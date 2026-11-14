import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { extractText } from 'unpdf';
import {
  createJwtToken,
  deriveChatTitle,
  getOrInitJwtSecret,
  hashPassword,
  sanitizeEmail,
  verifyJwtToken,
  verifyPassword,
} from './server/auth';
import { AppDatabase, type DbUser } from './server/db';
import {
  normalizeYoutubeApiKey,
  recommendYoutubeVideos,
  resolveGeminiTextModel,
  SlidingWindowRateLimiter,
  YouTubeServiceError,
} from './server/youtube';
import {
  createAudioAccessToken,
  generateVoiceTutorLesson,
  normalizeTutorLevel,
  normalizeTutorSourceType,
  resolveTutorLanguage,
  SUPPORTED_TUTOR_LANGUAGES,
  verifyAudioAccessToken,
} from './server/voiceTutor';
import type { DbVoiceTutorSession } from './server/db';
import {
  buildCacheKey,
  cleanPdfPageText,
  computeTextStats,
  splitTextIntoChunks,
  stitchWavClips,
  validateUploadFileName,
} from './src/utils/textMetrics';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR =
  path.basename(__dirname) === 'dist-server'
    ? path.resolve(__dirname, '..')
    : __dirname;

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_TEXT_MODEL = resolveGeminiTextModel(process.env.GEMINI_MODEL);
const FALLBACK_TEXT_MODEL = 'gemini-3.1-flash-lite';
const TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const FALLBACK_TTS_MODEL = 'gemini-3.8-flash-tts';
const MAX_SINGLE_CALL_CHARS = 28000;
const MAX_CACHE_ENTRIES = 60;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const DATA_DIR = process.env.DATA_DIR?.trim()
  ? path.resolve(process.env.DATA_DIR.trim())
  : path.resolve(ROOT_DIR, '.data');
const db = new AppDatabase(path.join(DATA_DIR, 'smart_learning.db'));
const jwtSecret = getOrInitJwtSecret(DATA_DIR);
const youtubeRateLimiter = new SlidingWindowRateLimiter(15, 60_000);

function isAllowedCorsOrigin(origin: string): boolean {
  const normalized = origin.trim().replace(/\/+$/, '');
  if (!normalized) return false;

  const configuredAppUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configuredAppUrl && normalized === configuredAppUrl) {
    return true;
  }

  const extraOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (extraOrigins.includes('*') || extraOrigins.includes(normalized)) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return true;
    }
    if (host.endsWith('.run.app')) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

interface AuthenticatedRequest extends Request {
  authUser?: DbUser;
}

const responseCache = new Map<string, unknown>();

function getCached<T>(key: string): T | undefined {
  if (!responseCache.has(key)) return undefined;
  const val = responseCache.get(key) as T;
  responseCache.delete(key);
  responseCache.set(key, val);
  return val;
}

function setCached(key: string, value: unknown): void {
  if (responseCache.has(key)) {
    responseCache.delete(key);
  } else if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey !== undefined) {
      responseCache.delete(oldestKey);
    }
  }
  responseCache.set(key, value);
}

function getGeminiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add it in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractErrorStatus(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const obj = err as { status?: unknown; statusCode?: unknown; code?: unknown };
    if (typeof obj.status === 'number') return obj.status;
    if (typeof obj.statusCode === 'number') return obj.statusCode;
    if (typeof obj.code === 'number') return obj.code;
  }
  return null;
}

function parseGeminiJson<T>(rawText: string | undefined): T {
  let cleaned = (rawText ?? '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  if (!cleaned) {
    throw new Error('The AI model returned an empty response. Please try again.');
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error('The AI model returned an unreadable response format. Please try again.');
  }
}

async function generateWithRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = extractErrorStatus(err);
      const msg = err instanceof Error ? err.message : String(err);
      const isPermanent =
        status === 400 ||
        status === 401 ||
        status === 403 ||
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('API_KEY_INVALID') ||
        msg.includes('INVALID_ARGUMENT') ||
        msg.includes('GEMINI_API_KEY') ||
        /\b403\b/.test(msg);
      if (isPermanent || attempt === maxAttempts - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }
  }
  throw lastError;
}

function isQuotaOrModelUnavailable(err: unknown): boolean {
  const status = extractErrorStatus(err);
  const msg = err instanceof Error ? err.message : String(err);
  return (
    status === 429 ||
    status === 404 ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('NOT_FOUND') ||
    /"code"\s*:\s*(?:429|404)/i.test(msg)
  );
}

async function generateTextWithFallback<T>(
  runner: (model: string) => Promise<T>
): Promise<T> {
  try {
    return await generateWithRetry(() => runner(DEFAULT_TEXT_MODEL), 2);
  } catch (err) {
    if (
      DEFAULT_TEXT_MODEL !== FALLBACK_TEXT_MODEL &&
      isQuotaOrModelUnavailable(err)
    ) {
      return await generateWithRetry(() => runner(FALLBACK_TEXT_MODEL), 2);
    }
    throw err;
  }
}

