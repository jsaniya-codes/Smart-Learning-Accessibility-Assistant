import { useEffect, useRef, useState } from 'react';
import { Loader2, Menu } from 'lucide-react';
import { AssistantWorkspace } from './components/AssistantWorkspace';
import { AuthPage } from './components/AuthPage';
import { HistoryWorkspace } from './components/HistoryWorkspace';
import { InputWorkspace } from './components/InputWorkspace';
import { ReadingToolbar } from './components/ReadingToolbar';
import { SidebarNav } from './components/SidebarNav';
import { SimplifyWorkspace } from './components/SimplifyWorkspace';
import { SpeechWorkspace } from './components/SpeechWorkspace';
import { SummaryWorkspace } from './components/SummaryWorkspace';
import { VideoRecommendationsSection } from './components/VideoRecommendationsSection';
import {
  clearAuthToken,
  createChat,
  deleteChat,
  deleteDocumentById,
  deleteLearningResultById,
  deleteVideoRecommendationById,
  deleteVoiceTutorSessionById,
  downloadDocumentFile,
  fetchCurrentUser,
  getAuthToken,
  getChatDetail,
  getDocumentById,
  listChats,
  listDocuments,
  listLearningResults,
  listVideoRecommendationsHistory,
  listVoiceTutorHistory,
  logoutUser,
  renameChat,
  saveLearningResultRecord,
  sendChatMessage,
  setUnauthorizedHandler,
} from './services/api';
import type {
  ActiveSection,
  AuthUser,
  ChatConversationSummary,
  ChatDetail,
  DocumentSourceMeta,
  LearningResultRecord,
  ReadingLevel,
  ReadingPreferences,
  SavedDocumentSummary,
  SimplifyResult,
  SpeechAudioState,
  SummaryLength,
  SummaryResult,
  VideoRecommendationResult,
  VoiceTutorSession,
} from './types/learning';
import {
  buildCacheKey,
  computeTextStats,
  DEFAULT_FONT_SIZE,
} from './utils/textMetrics';

const SECTION_TITLES: Record<ActiveSection, string> = {
  input: 'Workspace / Input & Upload',
  simplify: 'Workspace / Text Simplification',
  summarize: 'Workspace / Text Summarization',
  assistant: 'Workspace / AI Learning Assistant',
  videos: 'Workspace / Recommended Learning Videos',
  speech: 'Workspace / AI Voice Tutor & Audio Studio',
  history: 'Workspace / Saved Learning Library',
};

