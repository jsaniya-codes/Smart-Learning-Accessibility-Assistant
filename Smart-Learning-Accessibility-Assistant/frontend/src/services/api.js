/**
 * Central API client communicating with the Python FastAPI backend.
 * Stores only the JWT access token locally; all chats, documents, and
 * learning results are persisted in the backend SQLAlchemy database.
 */

const RAW_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim();

export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, '').replace(/\/api$/i, '');

export function buildApiUrl(endpoint) {
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalized}` : normalized;
}

const TOKEN_STORAGE_KEY = 'slaa_auth_token';
let unauthorizedHandler = null;

export function getAuthToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setAuthToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction errors
  }
}

export function clearAuthToken() {
  setAuthToken('');
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

async function parseErrorMessage(response, fallbackMessage) {
  try {
    const data = await response.json();
    if (typeof data?.detail === 'string') {
      return data.detail;
    }
    if (Array.isArray(data?.detail) && data.detail.length > 0) {
      return data.detail.map((item) => item.msg || String(item)).join(' ');
    }
    if (typeof data?.error === 'string') {
      return data.error;
    }
  } catch {
    // Non-JSON response body
  }
  return fallbackMessage;
}

function buildHeaders(extraHeaders = {}, includeJsonContentType = false) {
  const headers = {
    Accept: 'application/json',
    'X-Requested-With': 'fetch',
    ...extraHeaders,
  };
  if (includeJsonContentType && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function requestJson(endpoint, { method = 'GET', body, fallbackError, skipAuthRedirect = false } = {}) {
  const targetUrl = buildApiUrl(endpoint);
  const executeFetch = () =>
    fetch(targetUrl, {
      method,
      headers: buildHeaders({}, body !== undefined),
      cache: 'no-store',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let response;
  try {
    response = await executeFetch();
  } catch {
    throw new Error(
      `Could not reach the backend server (${API_BASE_URL || 'same-origin /api proxy'}). Please ensure the FastAPI server is running.`
    );
  }

  let contentType = (response.headers.get('content-type') || '').toLowerCase();
  let rawText = response.status === 204 ? '' : await response.text();

  if (
    response.status !== 204 &&
    (contentType.includes('text/html') || /^\s*</.test(rawText))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      response = await executeFetch();
      contentType = (response.headers.get('content-type') || '').toLowerCase();
      rawText = response.status === 204 ? '' : await response.text();
    } catch {
      // Keep original response state if retry fails at network layer
    }
  }

  if (response.status === 401 && !skipAuthRedirect && unauthorizedHandler) {
    unauthorizedHandler();
  }

  if (!response.ok) {
    let parsedError = fallbackError || 'Request failed.';
    try {
      const errData = JSON.parse(rawText);
      if (typeof errData?.detail === 'string') parsedError = errData.detail;
      else if (Array.isArray(errData?.detail) && errData.detail.length > 0) {
        parsedError = errData.detail.map((item) => item.msg || String(item)).join(' ');
      } else if (typeof errData?.error === 'string') {
        parsedError = errData.error;
      }
    } catch {
      // Non-JSON error body
    }
    throw new Error(parsedError);
  }

  if (response.status === 204 || !rawText.trim()) {
    return response.status === 204 ? null : {};
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    const looksLikeHtml =
      contentType.includes('text/html') || /^\s*</.test(rawText);
    if (looksLikeHtml) {
      throw new Error(
        `Received HTML instead of JSON from ${endpoint} (HTTP ${response.status}). Please refresh the page and ensure the backend server is running.`
      );
    }
    throw new Error(
      `Unexpected non-JSON response from ${endpoint} (HTTP ${response.status}). Please refresh and try again.`
    );
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`Unexpected response format from ${endpoint}. Please try again.`);
  }
  return data;
}

function normalizeVideoRecommendationResult(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  return {
    id: typeof item.id === 'string' ? item.id : null,
    conversationId: typeof item.conversationId === 'string' ? item.conversationId : null,
    documentId: typeof item.documentId === 'string' ? item.documentId : null,
    sourceType: typeof item.sourceType === 'string' ? item.sourceType : 'text',
    topic: typeof item.topic === 'string' && item.topic.trim() ? item.topic : 'Study Topic',
    keywords: Array.isArray(item.keywords)
      ? item.keywords.filter((k) => typeof k === 'string')
      : [],
    searchQuery: typeof item.searchQuery === 'string' ? item.searchQuery : '',
    learningLevel: typeof item.learningLevel === 'string' ? item.learningLevel : 'Beginner',
    preferredLanguage:
      typeof item.preferredLanguage === 'string' ? item.preferredLanguage : 'English',
    videos: Array.isArray(item.videos)
      ? item.videos.filter((v) => v && typeof v === 'object')
      : [],
    cached: Boolean(item.cached),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
  };
}

function resolveBackendAudioUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (/^https?:\/\//i.test(url)) return url;
  return buildApiUrl(url);
}

function normalizeVoiceTutorSession(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const exp = item.explanation && typeof item.explanation === 'object' ? item.explanation : {};
  const audioRefs = Array.isArray(item.audioRefs)
    ? item.audioRefs.map((r) => ({
        ...r,
        audioUrl: r?.audioUrl ? resolveBackendAudioUrl(r.audioUrl) : '',
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
    primaryAudioUrl: item.primaryAudioUrl
      ? resolveBackendAudioUrl(item.primaryAudioUrl)
      : null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
  };
}

// ---------- Health ----------

export async function checkBackendHealth() {
  return requestJson('/api/health', {
    fallbackError: 'Backend health check failed.',
    skipAuthRedirect: true,
  });
}

// ---------- Authentication ----------

export async function registerUser({ fullName, email, password }) {
  const data = await requestJson('/api/auth/register', {
    method: 'POST',
    body: { fullName, email, password },
    fallbackError: 'Could not create account.',
    skipAuthRedirect: true,
  });
  if (data?.accessToken) {
    setAuthToken(data.accessToken);
  }
  return data;
}

export async function loginUser({ email, password }) {
  const data = await requestJson('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    fallbackError: 'Invalid email or password.',
    skipAuthRedirect: true,
  });
  if (data?.accessToken) {
    setAuthToken(data.accessToken);
  }
  return data;
}

export async function logoutUser() {
  try {
    if (getAuthToken()) {
      await requestJson('/api/auth/logout', {
        method: 'POST',
        fallbackError: 'Sign out failed.',
        skipAuthRedirect: true,
      });
    }
  } catch {
    // Always clear client token regardless of network error on sign-out
  } finally {
    clearAuthToken();
  }
}

export async function fetchCurrentUser() {
  return requestJson('/api/auth/me', {
    fallbackError: 'Session expired. Please log in again.',
    skipAuthRedirect: true,
  });
}

// ---------- Persistent Chats ----------

export async function createChat({ title = null, documentId = null } = {}) {
  return requestJson('/api/chats', {
    method: 'POST',
    body: { title, documentId },
    fallbackError: 'Could not create new conversation.',
  });
}

export async function listChats(query = '') {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  return requestJson(`/api/chats${qs}`, {
    fallbackError: 'Could not load conversations.',
  });
}

export async function getChatDetail(chatId) {
  const data = await requestJson(`/api/chats/${encodeURIComponent(chatId)}`, {
    fallbackError: 'Could not load conversation messages.',
  });
  return {
    ...data,
    messages: Array.isArray(data?.messages) ? data.messages : [],
    recommendations: Array.isArray(data?.recommendations)
      ? data.recommendations.map(normalizeVideoRecommendationResult)
      : [],
  };
}

export async function sendChatMessage(chatId, { content, sourceText = null, documentId = null }) {
  return requestJson(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST',
    body: { content, sourceText, documentId },
    fallbackError: 'Could not send message.',
  });
}

export async function renameChat(chatId, title) {
  return requestJson(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: 'PATCH',
    body: { title },
    fallbackError: 'Could not rename conversation.',
  });
}

export async function deleteChat(chatId) {
  return requestJson(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
    fallbackError: 'Could not delete conversation.',
  });
}

// ---------- Unified History & Search ----------

export async function fetchHistoryOverview() {
  return requestJson('/api/history', {
    fallbackError: 'Could not load your learning history.',
  });
}

export async function searchHistory(query) {
  const data = await requestJson(`/api/history/search?q=${encodeURIComponent(query || '')}`, {
    fallbackError: 'Could not search your learning history.',
  });
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

// ---------- Documents ----------

export async function uploadDocumentFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  let response;
  try {
    response = await fetch(buildApiUrl('/api/documents/upload'), {
      method: 'POST',
      headers: buildHeaders(),
      cache: 'no-store',
      body: formData,
    });
  } catch {
    throw new Error(
      `Could not reach the backend server (${API_BASE_URL || 'same-origin /api proxy'}). Please ensure the FastAPI server is running.`
    );
  }

  if (response.status === 401 && unauthorizedHandler) {
    unauthorizedHandler();
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const rawText = await response.text();
  const looksLikeHtml = contentType.includes('text/html') || /^\s*</.test(rawText);

  if (!response.ok) {
    let parsedError = 'Could not extract text from this document.';
    try {
      const errData = JSON.parse(rawText);
      if (typeof errData?.detail === 'string') parsedError = errData.detail;
      else if (typeof errData?.error === 'string') parsedError = errData.error;
    } catch {
      if (looksLikeHtml) {
        parsedError =
          'Received HTML instead of JSON from /api/documents/upload. Please ensure the FastAPI server is running.';
      }
    }
    throw new Error(parsedError);
  }

  try {
    return JSON.parse(rawText);
  } catch {
    if (looksLikeHtml) {
      throw new Error(
        `Received HTML instead of JSON from /api/documents/upload (HTTP ${response.status}). Please ensure the backend server is running.`
      );
    }
    throw new Error(
      `Unexpected non-JSON response from /api/documents/upload (HTTP ${response.status}). Please refresh and try again.`
    );
  }
}

export async function listDocuments() {
  return requestJson('/api/documents', {
    fallbackError: 'Could not load your uploaded documents.',
  });
}

export async function getDocumentById(documentId) {
  return requestJson(`/api/documents/${encodeURIComponent(documentId)}`, {
    fallbackError: 'Could not reopen this document.',
  });
}

export async function downloadDocumentFile(documentId, filename) {
  let response;
  try {
    response = await fetch(
      buildApiUrl(`/api/documents/${encodeURIComponent(documentId)}/download`),
      {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      }
    );
  } catch {
    throw new Error(
      `Could not reach the backend server (${API_BASE_URL || 'same-origin /api proxy'}).`
    );
  }

  if (response.status === 401 && unauthorizedHandler) {
    unauthorizedHandler();
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(
      'Received an HTML page instead of the document file. Please refresh and ensure the backend server is running.'
    );
  }

  if (!response.ok) {
    const message = await parseErrorMessage(response, 'Could not download document.');
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'study-document';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function deleteDocumentById(documentId) {
  return requestJson(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    fallbackError: 'Could not delete document.',
  });
}

export async function analyzeTextOnBackend(text) {
  return requestJson('/api/documents/analyze', {
    method: 'POST',
    body: { text },
    fallbackError: 'Could not analyze educational text.',
  });
}

// ---------- Saved Learning Results ----------

export async function listLearningResults(type = '') {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  return requestJson(`/api/learning-results${qs}`, {
    fallbackError: 'Could not load saved learning results.',
  });
}

export async function saveLearningResultRecord(payload) {
  return requestJson('/api/learning-results', {
    method: 'POST',
    body: payload,
    fallbackError: 'Could not save learning result.',
  });
}

export async function deleteLearningResultById(resultId) {
  return requestJson(`/api/learning-results/${encodeURIComponent(resultId)}`, {
    method: 'DELETE',
    fallbackError: 'Could not delete saved result.',
  });
}

// ---------- AI & Speech ----------

export async function simplifyText(
  text,
  readingLevel = 'Beginner',
  documentId = null,
  saveToHistory = true
) {
  return requestJson('/api/simplify', {
    method: 'POST',
    body: { text, readingLevel, documentId, saveToHistory },
    fallbackError: 'Could not simplify educational text.',
  });
}

export async function summarizeText(
  text,
  summaryLength = 'Medium',
  documentId = null,
  saveToHistory = true
) {
  return requestJson('/api/summarize', {
    method: 'POST',
    body: { text, summaryLength, documentId, saveToHistory },
    fallbackError: 'Could not summarize educational text.',
  });
}

export async function askLearningAssistant(text, question) {
  return requestJson('/api/assistant', {
    method: 'POST',
    body: { text, question },
    fallbackError: 'Could not answer your question.',
  });
}

export async function generateSpeechAudio({ text, lang = 'en', slow = false }) {
  let response;
  try {
    response = await fetch(buildApiUrl('/api/speech'), {
      method: 'POST',
      headers: buildHeaders({}, true),
      cache: 'no-store',
      body: JSON.stringify({ text, lang, slow }),
    });
  } catch {
    throw new Error(
      `Could not reach the backend server (${API_BASE_URL || 'same-origin /api proxy'}). Please ensure the FastAPI server is running.`
    );
  }

  if (response.status === 401 && unauthorizedHandler) {
    unauthorizedHandler();
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(
      `Received HTML instead of audio from /api/speech (HTTP ${response.status}). Please ensure the FastAPI server is running.`
    );
  }

  if (!response.ok) {
    const message = await parseErrorMessage(
      response,
      'Could not generate MP3 speech audio.'
    );
    throw new Error(message);
  }

  const blob = await response.blob();
  const chunkCount = Number(response.headers.get('X-Speech-Chunks') || '1');
  const wasTruncated = response.headers.get('X-Speech-Truncated') === 'true';

  return {
    blob,
    chunkCount: Number.isFinite(chunkCount) ? chunkCount : 1,
    wasTruncated,
  };
}

// ---------- YouTube Learning Video Recommendations ----------

export async function fetchYoutubeRecommendations({
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
}) {
  const data = await requestJson('/api/recommendations/youtube', {
    method: 'POST',
    body: {
      content,
      customTopic,
      keywords,
      learningLevel,
      preferredLanguage,
      sourceType,
      documentId,
      conversationId,
      forceRefresh,
      saveToHistory,
    },
    fallbackError: 'Could not load YouTube video recommendations.',
  });
  return normalizeVideoRecommendationResult(data);
}

export async function listVideoRecommendationsHistory({
  conversationId = '',
  query = '',
} = {}) {
  const sp = new URLSearchParams();
  if (conversationId) sp.set('conversationId', conversationId);
  if (query.trim()) sp.set('q', query.trim());
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  const data = await requestJson(`/api/recommendations/youtube/history${qs}`, {
    fallbackError: 'Could not load saved video recommendations.',
  });
  return {
    recommendations: Array.isArray(data?.recommendations)
      ? data.recommendations.map(normalizeVideoRecommendationResult)
      : [],
  };
}

export async function deleteVideoRecommendationById(id) {
  return requestJson(`/api/recommendations/youtube/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    fallbackError: 'Could not delete video recommendation.',
  });
}

