import crypto from 'crypto';
import { ThinkingLevel, Type, type GoogleGenAI } from '@google/genai';
import { resolveGeminiTextModel } from './youtube';

export type TutorLearningLevel = 'Beginner' | 'Intermediate' | 'Advanced';
export type TutorSourceType = 'topic' | 'text' | 'document' | 'summary' | 'conversation';

export interface TutorLanguageOption {
  label: string;
  code: string;
  nativeLabel: string;
}

export const SUPPORTED_TUTOR_LANGUAGES: TutorLanguageOption[] = [
  { label: 'English', code: 'en', nativeLabel: 'English' },
  { label: 'Spanish', code: 'es', nativeLabel: 'Español' },
  { label: 'French', code: 'fr', nativeLabel: 'Français' },
  { label: 'German', code: 'de', nativeLabel: 'Deutsch' },
  { label: 'Hindi', code: 'hi', nativeLabel: 'हिन्दी' },
  { label: 'Portuguese', code: 'pt', nativeLabel: 'Português' },
  { label: 'Italian', code: 'it', nativeLabel: 'Italiano' },
  { label: 'Japanese', code: 'ja', nativeLabel: '日本語' },
  { label: 'Korean', code: 'ko', nativeLabel: '한국어' },
  { label: 'Arabic', code: 'ar', nativeLabel: 'العربية' },
];

export interface TutorStepItem {
  stepTitle: string;
  explanation: string;
}

export interface TutorExampleItem {
  title: string;
  description: string;
}

export interface TutorAnalogyItem {
  concept: string;
  analogy: string;
}

export interface VoiceTutorExplanationPayload {
  lessonTitle: string;
  introduction: string;
  meaningAndDefinition: string;
  stepByStepExplanation: TutorStepItem[];
  realWorldExamples: TutorExampleItem[];
  analogies: TutorAnalogyItem[];
  importantPoints: string[];
  shortRecap: string;
}

export interface VoiceTutorSection {
  index: number;
  title: string;
  kind: string;
  spokenScript: string;
  wordCount: number;
  estimatedSeconds: number;
}

export interface GeneratedVoiceTutorLesson {
  lessonTitle: string;
  topic: string;
  learningLevel: TutorLearningLevel;
  preferredLanguage: string;
  languageCode: string;
  sourceType: TutorSourceType;
  explanation: VoiceTutorExplanationPayload;
  sections: VoiceTutorSection[];
  fullExplanationText: string;
  cached: boolean;
}

const DEFAULT_MODEL = resolveGeminiTextModel(process.env.GEMINI_MODEL);
const MAX_SECTION_CHARS = 1350;
const EXPLANATION_CACHE_LIMIT = 40;
const explanationCache = new Map<string, Omit<GeneratedVoiceTutorLesson, 'cached'>>();

export function normalizeTutorLevel(raw?: string | null): TutorLearningLevel {
  if (raw === 'Intermediate' || raw === 'Advanced') {
    return raw;
  }
  return 'Beginner';
}

export function normalizeTutorSourceType(raw?: string | null): TutorSourceType {
  if (
    raw === 'text' ||
    raw === 'document' ||
    raw === 'summary' ||
    raw === 'conversation'
  ) {
    return raw;
  }
  return 'topic';
}

export function resolveTutorLanguage(raw?: string | null): TutorLanguageOption {
  const input = (raw ?? '').trim().toLowerCase();
  if (!input) {
    return SUPPORTED_TUTOR_LANGUAGES[0]!;
  }
  const match = SUPPORTED_TUTOR_LANGUAGES.find(
    (item) =>
      item.label.toLowerCase() === input ||
      item.code.toLowerCase() === input ||
      item.nativeLabel.toLowerCase() === input
  );
  return match ?? SUPPORTED_TUTOR_LANGUAGES[0]!;
}

function getTutorLevelPromptGuidance(level: TutorLearningLevel): string {
  switch (level) {
    case 'Intermediate':
      return (
        'LEVEL: INTERMEDIATE. Teach like an engaging high-school or early-college instructor. ' +
        'Introduce standard terminology naturally, immediately define every technical term in plain English, ' +
        'walk through mechanisms step by step, and connect concepts with practical real-world examples and vivid analogies.'
      );
    case 'Advanced':
      return (
        'LEVEL: ADVANCED. Teach like an insightful university seminar mentor. ' +
        'Include deeper mechanisms, edge cases, formal principles, and nuanced real-world applications while keeping ' +
        'spoken sentences clear, conversational, and easy to follow by ear.'
      );
    case 'Beginner':
    default:
      return (
        'LEVEL: BEGINNER. Teach like a patient, encouraging private tutor explaining to someone encountering this for the first time. ' +
        'Use short, natural spoken sentences, everyday vocabulary, relatable household/daily-life examples, and memorable analogies.'
      );
  }
}

