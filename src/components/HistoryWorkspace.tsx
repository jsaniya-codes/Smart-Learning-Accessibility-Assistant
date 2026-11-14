import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  BookOpen,
  Download,
  FileText,
  FolderOpen,
  GraduationCap,
  ListChecks,
  MessageSquare,
  PlayCircle,
  Search,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { searchHistory } from '../services/api';
import type {
  ChatConversationSummary,
  HistoryBundle,
  LearningResultRecord,
  ReadingPreferences,
  SavedDocumentSummary,
  VideoRecommendationResult,
  VoiceTutorSession,
} from '../types/learning';

interface HistoryWorkspaceProps {
  preferences: ReadingPreferences;
  conversations: ChatConversationSummary[];
  documents: SavedDocumentSummary[];
  learningResults: LearningResultRecord[];
  videoRecommendations: VideoRecommendationResult[];
  voiceTutorSessions: VoiceTutorSession[];
  onOpenChat: (chatId: string) => void;
  onReopenDocument: (documentId: string) => void;
  onDownloadDocument: (documentId: string, filename: string) => void;
  onDeleteDocument: (documentId: string) => void;
  onReopenLearningResult: (item: LearningResultRecord) => void;
  onSendTextToSpeech: (text: string, label: string) => void;
  onDeleteLearningResult: (resultId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onOpenVideoRecommendation: (item: VideoRecommendationResult) => void;
  onDeleteVideoRecommendation: (id: string) => void;
  onOpenVoiceTutorSession: (session: VoiceTutorSession) => void;
  onDeleteVoiceTutorSession: (id: string) => void;
}

type LibraryTab =
  | 'all'
  | 'simplified'
  | 'summary'
  | 'explanation'
  | 'voice_tutor'
  | 'videos'
  | 'documents'
  | 'chats';

const FILTER_TABS: { id: LibraryTab; label: string }[] = [
  { id: 'all', label: 'All Items' },
  { id: 'simplified', label: 'Simplified' },
  { id: 'summary', label: 'Summaries' },
  { id: 'explanation', label: 'Explanations' },
  { id: 'voice_tutor', label: 'Voice Tutor' },
  { id: 'videos', label: 'Learning Videos' },
  { id: 'documents', label: 'Documents' },
  { id: 'chats', label: 'Chats' },
];

function formatDate(isoString: string): string {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function HistoryWorkspace({
  preferences,
  conversations,
  documents,
  learningResults,
  videoRecommendations,
  voiceTutorSessions,
  onOpenChat,
  onReopenDocument,
  onDownloadDocument,
  onDeleteDocument,
  onReopenLearningResult,
  onSendTextToSpeech,
  onDeleteLearningResult,
  onDeleteChat,
  onOpenVideoRecommendation,
  onDeleteVideoRecommendation,
  onOpenVoiceTutorSession,
  onDeleteVoiceTutorSession,
}: HistoryWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<LibraryTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HistoryBundle | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hc = preferences.highContrast;

  const displayedChats = searchResults
    ? Array.isArray(searchResults.conversations)
      ? searchResults.conversations
      : []
    : Array.isArray(conversations)
    ? conversations
    : [];
  const displayedDocs = searchResults
    ? Array.isArray(searchResults.documents)
      ? searchResults.documents
      : []
    : Array.isArray(documents)
    ? documents
    : [];
  const displayedResults = searchResults
    ? Array.isArray(searchResults.learningResults)
      ? searchResults.learningResults
      : []
    : Array.isArray(learningResults)
    ? learningResults
    : [];
  const displayedVideos = searchResults
    ? Array.isArray(searchResults.videoRecommendations)
      ? searchResults.videoRecommendations
      : []
    : Array.isArray(videoRecommendations)
    ? videoRecommendations
    : [];
  const displayedVoiceTutor = searchResults
    ? Array.isArray(searchResults.voiceTutorSessions)
      ? searchResults.voiceTutorSessions
      : []
    : Array.isArray(voiceTutorSessions)
    ? voiceTutorSessions
    : [];

  const filteredLearningResults = displayedResults.filter((item) => {
    if (activeTab === 'simplified') return item.resultType === 'simplified';
    if (activeTab === 'summary') return item.resultType === 'summary';
    if (activeTab === 'explanation') return item.resultType === 'explanation';
    return activeTab === 'all';
  });

  const showChats = activeTab === 'all' || activeTab === 'chats';
  const showDocs = activeTab === 'all' || activeTab === 'documents';
  const showVideos = activeTab === 'all' || activeTab === 'videos';
  const showVoiceTutor = activeTab === 'all' || activeTab === 'voice_tutor';
  const showLearningResults =
    activeTab === 'all' ||
    activeTab === 'simplified' ||
    activeTab === 'summary' ||
    activeTab === 'explanation';

  const handleSearchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }

    setIsSearching(true);
    try {
      const data = await searchHistory(trimmed);
      setSearchResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
    setError(null);
  };

  const totalVisible =
    (showLearningResults ? filteredLearningResults.length : 0) +
    (showVoiceTutor ? displayedVoiceTutor.length : 0) +
    (showVideos ? displayedVideos.length : 0) +
    (showDocs ? displayedDocs.length : 0) +
    (showChats ? displayedChats.length : 0);

  return (
    <div className="space-y-6">
      <div>
        <h1
          className={`text-2xl font-bold tracking-tight ${
            hc ? 'text-white' : 'text-slate-900'
          }`}
        >
          Saved Learning Library
        </h1>
        <p
          className={`mt-1 text-sm ${
            hc ? 'text-zinc-200' : 'text-slate-600'
          }`}
        >
          Reopen previously uploaded documents, simplified passages, summaries, and chat conversations saved to your account.
        </p>
      </div>

      <div
        className={`rounded-xl p-5 space-y-4 ${
          hc
            ? 'border-2 border-white bg-black text-white'
            : 'border border-slate-200 bg-white text-slate-900'
        }`}
      >
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-2.5 sm:flex-row">
          <div className="relative flex-1">
            <label htmlFor="library-search-input" className="sr-only">
              Search saved chats, documents, and results
            </label>
            <Search
              className={`pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 ${
                hc ? 'text-zinc-300' : 'text-slate-400'
              }`}
              aria-hidden="true"
            />
            <input
              id="library-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => {
                const next = e.target.value;
                setSearchQuery(next);
                if (!next.trim() && searchResults) {
                  setSearchResults(null);
                }
              }}
              placeholder="Search conversations, uploaded filenames, keywords, or saved summaries..."
              className={
                hc
                  ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 pl-10 pr-9 text-sm text-white placeholder:text-zinc-400 focus:border-yellow-300 focus:outline-none'
                  : 'h-10 w-full rounded-lg border border-slate-300 bg-slate-50/50 pl-10 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none'
              }
            />
            {searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear library search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isSearching}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold whitespace-nowrap shrink-0 ${
              hc
                ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isSearching ? 'Searching...' : 'Search Library'}</span>
          </button>
        </form>

