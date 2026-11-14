import type {
  AuthUser,
  ChatConversationSummary,
  ChatDetail,
  ChatMessage,
  HistoryBundle,
  LearningResultConcept,
  LearningResultRecord,
  ReadingLevel,
  SavedDocumentDetail,
  SavedDocumentSummary,
  SimplifyResult,
  SummaryLength,
  SummaryResult,
  TtsVoiceName,
  VideoRecommendationResult,
  VideoSourceType,
  VoiceTutorExplainResponse,
  VoiceTutorLanguageOption,
  VoiceTutorSectionAudioResponse,
  VoiceTutorSession,
  VoiceTutorSourceType,
} from '../types/learning';

const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim();
export const API_BASE_URL = RAW_API_BASE_URL.replace(/\/+$/, '').replace(/\/api$/i, '');

export function buildApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalized}` : normalized;
}

const TOKEN_STORAGE_KEY = 'slaa_auth_token';

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage restriction
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage restriction
  }
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    skipAuthRedirect?: boolean;
  } = {}
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Requested-With': 'fetch',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const targetUrl = buildApiUrl(path);
  const executeFetch = () =>
    fetch(targetUrl, {
      method: options.method ?? 'GET',
      headers,
      cache: 'no-store',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

  let response = await executeFetch();
  let contentType = (response.headers.get('content-type') || '').toLowerCase();
  let rawText = await response.text();

  // If a proxy or restarting server briefly serves an HTML interstitial/SPA shell, retry once.
  const isHtmlPayload =
    contentType.includes('text/html') || /^\s*</.test(rawText);
  if (isHtmlPayload) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    response = await executeFetch();
    contentType = (response.headers.get('content-type') || '').toLowerCase();
    rawText = await response.text();
  }

  if (response.status === 401 && !options.skipAuthRedirect && unauthorizedHandler) {
    unauthorizedHandler();
  }

  if (response.status === 204 || !rawText.trim()) {
    if (!response.ok) {
      throw new Error(`Request failed for ${path} (HTTP ${response.status}).`);
    }
    return {} as T;
  }

  let data: (T & { error?: string }) | null = null;
  try {
    data = JSON.parse(rawText) as T & { error?: string };
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed for ${path} (HTTP ${response.status}).`);
    }
    const looksLikeHtml =
      contentType.includes('text/html') || /^\s*</.test(rawText);
    if (looksLikeHtml) {
      if (response.redirected) {
        throw new Error(
          `Your session proxy redirected ${path} to an HTML page. Please refresh the page to re-authenticate and try again.`
        );
      }
      throw new Error(
        `Received HTML instead of JSON from ${path} (HTTP ${response.status}). Please refresh the page and ensure the backend server is running.`
      );
    }
    throw new Error(
      `Unexpected non-JSON response from ${path} (HTTP ${response.status}). Please refresh and try again.`
    );
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error(`Unexpected response format from ${path}. Please try again.`);
  }
  return data;
}

function normalizeVideoRecommendationResult(raw: unknown): VideoRecommendationResult {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Partial<VideoRecommendationResult>;
  const rawVideos = Array.isArray(item.videos) ? item.videos : [];
  return {
    id: typeof item.id === 'string' ? item.id : null,
    conversationId: typeof item.conversationId === 'string' ? item.conversationId : null,
    documentId: typeof item.documentId === 'string' ? item.documentId : null,
    sourceType: typeof item.sourceType === 'string' ? item.sourceType : 'text',
    topic: typeof item.topic === 'string' && item.topic.trim() ? item.topic : 'Study Topic',
    keywords: Array.isArray(item.keywords)
      ? item.keywords.filter((k): k is string => typeof k === 'string')
      : [],
    searchQuery: typeof item.searchQuery === 'string' ? item.searchQuery : '',
    learningLevel: typeof item.learningLevel === 'string' ? item.learningLevel : 'Beginner',
    preferredLanguage:
      typeof item.preferredLanguage === 'string' ? item.preferredLanguage : 'English',
    videos: rawVideos.filter((v): v is VideoRecommendationResult['videos'][number] =>
      Boolean(v && typeof v === 'object')
    ),
    cached: Boolean(item.cached),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
  };
}

function resolveBackendAudioUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return buildApiUrl(url);
}