export function splitSpokenScriptForAudio(text: string, maxChars = MAX_SECTION_CHARS): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const sentences = cleaned.split(/(?<=[.!?।。！？])\s+/);
  const parts: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      const words = sentence.split(' ');
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= maxChars) {
          current = candidate;
        } else {
          if (current) parts.push(current);
          if (word.length > maxChars) {
            for (let i = 0; i < word.length; i += maxChars) {
              parts.push(word.slice(i, i + maxChars));
            }
            current = '';
          } else {
            current = word;
          }
        }
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = sentence;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function makeSection(index: number, title: string, kind: string, script: string): VoiceTutorSection {
  const cleaned = script.replace(/\s+/g, ' ').trim();
  const wordCount = cleaned ? cleaned.split(/\s+/).length : 0;
  const estimatedSeconds = Math.max(4, Math.round((wordCount / 145) * 60));
  return {
    index,
    title: title.trim() || `Section ${index + 1}`,
    kind: kind.trim() || 'lesson',
    spokenScript: cleaned,
    wordCount,
    estimatedSeconds,
  };
}

export function buildSectionsFromExplanation(
  explanation: VoiceTutorExplanationPayload,
  rawSections?: { title?: string; kind?: string; spokenScript?: string }[],
  maxSectionChars = MAX_SECTION_CHARS
): VoiceTutorSection[] {
  const fallbackCandidates: { title: string; kind: string; script: string }[] = [
    {
      title: 'Introduction & Core Meaning',
      kind: 'introduction',
      script: `${explanation.introduction} ${explanation.meaningAndDefinition}`.trim(),
    },
    {
      title: 'Step-by-Step Walkthrough',
      kind: 'steps',
      script: explanation.stepByStepExplanation
        .map((s, idx) => `Step ${idx + 1}: ${s.stepTitle}. ${s.explanation}`)
        .join(' '),
    },
    {
      title: 'Real-World Examples & Analogies',
      kind: 'examples',
      script: [
        ...explanation.realWorldExamples.map((e) => `For example, ${e.title}: ${e.description}`),
        ...explanation.analogies.map((a) => `Think of ${a.concept} like this: ${a.analogy}`),
      ].join(' '),
    },
    {
      title: 'Key Takeaways & Quick Recap',
      kind: 'recap',
      script: [
        explanation.importantPoints.length > 0
          ? `Important points to remember: ${explanation.importantPoints.join(' ')}`
          : '',
        `To wrap up: ${explanation.shortRecap}`,
      ]
        .filter(Boolean)
        .join(' '),
    },
  ].filter((c) => c.script.trim().length > 0);

  const sourceList =
    Array.isArray(rawSections) && rawSections.some((s) => (s?.spokenScript || '').trim().length > 25)
      ? rawSections
          .map((s, idx) => ({
            title: (s.title || `Part ${idx + 1}`).trim(),
            kind: (s.kind || 'lesson').trim(),
            script: (s.spokenScript || '').trim(),
          }))
          .filter((s) => s.script.length > 0)
      : fallbackCandidates;

  const finalSections: VoiceTutorSection[] = [];
  for (const item of sourceList) {
    const splits = splitSpokenScriptForAudio(item.script, maxSectionChars);
    if (splits.length <= 1) {
      finalSections.push(makeSection(finalSections.length, item.title, item.kind, splits[0] || item.script));
    } else {
      splits.forEach((chunk, partIdx) => {
        finalSections.push(
          makeSection(
            finalSections.length,
            `${item.title} (Part ${partIdx + 1}/${splits.length})`,
            item.kind,
            chunk
          )
        );
      });
    }
  }

  return finalSections;
}

export function formatExplanationTranscript(explanation: VoiceTutorExplanationPayload): string {
  const parts: string[] = [
    explanation.lessonTitle,
    '',
    '1. Introduction',
    explanation.introduction,
    '',
    '2. Meaning & Simple Definition',
    explanation.meaningAndDefinition,
    '',
    '3. Step-by-Step Explanation',
    ...explanation.stepByStepExplanation.map(
      (s, i) => `Step ${i + 1} — ${s.stepTitle}: ${s.explanation}`
    ),
    '',
    '4. Real-World Examples',
    ...explanation.realWorldExamples.map((e) => `- ${e.title}: ${e.description}`),
    '',
    '5. Helpful Analogies',
    ...explanation.analogies.map((a) => `- ${a.concept}: ${a.analogy}`),
    '',
    '6. Important Points to Remember',
    ...explanation.importantPoints.map((pt) => `- ${pt}`),
    '',
    '7. Short Recap',
    explanation.shortRecap,
  ];
  return parts.filter((line) => line !== undefined).join('\n').trim();
}