// ---------- AI Voice Tutor ----------

export async function getVoiceTutorLanguages() {
  return requestJson('/api/voice-tutor/languages', {
    fallbackError: 'Could not load supported languages.',
    skipAuthRedirect: true,
  });
}

export async function explainWithVoiceTutor(params) {
  const data = await requestJson('/api/voice-tutor/explain', {
    method: 'POST',
    body: params,
    fallbackError: 'Could not generate AI Voice Tutor explanation.',
  });
  return {
    ...data,
    session: normalizeVoiceTutorSession(data?.session),
    audioUrl: data?.audioUrl ? resolveBackendAudioUrl(data.audioUrl) : null,
    sections: Array.isArray(data?.sections) ? data.sections : [],
  };
}

export async function synthesizeVoiceTutorSectionAudio(params) {
  const data = await requestJson('/api/voice-tutor/sections/audio', {
    method: 'POST',
    body: params,
    fallbackError: 'Could not synthesize section audio.',
  });
  return {
    ...data,
    audioUrl: data?.audioUrl ? resolveBackendAudioUrl(data.audioUrl) : '',
  };
}

export async function listVoiceTutorHistory(query = '') {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const data = await requestJson(`/api/voice-tutor/history${qs}`, {
    fallbackError: 'Could not load saved Voice Tutor lessons.',
  });
  return {
    sessions: Array.isArray(data?.sessions)
      ? data.sessions.map(normalizeVoiceTutorSession)
      : [],
  };
}

export async function deleteVoiceTutorSessionById(id) {
  return requestJson(`/api/voice-tutor/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    fallbackError: 'Could not delete Voice Tutor session.',
  });
}