function formatApiError(err: unknown, fallback: string): { status: number; message: string } {
  const status = extractErrorStatus(err);
  const msg = err instanceof Error ? err.message : fallback;
  if (msg.includes('GEMINI_API_KEY')) {
    return { status: 500, message: msg };
  }
  if (
    status === 401 ||
    status === 403 ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('API_KEY_INVALID') ||
    (status === null && /"code"\s*:\s*403|"status"\s*:\s*"PERMISSION_DENIED"/i.test(msg))
  ) {
    return {
      status: 403,
      message: 'Gemini API authentication failed. Please verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (
    status === 429 ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    (status === null && /"code"\s*:\s*429|"status"\s*:\s*"RESOURCE_EXHAUSTED"/i.test(msg))
  ) {
    return {
      status: 429,
      message: 'Rate limit reached on Gemini API. Please wait a moment and try again.',
    };
  }
  return { status: 500, message: msg || fallback };
}

const ALLOWED_TTS_VOICES = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']);

function normalizeTtsVoice(voiceName?: string): string {
  return voiceName && ALLOWED_TTS_VOICES.has(voiceName) ? voiceName : 'Kore';
}

async function synthesizeVoiceAudioClip(params: {
  text: string;
  voiceName?: string;
  slow?: boolean;
  languageLabel?: string;
}): Promise<{
  audioBytes: Uint8Array;
  mimeType: string;
  chunkCount: number;
  cached: boolean;
}> {
  const cleaned = (params.text ?? '').trim();
  if (!cleaned) {
    throw new Error('No speakable text was found.');
  }

  const selectedVoice = normalizeTtsVoice(params.voiceName);
  const slow = Boolean(params.slow);
  const languageLabel = (params.languageLabel || 'English').trim() || 'English';

  const cacheKey = buildCacheKey('tts-clip', [
    selectedVoice,
    String(slow),
    languageLabel,
    cleaned,
  ]);
  const cached = getCached<{
    audioBase64: string;
    mimeType: string;
    chunkCount: number;
  }>(cacheKey);
  if (cached) {
    return {
      audioBytes: new Uint8Array(Buffer.from(cached.audioBase64, 'base64')),
      mimeType: cached.mimeType,
      chunkCount: cached.chunkCount,
      cached: true,
    };
  }

  const chunks = splitTextIntoChunks(cleaned, 1400);
  if (chunks.length === 0) {
    throw new Error('No speakable text was found.');
  }

  const ai = getGeminiClient('v1beta');
  const clipBuffers: Uint8Array[] = [];

  for (const chunk of chunks) {
    const runTtsForModel = (modelName: string) =>
      ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: chunk,
                speechMetadata: {
                  style: slow
                    ? `Warm, calm, slow, crystal-clear ${languageLabel} teacher voice for accessibility`
                    : `Warm, clear, engaging ${languageLabel} teacher voice explaining concepts naturally`,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

    let response;
    try {
      response = await generateWithRetry(() => runTtsForModel(TTS_MODEL), 2);
    } catch (ttsErr) {
      if (isQuotaOrModelUnavailable(ttsErr)) {
        response = await generateWithRetry(() => runTtsForModel(FALLBACK_TTS_MODEL), 2);
      } else {
        throw ttsErr;
      }
    }

    const partBase64 =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!partBase64) {
      throw new Error(
        'Audio generation returned empty data for a passage segment. Please try again.'
      );
    }

    clipBuffers.push(new Uint8Array(Buffer.from(partBase64, 'base64')));
  }

  const stitched = stitchWavClips(clipBuffers);
  setCached(cacheKey, {
    audioBase64: Buffer.from(stitched).toString('base64'),
    mimeType: 'audio/wav',
    chunkCount: chunks.length,
  });

  return {
    audioBytes: stitched,
    mimeType: 'audio/wav',
    chunkCount: chunks.length,
    cached: false,
  };
}

function buildSignedAudioUrl(audioId: string, userId: string): string {
  const token = createAudioAccessToken(audioId, userId, jwtSecret);
  return `/api/voice-tutor/audio/${encodeURIComponent(audioId)}?token=${encodeURIComponent(token)}`;
}

function hydrateVoiceTutorSession(userId: string, session: DbVoiceTutorSession) {
  const audioRefs = (session.audioRefs || []).map((ref) => ({
    ...ref,
    audioUrl: buildSignedAudioUrl(ref.audioId, userId),
  }));
  const primaryRef = audioRefs.find((r) => r.sectionIndex === 0) ?? audioRefs[0] ?? null;
  return {
    ...session,
    audioRefs,
    primaryAudioUrl: primaryRef ? primaryRef.audioUrl : null,
  };
}

function getLevelGuidance(readingLevel: string): string {
  switch (readingLevel) {
    case 'Intermediate':
      return (
        'Target level: INTERMEDIATE (high-school / early undergraduate level). ' +
        'Use clear everyday English while retaining standard academic vocabulary where useful, ' +
        'unpacking abstract sentences and providing concrete examples.'
      );
    case 'Advanced':
      return (
        'Target level: ADVANCED (clarity-focused academic revision). ' +
        'Preserve full technical nuance and precision while untangling overly dense sentence structures ' +
        'and illustrating complex mechanisms with sharp examples.'
      );
    case 'Beginner':
    default:
      return (
        'Target level: BEGINNER (plain everyday English). ' +
        'Use short sentences, familiar words, and clear everyday analogies so any student new to the topic can understand effortlessly.'
      );
  }
}

function getSummaryGuidance(summaryLength: string): string {
  switch (summaryLength) {
    case 'Detailed':
      return (
        'Length: DETAILED (3 to 4 thorough paragraphs covering main arguments, supporting mechanisms, and relationships), ' +
        'plus 6 to 8 comprehensive bullet points and 4 to 6 key concepts.'
      );
    case 'Medium':
      return (
        'Length: MEDIUM (1 to 2 balanced paragraphs covering the core message and key supporting ideas), ' +
        'plus 4 to 6 clear bullet points and 3 to 5 key concepts.'
      );
    case 'Short':
    default:
      return (
        'Length: SHORT (a crisp 2 to 4 sentence overview capturing the central thesis), ' +
        'plus 3 to 4 concise bullet points and 2 to 4 key concepts.'
      );
  }
}

async function condenseLongDocument(ai: GoogleGenAI, text: string): Promise<string> {
  if (text.length <= MAX_SINGLE_CALL_CHARS) {
    return text;
  }
  const sections = splitTextIntoChunks(text, 14000).slice(0, 6);
  const notes: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const res = await generateTextWithFallback((model) =>
      ai.models.generateContent({
        model,
        contents:
          `Extract all factual key points, definitions, and claims from Section ${i + 1} of the study material. ` +
          'Include ONLY information explicitly present in the text:\n\n' +
          sections[i],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Extract faithful, grounded study notes strictly from the provided section without adding outside facts.',
        },
      })
    );
    const extracted = (res.text ?? '').trim();
    if (extracted) {
      notes.push(`[Section ${i + 1}]\n${extracted}`);
    }
  }
  return notes.join('\n\n') || text.slice(0, MAX_SINGLE_CALL_CHARS);
}

async function extractPdfBuffer(buffer: Buffer, fileName: string): Promise<{
  text: string;
  pageCount: number;
  pagesWithText: number;
  ocrWarning: string | null;
}> {
  const uint8 = new Uint8Array(buffer);
  const result = await extractText(uint8, { mergePages: false });
  const rawPages: string[] = Array.isArray(result.text)
    ? result.text
    : [String(result.text ?? '')];

  const totalPages = result.totalPages || rawPages.length || 1;
  const formattedPages: string[] = [];
  let emptyPageCount = 0;

  for (let i = 0; i < rawPages.length; i++) {
    const cleanedPage = cleanPdfPageText(rawPages[i] ?? '');
    if (cleanedPage) {
      if (totalPages > 1) {
        formattedPages.push(`[Page ${i + 1}]\n${cleanedPage}`);
      } else {
        formattedPages.push(cleanedPage);
      }
    } else {
      emptyPageCount += 1;
    }
  }

  const combinedText = formattedPages.join('\n\n').trim();
  if (!combinedText) {
    throw new Error(
      `No extractable text was found in "${fileName || 'this PDF'}". ` +
        'It appears to be a scanned or image-only PDF, so OCR (Optical Character Recognition) ' +
        'is required before its text can be processed. Please run OCR on the PDF or upload a text-based PDF/TXT file.'
    );
  }

  const pagesWithText = Math.max(1, rawPages.length - emptyPageCount);
  const ocrWarning =
    emptyPageCount > 0
      ? `${emptyPageCount} of ${totalPages} page(s) contained no selectable text (likely scanned images or diagrams requiring OCR). Extracted text from the remaining ${pagesWithText} page(s).`
      : null;

  return {
    text: combinedText,
    pageCount: totalPages,
    pagesWithText,
    ocrWarning,
  };
}