function normalizeVoiceTutorSession(raw: unknown): VoiceTutorSession {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Partial<VoiceTutorSession>;
  const exp = (
    item.explanation && typeof item.explanation === 'object' ? item.explanation : {}
  ) as Partial<VoiceTutorSession['explanation']>;
  const audioRefs = Array.isArray(item.audioRefs)
    ? item.audioRefs.map((ref) => ({
        ...ref,
        audioUrl: ref?.audioUrl ? resolveBackendAudioUrl(ref.audioUrl) : ref?.audioUrl,
      }))
    : [];
  return {
    id: typeof item.id === 'string' ? item.id : '',
    documentId: typeof item.documentId === 'string' ? item.documentId : null,
    conversationId: typeof item.conversationId === 'string' ? item.conversationId : null,
    sourceType: typeof item.sourceType === 'string' ? item.sourceType : 'topic',
    topic: typeof item.topic === 'string' && item.topic.trim() ? item.topic : 'Study Topic',
    lessonTitle:
      typeof item.lessonTitle === 'string' && item.lessonTitle.trim()
        ? item.lessonTitle
        : 'Voice Tutor Lesson',
    sourceExcerpt: typeof item.sourceExcerpt === 'string' ? item.sourceExcerpt : '',
    learningLevel: typeof item.learningLevel === 'string' ? item.learningLevel : 'Beginner',
    preferredLanguage:
      typeof item.preferredLanguage === 'string' ? item.preferredLanguage : 'English',
    languageCode: typeof item.languageCode === 'string' ? item.languageCode : 'en',
    voiceName: typeof item.voiceName === 'string' ? item.voiceName : 'Kore',
    slow: Boolean(item.slow),
    explanation: {
      lessonTitle:
        typeof exp.lessonTitle === 'string' && exp.lessonTitle.trim()
          ? exp.lessonTitle
          : typeof item.lessonTitle === 'string'
          ? item.lessonTitle
          : 'Voice Tutor Lesson',
      introduction: typeof exp.introduction === 'string' ? exp.introduction : '',
      meaningAndDefinition:
        typeof exp.meaningAndDefinition === 'string' ? exp.meaningAndDefinition : '',
      stepByStepExplanation: Array.isArray(exp.stepByStepExplanation)
        ? exp.stepByStepExplanation
        : [],
      realWorldExamples: Array.isArray(exp.realWorldExamples) ? exp.realWorldExamples : [],
      analogies: Array.isArray(exp.analogies) ? exp.analogies : [],
      importantPoints: Array.isArray(exp.importantPoints) ? exp.importantPoints : [],
      shortRecap: typeof exp.shortRecap === 'string' ? exp.shortRecap : '',
    },
    sections: Array.isArray(item.sections) ? item.sections : [],
    audioRefs,
    primaryAudioUrl:
      typeof item.primaryAudioUrl === 'string' && item.primaryAudioUrl
        ? resolveBackendAudioUrl(item.primaryAudioUrl)
        : null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// ── Auth API ─────────────────────────────────────────────────────────────────

export async function registerUser(params: {
  fullName: string;
  email: string;
  password: string;
}): Promise<{ accessToken: string; user: AuthUser }> {
  const data = await apiRequest<{ accessToken: string; user: AuthUser }>(
    '/api/auth/register',
    {
      method: 'POST',
      body: params,
      skipAuthRedirect: true,
    }
  );
  setAuthToken(data.accessToken);
  return data;
}

export async function loginUser(params: {
  email: string;
  password: string;
}): Promise<{ accessToken: string; user: AuthUser }> {
  const data = await apiRequest<{ accessToken: string; user: AuthUser }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: params,
      skipAuthRedirect: true,
    }
  );
  setAuthToken(data.accessToken);
  return data;
}

export async function logoutUser(): Promise<void> {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST', skipAuthRedirect: true });
  } catch {
    // Ignore transient network errors on logout
  } finally {
    clearAuthToken();
  }
}

export async function fetchCurrentUser(): Promise<{ user: AuthUser }> {
  return apiRequest<{ user: AuthUser }>('/api/auth/me', { skipAuthRedirect: true });
}

// ── Documents API ────────────────────────────────────────────────────────────

export async function uploadDocumentFile(file: File): Promise<SavedDocumentDetail> {
  const buffer = await file.arrayBuffer();
  const base64Data = arrayBufferToBase64(buffer);
  return apiRequest<SavedDocumentDetail>('/api/documents/upload', {
    method: 'POST',
    body: { fileName: file.name, base64Data },
  });
}

