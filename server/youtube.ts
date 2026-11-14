import { ThinkingLevel, Type, type GoogleGenAI } from '@google/genai';

export type VideoSourceType = 'text' | 'document' | 'summary' | 'assistant' | 'custom';
export type LearningLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export interface YouTubeCandidateVideo {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  channelName: string;
  publishedAt?: string;
  durationIso?: string;
  viewCount?: number;
  likeCount?: number;
  categoryId?: string;
}

export interface RecommendedVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  channelName: string;
  videoUrl: string;
  duration: string;
  recommendationReason: string;
}

export interface RecommendationQueryAnalysis {
  topic: string;
  keywords: string[];
  searchQuery: string;
}

export interface YouTubeRecommendationResponse {
  topic: string;
  keywords: string[];
  searchQuery: string;
  learningLevel: LearningLevel;
  preferredLanguage: string;
  sourceType: VideoSourceType;
  videos: RecommendedVideo[];
  cached: boolean;
}

export class YouTubeServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'YouTubeServiceError';
    this.status = status;
  }
}

const DEPRECATED_GEMINI_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export function resolveGeminiTextModel(rawModel?: string | null): string {
  const trimmed = (rawModel ?? '').trim();
  if (!trimmed) return 'gemini-4-hydrogen';
  const normalized = trimmed.replace(/^models\//i, '').toLowerCase();
  if (!/^gemini-[a-z0-9._-]+$/.test(normalized)) {
    return 'gemini-4-hydrogen';
  }
  if (DEPRECATED_GEMINI_MODELS.has(normalized)) {
    return 'gemini-4-hydrogen';
  }
  return trimmed.replace(/^models\//i, '');
}

const DEFAULT_MODEL = resolveGeminiTextModel(process.env.GEMINI_MODEL);

const LANGUAGE_MAP: Record<string, string> = {
  english: 'en',
  en: 'en',
  spanish: 'es',
  espanol: 'es',
  es: 'es',
  hindi: 'hi',
  hi: 'hi',
  french: 'fr',
  francais: 'fr',
  fr: 'fr',
  german: 'de',
  deutsch: 'de',
  de: 'de',
  arabic: 'ar',
  ar: 'ar',
  portuguese: 'pt',
  pt: 'pt',
  japanese: 'ja',
  ja: 'ja',
  korean: 'ko',
  ko: 'ko',
  chinese: 'zh-Hans',
  mandarin: 'zh-Hans',
  zh: 'zh-Hans',
  italian: 'it',
  it: 'it',
};

const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'almost', 'alone', 'along',
  'already', 'also', 'although', 'always', 'among', 'another', 'answer', 'around',
  'because', 'become', 'before', 'being', 'below', 'between', 'both', 'called',
  'cannot', 'could', 'course', 'describe', 'described', 'does', 'doing', 'during',
  'each', 'either', 'enough', 'every', 'example', 'explain', 'explained', 'first',
  'following', 'found', 'from', 'further', 'gives', 'great', 'have', 'having',
  'helpful', 'here', 'hers', 'herself', 'himself', 'however', 'important', 'include',
  'including', 'inside', 'into', 'itself', 'just', 'known', 'learn', 'learning',
  'lesson', 'like', 'made', 'make', 'many', 'material', 'mean', 'meaning', 'might',
  'more', 'most', 'much', 'must', 'nearly', 'need', 'never', 'only', 'other',
  'others', 'otherwise', 'ours', 'ourselves', 'over', 'page', 'paragraph', 'part',
  'passage', 'process', 'question', 'quite', 'rather', 'really', 'same', 'section',
  'several', 'shall', 'should', 'since', 'some', 'someone', 'something', 'sometimes',
  'still', 'student', 'study', 'such', 'summary', 'take', 'than', 'that', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'thing', 'things',
  'think', 'this', 'those', 'though', 'through', 'thus', 'together', 'toward',
  'under', 'understand', 'until', 'upon', 'used', 'using', 'usually', 'very',
  'video', 'want', 'watch', 'well', 'were', 'what', 'when', 'where', 'which',
  'while', 'whom', 'whose', 'will', 'with', 'within', 'without', 'word', 'words',
  'work', 'works', 'would', 'your', 'yours', 'yourself',
]);