function buildCacheKey(params: {
  topic: string;
  content: string;
  learningLevel: TutorLearningLevel;
  languageCode: string;
  sourceType: TutorSourceType;
}): string {
  const hash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        params.sourceType,
        params.learningLevel,
        params.languageCode,
        params.topic.trim().toLowerCase(),
        params.content.trim().slice(0, 20000),
      ])
    )
    .digest('hex');
  return `vt:${hash}`;
}

function parseJsonSafe<T>(rawText: string | undefined): T {
  let cleaned = (rawText ?? '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  if (!cleaned) {
    throw new Error('The AI Voice Tutor returned an empty explanation. Please try again.');
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error('The AI Voice Tutor returned an unreadable format. Please try again.');
  }
}

export async function generateVoiceTutorLesson(params: {
  ai: GoogleGenAI;
  topic?: string;
  content?: string;
  sourceType?: string;
  learningLevel?: string;
  preferredLanguage?: string;
  sourceDocumentName?: string;
  model?: string;
}): Promise<GeneratedVoiceTutorLesson> {
  const learningLevel = normalizeTutorLevel(params.learningLevel);
  const language = resolveTutorLanguage(params.preferredLanguage);
  const sourceType = normalizeTutorSourceType(params.sourceType);
  const trimmedTopic = (params.topic ?? '').trim();
  const trimmedContent = (params.content ?? '').trim();

  const effectiveTopic =
    trimmedTopic ||
    params.sourceDocumentName ||
    trimmedContent.split(/[.!?\n]/)[0]?.slice(0, 80).trim() ||
    'Study Topic';

  const cacheKey = buildCacheKey({
    topic: effectiveTopic,
    content: trimmedContent,
    learningLevel,
    languageCode: language.code,
    sourceType,
  });

  const cached = explanationCache.get(cacheKey);
  if (cached) {
    explanationCache.delete(cacheKey);
    explanationCache.set(cacheKey, cached);
    return { ...cached, cached: true };
  }

  const isLengthyMaterial = trimmedContent.length > 3500;
  const boundedContent =
    trimmedContent.length > 26000
      ? `${trimmedContent.slice(0, 26000)}\n\n[Material truncated for lesson focus]`
      : trimmedContent;

  const contentPromptSection = boundedContent
    ? `Source Material (${sourceType}${params.sourceDocumentName ? ` · "${params.sourceDocumentName}"` : ''}):\n"""\n${boundedContent}\n"""\n\n` +
      'IMPORTANT: Teach and explain the ACTUAL concepts contained in this source material rather than drifting off-topic.'
    : 'No external passage was provided; teach the requested topic thoroughly and accurately.';

  const sectionGuidance = isLengthyMaterial
    ? 'Because the study material is lengthy, divide the spoken lesson into 4 to 7 well-paced, meaningful sections (each ~140-220 words) covering each major part of the material plus examples, key takeaways, and a recap.'
    : 'Divide the spoken lesson into 3 to 5 clear, focused sections (each ~100-190 words) so the student can listen section by section.';

  const selectedModel = resolveGeminiTextModel(params.model || DEFAULT_MODEL);
  const response = await params.ai.models.generateContent({
    model: selectedModel,
    contents: [
      `Target Language: ${language.label} (${language.code})`,
      getTutorLevelPromptGuidance(learningLevel),
      `Topic / Focus: ${effectiveTopic}`,
      contentPromptSection,
      sectionGuidance,
      'Write EVERY field in natural, warm, spoken-friendly ' +
        `${language.label} so a teacher can read it aloud naturally to a student.`,
    ].join('\n\n'),
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction:
        'You are a gifted, empathetic AI Voice Tutor speaking directly to a student in a 1-on-1 lesson. ' +
        'Do NOT sound like a dry textbook or bullet-list readout. Use natural conversational phrasing, rhetorical signposts ' +
        '("Let us start with...", "Here is an everyday way to picture this...", "Before we wrap up..."), ' +
        'and crystal-clear pedagogy covering: (1) Introduction, (2) Simple meaning & definition, ' +
        '(3) Step-by-step explanation, (4) Real-world examples, (5) Analogies, (6) Important points to remember, and (7) Short recap. ' +
        'Avoid markdown asterisks or raw URLs inside spokenScript fields so TTS pronounces every sentence smoothly.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          lessonTitle: { type: Type.STRING, description: 'Clear lesson title.' },
          introduction: {
            type: Type.STRING,
            description: 'Warm, engaging teacher introduction explaining why the topic matters.',
          },
          meaningAndDefinition: {
            type: Type.STRING,
            description: 'Meaning and definition explained in simple, accessible language.',
          },
          stepByStepExplanation: {
            type: Type.ARRAY,
            description: 'Clear sequential teaching steps walking through how the concept works.',
            items: {
              type: Type.OBJECT,
              properties: {
                stepTitle: { type: Type.STRING },
                explanation: { type: Type.STRING },
              },
              required: ['stepTitle', 'explanation'],
            },
          },
          realWorldExamples: {
            type: Type.ARRAY,
            description: 'Concrete real-world examples illustrating the topic.',
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
              },
              required: ['title', 'description'],
            },
          },
          analogies: {
            type: Type.ARRAY,
            description: 'Relatable analogies comparing hard concepts to familiar everyday situations.',
            items: {
              type: Type.OBJECT,
              properties: {
                concept: { type: Type.STRING },
                analogy: { type: Type.STRING },
              },
              required: ['concept', 'analogy'],
            },
          },
          importantPoints: {
            type: Type.ARRAY,
            description: '3 to 6 essential points the student should remember.',
            items: { type: Type.STRING },
          },
          shortRecap: {
            type: Type.STRING,
            description: 'Encouraging 2-4 sentence spoken recap at the end of the lesson.',
          },
          sections: {
            type: Type.ARRAY,
            description:
              'Meaningful sequential audio-ready lesson sections covering the full explanation in natural spoken prose (no markdown symbols).',
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                kind: { type: Type.STRING },
                spokenScript: { type: Type.STRING },
              },
              required: ['title', 'kind', 'spokenScript'],
            },
          },
        },
        required: [
          'lessonTitle',
          'introduction',
          'meaningAndDefinition',
          'stepByStepExplanation',
          'realWorldExamples',
          'analogies',
          'importantPoints',
          'shortRecap',
          'sections',
        ],
      },
    },
  });

  const parsed = parseJsonSafe<
    Partial<VoiceTutorExplanationPayload> & {
      sections?: { title?: string; kind?: string; spokenScript?: string }[];
    }
  >(response.text);

  const explanation: VoiceTutorExplanationPayload = {
    lessonTitle: (parsed.lessonTitle || effectiveTopic).trim(),
    introduction: (parsed.introduction || '').trim(),
    meaningAndDefinition: (parsed.meaningAndDefinition || '').trim(),
    stepByStepExplanation: Array.isArray(parsed.stepByStepExplanation)
      ? parsed.stepByStepExplanation
          .filter((s) => s && (s.stepTitle || s.explanation))
          .map((s) => ({
            stepTitle: String(s.stepTitle || 'Key Step').trim(),
            explanation: String(s.explanation || '').trim(),
          }))
      : [],
    realWorldExamples: Array.isArray(parsed.realWorldExamples)
      ? parsed.realWorldExamples
          .filter((e) => e && (e.title || e.description))
          .map((e) => ({
            title: String(e.title || 'Example').trim(),
            description: String(e.description || '').trim(),
          }))
      : [],
    analogies: Array.isArray(parsed.analogies)
      ? parsed.analogies
          .filter((a) => a && (a.concept || a.analogy))
          .map((a) => ({
            concept: String(a.concept || 'Core Idea').trim(),
            analogy: String(a.analogy || '').trim(),
          }))
      : [],
    importantPoints: Array.isArray(parsed.importantPoints)
      ? parsed.importantPoints.map((p) => String(p).trim()).filter(Boolean)
      : [],
    shortRecap: (parsed.shortRecap || '').trim(),
  };

  const sections = buildSectionsFromExplanation(explanation, parsed.sections);
  const fullExplanationText = formatExplanationTranscript(explanation);

  const result: Omit<GeneratedVoiceTutorLesson, 'cached'> = {
    lessonTitle: explanation.lessonTitle,
    topic: effectiveTopic,
    learningLevel,
    preferredLanguage: language.label,
    languageCode: language.code,
    sourceType,
    explanation,
    sections,
    fullExplanationText,
  };

  if (explanationCache.size >= EXPLANATION_CACHE_LIMIT) {
    const oldest = explanationCache.keys().next().value;
    if (oldest !== undefined) explanationCache.delete(oldest);
  }
  explanationCache.set(cacheKey, result);

  return { ...result, cached: false };
}

export function createAudioAccessToken(
  audioId: string,
  userId: string,
  secret: string,
  ttlSeconds = 60 * 60 * 24
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ audioId, sub: userId, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyAudioAccessToken(
  token: string,
  expectedAudioId: string,
  secret: string
): { userId: string; audioId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts as [string, string];
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (sigB64.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      audioId?: string;
      sub?: string;
      exp?: number;
    };
    if (!parsed.audioId || !parsed.sub || typeof parsed.exp !== 'number') return null;
    if (parsed.audioId !== expectedAudioId) return null;
    if (Math.floor(Date.now() / 1000) > parsed.exp) return null;
    return { userId: parsed.sub, audioId: parsed.audioId };
  } catch {
    return null;
  }
}