        <div
          className={`inline-flex flex-wrap items-center gap-1 rounded-lg p-1 ${
            hc ? 'border border-white bg-zinc-900' : 'bg-slate-100'
          }`}
          role="tablist"
          aria-label="Filter saved items"
        >
          {FILTER_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                  hc
                    ? active
                      ? 'bg-yellow-300 text-black font-bold'
                      : 'text-white hover:bg-zinc-800'
                    : active
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {error && (
          <div
            role="alert"
            className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
              hc
                ? 'border-red-400 bg-zinc-950 text-red-300'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {totalVisible === 0 && (
        <div
          className={`rounded-xl border border-dashed p-8 text-center ${
            hc
              ? 'border-white bg-black text-white'
              : 'border-slate-300 bg-white text-slate-900'
          }`}
        >
          <p className="text-sm font-medium">
            {searchResults
              ? `No saved items matched "${searchResults.query}"`
              : 'Your saved learning library is empty'}
          </p>
          <p
            className={`mt-1 text-xs ${
              hc ? 'text-zinc-300' : 'text-slate-500'
            }`}
          >
            {searchResults
              ? 'Try another keyword or clear your search filter.'
              : 'Upload a document, simplify or summarize study text, or start an AI chat to build your personal study archive.'}
          </p>
        </div>
      )}

      {showLearningResults && filteredLearningResults.length > 0 && (
        <section aria-labelledby="saved-results-heading" className="space-y-3">
          <h2
            id="saved-results-heading"
            className={`text-base font-bold ${
              hc ? 'text-yellow-300' : 'text-slate-900'
            }`}
          >
            Saved AI Explanations, Simplifications &amp; Summaries ({filteredLearningResults.length})
          </h2>

          <div className="space-y-3">
            {filteredLearningResults.map((item) => {
              const typeLabel =
                item.resultType === 'simplified'
                  ? `Simplified · ${item.readingLevel || 'Beginner'}`
                  : item.resultType === 'summary'
                  ? `Summary · ${item.summaryLength || 'Medium'}`
                  : 'Saved Explanation';
              const Icon =
                item.resultType === 'simplified'
                  ? Sparkles
                  : item.resultType === 'summary'
                  ? ListChecks
                  : BookOpen;

              return (
                <article
                  key={item.id}
                  className={`rounded-xl p-5 space-y-3 ${
                    hc
                      ? 'border-2 border-white bg-black text-white'
                      : 'border border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon
                          className={`h-4 w-4 shrink-0 ${
                            hc ? 'text-yellow-300' : 'text-indigo-600'
                          }`}
                          aria-hidden="true"
                        />
                        <h3 className="text-sm font-bold truncate">{item.title}</h3>
                      </div>
                      <p
                        className={`mt-1 text-xs ${
                          hc ? 'text-zinc-300' : 'text-slate-500'
                        }`}
                      >
                        {typeLabel}
                        {item.createdAt ? ` · ${formatDate(item.createdAt)}` : ''}
                        {Array.isArray(item.keywords) && item.keywords.length > 0
                          ? ` · ${item.keywords.length} keywords`
                          : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onReopenLearningResult(item)}
                        className={
                          hc
                            ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border-2 border-yellow-300 bg-yellow-300 px-3 text-xs font-bold text-black whitespace-nowrap'
                            : 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 whitespace-nowrap'
                        }
                      >
                        <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Open in Workspace</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onSendTextToSpeech(item.contentText, item.title)}
                        className={
                          hc
                            ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-white px-3 text-xs font-semibold text-white hover:bg-zinc-900 whitespace-nowrap'
                            : 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap'
                        }
                      >
                        <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Listen</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteLearningResult(item.id)}
                        aria-label={`Delete saved result ${item.title}`}
                        className={
                          hc
                            ? 'inline-flex h-9 items-center justify-center rounded-lg border border-red-400 px-2.5 text-red-300 hover:bg-zinc-900'
                            : 'inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 px-2.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <p
                    className={`text-sm leading-relaxed line-clamp-3 ${
                      hc ? 'text-zinc-100' : 'text-slate-700'
                    }`}
                  >
                    {item.contentText}
                  </p>

                  {Array.isArray(item.keywords) && item.keywords.length > 0 && (
                    <p
                      className={`text-xs ${
                        hc ? 'text-yellow-300' : 'text-indigo-700'
                      }`}
                    >
                      Keywords: {item.keywords.join(', ')}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {showDocs && displayedDocs.length > 0 && (
        <section aria-labelledby="saved-docs-heading" className="space-y-3">
          <h2
            id="saved-docs-heading"
            className={`text-base font-bold ${
              hc ? 'text-yellow-300' : 'text-slate-900'
            }`}
          >
            Uploaded Documents ({displayedDocs.length})
          </h2>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {displayedDocs.map((doc) => {
              const displayName = doc.originalFilename || doc.filename;
              return (
                <article
                  key={doc.id}
                  className={`rounded-xl p-4 flex flex-col justify-between gap-3 ${
                    hc
                      ? 'border-2 border-white bg-black text-white'
                      : 'border border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <FileText
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        hc ? 'text-yellow-300' : 'text-blue-600'
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold truncate">{displayName}</h3>
                      <p
                        className={`mt-0.5 text-xs font-mono-tabular ${
                          hc ? 'text-zinc-300' : 'text-slate-500'
                        }`}
                      >
                        {doc.fileType} · {doc.wordCount} words · {doc.pageCount} page
                        {doc.pageCount === 1 ? '' : 's'}
                        {doc.createdAt ? ` · ${formatDate(doc.createdAt)}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onReopenDocument(doc.id)}
                      className={
                        hc
                          ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border-2 border-yellow-300 bg-yellow-300 px-3 text-xs font-bold text-black'
                          : 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100'
                      }
                    >
                      <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Reopen</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDownloadDocument(doc.id, displayName)}
                      className={
                        hc
                          ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-white px-3 text-xs font-semibold text-white hover:bg-zinc-900'
                          : 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50'
                      }
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteDocument(doc.id)}
                      aria-label={`Delete document ${displayName}`}
                      className={
                        hc
                          ? 'inline-flex h-9 items-center justify-center rounded-lg border border-red-400 px-2.5 text-red-300 hover:bg-zinc-900'
                          : 'inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 px-2.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {showChats && displayedChats.length > 0 && (
        <section aria-labelledby="saved-chats-heading" className="space-y-3">
          <h2
            id="saved-chats-heading"
            className={`text-base font-bold ${
              hc ? 'text-yellow-300' : 'text-slate-900'
            }`}
          >
            Previous Conversations ({displayedChats.length})
          </h2>

          <div className="space-y-2.5">
            {displayedChats.map((chat) => (
              <article
                key={chat.id}
                className={`rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                  hc
                    ? 'border-2 border-white bg-black text-white'
                    : 'border border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MessageSquare
                      className={`h-4 w-4 shrink-0 ${
                        hc ? 'text-yellow-300' : 'text-indigo-600'
                      }`}
                      aria-hidden="true"
                    />
                    <h3 className="text-sm font-bold truncate">{chat.title}</h3>
                  </div>
                  <p
                    className={`mt-1 text-xs ${
                      hc ? 'text-zinc-300' : 'text-slate-500'
                    }`}
                  >
                    {chat.messageCount} message{chat.messageCount === 1 ? '' : 's'}
                    {chat.documentName ? ` · Document: ${chat.documentName}` : ''}
                    {chat.updatedAt ? ` · Updated ${formatDate(chat.updatedAt)}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenChat(chat.id)}
                    className={
                      hc
                        ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border-2 border-yellow-300 bg-yellow-300 px-3 text-xs font-bold text-black'
                        : 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100'
                    }
                  >
                    <span>Open Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteChat(chat.id)}
                    aria-label={`Delete conversation ${chat.title}`}
                    className={
                      hc
                        ? 'inline-flex h-9 items-center justify-center rounded-lg border border-red-400 px-2.5 text-red-300 hover:bg-zinc-900'
                        : 'inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 px-2.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {showVideos && displayedVideos.length > 0 && (
        <section aria-labelledby="saved-videos-heading" className="space-y-3">
          <h2
            id="saved-videos-heading"
            className={`text-base font-bold ${
              hc ? 'text-yellow-300' : 'text-slate-900'
            }`}
          >
            Recommended Learning Video Sets ({displayedVideos.length})
          </h2>

          <div className="space-y-2.5">
            {displayedVideos.map((rec, idx) => {
              const videos = Array.isArray(rec?.videos) ? rec.videos : [];
              return (
                <article
                  key={rec.id || `${rec.topic || 'topic'}-${rec.createdAt || idx}`}
                  className={`rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                    hc
                      ? 'border-2 border-white bg-black text-white'
                      : 'border border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <PlayCircle
                        className={`h-4 w-4 shrink-0 ${
                          hc ? 'text-yellow-300' : 'text-indigo-600'
                        }`}
                        aria-hidden="true"
                      />
                      <h3 className="text-sm font-bold truncate">
                        {rec.topic || 'Study Topic'}
                      </h3>
                    </div>
                    <p
                      className={`mt-1 text-xs ${
                        hc ? 'text-zinc-300' : 'text-slate-500'
                      }`}
                    >
                      {videos.length} video{videos.length === 1 ? '' : 's'} ·{' '}
                      {rec.learningLevel || 'Beginner'} ·{' '}
                      {rec.preferredLanguage || 'English'}
                      {rec.createdAt ? ` · ${formatDate(rec.createdAt)}` : ''}
                    </p>
                  </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenVideoRecommendation(rec)}
                    className={
                      hc
                        ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border-2 border-yellow-300 bg-yellow-300 px-3 text-xs font-bold text-black'
                        : 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100'
                    }
                  >
                    <span>View Videos</span>
                  </button>
                  {rec.id && (
                    <button
                      type="button"
                      onClick={() => onDeleteVideoRecommendation(rec.id!)}
                      aria-label={`Delete saved video set ${rec.topic || 'topic'}`}
                      className={
                        hc
                          ? 'inline-flex h-9 items-center justify-center rounded-md border border-red-400 px-2.5 text-red-300 hover:bg-zinc-900'
                          : 'inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-2.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </article>
              );
            })}
          </div>
        </section>
      )}

      {showVoiceTutor && displayedVoiceTutor.length > 0 && (
        <section aria-labelledby="saved-voice-tutor-heading" className="space-y-3">
          <h2
            id="saved-voice-tutor-heading"
            className={`text-base font-bold ${
              hc ? 'text-yellow-300' : 'text-slate-900'
            }`}
          >
            AI Voice Tutor Lessons ({displayedVoiceTutor.length})
          </h2>

          <div className="space-y-2.5">
            {displayedVoiceTutor.map((sess) => (
              <article
                key={sess.id}
                className={`rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                  hc
                    ? 'border-2 border-white bg-black text-white'
                    : 'border border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <GraduationCap
                      className={`h-4 w-4 shrink-0 ${
                        hc ? 'text-yellow-300' : 'text-indigo-600'
                      }`}
                      aria-hidden="true"
                    />
                    <h3 className="text-sm font-bold truncate">{sess.lessonTitle}</h3>
                  </div>
                  <p
                    className={`mt-1 text-xs ${
                      hc ? 'text-zinc-300' : 'text-slate-500'
                    }`}
                  >
                    {sess.learningLevel} · {sess.preferredLanguage} ·{' '}
                    {sess.sections.length} section{sess.sections.length === 1 ? '' : 's'}
                    {sess.createdAt ? ` · ${formatDate(sess.createdAt)}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenVoiceTutorSession(sess)}
                    className={
                      hc
                        ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border-2 border-yellow-300 bg-yellow-300 px-3 text-xs font-bold text-black whitespace-nowrap'
                        : 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 whitespace-nowrap'
                    }
                  >
                    <span>Open in Voice Tutor</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteVoiceTutorSession(sess.id)}
                    aria-label={`Delete Voice Tutor lesson ${sess.lessonTitle}`}
                    className={
                      hc
                        ? 'inline-flex h-9 items-center justify-center rounded-md border border-red-400 px-2.5 text-red-300 hover:bg-zinc-900'
                        : 'inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-2.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