const EDUCATIONAL_POSITIVE_SIGNALS: { pattern: RegExp; weight: number }[] = [
  { pattern: /\b(explained|explanation|tutorial|lesson|lecture|course|crash course)\b/i, weight: 18 },
  { pattern: /\b(introduction|intro|basics|fundamentals|overview|guide|walkthrough)\b/i, weight: 14 },
  { pattern: /\b(visual|animation|animated|demonstration|demo|step by step|how .+ works)\b/i, weight: 15 },
  { pattern: /\b(khan academy|mit|stanford|harvard|ted-ed|crashcourse|3blue1brown|amoeba sisters|organic chemistry tutor|kurzgesagt|bozeman|professor|academy)\b/i, weight: 22 },
  { pattern: /\b(concept|concepts|theory|example|examples|study|science|math|biology|physics|history|economics|chemistry)\b/i, weight: 8 },
];

const ENTERTAINMENT_NEGATIVE_SIGNALS: { pattern: RegExp; weight: number }[] = [
  { pattern: /\b(prank|roast|reaction|reacts|tiktok|memes?|funny moments|unboxing|vlog|drama|gossip|diss track|official music video|lyric video|gameplay|speedrun|fortnite|minecraft|roblox)\b/i, weight: -50 },
  { pattern: /#shorts?\b/i, weight: -35 },
  { pattern: /\b(top 10 shocking|you won't believe|gone wrong|clickbait)\b/i, weight: -40 },
];

export function normalizeLearningLevel(level?: string | null): LearningLevel {
  if (level === 'Intermediate' || level === 'Advanced') {
    return level;
  }
  return 'Beginner';
}

export function normalizeSourceType(sourceType?: string | null): VideoSourceType {
  if (
    sourceType === 'document' ||
    sourceType === 'summary' ||
    sourceType === 'assistant' ||
    sourceType === 'custom'
  ) {
    return sourceType;
  }
  return 'text';
}

export function mapLanguageCode(preferredLanguage?: string | null): string {
  const key = (preferredLanguage || 'English').trim().toLowerCase();
  return LANGUAGE_MAP[key] || 'en';
}

export function parseDurationSeconds(isoDuration?: string | null): number {
  if (!isoDuration || typeof isoDuration !== 'string') return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(isoDuration.trim());
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

export function parseIso8601Duration(isoDuration?: string | null): string {
  const totalSeconds = parseDurationSeconds(isoDuration);
  if (totalSeconds <= 0) return '';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secStr = String(seconds).padStart(2, '0');
  if (hours > 0) {
    const minStr = String(minutes).padStart(2, '0');
    return `${hours}:${minStr}:${secStr}`;
  }
  return `${minutes}:${secStr}`;
}

export function extractKeywordsHeuristic(text: string, limit = 5): string[] {
  const cleaned = text
    .replace(/\[Page \d+\]/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .toLowerCase();

  const counts = new Map<string, number>();
  for (const token of cleaned.split(/\s+/)) {
    const word = token.replace(/^-+|-+$/g, '');
    if (word.length < 4 || /^\d+$/.test(word) || STOPWORDS.has(word)) {
      continue;
    }
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([word]) => word);
}

export function buildFallbackSearchQuery(params: {
  topicOrText: string;
  customTopic?: string;
  keywords?: string[];
  learningLevel: LearningLevel;
  preferredLanguage: string;
}): RecommendationQueryAnalysis {
  const custom = (params.customTopic || '').trim();
  const providedKeywords = (params.keywords || [])
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 6);

  const sourceText = custom || params.topicOrText.trim();
  const extracted =
    providedKeywords.length > 0
      ? providedKeywords
      : extractKeywordsHeuristic(sourceText, 5);

  let topic = custom;
  if (!topic) {
    const firstSentence = sourceText
      .replace(/\[Page \d+\]\s*/gi, '')
      .split(/[.!?\n]/)[0]
      ?.trim() || '';
    if (firstSentence && firstSentence.length <= 80 && firstSentence.split(/\s+/).length <= 10) {
      topic = firstSentence;
    } else if (extracted.length > 0) {
      topic = extracted
        .slice(0, 3)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    } else {
      topic = sourceText.slice(0, 60).trim() || 'Study Topic';
    }
  }

  const levelQualifier =
    params.learningLevel === 'Beginner'
      ? 'explained for beginners tutorial'
      : params.learningLevel === 'Intermediate'
      ? 'concept explanation tutorial'
      : 'in depth lecture explained';

  const langSuffix =
    params.preferredLanguage &&
    params.preferredLanguage.trim().toLowerCase() !== 'english'
      ? ` in ${params.preferredLanguage.trim()}`
      : '';

  const coreTerms = custom
    ? custom
    : extracted.length > 0
    ? extracted.slice(0, 4).join(' ')
    : topic;

  const searchQuery = `${coreTerms} ${levelQualifier}${langSuffix}`
    .replace(/\s+/g, ' ')
    .trim();

  return {
    topic,
    keywords: extracted.length > 0 ? extracted : topic.toLowerCase().split(/\s+/).slice(0, 4),
    searchQuery,
  };
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function scoreAndFilterCandidates(
  candidates: YouTubeCandidateVideo[],
  context: {
    topic: string;
    keywords: string[];
    learningLevel: LearningLevel;
    preferredLanguage: string;
    reasonMap?: Record<string, string>;
  }
): RecommendedVideo[] {
  const seen = new Set<string>();
  const normalizedKeywords = [
    ...new Set(
      [...context.keywords, ...context.topic.split(/\s+/)]
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length >= 3 && !STOPWORDS.has(k))
    ),
  ];

  const scored = candidates
    .filter((item) => {
      if (!item.videoId || seen.has(item.videoId)) return false;
      seen.add(item.videoId);
      return Boolean(item.title?.trim());
    })
    .map((item) => {
      const title = decodeHtmlEntities(item.title.trim());
      const desc = decodeHtmlEntities((item.description || '').trim());
      const channel = decodeHtmlEntities((item.channelName || 'Educational Channel').trim());
      const combined = `${title} ${desc} ${channel}`.toLowerCase();
      const seconds = parseDurationSeconds(item.durationIso);

      let score = 0;

      // Keyword & topic relevance
      let matchedKeywords: string[] = [];
      for (const kw of normalizedKeywords) {
        if (title.toLowerCase().includes(kw)) {
          score += 18;
          matchedKeywords.push(kw);
        } else if (combined.includes(kw)) {
          score += 8;
          matchedKeywords.push(kw);
        }
      }

      // Educational quality signals
      for (const sig of EDUCATIONAL_POSITIVE_SIGNALS) {
        if (sig.pattern.test(combined)) {
          score += sig.weight;
        }
      }

      // Entertainment / Shorts / clickbait penalty
      for (const neg of ENTERTAINMENT_NEGATIVE_SIGNALS) {
        if (neg.pattern.test(combined)) {
          score += neg.weight;
        }
      }

      // Education / Science & Tech category boost (27 = Education, 28 = Science & Tech)
      if (item.categoryId === '27') score += 16;
      else if (item.categoryId === '28') score += 10;

      // Level alignment
      if (context.learningLevel === 'Beginner') {
        if (/\b(beginner|beginners|intro|introduction|basics|simple|made easy|for kids|101)\b/i.test(combined)) {
          score += 14;
        }
      } else if (context.learningLevel === 'Intermediate') {
        if (/\b(explained|visual|deep dive|mechanism|how|principles|guide)\b/i.test(combined)) {
          score += 12;
        }
      } else if (context.learningLevel === 'Advanced') {
        if (/\b(lecture|university|advanced|derivation|proof|seminar|research|mit)\b/i.test(combined)) {
          score += 14;
        }
      }

      // Duration sweet spot: 2 min to 45 min is ideal for focused study; penalize <60s Shorts
      if (seconds > 0 && seconds < 60) {
        score -= 25;
      } else if (seconds >= 120 && seconds <= 2700) {
        score += 12;
      } else if (seconds > 2700) {
        score += 4;
      }

      // Light view-count log tiebreaker (avoid huge clickbait skewing educational fit)
      if (item.viewCount && item.viewCount > 1000) {
        score += Math.min(10, Math.log10(item.viewCount));
      }

      const duration = parseIso8601Duration(item.durationIso);
      const customReason = context.reasonMap?.[item.videoId]?.trim();
      const matchedLabel =
        matchedKeywords.length > 0
          ? matchedKeywords.slice(0, 3).join(', ')
          : context.topic;

      const defaultReason =
        seconds >= 120
          ? `Recommended ${context.learningLevel.toLowerCase()}-friendly lesson by ${channel} covering ${matchedLabel}.`
          : `Helpful video explanation from ${channel} focused on ${matchedLabel}.`;

      return {
        score,
        video: {
          videoId: item.videoId,
          title,
          thumbnailUrl:
            item.thumbnailUrl ||
            `https://i.ytimg.com/vi/${encodeURIComponent(item.videoId)}/hqdefault.jpg`,
          channelName: channel,
          videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`,
          duration,
          recommendationReason: customReason || defaultReason,
        } satisfies RecommendedVideo,
      };
    });

  // Drop blatant non-educational negative-score spam unless we would otherwise return 0 results
  const positiveMatches = scored.filter((entry) => entry.score > -10);
  const pool = positiveMatches.length > 0 ? positiveMatches : scored.filter((entry) => entry.score > -35);

  return pool
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => entry.video);
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly hits = new Map<string, number[]>();

  constructor(maxRequests = 15, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  allow(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const cutoff = now - this.windowMs;
    const prev = (this.hits.get(key) || []).filter((ts) => ts > cutoff);
    if (prev.length >= this.maxRequests) {
      const oldest = prev[0]!;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.hits.set(key, prev);
      return { allowed: false, retryAfterSeconds };
    }
    prev.push(now);
    this.hits.set(key, prev);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

interface CacheEntry {
  expiresAt: number;
  data: Omit<YouTubeRecommendationResponse, 'cached'>;
}

const RECOMMENDATION_CACHE_TTL_MS = 15 * 60 * 1000;
const recommendationCache = new Map<string, CacheEntry>();

function readRecommendationCache(key: string): Omit<YouTubeRecommendationResponse, 'cached'> | null {
  const entry = recommendationCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    recommendationCache.delete(key);
    return null;
  }
  return entry.data;
}

function writeRecommendationCache(
  key: string,
  data: Omit<YouTubeRecommendationResponse, 'cached'>
): void {
  if (recommendationCache.size >= 80) {
    const oldest = recommendationCache.keys().next().value;
    if (oldest !== undefined) recommendationCache.delete(oldest);
  }
  recommendationCache.set(key, {
    expiresAt: Date.now() + RECOMMENDATION_CACHE_TTL_MS,
    data,
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function analyzeTopicWithGemini(
  ai: GoogleGenAI,
  params: {
    content: string;
    customTopic?: string;
    keywords?: string[];
    learningLevel: LearningLevel;
    preferredLanguage: string;
    sourceType: VideoSourceType;
  }
): Promise<RecommendationQueryAnalysis> {
  const fallback = buildFallbackSearchQuery({
    topicOrText: params.content,
    customTopic: params.customTopic,
    keywords: params.keywords,
    learningLevel: params.learningLevel,
    preferredLanguage: params.preferredLanguage,
  });

  try {
    const boundedContent = params.content.slice(0, 8000);
    const promptParts = [
      `Student Learning Level: ${params.learningLevel}`,
      `Preferred Video Language: ${params.preferredLanguage}`,
      `Source Type: ${params.sourceType}`,
    ];
    if (params.customTopic?.trim()) {
      promptParts.push(`Explicit Student Topic Request: ${params.customTopic.trim()}`);
    }
    if (params.keywords && params.keywords.length > 0) {
      promptParts.push(`Pre-extracted Keywords: ${params.keywords.join(', ')}`);
    }
    if (boundedContent.trim()) {
      promptParts.push(`Study Content / Context:\n"""\n${boundedContent}\n"""`);
    }

    const res = await withTimeout(
      ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: promptParts.join('\n\n'),
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You help students discover clear educational YouTube videos. ' +
            'Extract the core academic topic, 3 to 6 concise subject keywords, and generate a clean YouTube search query ' +
            'optimized for tutorials, conceptual explanations, or classroom lectures matching the requested learning level and language. ' +
            'Do not include quotes, boolean operators, or hashtags in searchQuery.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              topic: {
                type: Type.STRING,
                description: 'Concise 2 to 6 word main academic topic.',
              },
              keywords: {
                type: Type.ARRAY,
                description: '3 to 6 relevant educational search keywords.',
                items: { type: Type.STRING },
              },
              searchQuery: {
                type: Type.STRING,
                description:
                  'Focused YouTube educational search query targeting tutorials/explanations at the requested learning level.',
              },
            },
            required: ['topic', 'keywords', 'searchQuery'],
          },
        },
      }),
      6000,
      'Gemini topic analysis'
    );

    const parsed = JSON.parse((res.text ?? '{}').trim()) as Partial<RecommendationQueryAnalysis>;
    const topic = (parsed.topic || fallback.topic).trim();
    const keywords = Array.isArray(parsed.keywords) && parsed.keywords.length > 0
      ? parsed.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 6)
      : fallback.keywords;
    const searchQuery = (parsed.searchQuery || fallback.searchQuery).trim();

    return { topic, keywords, searchQuery };
  } catch {
    return fallback;
  }
}

async function enrichRecommendationReasonsWithGemini(
  ai: GoogleGenAI,
  videos: RecommendedVideo[],
  context: {
    topic: string;
    learningLevel: LearningLevel;
    preferredLanguage: string;
  }
): Promise<Record<string, string>> {
  if (videos.length === 0) return {};
  try {
    const candidateLines = videos
      .map(
        (v, idx) =>
          `${idx + 1}. videoId="${v.videoId}" | title="${v.title}" | channel="${v.channelName}" | duration="${v.duration || 'N/A'}"`
      )
      .join('\n');

    const res = await withTimeout(
      ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents:
          `Topic: ${context.topic}\n` +
          `Student Level: ${context.learningLevel}\n` +
          `Preferred Language: ${context.preferredLanguage}\n\n` +
          `Videos:\n${candidateLines}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Write a crisp 1-sentence student-friendly explanation (12 to 24 words) for each video explaining why it helps learn the topic at the given level.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reasons: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    videoId: { type: Type.STRING },
                    reason: { type: Type.STRING },
                  },
                  required: ['videoId', 'reason'],
                },
              },
            },
            required: ['reasons'],
          },
        },
      }),
      6000,
      'Gemini video reason enrichment'
    );

    const parsed = JSON.parse((res.text ?? '{}').trim()) as {
      reasons?: { videoId?: string; reason?: string }[];
    };
    const reasonMap: Record<string, string> = {};
    for (const item of parsed.reasons || []) {
      if (item.videoId && item.reason) {
        reasonMap[item.videoId] = item.reason.trim();
      }
    }
    return reasonMap;
  } catch {
    return {};
  }
}

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
}