export default function App() {
  const [authBootstrapping, setAuthBootstrapping] = useState(true);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<ActiveSection>('input');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [sourceText, setSourceText] = useState('');
  const [sourceMeta, setSourceMeta] = useState<DocumentSourceMeta | null>(null);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);

  const [readingLevel, setReadingLevel] = useState<ReadingLevel>('Beginner');
  const [simplifyCache, setSimplifyCache] = useState<Record<string, SimplifyResult>>({});

  const [summaryLength, setSummaryLength] = useState<SummaryLength>('Medium');
  const [summaryCache, setSummaryCache] = useState<Record<string, SummaryResult>>({});

  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [activeChat, setActiveChat] = useState<ChatDetail | null>(null);
  const [isLoadingChat, setIsLoadingChat] = useState(false);

  const [documents, setDocuments] = useState<SavedDocumentSummary[]>([]);
  const [learningResults, setLearningResults] = useState<LearningResultRecord[]>([]);
  const [activeVideoResult, setActiveVideoResult] =
    useState<VideoRecommendationResult | null>(null);
  const [videoHistory, setVideoHistory] = useState<VideoRecommendationResult[]>([]);
  const [voiceTutorHistory, setVoiceTutorHistory] = useState<VoiceTutorSession[]>([]);
  const [activeVoiceTutorSession, setActiveVoiceTutorSession] =
    useState<VoiceTutorSession | null>(null);

  const [speechAudio, setSpeechAudio] = useState<SpeechAudioState | null>(null);
  const speechUrlRef = useRef<string | null>(null);

  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>({
    fontSize: DEFAULT_FONT_SIZE,
    lineSpacing: 'relaxed',
    fontFamily: 'sans',
    highContrast: false,
  });

  const revokeSpeechUrl = () => {
    if (speechUrlRef.current) {
      URL.revokeObjectURL(speechUrlRef.current);
      speechUrlRef.current = null;
    }
  };

  const resetUserWorkspace = () => {
    setSourceText('');
    setSourceMeta(null);
    setActiveDocumentId(null);
    setSimplifyCache({});
    setSummaryCache({});
    setConversations([]);
    setChatSearchQuery('');
    setActiveChat(null);
    setDocuments([]);
    setLearningResults([]);
    setActiveVideoResult(null);
    setVideoHistory([]);
    setVoiceTutorHistory([]);
    setActiveVoiceTutorSession(null);
    revokeSpeechUrl();
    setSpeechAudio(null);
    setActiveSection('input');
  };

  const loadUserWorkspace = async () => {
    const [chatsRes, docsRes, resultsRes, videosRes, tutorRes] = await Promise.all([
      listChats(),
      listDocuments(),
      listLearningResults(),
      listVideoRecommendationsHistory(),
      listVoiceTutorHistory(),
    ]);
    setConversations(chatsRes?.conversations || []);
    setDocuments(docsRes?.documents || []);
    setLearningResults(resultsRes?.results || []);
    setVideoHistory(videosRes?.recommendations || []);
    setVoiceTutorHistory(tutorRes?.sessions || []);
  };

  useEffect(() => {
    speechUrlRef.current = speechAudio?.url ?? null;
  }, [speechAudio]);

  useEffect(() => {
    return () => {
      if (speechUrlRef.current) {
        URL.revokeObjectURL(speechUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearAuthToken();
      setCurrentUser(null);
      resetUserWorkspace();
      setSessionNotice('Your session expired. Please sign in again.');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      const token = getAuthToken();
      if (!token) {
        if (active) setAuthBootstrapping(false);
        return;
      }
      try {
        const meData = await fetchCurrentUser();
        if (!active) return;
        setCurrentUser(meData.user);
        await loadUserWorkspace();
      } catch {
        clearAuthToken();
        if (active) {
          setCurrentUser(null);
        }
      } finally {
        if (active) setAuthBootstrapping(false);
      }
    }
    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  const handleAuthenticated = async (user: AuthUser) => {
    setSessionNotice(null);
    setCurrentUser(user);
    await loadUserWorkspace();
  };

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser(null);
    setSessionNotice(null);
    resetUserWorkspace();
  };

  const handleUpdateText = (nextText: string, nextMeta: DocumentSourceMeta | null) => {
    setSourceText(nextText);
    setSourceMeta(nextMeta);
    setActiveDocumentId(nextMeta?.id || null);
    setSimplifyCache({});
    setSummaryCache({});
    setActiveVideoResult(null);
    revokeSpeechUrl();
    setSpeechAudio(null);
  };

  const handleDocumentUploaded = async () => {
    const docsRes = await listDocuments();
    setDocuments(docsRes?.documents || []);
  };

  const handleReopenDocument = async (documentId: string) => {
    const doc = await getDocumentById(documentId);
    setSourceText(doc.text || '');
    setSourceMeta({
      id: doc.id,
      name: doc.originalFilename || doc.filename,
      fileType: doc.fileType,
      pages: doc.pageCount || 1,
      pagesWithText: doc.pagesWithText || doc.pageCount || 1,
      ocrWarning: doc.ocrWarning || null,
    });
    setActiveDocumentId(doc.id);
    setSimplifyCache({});
    setSummaryCache({});
    setActiveSection('input');
  };

  const handleSelectDocumentForChat = async (documentId: string) => {
    const doc = await getDocumentById(documentId);
    setSourceText(doc.text || '');
    setSourceMeta({
      id: doc.id,
      name: doc.originalFilename || doc.filename,
      fileType: doc.fileType,
      pages: doc.pageCount || 1,
      pagesWithText: doc.pagesWithText || doc.pageCount || 1,
      ocrWarning: doc.ocrWarning || null,
    });
    setActiveDocumentId(doc.id);
  };

  const handleDownloadDocument = async (documentId: string, filename: string) => {
    await downloadDocumentFile(documentId, filename);
  };

  const handleDeleteDocument = async (documentId: string) => {
    await deleteDocumentById(documentId);
    setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
    if (activeDocumentId === documentId) {
      setActiveDocumentId(null);
    }
  };

  const handleChatSearchChange = async (query: string) => {
    setChatSearchQuery(query);
    try {
      const res = await listChats(query);
      setConversations(res?.conversations || []);
    } catch {
      // Keep current list on transient search error
    }
  };

  const handleNewChat = () => {
    setActiveChat(null);
    setActiveSection('assistant');
  };

  const handleSelectChat = async (chatId: string) => {
    setActiveSection('assistant');
    setIsLoadingChat(true);
    try {
      const detail = await getChatDetail(chatId);
      setActiveChat(detail);
      if (detail.document?.text) {
        setSourceText(detail.document.text);
        setSourceMeta({
          id: detail.document.id,
          name: detail.document.originalFilename || detail.document.filename,
          fileType: detail.document.fileType,
          pages: detail.document.pageCount || 1,
          pagesWithText: detail.document.pagesWithText || 1,
          ocrWarning: detail.document.ocrWarning || null,
        });
        setActiveDocumentId(detail.document.id);
      }
    } finally {
      setIsLoadingChat(false);
    }
  };

  const handleSendChatMessage = async ({
    content,
    sourceText: msgText,
    documentId,
  }: {
    content: string;
    sourceText: string;
    documentId: string | null;
  }) => {
    let targetChat = activeChat;
    if (!targetChat) {
      targetChat = await createChat({ documentId: documentId || activeDocumentId || null });
    }

    const replyData = await sendChatMessage(targetChat.id, {
      content,
      sourceText: msgText,
      documentId: documentId || activeDocumentId || null,
    });

    setActiveChat((prev) => ({
      ...(prev || targetChat),
      id: targetChat.id,
      title: replyData.conversation.title,
      documentId: replyData.conversation.documentId,
      createdAt: replyData.conversation.createdAt,
      updatedAt: replyData.conversation.updatedAt,
      document: prev?.document || targetChat.document || null,
      messages: [
        ...(prev?.id === targetChat.id ? prev.messages || [] : []),
        replyData.userMessage,
        replyData.assistantMessage,
      ],
    }));

    const chatsRes = await listChats(chatSearchQuery);
    setConversations(chatsRes?.conversations || []);
  };

  const handleRenameChat = async (chatId: string, newTitle: string) => {
    const updated = await renameChat(chatId, newTitle);
    setConversations((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, title: updated.title } : c))
    );
    setActiveChat((prev) =>
      prev && prev.id === chatId ? { ...prev, title: updated.title } : prev
    );
  };

  const handleDeleteChat = async (chatId: string) => {
    await deleteChat(chatId);
    setConversations((prev) => prev.filter((c) => c.id !== chatId));
    if (activeChat?.id === chatId) {
      setActiveChat(null);
    }
  };

  const handleRefreshLibrary = async () => {
    const res = await listLearningResults();
    setLearningResults(res?.results || []);
  };

  const handleSaveExplanationResult = async (payload: {
    title: string;
    sourceExcerpt: string;
    contentText: string;
    documentId: string | null;
    examples: string[];
  }) => {
    await saveLearningResultRecord({
      resultType: 'explanation',
      title: payload.title,
      sourceExcerpt: payload.sourceExcerpt,
      contentText: payload.contentText,
      documentId: payload.documentId || null,
      examples: payload.examples || [],
    });
    await handleRefreshLibrary();
  };

  const handleReopenLearningResult = async (item: LearningResultRecord) => {
    let resolvedText = item.sourceExcerpt || item.contentText;
    if (item.documentId) {
      try {
        const doc = await getDocumentById(item.documentId);
        resolvedText = doc.text || resolvedText;
        setSourceText(resolvedText);
        setSourceMeta({
          id: doc.id,
          name: doc.originalFilename || doc.filename,
          fileType: doc.fileType,
          pages: doc.pageCount || 1,
          pagesWithText: doc.pagesWithText || 1,
          ocrWarning: doc.ocrWarning || null,
        });
        setActiveDocumentId(doc.id);
      } catch {
        setSourceText(resolvedText);
        setSourceMeta({ name: item.title, fileType: 'Saved', pages: 1 });
        setActiveDocumentId(null);
      }
    } else {
      setSourceText(resolvedText);
      setSourceMeta({ name: item.title, fileType: 'Saved', pages: 1 });
      setActiveDocumentId(null);
    }

    const trimmedResolved = resolvedText.trim();

    if (item.resultType === 'simplified') {
      const level = (
        item.readingLevel === 'Intermediate' || item.readingLevel === 'Advanced'
          ? item.readingLevel
          : 'Beginner'
      ) as ReadingLevel;
      setReadingLevel(level);
      const key = buildCacheKey('simplify', [level, trimmedResolved]);
      setSimplifyCache((prev) => ({
        ...prev,
        [key]: {
          simplifiedText: item.contentText,
          difficultConcepts: (item.concepts || []).map((c) => ({
            term: c.term,
            explanation: c.explanation || c.definition || '',
          })),
          examples: item.examples || [],
          savedResultId: item.id,
        },
      }));
      setActiveSection('simplify');
    } else if (item.resultType === 'summary') {
      const length = (
        item.summaryLength === 'Short' || item.summaryLength === 'Detailed'
          ? item.summaryLength
          : 'Medium'
      ) as SummaryLength;
      setSummaryLength(length);
      const key = buildCacheKey('summarize', [length, trimmedResolved]);
      setSummaryCache((prev) => ({
        ...prev,
        [key]: {
          summaryText: item.contentText,
          keywords: item.keywords || [],
          bulletPoints: item.bulletPoints || [],
          keyConcepts: (item.concepts || []).map((c) => ({
            term: c.term,
            definition: c.definition || c.explanation || '',
          })),
          savedResultId: item.id,
        },
      }));
      setActiveSection('summarize');
    } else {
      setSourceText(item.contentText);
      setSourceMeta({ name: item.title, fileType: 'Explanation', pages: 1 });
      setActiveSection('input');
    }
  };

  const handleSendTextToSpeech = (text: string, label: string) => {
    setSourceText(text);
    setSourceMeta({ name: label || 'Saved Text', fileType: 'Saved', pages: 1 });
    setActiveSection('speech');
  };

  const handleDeleteLearningResult = async (resultId: string) => {
    await deleteLearningResultById(resultId);
    setLearningResults((prev) => prev.filter((r) => r.id !== resultId));
  };

  const handleRefreshVideoHistory = async () => {
    try {
      const res = await listVideoRecommendationsHistory();
      setVideoHistory(res?.recommendations || []);
    } catch {
      // Keep current list on transient error
    }
  };

  const handleDeleteVideoRecommendation = async (id: string) => {
    await deleteVideoRecommendationById(id);
    setVideoHistory((prev) => prev.filter((v) => v.id !== id));
    if (activeVideoResult?.id === id) {
      setActiveVideoResult(null);
    }
  };

  const handleAudioGenerated = (nextAudio: SpeechAudioState) => {
    revokeSpeechUrl();
    setSpeechAudio(nextAudio);
  };

  const handleRefreshVoiceTutorHistory = async () => {
    try {
      const res = await listVoiceTutorHistory();
      const sessions = res?.sessions || [];
      setVoiceTutorHistory(sessions);
      if (activeVoiceTutorSession) {
        const refreshed = sessions.find((s) => s.id === activeVoiceTutorSession.id);
        if (refreshed) {
          setActiveVoiceTutorSession(refreshed);
        }
      }
    } catch {
      // Keep current list on transient error
    }
  };

  const handleDeleteVoiceTutorSession = async (id: string) => {
    await deleteVoiceTutorSessionById(id);
    setVoiceTutorHistory((prev) => prev.filter((s) => s.id !== id));
    if (activeVoiceTutorSession?.id === id) {
      setActiveVoiceTutorSession(null);
    }
  };

  if (authBootstrapping) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-600">
        <div className="flex items-center gap-2.5 text-sm font-medium">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-600" aria-hidden="true" />
          <span>Restoring your Smart Learning workspace...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthPage
        onAuthenticated={(user) => void handleAuthenticated(user)}
        sessionNotice={sessionNotice}
      />
    );
  }

  const stats = computeTextStats(sourceText);
  const hc = readingPreferences.highContrast;

  const trimmedSource = sourceText.trim();
  const activeSimplifyKey = buildCacheKey('simplify', [readingLevel, trimmedSource]);
  const activeSummaryKey = buildCacheKey('summarize', [summaryLength, trimmedSource]);

  const currentSimplifiedResult = trimmedSource
    ? simplifyCache[activeSimplifyKey] ?? Object.values(simplifyCache)[0] ?? null
    : null;

  const currentSummaryResult = trimmedSource
    ? summaryCache[activeSummaryKey] ?? Object.values(summaryCache)[0] ?? null
    : null;

  return (
    <div
      className={`min-h-screen flex ${
        hc ? 'bg-black text-white' : 'bg-slate-50 text-slate-900'
      }`}
      data-high-contrast={hc ? 'true' : 'false'}
    >
      <SidebarNav
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        sourceMeta={sourceMeta}
        wordCount={stats.words}
        hasSimplified={Object.keys(simplifyCache).length > 0}
        hasSummary={Object.keys(summaryCache).length > 0}
        hasQa={(activeChat?.messages?.length || 0) > 0}
        hasVideos={Boolean(activeVideoResult?.videos?.length) || videoHistory.length > 0}
        hasAudio={Boolean(speechAudio) || Boolean(activeVoiceTutorSession) || voiceTutorHistory.length > 0}
        highContrast={hc}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        currentUser={currentUser}
        onLogout={() => void handleLogout()}
        conversations={conversations}
        activeChatId={activeChat?.id || null}
        chatSearchQuery={chatSearchQuery}
        onChatSearchChange={(q) => void handleChatSearchChange(q)}
        onNewChat={handleNewChat}
        onSelectChat={(id) => void handleSelectChat(id)}
        onRenameChat={(id, title) => handleRenameChat(id, title)}
        onDeleteChat={(id) => void handleDeleteChat(id)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={`sticky top-0 z-30 flex items-center justify-between gap-4 border-b px-4 py-3 backdrop-blur-xs sm:px-6 lg:px-8 ${
            hc
              ? 'border-white bg-black text-white'
              : 'border-slate-200 bg-white/95 text-slate-900'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className={
                hc
                  ? 'inline-flex h-10 w-10 items-center justify-center rounded-lg border-2 border-white bg-zinc-900 text-white hover:bg-zinc-800 lg:hidden'
                  : 'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 lg:hidden'
              }
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <p
              className={`text-sm font-semibold truncate ${
                hc ? 'text-yellow-300' : 'text-slate-700'
              }`}
            >
              {SECTION_TITLES[activeSection]}
            </p>
          </div>

          <div
            className={`flex items-center gap-2 text-xs whitespace-nowrap shrink-0 font-mono-tabular ${
              hc ? 'text-zinc-200' : 'text-slate-500'
            }`}
          >
            <span>{readingPreferences.fontSize} px</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{readingPreferences.lineSpacing}</span>
            {hc && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-yellow-300 font-semibold">High Contrast</span>
              </>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:px-8 space-y-6">
          <ReadingToolbar
            preferences={readingPreferences}
            onChange={setReadingPreferences}
          />

          {activeSection === 'input' && (
            <InputWorkspace
              sourceText={sourceText}
              sourceMeta={sourceMeta}
              activeDocumentId={activeDocumentId}
              documents={documents}
              preferences={readingPreferences}
              onUpdateText={handleUpdateText}
              onDocumentUploaded={() => void handleDocumentUploaded()}
              onReopenDocument={(id) => void handleReopenDocument(id)}
              onDownloadDocument={(id, name) => void handleDownloadDocument(id, name)}
              onDeleteDocument={(id) => void handleDeleteDocument(id)}
              onNavigate={setActiveSection}
              readingLevel={readingLevel}
              onChangeLevel={setReadingLevel}
              videoResult={activeVideoResult}
              onVideoResultLoaded={setActiveVideoResult}
              onRefreshVideoHistory={() => void handleRefreshVideoHistory()}
            />
          )}

          {activeSection === 'simplify' && (
            <SimplifyWorkspace
              sourceText={sourceText}
              activeDocumentId={activeDocumentId}
              preferences={readingPreferences}
              readingLevel={readingLevel}
              onChangeLevel={setReadingLevel}
              simplifyCache={simplifyCache}
              onSaveResult={(cacheKey, result) =>
                setSimplifyCache((prev) => ({ ...prev, [cacheKey]: result }))
              }
              onResultPersisted={() => void handleRefreshLibrary()}
              onNavigate={setActiveSection}
            />
          )}

          {activeSection === 'summarize' && (
            <SummaryWorkspace
              sourceText={sourceText}
              activeDocumentId={activeDocumentId}
              preferences={readingPreferences}
              summaryLength={summaryLength}
              onChangeLength={setSummaryLength}
              summaryCache={summaryCache}
              onSaveResult={(cacheKey, result) =>
                setSummaryCache((prev) => ({ ...prev, [cacheKey]: result }))
              }
              onResultPersisted={() => void handleRefreshLibrary()}
              onNavigate={setActiveSection}
              readingLevel={readingLevel}
              onChangeLevel={setReadingLevel}
              videoResult={activeVideoResult}
              onVideoResultLoaded={setActiveVideoResult}
              onRefreshVideoHistory={() => void handleRefreshVideoHistory()}
            />
          )}

          {activeSection === 'assistant' && (
            <AssistantWorkspace
              sourceText={sourceText}
              sourceMeta={sourceMeta}
              activeDocumentId={activeDocumentId}
              documents={documents}
              preferences={readingPreferences}
              activeChat={activeChat}
              isLoadingChat={isLoadingChat}
              onSelectDocumentForSession={(id) => handleSelectDocumentForChat(id)}
              onSendMessage={handleSendChatMessage}
              onNewChat={handleNewChat}
              onRenameChat={handleRenameChat}
              onSaveExplanationResult={handleSaveExplanationResult}
              onSendTextToSpeech={handleSendTextToSpeech}
              onNavigate={setActiveSection}
              readingLevel={readingLevel}
              onChangeLevel={setReadingLevel}
              videoResult={activeVideoResult}
              onVideoResultLoaded={setActiveVideoResult}
              onRefreshVideoHistory={() => void handleRefreshVideoHistory()}
            />
          )}

          {activeSection === 'videos' && (
            <VideoRecommendationsSection
              preferences={readingPreferences}
              sourceType={activeDocumentId ? 'document' : 'text'}
              sourceContent={sourceText}
              sourceLabel={sourceMeta?.name || 'Entered Text / Document'}
              keywords={currentSummaryResult?.keywords || []}
              learningLevel={readingLevel}
              onChangeLevel={setReadingLevel}
              documentId={activeDocumentId}
              conversationId={activeChat?.id || null}
              result={activeVideoResult}
              onResultLoaded={setActiveVideoResult}
              savedHistory={videoHistory}
              onSelectSavedHistory={(item) => setActiveVideoResult(item)}
              onDeleteSavedHistory={(id) => void handleDeleteVideoRecommendation(id)}
              summaryContext={
                currentSummaryResult
                  ? {
                      text: currentSummaryResult.summaryText,
                      keywords: currentSummaryResult.keywords,
                    }
                  : null
              }
              assistantContext={
                activeChat?.messages?.length
                  ? activeChat.messages
                      .slice(-4)
                      .map((m) => m.content)
                      .join('\n\n')
                  : ''
              }
              onRefreshHistory={() => void handleRefreshVideoHistory()}
              variant="workspace"
            />
          )}

          {activeSection === 'speech' && (
            <SpeechWorkspace
              sourceText={sourceText}
              activeDocumentId={activeDocumentId}
              documents={documents}
              conversations={conversations}
              activeChat={activeChat}
              simplifiedResult={currentSimplifiedResult}
              summaryResult={currentSummaryResult}
              preferences={readingPreferences}
              readingLevel={readingLevel}
              onChangeLevel={setReadingLevel}
              audioState={speechAudio}
              onAudioGenerated={handleAudioGenerated}
              voiceTutorHistory={voiceTutorHistory}
              activeVoiceTutorSession={activeVoiceTutorSession}
              onSelectVoiceTutorSession={setActiveVoiceTutorSession}
              onRefreshVoiceTutorHistory={() => void handleRefreshVoiceTutorHistory()}
              onDeleteVoiceTutorSession={(id) => void handleDeleteVoiceTutorSession(id)}
              onNavigate={setActiveSection}
            />
          )}

          {activeSection === 'history' && (
            <HistoryWorkspace
              preferences={readingPreferences}
              conversations={conversations}
              documents={documents}
              learningResults={learningResults}
              videoRecommendations={videoHistory}
              voiceTutorSessions={voiceTutorHistory}
              onOpenChat={(id) => void handleSelectChat(id)}
              onReopenDocument={(id) => void handleReopenDocument(id)}
              onDownloadDocument={(id, name) => void handleDownloadDocument(id, name)}
              onDeleteDocument={(id) => void handleDeleteDocument(id)}
              onReopenLearningResult={(item) => void handleReopenLearningResult(item)}
              onSendTextToSpeech={handleSendTextToSpeech}
              onDeleteLearningResult={(id) => void handleDeleteLearningResult(id)}
              onDeleteChat={(id) => void handleDeleteChat(id)}
              onOpenVideoRecommendation={(item) => {
                setActiveVideoResult(item);
                setActiveSection('videos');
              }}
              onDeleteVideoRecommendation={(id) =>
                void handleDeleteVideoRecommendation(id)
              }
              onOpenVoiceTutorSession={(sess) => {
                setActiveVoiceTutorSession(sess);
                setActiveSection('speech');
              }}
              onDeleteVoiceTutorSession={(id) =>
                void handleDeleteVoiceTutorSession(id)
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}