async function generateAssistantPayload(
  studyMaterial: string,
  question: string
): Promise<{
  foundInMaterial: boolean;
  answer: string;
  examples: string[];
  supportingQuote: string;
  cached?: boolean;
}> {
  const cacheKey = buildCacheKey('assistant', [question.toLowerCase(), studyMaterial]);
  const cached = getCached<{
    foundInMaterial: boolean;
    answer: string;
    examples: string[];
    supportingQuote: string;
  }>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const ai = getGeminiClient();
  const boundedMaterial =
    studyMaterial.length > 36000
      ? `${studyMaterial.slice(0, 36000)}\n\n[Material truncated to 36,000 characters]`
      : studyMaterial;

  const response = await generateTextWithFallback((model) =>
    ai.models.generateContent({
      model,
      contents:
        `Study Material:\n"""\n${boundedMaterial}\n"""\n\n` +
        `Student Question: ${question}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction:
          'You are a strict, student-friendly AI Learning Assistant. ' +
          'Answer the student question using ONLY the provided Study Material. ' +
          'Never invent facts or rely on outside knowledge. ' +
          'If the Study Material does NOT contain enough information to answer the question, ' +
          'you MUST set foundInMaterial to false, explain clearly that this answer is not available in the uploaded material, ' +
          'set examples to an empty array, and set supportingQuote to an empty string. ' +
          'When foundInMaterial is true, answer in simple, encouraging English, include 1-2 relatable examples based on the concept, ' +
          'and provide a short direct quote from the Study Material as supportingQuote.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            foundInMaterial: {
              type: Type.BOOLEAN,
              description: 'True only if the answer is supported by the provided study material.',
            },
            answer: {
              type: Type.STRING,
              description:
                'Clear, beginner-friendly answer grounded in the study material, or explicit notice that the answer is not in the material.',
            },
            examples: {
              type: Type.ARRAY,
              description: '1 to 2 simple examples illustrating the answer when foundInMaterial is true.',
              items: { type: Type.STRING },
            },
            supportingQuote: {
              type: Type.STRING,
              description: 'Short exact snippet from the study material supporting the answer, or empty string.',
            },
          },
          required: ['foundInMaterial', 'answer', 'examples', 'supportingQuote'],
        },
      },
    })
  );

  const parsed = parseGeminiJson<{
    foundInMaterial?: unknown;
    answer?: string;
    examples?: unknown;
    supportingQuote?: unknown;
  }>(response.text);
  const payload = {
    foundInMaterial: Boolean(parsed.foundInMaterial),
    answer: parsed.answer ?? 'I could not find an answer in the provided material.',
    examples: Array.isArray(parsed.examples) ? parsed.examples : [],
    supportingQuote: typeof parsed.supportingQuote === 'string' ? parsed.supportingQuote : '',
  };
  setCached(cacheKey, payload);
  return payload;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const token = header.slice(7).trim();
  const claims = verifyJwtToken(token, jwtSecret);
  if (!claims) {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    return;
  }

  const user = db.findUserById(claims.sub);
  if (!user) {
    res.status(401).json({ error: 'Account not found. Please sign in again.' });
    return;
  }

  req.authUser = user;
  next();
}

async function startServer() {
  const app = express();
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    if (origin && isAllowedCorsOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Accept, X-Requested-With, Cache-Control'
      );
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '18mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      model: DEFAULT_TEXT_MODEL,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      youtubeConfigured: Boolean(normalizeYoutubeApiKey(process.env.YOUTUBE_API_KEY)),
    });
  });

  // ── Auth Routes ────────────────────────────────────────────────────────────
  app.post('/api/auth/register', (req, res) => {
    try {
      const { fullName, email, password } = req.body as {
        fullName?: string;
        email?: string;
        password?: string;
      };

      const trimmedName = (fullName ?? '').trim();
      const normalizedEmail = sanitizeEmail(email ?? '');
      const rawPassword = password ?? '';

      if (trimmedName.length < 2) {
        res.status(400).json({ error: 'Please enter your full name (at least 2 characters).' });
        return;
      }
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
      }
      if (rawPassword.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }

      const existing = db.findUserByEmail(normalizedEmail);
      if (existing) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      const user = db.createUser({
        fullName: trimmedName,
        email: normalizedEmail,
        passwordHash: hashPassword(rawPassword),
      });
      const accessToken = createJwtToken({ sub: user.id, email: user.email }, jwtSecret);
      res.status(201).json({ accessToken, tokenType: 'bearer', user });
    } catch {
      res.status(500).json({ error: 'Failed to create account. Please try again.' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const { email, password } = req.body as {
        email?: string;
        password?: string;
      };
      const normalizedEmail = sanitizeEmail(email ?? '');
      const rawPassword = password ?? '';

      if (!normalizedEmail || !rawPassword) {
        res.status(400).json({ error: 'Please enter your email and password.' });
        return;
      }

      const user = db.findUserByEmail(normalizedEmail);
      if (!user || !verifyPassword(rawPassword, user.passwordHash)) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const accessToken = createJwtToken({ sub: user.id, email: user.email }, jwtSecret);
      res.json({
        accessToken,
        tokenType: 'bearer',
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          createdAt: user.createdAt,
        },
      });
    } catch {
      res.status(500).json({ error: 'Sign in failed. Please try again.' });
    }
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.authUser });
  });

  // ── Document Routes ────────────────────────────────────────────────────────
  app.post('/api/documents/upload', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const { fileName, base64Data } = req.body as {
        fileName?: string;
        base64Data?: string;
      };

      if (!fileName || typeof fileName !== 'string') {
        res.status(400).json({ error: 'A filename is required.' });
        return;
      }

      const check = validateUploadFileName(fileName);
      if (!check.valid || !check.extension) {
        res.status(400).json({ error: check.error ?? 'Unsupported file format.' });
        return;
      }

      if (!base64Data || typeof base64Data !== 'string') {
        res.status(400).json({ error: 'No file data was provided.' });
        return;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0) {
        res.status(400).json({ error: 'The selected file is empty.' });
        return;
      }
      if (buffer.length > MAX_UPLOAD_BYTES) {
        res.status(413).json({ error: 'File exceeds the 12 MB upload limit.' });
        return;
      }

      let extractedText = '';
      let pageCount = 1;
      let pagesWithText = 1;
      let ocrWarning: string | null = null;
      let fileType: 'PDF' | 'TXT' = 'TXT';
      let mimeType = 'text/plain';

      if (check.extension === 'txt') {
        extractedText = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
        if (!extractedText) {
          res.status(422).json({ error: 'The uploaded TXT file contains no readable text.' });
          return;
        }
      } else {
        fileType = 'PDF';
        mimeType = 'application/pdf';
        try {
          const pdfResult = await extractPdfBuffer(buffer, fileName);
          extractedText = pdfResult.text;
          pageCount = pdfResult.pageCount;
          pagesWithText = pdfResult.pagesWithText;
          ocrWarning = pdfResult.ocrWarning;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Unable to extract text from this PDF.';
          res.status(422).json({
            error: message.includes('No extractable text')
              ? message
              : `Could not read this PDF file. Please ensure it is not password-protected or corrupted. (${message})`,
          });
          return;
        }
      }

      const stats = computeTextStats(extractedText);
      const saved = db.createDocument({
        userId,
        originalFilename: fileName.trim(),
        fileType,
        mimeType,
        wordCount: stats.words,
        pageCount,
        pagesWithText,
        ocrWarning,
        extractedText,
        fileContent: new Uint8Array(buffer),
      });

      res.status(201).json(saved);
    } catch {
      res.status(500).json({ error: 'Failed to process uploaded document.' });
    }
  });

  app.get('/api/documents', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const documents = db.listDocuments(userId);
    res.json({ documents });
  });

  app.get('/api/documents/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const doc = db.getDocument(userId, String(req.params.id));
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    res.json(doc);
  });

  app.get('/api/documents/:id/download', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const file = db.getDocumentBinary(userId, String(req.params.id));
    if (!file) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    const safeFilename = file.filename.replace(/["\\\r\n]/g, '_');
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.send(Buffer.from(file.content));
  });

  app.delete('/api/documents/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const deleted = db.deleteDocument(userId, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // ── Chat / Conversation Routes ─────────────────────────────────────────────
  app.post('/api/chats', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const { title, documentId } = (req.body || {}) as {
      title?: string;
      documentId?: string | null;
    };
    const conversation = db.createConversation({
      userId,
      title,
      documentId: documentId ?? null,
    });
    res.status(201).json(conversation);
  });

  app.get('/api/chats', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const conversations = db.listConversations(userId, q);
    res.json({ conversations });
  });

  app.get('/api/chats/:chatId', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const detail = db.getConversation(userId, String(req.params.chatId));
    if (!detail) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    res.json(detail);
  });

  app.patch('/api/chats/:chatId', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const { title, documentId } = (req.body || {}) as {
      title?: string;
      documentId?: string | null;
    };
    const updated = db.updateConversation(userId, String(req.params.chatId), {
      title,
      documentId,
    });
    if (!updated) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    res.json(updated);
  });

  app.delete('/api/chats/:chatId', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const deleted = db.deleteConversation(userId, String(req.params.chatId));
    if (!deleted) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/chats/:chatId/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const chatId = String(req.params.chatId);
      const chat = db.getConversation(userId, chatId);
      if (!chat) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      const { content, sourceText, documentId } = (req.body || {}) as {
        content?: string;
        sourceText?: string;
        documentId?: string | null;
      };

      const cleanedQuestion = (content ?? '').trim();
      if (cleanedQuestion.length < 3) {
        res.status(400).json({ error: 'Please enter a clear question (at least 3 characters).' });
        return;
      }

      let material = (sourceText ?? '').trim();
      if (!material && documentId) {
        material = db.getDocument(userId, documentId)?.text ?? '';
      }
      if (!material && chat.document?.text) {
        material = chat.document.text;
      }

      if (!material || material.length < 15) {
        res.status(400).json({
          error: 'Please load or select study material before asking a question.',
        });
        return;
      }

      const aiReply = await generateAssistantPayload(material, cleanedQuestion);
      const turn = db.appendChatTurn({
        userId,
        conversationId: chatId,
        userQuestion: cleanedQuestion,
        assistantAnswer: aiReply.answer,
        foundInMaterial: aiReply.foundInMaterial,
        examples: aiReply.examples,
        supportingQuote: aiReply.supportingQuote,
        newTitle: deriveChatTitle(cleanedQuestion),
        documentId: documentId ?? null,
      });

      if (!turn) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      res.status(201).json(turn);
    } catch (err) {
      const formatted = formatApiError(err, 'Failed to answer your learning question.');
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // ── Learning Results & Unified History Search ──────────────────────────────
  app.get('/api/learning-results', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const resultType =
      typeof req.query.resultType === 'string' ? req.query.resultType : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const results = db.listLearningResults(userId, { resultType, query: q });
    res.json({ results });
  });

  app.post('/api/learning-results', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const {
      resultType,
      title,
      readingLevel,
      summaryLength,
      sourceExcerpt,
      contentText,
      documentId,
      keywords,
      bulletPoints,
      concepts,
      examples,
    } = (req.body || {}) as {
      resultType?: 'simplified' | 'summary' | 'explanation';
      title?: string;
      readingLevel?: string | null;
      summaryLength?: string | null;
      sourceExcerpt?: string;
      contentText?: string;
      documentId?: string | null;
      keywords?: string[];
      bulletPoints?: string[];
      concepts?: { term: string; explanation?: string; definition?: string }[];
      examples?: string[];
    };

    if (!contentText || !contentText.trim()) {
      res.status(400).json({ error: 'Result content text is required.' });
      return;
    }

    const normalizedType =
      resultType === 'simplified' || resultType === 'summary' ? resultType : 'explanation';

    const created = db.createLearningResult({
      userId,
      documentId: documentId ?? null,
      resultType: normalizedType,
      title: (title ?? '').trim() || 'Saved Study Result',
      readingLevel: readingLevel ?? null,
      summaryLength: summaryLength ?? null,
      sourceExcerpt: (sourceExcerpt ?? '').slice(0, 600),
      contentText: contentText.trim(),
      keywords: Array.isArray(keywords) ? keywords : [],
      bulletPoints: Array.isArray(bulletPoints) ? bulletPoints : [],
      concepts: Array.isArray(concepts) ? concepts : [],
      examples: Array.isArray(examples) ? examples : [],
    });

    res.status(201).json(created);
  });

  app.delete('/api/learning-results/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const deleted = db.deleteLearningResult(userId, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Saved result not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/history', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    res.json({
      conversations: db.listConversations(userId),
      documents: db.listDocuments(userId),
      learningResults: db.listLearningResults(userId),
      videoRecommendations: db.listVideoRecommendations(userId),
      voiceTutorSessions: db
        .listVoiceTutorSessions(userId)
        .map((session) => hydrateVoiceTutorSession(userId, session)),
    });
  });

  app.get('/api/history/search', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    res.json({
      query,
      conversations: db.listConversations(userId, query),
      documents: db.listDocuments(userId, query),
      learningResults: db.listLearningResults(userId, { query }),
      videoRecommendations: db.listVideoRecommendations(userId, { query }),
      voiceTutorSessions: db
        .listVoiceTutorSessions(userId, { query })
        .map((session) => hydrateVoiceTutorSession(userId, session)),
    });
  });

  // ── YouTube Educational Video Recommendations ──────────────────────────────
  app.post('/api/recommendations/youtube', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const rateCheck = youtubeRateLimiter.allow(userId);
      if (!rateCheck.allowed) {
        res.status(429).json({
          error: `Too many recommendation requests. Please wait ${rateCheck.retryAfterSeconds} second(s) and try again.`,
        });
        return;
      }

      const {
        content = '',
        customTopic = '',
        keywords = [],
        learningLevel = 'Beginner',
        preferredLanguage = 'English',
        sourceType = 'text',
        documentId = null,
        conversationId = null,
        forceRefresh = false,
        saveToHistory = true,
      } = (req.body || {}) as {
        content?: string;
        customTopic?: string;
        keywords?: string[];
        learningLevel?: string;
        preferredLanguage?: string;
        sourceType?: string;
        documentId?: string | null;
        conversationId?: string | null;
        forceRefresh?: boolean;
        saveToHistory?: boolean;
      };

      let effectiveContent = typeof content === 'string' ? content.trim() : '';
      const trimmedCustomTopic = typeof customTopic === 'string' ? customTopic.trim() : '';

      if (!effectiveContent && documentId) {
        const doc = db.getDocument(userId, documentId);
        if (doc?.text) {
          effectiveContent = doc.text;
        }
      }

      if (!effectiveContent && conversationId) {
        const conv = db.getConversation(userId, conversationId);
        if (conv) {
          const msgContext = conv.messages.map((m) => m.content).join('\n');
          effectiveContent = msgContext || conv.document?.text || conv.title;
        }
      }

      if (effectiveContent.length < 3 && trimmedCustomTopic.length < 2) {
        res.status(400).json({
          error:
            'Please provide a custom topic, study text, summary, or question to recommend educational videos.',
        });
        return;
      }

      const result = await recommendYoutubeVideos({
        content: effectiveContent,
        customTopic: trimmedCustomTopic,
        keywords: Array.isArray(keywords) ? keywords : [],
        learningLevel,
        preferredLanguage,
        sourceType: trimmedCustomTopic && !effectiveContent ? 'custom' : sourceType,
        forceRefresh: Boolean(forceRefresh),
        getAiClient: () => {
          try {
            return getGeminiClient();
          } catch {
            return null;
          }
        },
      });

      let savedRecordId: string | null = null;
      let createdAt = new Date().toISOString();
      if (saveToHistory && result.videos.length > 0) {
        const saved = db.saveVideoRecommendation({
          userId,
          conversationId,
          documentId,
          sourceType: result.sourceType,
          topic: result.topic,
          searchQuery: result.searchQuery,
          learningLevel: result.learningLevel,
          preferredLanguage: result.preferredLanguage,
          keywords: result.keywords,
          videos: result.videos,
        });
        savedRecordId = saved.id;
        createdAt = saved.createdAt;
      }

      res.json({
        id: savedRecordId,
        conversationId: conversationId ?? null,
        documentId: documentId ?? null,
        ...result,
        createdAt,
      });
    } catch (err) {
      if (err instanceof YouTubeServiceError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const formatted = formatApiError(
        err,
        'Failed to fetch YouTube educational video recommendations.'
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.get('/api/recommendations/youtube/history', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const conversationId =
      typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined;
    const query = typeof req.query.q === 'string' ? req.query.q : undefined;
    const recommendations = db.listVideoRecommendations(userId, { conversationId, query });
    res.json({ recommendations });
  });

  app.delete('/api/recommendations/youtube/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const deleted = db.deleteVideoRecommendation(userId, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Saved video recommendation not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // ── Protected Core Processing Endpoints ────────────────────────────────────
  app.post('/api/extract-pdf', requireAuth, async (req, res) => {
    try {
      const { base64Data, fileName } = req.body as {
        base64Data?: string;
        fileName?: string;
      };

      if (!base64Data || typeof base64Data !== 'string') {
        res.status(400).json({ error: 'No PDF data was provided.' });
        return;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0) {
        res.status(400).json({ error: 'The uploaded PDF file is empty.' });
        return;
      }

      const pdfResult = await extractPdfBuffer(buffer, fileName || 'this PDF');
      res.json(pdfResult);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to extract text from this PDF.';
      res.status(422).json({
        error: message.includes('No extractable text')
          ? message
          : `Could not read this PDF file. Please ensure it is not password-protected or corrupted. (${message})`,
      });
    }
  });

  app.post('/api/simplify', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const {
        text,
        readingLevel = 'Beginner',
        documentId = null,
        saveToHistory = true,
      } = req.body as {
        text?: string;
        readingLevel?: string;
        documentId?: string | null;
        saveToHistory?: boolean;
      };

      const cleaned = (text ?? '').trim();
      if (!cleaned) {
        res.status(400).json({ error: 'Please provide educational text to simplify.' });
        return;
      }

      const normalizedLevel =
        readingLevel === 'Intermediate' || readingLevel === 'Advanced'
          ? readingLevel
          : 'Beginner';

      const cacheKey = buildCacheKey('simplify', [normalizedLevel, cleaned]);
      let payload = getCached<{
        simplifiedText: string;
        difficultConcepts: { term: string; explanation: string }[];
        examples: string[];
      }>(cacheKey);
      let fromCache = Boolean(payload);

      if (!payload) {
        const ai = getGeminiClient();
        const effectiveText =
          cleaned.length > MAX_SINGLE_CALL_CHARS
            ? await condenseLongDocument(ai, cleaned)
            : cleaned;

        const response = await generateTextWithFallback((model) =>
          ai.models.generateContent({
            model,
            contents:
              `${getLevelGuidance(normalizedLevel)}\n\n` +
              `Simplify the following educational content while preserving 100% of its core meaning and important details:\n\n${effectiveText}`,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction:
                'You are an empathetic educational accessibility assistant. ' +
                'Rewrite complex academic or technical passages cleanly according to the requested explanation level ' +
                'while preserving 100% of the original meaning and accuracy. ' +
                'Explain difficult technical terms clearly and give relatable real-world examples.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  simplifiedText: {
                    type: Type.STRING,
                    description: 'The rewritten passage tailored to the chosen explanation level.',
                  },
                  difficultConcepts: {
                    type: Type.ARRAY,
                    description: 'Technical or difficult terms explained in plain language.',
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        term: { type: Type.STRING },
                        explanation: { type: Type.STRING },
                      },
                      required: ['term', 'explanation'],
                    },
                  },
                  examples: {
                    type: Type.ARRAY,
                    description: 'Helpful real-world examples illustrating the ideas.',
                    items: { type: Type.STRING },
                  },
                },
                required: ['simplifiedText', 'difficultConcepts', 'examples'],
              },
            },
          })
        );

        const parsed = parseGeminiJson<{
          simplifiedText?: string;
          difficultConcepts?: unknown;
          examples?: unknown;
        }>(response.text);
        payload = {
          simplifiedText: parsed.simplifiedText ?? '',
          difficultConcepts: Array.isArray(parsed.difficultConcepts)
            ? parsed.difficultConcepts
            : [],
          examples: Array.isArray(parsed.examples) ? parsed.examples : [],
        };
        setCached(cacheKey, payload);
      }

      let savedResultId: string | null = null;
      if (saveToHistory) {
        const doc = documentId ? db.getDocument(userId, documentId) : null;
        const titlePrefix = doc ? doc.originalFilename : deriveChatTitle(cleaned);
        const saved = db.createLearningResult({
          userId,
          documentId: doc?.id ?? null,
          resultType: 'simplified',
          title: `Simplified (${normalizedLevel}) · ${titlePrefix}`,
          readingLevel: normalizedLevel,
          sourceExcerpt: cleaned.slice(0, 600),
          contentText: payload.simplifiedText,
          concepts: payload.difficultConcepts,
          examples: payload.examples,
        });
        savedResultId = saved.id;
      }

      res.json({ ...payload, cached: fromCache, savedResultId });
    } catch (err) {
      const formatted = formatApiError(err, 'Failed to simplify educational text.');
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/summarize', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const {
        text,
        summaryLength = 'Short',
        documentId = null,
        saveToHistory = true,
      } = req.body as {
        text?: string;
        summaryLength?: string;
        documentId?: string | null;
        saveToHistory?: boolean;
      };

      const cleaned = (text ?? '').trim();
      if (!cleaned) {
        res.status(400).json({ error: 'Please provide educational text to summarize.' });
        return;
      }

      const normalizedLength =
        summaryLength === 'Medium' || summaryLength === 'Detailed'
          ? summaryLength
          : 'Short';

      const cacheKey = buildCacheKey('summarize', [normalizedLength, cleaned]);
      let payload = getCached<{
        summaryText: string;
        keywords: string[];
        bulletPoints: string[];
        keyConcepts: { term: string; definition: string }[];
      }>(cacheKey);
      let fromCache = Boolean(payload);

      if (!payload) {
        const ai = getGeminiClient();
        const sourceForSummary = await condenseLongDocument(ai, cleaned);

        const response = await generateTextWithFallback((model) =>
          ai.models.generateContent({
            model,
            contents:
              `${getSummaryGuidance(normalizedLength)}\n\n` +
              'Strictly summarize ONLY what is supported by the source material below. ' +
              'Do NOT introduce external facts or unsupported claims:\n\n' +
              sourceForSummary,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction:
                'You are an accurate educational study-skills assistant. ' +
                'Produce faithful summaries calibrated to the requested length (Short, Medium, or Detailed). ' +
                'Extract high-value keywords, bullet-point takeaways, and key definitions strictly supported by the source text.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  summaryText: {
                    type: Type.STRING,
                    description: 'Overview summary calibrated to the requested length.',
                  },
                  keywords: {
                    type: Type.ARRAY,
                    description: '5 to 10 essential keywords explicitly present in the source text.',
                    items: { type: Type.STRING },
                  },
                  bulletPoints: {
                    type: Type.ARRAY,
                    description: 'Important study takeaways as concise bullet points.',
                    items: { type: Type.STRING },
                  },
                  keyConcepts: {
                    type: Type.ARRAY,
                    description: 'Important concepts and definitions supported by the text.',
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        term: { type: Type.STRING },
                        definition: { type: Type.STRING },
                      },
                      required: ['term', 'definition'],
                    },
                  },
                },
                required: ['summaryText', 'keywords', 'bulletPoints', 'keyConcepts'],
              },
            },
          })
        );

        const parsed = parseGeminiJson<{
          summaryText?: string;
          keywords?: unknown;
          bulletPoints?: unknown;
          keyConcepts?: unknown;
        }>(response.text);
        payload = {
          summaryText: parsed.summaryText ?? '',
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
          bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints : [],
          keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : [],
        };
        setCached(cacheKey, payload);
      }

      let savedResultId: string | null = null;
      if (saveToHistory) {
        const doc = documentId ? db.getDocument(userId, documentId) : null;
        const titlePrefix = doc ? doc.originalFilename : deriveChatTitle(cleaned);
        const saved = db.createLearningResult({
          userId,
          documentId: doc?.id ?? null,
          resultType: 'summary',
          title: `Summary (${normalizedLength}) · ${titlePrefix}`,
          summaryLength: normalizedLength,
          sourceExcerpt: cleaned.slice(0, 600),
          contentText: payload.summaryText,
          keywords: payload.keywords,
          bulletPoints: payload.bulletPoints,
          concepts: payload.keyConcepts,
        });
        savedResultId = saved.id;
      }

      res.json({ ...payload, cached: fromCache, savedResultId });
    } catch (err) {
      const formatted = formatApiError(err, 'Failed to summarize educational text.');
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/assistant', requireAuth, async (req, res) => {
    try {
      const { text, question } = req.body as {
        text?: string;
        question?: string;
      };

      const cleanedText = (text ?? '').trim();
      const cleanedQuestion = (question ?? '').trim();

      if (!cleanedText || cleanedText.length < 15) {
        res.status(400).json({ error: 'Please load or enter educational material before asking a question.' });
        return;
      }
      if (!cleanedQuestion || cleanedQuestion.length < 3) {
        res.status(400).json({ error: 'Please enter a clear question about your study material.' });
        return;
      }

      const payload = await generateAssistantPayload(cleanedText, cleanedQuestion);
      res.json(payload);
    } catch (err) {
      const formatted = formatApiError(err, 'Failed to answer your learning question.');
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // ── AI Voice Tutor Endpoints ───────────────────────────────────────────────
  app.get('/api/voice-tutor/languages', (_req, res) => {
    res.json({ languages: SUPPORTED_TUTOR_LANGUAGES });
  });

  app.post('/api/voice-tutor/explain', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const {
        topic = '',
        content = '',
        sourceType = 'topic',
        documentId = null,
        conversationId = null,
        learningLevel = 'Beginner',
        preferredLanguage = 'English',
        voiceName = 'Kore',
        slow = false,
        generateInitialAudio = true,
      } = (req.body || {}) as {
        topic?: string;
        content?: string;
        sourceType?: string;
        documentId?: string | null;
        conversationId?: string | null;
        learningLevel?: string;
        preferredLanguage?: string;
        voiceName?: string;
        slow?: boolean;
        generateInitialAudio?: boolean;
      };

      let effectiveTopic = typeof topic === 'string' ? topic.trim() : '';
      let effectiveContent = typeof content === 'string' ? content.trim() : '';
      let sourceDocumentName = '';
      const normalizedSourceType = normalizeTutorSourceType(sourceType);
      const normalizedLevel = normalizeTutorLevel(learningLevel);
      const language = resolveTutorLanguage(preferredLanguage);
      const selectedVoice = normalizeTtsVoice(voiceName);
      const slowFlag = Boolean(slow);

      if (documentId) {
        const doc = db.getDocument(userId, documentId);
        if (doc) {
          sourceDocumentName = doc.originalFilename || doc.filename;
          if (!effectiveContent && doc.text) {
            effectiveContent = doc.text.trim();
          }
          if (!effectiveTopic) {
            effectiveTopic = sourceDocumentName;
          }
        }
      }

      if (conversationId) {
        const conv = db.getConversation(userId, conversationId);
        if (conv) {
          if (!effectiveContent) {
            const msgContext = conv.messages
              .map((m) => `${m.role === 'user' ? 'Student Question' : 'Tutor Answer'}: ${m.content}`)
              .join('\n\n');
            effectiveContent = msgContext || conv.document?.text || conv.title;
          }
          if (!effectiveTopic) {
            effectiveTopic = conv.title || 'Previous Conversation';
          }
        }
      }

      if (effectiveTopic.length < 2 && effectiveContent.length < 10) {
        res.status(400).json({
          error:
            'Please enter a topic, paste study text, or select a document, summary, or conversation to explain.',
        });
        return;
      }

      const ai = getGeminiClient();
      const condensedContent =
        effectiveContent.length > MAX_SINGLE_CALL_CHARS
          ? await condenseLongDocument(ai, effectiveContent)
          : effectiveContent;

      const lesson = await generateTextWithFallback((model) =>
        generateVoiceTutorLesson({
          ai,
          topic: effectiveTopic,
          content: condensedContent,
          sourceType: normalizedSourceType,
          learningLevel: normalizedLevel,
          preferredLanguage: language.label,
          sourceDocumentName,
          model,
        })
      );

      const savedSession = db.saveVoiceTutorSession({
        userId,
        documentId,
        conversationId,
        sourceType: lesson.sourceType,
        topic: lesson.topic,
        lessonTitle: lesson.lessonTitle,
        sourceExcerpt: effectiveContent || effectiveTopic,
        learningLevel: lesson.learningLevel,
        preferredLanguage: lesson.preferredLanguage,
        languageCode: lesson.languageCode,
        voiceName: selectedVoice,
        slow: slowFlag,
        explanation: lesson.explanation,
        sections: lesson.sections,
        audioRefs: [],
      });

      let audioId: string | null = null;
      let audioUrl: string | null = null;
      let audioError: string | null = null;
      let chunkCount = 0;

      if (generateInitialAudio !== false && lesson.sections.length > 0) {
        try {
          const clip = await synthesizeVoiceAudioClip({
            text: lesson.sections[0]!.spokenScript,
            voiceName: selectedVoice,
            slow: slowFlag,
            languageLabel: lesson.preferredLanguage,
          });
          const audioRef = db.saveVoiceTutorAudio({
            userId,
            sessionId: savedSession.id,
            sectionIndex: 0,
            languageCode: lesson.languageCode,
            voiceName: selectedVoice,
            slow: slowFlag,
            mimeType: clip.mimeType,
            audioBytes: clip.audioBytes,
          });
          audioId = audioRef.audioId;
          audioUrl = buildSignedAudioUrl(audioRef.audioId, userId);
          chunkCount = clip.chunkCount;
        } catch (ttsErr) {
          audioError = formatApiError(
            ttsErr,
            'Explanation generated, but speech synthesis failed.'
          ).message;
        }
      }

      const latestSession =
        db.getVoiceTutorSession(userId, savedSession.id) ?? savedSession;
      const hydrated = hydrateVoiceTutorSession(userId, latestSession);

      res.json({
        session: hydrated,
        explanation: hydrated.explanation,
        sections: hydrated.sections,
        audioId,
        audioUrl,
        sectionIndex: 0,
        mimeType: 'audio/wav',
        chunkCount,
        audioError,
        metadata: {
          topic: hydrated.topic,
          lessonTitle: hydrated.lessonTitle,
          learningLevel: hydrated.learningLevel,
          preferredLanguage: hydrated.preferredLanguage,
          languageCode: hydrated.languageCode,
          sourceType: hydrated.sourceType,
          voiceName: hydrated.voiceName,
          sectionCount: hydrated.sections.length,
        },
        cached: lesson.cached,
      });
    } catch (err) {
      const formatted = formatApiError(
        err,
        'Failed to generate AI Voice Tutor explanation.'
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/voice-tutor/sections/audio', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.authUser!.id;
      const {
        sessionId = null,
        sectionIndex = 0,
        text = '',
        preferredLanguage = 'English',
        voiceName = 'Kore',
        slow = false,
      } = (req.body || {}) as {
        sessionId?: string | null;
        sectionIndex?: number;
        text?: string;
        preferredLanguage?: string;
        voiceName?: string;
        slow?: boolean;
      };

      const selectedVoice = normalizeTtsVoice(voiceName);
      const slowFlag = Boolean(slow);
      const numericIndex = Number.isInteger(sectionIndex) && sectionIndex >= 0 ? sectionIndex : 0;

      let targetSession = sessionId
        ? db.getVoiceTutorSession(userId, sessionId)
        : null;
      if (sessionId && !targetSession) {
        res.status(404).json({ error: 'Voice Tutor session not found.' });
        return;
      }

      const language = resolveTutorLanguage(
        targetSession?.preferredLanguage || preferredLanguage
      );

      let spokenText = typeof text === 'string' ? text.trim() : '';
      if (!spokenText && targetSession) {
        const matchedSection = targetSession.sections.find(
          (s) => s.index === numericIndex
        );
        if (!matchedSection) {
          res.status(400).json({ error: 'Requested lesson section was not found.' });
          return;
        }
        spokenText = matchedSection.spokenScript;
      }

      if (!spokenText) {
        res.status(400).json({ error: 'Section text is required to synthesize audio.' });
        return;
      }

      if (targetSession) {
        const existingRef = db.findVoiceTutorAudioBySection({
          userId,
          sessionId: targetSession.id,
          sectionIndex: numericIndex,
          languageCode: language.code,
          voiceName: selectedVoice,
          slow: slowFlag,
        });
        if (existingRef) {
          res.json({
            audioId: existingRef.audioId,
            audioUrl: buildSignedAudioUrl(existingRef.audioId, userId),
            sectionIndex: numericIndex,
            mimeType: existingRef.mimeType,
            chunkCount: 1,
            cached: true,
          });
          return;
        }
      }

      const clip = await synthesizeVoiceAudioClip({
        text: spokenText,
        voiceName: selectedVoice,
        slow: slowFlag,
        languageLabel: language.label,
      });

      const audioRef = db.saveVoiceTutorAudio({
        userId,
        sessionId: targetSession?.id ?? null,
        sectionIndex: numericIndex,
        languageCode: language.code,
        voiceName: selectedVoice,
        slow: slowFlag,
        mimeType: clip.mimeType,
        audioBytes: clip.audioBytes,
      });

      res.json({
        audioId: audioRef.audioId,
        audioUrl: buildSignedAudioUrl(audioRef.audioId, userId),
        sectionIndex: numericIndex,
        mimeType: audioRef.mimeType,
        chunkCount: clip.chunkCount,
        cached: clip.cached,
      });
    } catch (err) {
      const formatted = formatApiError(
        err,
        'Failed to generate section audio.'
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.get('/api/voice-tutor/audio/:audioId', (req, res) => {
    const audioId = String(req.params.audioId || '').trim();
    if (!audioId) {
      res.status(400).json({ error: 'Audio ID is required.' });
      return;
    }

    let userId: string | null = null;
    const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (queryToken) {
      const verified = verifyAudioAccessToken(queryToken, audioId, jwtSecret);
      if (verified) {
        userId = verified.userId;
      }
    }

    if (!userId) {
      const header = req.headers.authorization || '';
      if (header.startsWith('Bearer ')) {
        const claims = verifyJwtToken(header.slice(7).trim(), jwtSecret);
        if (claims?.sub) {
          userId = claims.sub;
        }
      }
    }

    if (!userId) {
      res.status(401).json({ error: 'Authentication required to access audio.' });
      return;
    }

    const record = db.getVoiceTutorAudio(userId, audioId);
    if (!record) {
      res.status(404).json({ error: 'Audio clip not found.' });
      return;
    }

    const buffer = Buffer.from(record.bytes);
    const totalLength = buffer.length;
    const mimeType = record.mimeType || 'audio/wav';
    const rangeHeader = req.headers.range;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="voice-tutor-${audioId}.wav"`
    );

    if (rangeHeader && /^bytes=\d*-\d*$/i.test(rangeHeader.trim())) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/i, '').split('-');
      let start = startStr ? Number.parseInt(startStr, 10) : 0;
      let end = endStr ? Number.parseInt(endStr, 10) : totalLength - 1;
      if (Number.isNaN(start) || start < 0) start = 0;
      if (Number.isNaN(end) || end >= totalLength) end = totalLength - 1;
      if (start > end || start >= totalLength) {
        res.status(416).setHeader('Content-Range', `bytes */${totalLength}`).end();
        return;
      }
      const chunk = buffer.subarray(start, end + 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLength}`);
      res.setHeader('Content-Length', String(chunk.length));
      res.send(chunk);
      return;
    }

    res.setHeader('Content-Length', String(totalLength));
    res.send(buffer);
  });

  app.get('/api/voice-tutor/history', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
    const sessions = db
      .listVoiceTutorSessions(userId, { query })
      .map((session) => hydrateVoiceTutorSession(userId, session));
    res.json({ sessions });
  });

  app.delete('/api/voice-tutor/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const deleted = db.deleteVoiceTutorSession(userId, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Voice Tutor session not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/tts', requireAuth, async (req, res) => {
    try {
      const {
        text,
        voiceName = 'Kore',
        slow = false,
        language = 'English',
      } = req.body as {
        text?: string;
        voiceName?: string;
        slow?: boolean;
        language?: string;
      };

      const cleaned = (text ?? '').trim();
      if (!cleaned) {
        res.status(400).json({ error: 'Please provide text to convert into speech.' });
        return;
      }

      const resolvedLanguage = resolveTutorLanguage(language);
      const clip = await synthesizeVoiceAudioClip({
        text: cleaned,
        voiceName,
        slow,
        languageLabel: resolvedLanguage.label,
      });

      res.json({
        audioBase64: Buffer.from(clip.audioBytes).toString('base64'),
        mimeType: clip.mimeType,
        chunkCount: clip.chunkCount,
        language: resolvedLanguage.label,
        cached: clip.cached,
      });
    } catch (err) {
      const formatted = formatApiError(err, 'Failed to generate speech audio.');
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) {
      next(err);
      return;
    }
    if (res.headersSent) {
      next(err);
      return;
    }
    const errObj = err as { status?: unknown; statusCode?: unknown; type?: unknown; message?: unknown };
    const status =
      typeof errObj?.status === 'number'
        ? errObj.status
        : typeof errObj?.statusCode === 'number'
        ? errObj.statusCode
        : 500;
    const message =
      errObj?.type === 'entity.too.large'
        ? 'Request payload exceeds the 18 MB limit.'
        : err instanceof Error && err.message
        ? err.message
        : 'Unexpected server error.';
    res.status(status).json({ error: message });
  });

  // Defensive guard: ensure /api/* never falls through to Vite or index.html
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: 'API endpoint not found.' });
        return;
      }
      vite.middlewares(req, res, next);
    });
  } else {
    const distDir = path.resolve(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: 'API endpoint not found.' });
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Learning Accessibility Assistant running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