interface YouTubeVideoDetailItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    categoryId?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
  contentDetails?: {
    duration?: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
  };
}

export function normalizeYoutubeApiKey(rawKey?: string | null): string {
  let cleaned = (rawKey ?? '').trim();
  if (!cleaned) return '';
  cleaned = cleaned.replace(/^YOUTUBE_API_KEY\s*=\s*/i, '').trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  const upper = cleaned.toUpperCase();
  if (
    !cleaned ||
    upper === 'MY_YOUTUBE_DATA_API_V3_KEY' ||
    upper === 'YOUR_YOUTUBE_API_KEY' ||
    upper === 'REPLACE_WITH_YOUTUBE_API_KEY'
  ) {
    return '';
  }
  return cleaned;
}

export function sanitizeYouTubeErrorText(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]');
}

interface YouTubeErrorPayload {
  error?: {
    message?: string;
    status?: string;
    errors?: { reason?: string; message?: string; domain?: string }[];
    details?: { reason?: string; '@type'?: string }[];
  };
}

export function classifyYouTubeApiError(
  status: number,
  errBody: YouTubeErrorPayload | null | undefined
): YouTubeServiceError {
  const errorReasons = (errBody?.error?.errors || [])
    .map((e) => e.reason || '')
    .filter(Boolean);
  const detailReasons = (errBody?.error?.details || [])
    .map((d) => d.reason || '')
    .filter(Boolean);
  const allReasons = [...errorReasons, ...detailReasons].map((r) => r.toLowerCase());
  const rawMessage = sanitizeYouTubeErrorText(errBody?.error?.message || '');
  const lowerMsg = rawMessage.toLowerCase();

  if (
    allReasons.some(
      (r) =>
        r.includes('quota') ||
        r === 'dailylimitexceeded' ||
        r === 'ratelimitexceeded' ||
        r === 'userratelimitexceeded'
    ) ||
    status === 429 ||
    lowerMsg.includes('quota')
  ) {
    return new YouTubeServiceError(
      429,
      'YouTube Data API daily quota has been exceeded. Please try again later or verify your Google Cloud quota.'
    );
  }

  if (
    allReasons.some((r) => r.includes('referer')) ||
    lowerMsg.includes('referer')
  ) {
    return new YouTubeServiceError(
      503,
      'YouTube Data API key is blocked by HTTP referrer restrictions. Since requests run server-side, set Application restrictions to "None" for YOUTUBE_API_KEY in Google Cloud Console.'
    );
  }

  if (
    allReasons.some(
      (r) =>
        r === 'accessnotconfigured' ||
        r === 'service_disabled' ||
        r === 'api_key_service_blocked'
    ) ||
    lowerMsg.includes('has not been used in project') ||
    lowerMsg.includes('is disabled') ||
    lowerMsg.includes('service_blocked') ||
    lowerMsg.includes('are blocked')
  ) {
    return new YouTubeServiceError(
      503,
      'YouTube Data API v3 is not enabled or is blocked for this key. Enable "YouTube Data API v3" and include it under API restrictions in Google Cloud Console.'
    );
  }

  if (status === 400 || status === 401 || status === 403) {
    if (lowerMsg.includes('api keys are not supported')) {
      return new YouTubeServiceError(
        503,
        'The value in YOUTUBE_API_KEY was rejected by YouTube Data API v3 ("API keys are not supported by this API"). Please create a standard Google Cloud Console API Key (starting with "AIza...") under APIs & Services > Credentials with YouTube Data API v3 enabled, rather than an AI Studio / OAuth credential.'
      );
    }
    if (
      allReasons.some((r) => r === 'keyinvalid' || r === 'api_key_invalid') ||
      lowerMsg.includes('api key not valid') ||
      lowerMsg.includes('api key')
    ) {
      const reasonDetail = rawMessage ? ` (Google API: ${rawMessage})` : '';
      return new YouTubeServiceError(
        503,
        `YouTube Data API authentication failed. Please verify YOUTUBE_API_KEY is valid and YouTube Data API v3 is enabled${reasonDetail}.`
      );
    }
    return new YouTubeServiceError(
      status,
      rawMessage || 'YouTube Data API rejected the request.'
    );
  }

  return new YouTubeServiceError(
    502,
    rawMessage || `YouTube API request failed with status ${status}.`
  );
}