export async function listDocuments(): Promise<{ documents: SavedDocumentSummary[] }> {
  return apiRequest<{ documents: SavedDocumentSummary[] }>('/api/documents');
}

export async function getDocumentById(documentId: string): Promise<SavedDocumentDetail> {
  return apiRequest<SavedDocumentDetail>(`/api/documents/${encodeURIComponent(documentId)}`);
}

export async function downloadDocumentFile(
  documentId: string,
  filename: string
): Promise<void> {
  const token = getAuthToken();
  const url = buildApiUrl(`/api/documents/${encodeURIComponent(documentId)}/download`);
  const response = await fetch(url, {
    headers: {
      'X-Requested-With': 'fetch',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  });
  if (response.status === 401 && unauthorizedHandler) {
    unauthorizedHandler();
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(
      'Received an HTML page instead of the document file. Please refresh and try again.'
    );
  }
  if (!response.ok) {
    throw new Error('Could not download document.');
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function deleteDocumentById(documentId: string): Promise<void> {
  await apiRequest(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
}

// ── Chats API ────────────────────────────────────────────────────────────────

export async function createChat(params: {
  title?: string;
  documentId?: string | null;
} = {}): Promise<ChatDetail> {
  return apiRequest<ChatDetail>('/api/chats', {
    method: 'POST',
    body: params,
  });
}

export async function listChats(
  query = ''
): Promise<{ conversations: ChatConversationSummary[] }> {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  return apiRequest<{ conversations: ChatConversationSummary[] }>(`/api/chats${qs}`);
}

export async function getChatDetail(chatId: string): Promise<ChatDetail> {
  const data = await apiRequest<ChatDetail>(`/api/chats/${encodeURIComponent(chatId)}`);
  return {
    ...data,
    messages: Array.isArray(data?.messages) ? data.messages : [],
    recommendations: Array.isArray(data?.recommendations)
      ? data.recommendations.map(normalizeVideoRecommendationResult)
      : [],
  };
}

export async function sendChatMessage(
  chatId: string,
  params: { content: string; sourceText: string; documentId?: string | null }
): Promise<{
  conversation: ChatConversationSummary;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}> {
  return apiRequest(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST',
    body: params,
  });
}

export async function renameChat(
  chatId: string,
  title: string
): Promise<ChatConversationSummary> {
  return apiRequest<ChatConversationSummary>(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: 'PATCH',
    body: { title },
  });
}

export async function deleteChat(chatId: string): Promise<void> {
  await apiRequest(`/api/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
}

// ── Learning Results & History API ───────────────────────────────────────────

export async function listLearningResults(): Promise<{ results: LearningResultRecord[] }> {
  return apiRequest<{ results: LearningResultRecord[] }>('/api/learning-results');
}

export async function saveLearningResultRecord(params: {
  resultType: 'simplified' | 'summary' | 'explanation';
  title: string;
  sourceExcerpt: string;
  contentText: string;
  documentId?: string | null;
  readingLevel?: string | null;
  summaryLength?: string | null;
  keywords?: string[];
  bulletPoints?: string[];
  concepts?: LearningResultConcept[];
  examples?: string[];
}): Promise<LearningResultRecord> {
  return apiRequest<LearningResultRecord>('/api/learning-results', {
    method: 'POST',
    body: params,
  });
}

export async function deleteLearningResultById(resultId: string): Promise<void> {
  await apiRequest(`/api/learning-results/${encodeURIComponent(resultId)}`, {
    method: 'DELETE',
  });
}

export async function searchHistory(query: string): Promise<HistoryBundle> {
  const data = await apiRequest<HistoryBundle>(
    `/api/history/search?q=${encodeURIComponent(query.trim())}`
  );
  return {
    ...data,
    conversations: Array.isArray(data?.conversations) ? data.conversations : [],
    documents: Array.isArray(data?.documents) ? data.documents : [],
    learningResults: Array.isArray(data?.learningResults) ? data.learningResults : [],
    videoRecommendations: Array.isArray(data?.videoRecommendations)
      ? data.videoRecommendations.map(normalizeVideoRecommendationResult)
      : [],
    voiceTutorSessions: Array.isArray(data?.voiceTutorSessions)
      ? data.voiceTutorSessions.map(normalizeVoiceTutorSession)
      : [],
  };
}

// ── AI Processing APIs ───────────────────────────────────────────────────────

export async function simplifyText(
  text: string,
  readingLevel: ReadingLevel,
  documentId: string | null,
  saveToHistory = true
): Promise<SimplifyResult> {
  return apiRequest<SimplifyResult>('/api/simplify', {
    method: 'POST',
    body: { text, readingLevel, documentId, saveToHistory },
  });
}

export async function summarizeText(
  text: string,
  summaryLength: SummaryLength,
  documentId: string | null,
  saveToHistory = true
): Promise<SummaryResult> {
  return apiRequest<SummaryResult>('/api/summarize', {
    method: 'POST',
    body: { text, summaryLength, documentId, saveToHistory },
  });
}

export async function generateSpeechAudio(params: {
  text: string;
  voiceName: TtsVoiceName;
  slow: boolean;
  language?: string;
}): Promise<{ audioBase64: string; mimeType: string; chunkCount: number; language?: string }> {
  return apiRequest('/api/tts', {
    method: 'POST',
    body: params,
  });
}

// ── YouTube Learning Video Recommendations API ───────────────────────────────

export async function fetchYoutubeRecommendations(params: {
  content?: string;
  customTopic?: string;
  keywords?: string[];
  learningLevel?: ReadingLevel;
  preferredLanguage?: string;
  sourceType?: VideoSourceType;
  documentId?: string | null;
  conversationId?: string | null;
  forceRefresh?: boolean;
  saveToHistory?: boolean;
}): Promise<VideoRecommendationResult> {
  const data = await apiRequest<VideoRecommendationResult>('/api/recommendations/youtube', {
    method: 'POST',
    body: params,
  });
  return normalizeVideoRecommendationResult(data);
}

export async function listVideoRecommendationsHistory(params: {
  conversationId?: string;
  query?: string;
} = {}): Promise<{ recommendations: VideoRecommendationResult[] }> {
  const sp = new URLSearchParams();
  if (params.conversationId) sp.set('conversationId', params.conversationId);
  if (params.query?.trim()) sp.set('q', params.query.trim());
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  const data = await apiRequest<{ recommendations: VideoRecommendationResult[] }>(
    `/api/recommendations/youtube/history${qs}`
  );
  return {
    recommendations: Array.isArray(data?.recommendations)
      ? data.recommendations.map(normalizeVideoRecommendationResult)
      : [],
  };
}

export async function deleteVideoRecommendationById(id: string): Promise<void> {
  await apiRequest(`/api/recommendations/youtube/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── AI Voice Tutor API ───────────────────────────────────────────────────────

export async function getVoiceTutorLanguages(): Promise<{
  languages: VoiceTutorLanguageOption[];
}> {
  return apiRequest<{ languages: VoiceTutorLanguageOption[] }>(
    '/api/voice-tutor/languages'
  );
}

export async function explainWithVoiceTutor(params: {
  topic?: string;
  content?: string;
  sourceType?: VoiceTutorSourceType;
  documentId?: string | null;
  conversationId?: string | null;
  learningLevel?: ReadingLevel;
  preferredLanguage?: string;
  voiceName?: TtsVoiceName;
  slow?: boolean;
  generateInitialAudio?: boolean;
}): Promise<VoiceTutorExplainResponse> {
  const data = await apiRequest<VoiceTutorExplainResponse>('/api/voice-tutor/explain', {
    method: 'POST',
    body: params,
  });
  return {
    ...data,
    session: normalizeVoiceTutorSession(data.session),
    sections: Array.isArray(data?.sections) ? data.sections : [],
  };
}

export async function synthesizeVoiceTutorSectionAudio(params: {
  sessionId?: string | null;
  sectionIndex: number;
  text?: string;
  preferredLanguage?: string;
  voiceName?: TtsVoiceName;
  slow?: boolean;
}): Promise<VoiceTutorSectionAudioResponse> {
  return apiRequest<VoiceTutorSectionAudioResponse>('/api/voice-tutor/sections/audio', {
    method: 'POST',
    body: params,
  });
}

export async function listVoiceTutorHistory(
  query = ''
): Promise<{ sessions: VoiceTutorSession[] }> {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const data = await apiRequest<{ sessions: VoiceTutorSession[] }>(
    `/api/voice-tutor/history${qs}`
  );
  return {
    sessions: Array.isArray(data?.sessions)
      ? data.sessions.map(normalizeVoiceTutorSession)
      : [],
  };
}

export async function deleteVoiceTutorSessionById(id: string): Promise<void> {
  await apiRequest(`/api/voice-tutor/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

