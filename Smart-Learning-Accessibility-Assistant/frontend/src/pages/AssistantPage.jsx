import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  Plus,
  Quote,
  Send,
  Volume2,
  X,
} from 'lucide-react';
import { AccessibleReaderBox } from '../components/AccessibleReaderBox';
import { VideoRecommendationsSection } from '../components/VideoRecommendationsSection';
import { getLineHeightValue, getReadingFontClass } from '../utils/accessibility';

const SUGGESTED_QUESTIONS = [
  'What is the main idea of this material?',
  'Can you explain the key process step by step?',
  'What are the most important terms defined here?',
];

function formatTime(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function AssistantPage({
  sourceText,
  sourceMeta,
  activeDocumentId,
  documents,
  preferences,
  activeChat,
  isLoadingChat,
  onSelectDocumentForSession,
  onSendMessage,
  onNewChat,
  onRenameChat,
  onSaveExplanationResult,
  onSendTextToSpeech,
  onNavigate,
  readingLevel = 'Beginner',
  onChangeLevel,
  videoResult = null,
  onVideoResultLoaded,
  onRefreshVideoHistory,
}) {
  const [question, setQuestion] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const [savedMsgIds, setSavedMsgIds] = useState({});
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const threadEndRef = useRef(null);

  const hc = preferences.highContrast;
  const lineHeight = getLineHeightValue(preferences.lineSpacing);
  const fontClass = getReadingFontClass(preferences.fontFamily);
  const messages = activeChat?.messages ?? [];

  useEffect(() => {
    setError(null);
    setIsRenamingTitle(false);
  }, [activeChat?.id]);

  useEffect(() => {
    if (messages.length > 0 && threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, isSending]);

  const effectiveDocId = activeChat?.documentId || activeDocumentId || '';
  const hasStudyMaterial =
    sourceText.trim().length >= 15 || Boolean(activeChat?.document?.text);

  const submitQuestion = async (rawQuestion) => {
    setError(null);
    if (!hasStudyMaterial) {
      setError('Please enter educational text or select/upload a document first.');
      return;
    }

    const trimmed = rawQuestion.trim();
    if (trimmed.length < 3) {
      setError('Please enter a clear question (at least 3 characters).');
      return;
    }

    setIsSending(true);
    try {
      await onSendMessage({
        content: trimmed,
        sourceText: sourceText.trim() || activeChat?.document?.text || '',
        documentId: effectiveDocId || null,
      });
      setQuestion('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not send your message. Please try again.'
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    void submitQuestion(question);
  };

  const handleSaveExplanation = async (msg, idx) => {
    const previousUserMsg = [...messages.slice(0, idx)]
      .reverse()
      .find((m) => m.role === 'user');
    try {
      await onSaveExplanationResult({
        title: previousUserMsg?.content || activeChat?.title || 'AI Explanation',
        sourceExcerpt:
          (sourceText || activeChat?.document?.text || previousUserMsg?.content || 'Study passage').slice(0, 400),
        contentText: msg.content,
        documentId: effectiveDocId || null,
        examples: msg.examples || [],
      });
      setSavedMsgIds((prev) => ({ ...prev, [msg.id]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save explanation.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Chat Header & Document Linker */}
      <div
        className={`rounded-xl p-4 sm:p-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${
          hc
            ? 'border-2 border-white bg-black text-white'
            : 'border border-slate-200 bg-white text-slate-900'
        }`}
      >
        <div className="min-w-0 flex-1">
          {isRenamingTitle && activeChat ? (
            <div className="flex items-center gap-2 max-w-md">
              <label htmlFor="chat-header-rename" className="sr-only">
                Rename conversation title
              </label>
              <input
                id="chat-header-rename"
                type="text"
                value={titleDraft}
                autoFocus
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (titleDraft.trim()) {
                      void onRenameChat(activeChat.id, titleDraft.trim());
                    }
                    setIsRenamingTitle(false);
                  } else if (e.key === 'Escape') {
                    setIsRenamingTitle(false);
                  }
                }}
                className={
                  hc
                    ? 'h-9 flex-1 rounded-lg border-2 border-yellow-300 bg-zinc-950 px-3 text-sm font-semibold text-white focus:outline-none'
                    : 'h-9 flex-1 rounded-lg border border-indigo-400 bg-white px-3 text-sm font-semibold text-slate-900 focus:outline-none'
                }
              />
              <button
                type="button"
                onClick={async () => {
                  if (titleDraft.trim()) {
                    await onRenameChat(activeChat.id, titleDraft.trim());
                  }
                  setIsRenamingTitle(false);
                }}
                aria-label="Save conversation title"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setIsRenamingTitle(false)}
                aria-label="Cancel renaming"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h1
                className={`text-xl font-bold tracking-tight truncate ${
                  hc ? 'text-white' : 'text-slate-900'
                }`}
              >
                {activeChat ? activeChat.title : 'AI Learning Assistant'}
              </h1>
              {activeChat && (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(activeChat.title);
                    setIsRenamingTitle(true);
                  }}
                  aria-label="Rename active conversation"
                  className={
                    hc
                      ? 'rounded p-1.5 text-yellow-300 hover:bg-zinc-900'
                      : 'rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                  }
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <p
            className={`mt-0.5 text-xs ${
              hc ? 'text-zinc-300' : 'text-slate-500'
            }`}
          >
            {activeChat
              ? `${messages.length} saved message${messages.length === 1 ? '' : 's'} · Grounded in your study material`
              : 'Ask questions about your active passage or any saved document. Every turn is automatically saved.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {documents.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="chat-document-select" className="sr-only">
                Active study document
              </label>
              <FileText
                className={`h-4 w-4 shrink-0 ${
                  hc ? 'text-yellow-300' : 'text-indigo-600'
                }`}
                aria-hidden="true"
              />
              <select
                id="chat-document-select"
                value={effectiveDocId}
                onChange={(e) => {
                  const chosenId = e.target.value;
                  if (chosenId) {
                    void onSelectDocumentForSession(chosenId);
                  }
                }}
                className={
                  hc
                    ? 'h-9 max-w-52 rounded-lg border border-white bg-zinc-950 px-2.5 text-xs text-white focus:border-yellow-300 focus:outline-none'
                    : 'h-9 max-w-52 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none'
                }
              >
                <option value="">
                  {sourceMeta?.name ? `Current: ${sourceMeta.name}` : 'Select saved document...'}
                </option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.originalFilename || doc.filename}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={onNewChat}
            className={
              hc
                ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-white px-3 text-xs font-semibold text-white hover:bg-zinc-900 whitespace-nowrap'
                : 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap'
            }
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>New Chat</span>
          </button>
        </div>
      </div>

      {/* Persistent Chat Thread */}
      {isLoadingChat ? (
        <div
          className={`rounded-xl p-8 flex items-center justify-center gap-2.5 text-sm ${
            hc
              ? 'border-2 border-white bg-black text-white'
              : 'border border-slate-200 bg-white text-slate-600'
          }`}
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Loading conversation history...</span>
        </div>
      ) : messages.length > 0 ? (
        <div className="space-y-4" data-testid="chat-message-list">
          {messages.map((msg, idx) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div
                    className={`max-w-2xl rounded-2xl px-4 py-3 ${
                      hc
                        ? 'border-2 border-yellow-300 bg-zinc-900 text-white'
                        : 'bg-indigo-600 text-white'
                    }`}
                  >
                    <p
                      className={`whitespace-pre-wrap ${fontClass}`}
                      style={{
                        fontSize: `${preferences.fontSize}px`,
                        lineHeight,
                      }}
                    >
                      {msg.content}
                    </p>
                    <p
                      className={`mt-1 text-[11px] text-right ${
                        hc ? 'text-yellow-300' : 'text-indigo-100'
                      }`}
                    >
                      You · {formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              );
            }

            const isSaved = Boolean(savedMsgIds[msg.id]);

            return (
              <article
                key={msg.id}
                className={`rounded-2xl p-5 space-y-3.5 ${
                  hc
                    ? 'border-2 border-white bg-black text-white'
                    : 'border border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MessageCircleQuestion
                      className={`h-4 w-4 ${
                        hc ? 'text-yellow-300' : 'text-indigo-600'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="text-xs font-bold">Smart Learning Assistant</span>
                    <span
                      className={`text-xs ${
                        hc ? 'text-zinc-300' : 'text-slate-400'
                      }`}
                    >
                      · {formatTime(msg.createdAt)}
                    </span>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                      msg.foundInMaterial
                        ? hc
                          ? 'text-emerald-300'
                          : 'text-emerald-700'
                        : hc
                        ? 'text-yellow-300'
                        : 'text-amber-700'
                    }`}
                  >
                    {msg.foundInMaterial ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Grounded in Material</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Not Found in Material</span>
                      </>
                    )}
                  </span>
                </div>

                <AccessibleReaderBox
                  text={msg.content}
                  preferences={preferences}
                  testId={`assistant-reply-${idx}`}
                />

                {Array.isArray(msg.examples) && msg.examples.length > 0 && (
                  <div
                    className={`rounded-lg border p-3.5 ${
                      hc
                        ? 'border-white bg-zinc-950 text-white'
                        : 'border-slate-200 bg-slate-50/70 text-slate-800'
                    }`}
                  >
                    <p
                      className={`mb-1.5 text-xs font-bold ${
                        hc ? 'text-yellow-300' : 'text-indigo-700'
                      }`}
                    >
                      Helpful Examples
                    </p>
                    <ul className={`space-y-1 list-disc pl-5 ${fontClass}`}>
                      {msg.examples.map((ex, exIdx) => (
                        <li
                          key={exIdx}
                          style={{
                            fontSize: `${Math.max(14, preferences.fontSize - 1)}px`,
                            lineHeight,
                          }}
                        >
                          {ex}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {msg.supportingQuote && (
                  <blockquote
                    className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${
                      hc
                        ? 'border-yellow-300 bg-zinc-950 text-zinc-200'
                        : 'border-indigo-200 bg-indigo-50/40 text-slate-700'
                    }`}
                  >
                    <Quote
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        hc ? 'text-yellow-300' : 'text-indigo-600'
                      }`}
                      aria-hidden="true"
                    />
                    <div>
                      <p
                        className={`text-xs font-semibold mb-0.5 ${
                          hc ? 'text-yellow-300' : 'text-indigo-700'
                        }`}
                      >
                        Supporting Quote from Study Material
                      </p>
                      <p className={`italic ${fontClass}`}>
                        &ldquo;{msg.supportingQuote}&rdquo;
                      </p>
                    </div>
                  </blockquote>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      onSendTextToSpeech(msg.content, activeChat?.title || 'AI Explanation')
                    }
                    className={
                      hc
                        ? 'inline-flex h-8 items-center gap-1.5 rounded-md border border-white px-2.5 text-xs font-semibold text-white hover:bg-zinc-900'
                        : 'inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50'
                    }
                  >
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Listen (MP3)</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSaved}
                    onClick={() => void handleSaveExplanation(msg, idx)}
                    className={
                      hc
                        ? 'inline-flex h-8 items-center gap-1.5 rounded-md border border-yellow-300 px-2.5 text-xs font-semibold text-yellow-300 hover:bg-zinc-900 disabled:opacity-70'
                        : 'inline-flex h-8 items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50/60 px-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-70'
                    }
                  >
                    {isSaved ? (
                      <>
                        <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Saved to Library</span>
                      </>
                    ) : (
                      <>
                        <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Save Explanation</span>
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
          <div ref={threadEndRef} />
        </div>
      ) : (
        <div
          className={`rounded-xl border border-dashed p-8 text-center ${
            hc
              ? 'border-white bg-black text-white'
              : 'border-slate-300 bg-white text-slate-900'
          }`}
        >
          <p className="text-sm font-semibold">
            {hasStudyMaterial
              ? 'Start a persistent study conversation'
              : 'Load or select study material to begin chatting'}
          </p>
          <p
            className={`mt-1 text-xs ${
              hc ? 'text-zinc-300' : 'text-slate-500'
            }`}
          >
            {hasStudyMaterial
              ? 'Ask a question below. Your conversation title is generated automatically and every reply is saved to your account.'
              : 'Upload a PDF/TXT document, paste text in Input & Upload, or pick a saved document above.'}
          </p>

          {hasStudyMaterial && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTED_QUESTIONS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isSending}
                  onClick={() => {
                    setQuestion(prompt);
                    void submitQuestion(prompt);
                  }}
                  className={
                    hc
                      ? 'rounded-lg border border-white bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:border-yellow-300 disabled:opacity-50'
                      : 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/60 disabled:opacity-50'
                  }
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isSending && (
        <div
          className={`rounded-xl p-4 flex items-center gap-2.5 text-sm ${
            hc
              ? 'border-2 border-yellow-300 bg-black text-yellow-300'
              : 'border border-indigo-200 bg-indigo-50/50 text-indigo-700'
          }`}
          aria-busy="true"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Thinking and saving response to your conversation...</span>
        </div>
      )}

      {/* Message Composer */}
      <form
        onSubmit={handleSubmit}
        className={`rounded-xl p-4 space-y-3 ${
          hc
            ? 'border-2 border-white bg-black text-white'
            : 'border border-slate-200 bg-white text-slate-900'
        }`}
      >
        <label
          htmlFor="assistant-question-input"
          className={`block text-xs font-semibold ${
            hc ? 'text-yellow-300' : 'text-slate-700'
          }`}
        >
          Ask a Question About Your Study Material
        </label>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <input
            id="assistant-question-input"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Type your question and press Enter..."
            disabled={isSending}
            className={
              hc
                ? 'h-11 flex-1 rounded-lg border-2 border-white bg-zinc-950 px-3.5 text-sm text-white placeholder:text-zinc-400 focus:border-yellow-300 focus:outline-none disabled:opacity-60'
                : 'h-11 flex-1 rounded-lg border border-slate-300 bg-slate-50/50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-60'
            }
          />

          <div className="flex flex-wrap items-center gap-2">
            {!hasStudyMaterial && (
              <button
                type="button"
                onClick={() => onNavigate('input')}
                className={
                  hc
                    ? 'inline-flex h-11 items-center gap-1.5 rounded-lg border-2 border-white bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-800 whitespace-nowrap shrink-0'
                    : 'inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0'
                }
              >
                <span>Go to Input &amp; Upload</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <button
              type="submit"
              disabled={isSending}
              className={`inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0 ${
                hc
                  ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
                  : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'
              }`}
            >
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  <span>Send</span>
                </>
              )}
            </button>
          </div>
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
      </form>

      {(hasStudyMaterial || messages.length > 0) && (
        <VideoRecommendationsSection
          preferences={preferences}
          sourceType="assistant"
          sourceContent={
            messages.length > 0
              ? messages
                  .slice(-4)
                  .map((m) => m.content)
                  .join('\n\n')
              : sourceText || activeChat?.document?.text || ''
          }
          sourceLabel="Find YouTube lessons matching your assistant conversation and questions."
          learningLevel={readingLevel}
          onChangeLevel={onChangeLevel}
          documentId={effectiveDocId || null}
          conversationId={activeChat?.id || null}
          result={videoResult || activeChat?.recommendations?.[0] || null}
          onResultLoaded={onVideoResultLoaded}
          onRefreshHistory={onRefreshVideoHistory}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