async function fetchYouTubeJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new YouTubeServiceError(
      504,
      isTimeout
        ? 'YouTube Data API request timed out. Please try again.'
        : 'Could not reach YouTube Data API. Please try again.'
    );
  }

  if (!response.ok) {
    let errBody: YouTubeErrorPayload | null = null;
    try {
      errBody = (await response.json()) as YouTubeErrorPayload;
    } catch {
      // Ignore JSON parse error
    }
    throw classifyYouTubeApiError(response.status, errBody);
  }

  return (await response.json()) as T;
}

async function queryYouTubeCandidates(params: {
  apiKey: string;
  searchQuery: string;
  relevanceLanguage: string;
}): Promise<YouTubeCandidateVideo[]> {
  const runSearch = async (query: string, categoryId?: string): Promise<YouTubeSearchItem[]> => {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '12');
    searchUrl.searchParams.set('safeSearch', 'strict');
    searchUrl.searchParams.set('videoEmbeddable', 'true');
    searchUrl.searchParams.set('relevanceLanguage', params.relevanceLanguage);
    searchUrl.searchParams.set('q', query);
    if (categoryId) {
      searchUrl.searchParams.set('videoCategoryId', categoryId);
    }
    searchUrl.searchParams.set('key', params.apiKey);

    const searchData = await fetchYouTubeJson<{ items?: YouTubeSearchItem[] }>(
      searchUrl.toString()
    );
    return Array.isArray(searchData.items) ? searchData.items : [];
  };

  // Prioritize Education category (27) first; broaden with explicit tutorial suffix if sparse
  let searchItems = await runSearch(params.searchQuery, '27');
  if (searchItems.length < 4) {
    const broadened = await runSearch(`${params.searchQuery} tutorial lesson`);
    const seenIds = new Set(searchItems.map((i) => i.id?.videoId).filter(Boolean));
    for (const item of broadened) {
      const id = item.id?.videoId;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        searchItems.push(item);
      }
    }
  }

  const videoIds = searchItems
    .map((item) => item.id?.videoId?.trim())
    .filter((id): id is string => Boolean(id))
    .slice(0, 15);

  if (videoIds.length === 0) {
    return [];
  }

  const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  detailsUrl.searchParams.set('part', 'snippet,contentDetails,statistics');
  detailsUrl.searchParams.set('id', videoIds.join(','));
  detailsUrl.searchParams.set('key', params.apiKey);

  const detailsData = await fetchYouTubeJson<{ items?: YouTubeVideoDetailItem[] }>(
    detailsUrl.toString()
  );
  const detailsById = new Map<string, YouTubeVideoDetailItem>();
  for (const d of detailsData.items || []) {
    if (d.id) detailsById.set(d.id, d);
  }

  return videoIds.map((videoId) => {
    const searchItem = searchItems.find((s) => s.id?.videoId === videoId);
    const detail = detailsById.get(videoId);
    const snippet = detail?.snippet || searchItem?.snippet;
    const thumbs = snippet?.thumbnails;
    const thumbnailUrl =
      thumbs?.high?.url ||
      thumbs?.medium?.url ||
      thumbs?.default?.url ||
      `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;

    return {
      videoId,
      title: snippet?.title || 'Educational Video',
      description: snippet?.description || '',
      thumbnailUrl,
      channelName: snippet?.channelTitle || 'Educational Channel',
      publishedAt: snippet?.publishedAt,
      durationIso: detail?.contentDetails?.duration,
      viewCount: detail?.statistics?.viewCount
        ? Number(detail.statistics.viewCount)
        : undefined,
      likeCount: detail?.statistics?.likeCount
        ? Number(detail.statistics.likeCount)
        : undefined,
      categoryId: detail?.snippet?.categoryId,
    };
  });
}

export async function recommendYoutubeVideos(params: {
  content: string;
  customTopic?: string;
  keywords?: string[];
  learningLevel?: string;
  preferredLanguage?: string;
  sourceType?: string;
  forceRefresh?: boolean;
  getAiClient: () => GoogleGenAI | null;
  youtubeApiKey?: string;
}): Promise<YouTubeRecommendationResponse> {
  const youtubeApiKey = normalizeYoutubeApiKey(
    params.youtubeApiKey ?? process.env.YOUTUBE_API_KEY
  );
  if (!youtubeApiKey) {
    throw new YouTubeServiceError(
      503,
      'YouTube Data API v3 key (YOUTUBE_API_KEY) is not configured on the backend server. Please add a valid YOUTUBE_API_KEY in AI Studio Secrets.'
    );
  }

  const learningLevel = normalizeLearningLevel(params.learningLevel);
  const preferredLanguage = (params.preferredLanguage || 'English').trim() || 'English';
  const sourceType = normalizeSourceType(params.sourceType);
  const relevanceLanguage = mapLanguageCode(preferredLanguage);

  const cacheIdentity = [
    params.customTopic?.trim().toLowerCase() || '',
    params.content.trim().slice(0, 1200).toLowerCase(),
    (params.keywords || []).join(',').toLowerCase(),
    learningLevel.toLowerCase(),
    relevanceLanguage,
  ].join('|');

  if (!params.forceRefresh) {
    const cached = readRecommendationCache(cacheIdentity);
    if (cached) {
      return { ...cached, sourceType, cached: true };
    }
  }

  const ai = params.getAiClient();
  const analysis = ai
    ? await analyzeTopicWithGemini(ai, {
        content: params.content,
        customTopic: params.customTopic,
        keywords: params.keywords,
        learningLevel,
        preferredLanguage,
        sourceType,
      })
    : buildFallbackSearchQuery({
        topicOrText: params.content,
        customTopic: params.customTopic,
        keywords: params.keywords,
        learningLevel,
        preferredLanguage,
      });

  const candidates = await queryYouTubeCandidates({
    apiKey: youtubeApiKey,
    searchQuery: analysis.searchQuery,
    relevanceLanguage,
  });

  const initialTop5 = scoreAndFilterCandidates(candidates, {
    topic: analysis.topic,
    keywords: analysis.keywords,
    learningLevel,
    preferredLanguage,
  });

  const reasonMap =
    ai && initialTop5.length > 0
      ? await enrichRecommendationReasonsWithGemini(ai, initialTop5, {
          topic: analysis.topic,
          learningLevel,
          preferredLanguage,
        })
      : {};

  const finalVideos = initialTop5.map((video) => ({
    ...video,
    recommendationReason: reasonMap[video.videoId] || video.recommendationReason,
  }));

  const responsePayload: Omit<YouTubeRecommendationResponse, 'cached'> = {
    topic: analysis.topic,
    keywords: analysis.keywords,
    searchQuery: analysis.searchQuery,
    learningLevel,
    preferredLanguage,
    sourceType,
    videos: finalVideos,
  };

  if (finalVideos.length > 0) {
    writeRecommendationCache(cacheIdentity, responsePayload);
  }

  return { ...responsePayload, cached: false };
}
