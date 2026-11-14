import { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ListChecks,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { AccessibleReaderBox } from '../components/AccessibleReaderBox';
import { VideoRecommendationsSection } from '../components/VideoRecommendationsSection';
import { summarizeText } from '../services/api';
import { getLineHeightValue, getReadingFontClass } from '../utils/accessibility';

const SUMMARY_LENGTHS = [
  {
    id: 'Short',
    label: 'Short',
    hint: 'Quick 2–4 sentence thesis & core takeaways',
  },
  {
    id: 'Medium',
    label: 'Medium',
    hint: 'Balanced overview with key supporting ideas',
  },
  {
    id: 'Detailed',
    label: 'Detailed',
    hint: 'Thorough multi-paragraph study guide & definitions',
  },
];

export function SummarizePage({
  sourceText,
  activeDocumentId = null,
  preferences,
  summaryLength,
  onChangeLength,
  summaryResults,
  onSaveResult,
  onResultPersisted,
  onNavigate,
  readingLevel = 'Beginner',
  onChangeLevel,
  videoResult = null,
  onVideoResultLoaded,
  onRefreshVideoHistory,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const hc = preferences.highContrast;
  const result = sourceText.trim() ? summaryResults[summaryLength] ?? null : null;

  const handleSummarize = async () => {
    setError(null);
    setSavedNotice(false);
    if (!sourceText.trim()) {
      setError('Please enter educational text or upload a PDF/TXT document first.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await summarizeText(sourceText, summaryLength, activeDocumentId, true);
      onSaveResult(summaryLength, {
        summaryText: data.summaryText ?? '',
        keywords: Array.isArray(data.keywords) ? data.keywords : [],
        bulletPoints: Array.isArray(data.bulletPoints) ? data.bulletPoints : [],
        keyConcepts: Array.isArray(data.keyConcepts) ? data.keyConcepts : [],
      });
      if (data.savedResultId) {
        setSavedNotice(true);
        if (onResultPersisted) {
          onResultPersisted();
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not summarize text. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const lineHeight = getLineHeightValue(preferences.lineSpacing);
  const fontClass = getReadingFontClass(preferences.fontFamily);
  const activeHint =
    SUMMARY_LENGTHS.find((item) => item.id === summaryLength)?.hint ?? '';

  return (
    <div className="space-y-6">
      <div>
        <h1
          className={`text-2xl font-bold tracking-tight ${
            hc ? 'text-white' : 'text-slate-900'
          }`}
        >
          Smart Text Summarization
        </h1>
        <p
          className={`mt-1 text-sm ${
            hc ? 'text-zinc-200' : 'text-slate-600'
          }`}
        >
          Distill lengthy educational material into Short, Medium, or Detailed overviews with bullet points, keywords, and definitions.
        </p>
      </div>

      <div
        className={`rounded-xl p-5 ${
          hc
            ? 'border-2 border-white bg-black text-white'
            : 'border border-slate-200 bg-white text-slate-900'
        }`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <span
              className={`block text-xs font-semibold ${
                hc ? 'text-yellow-300' : 'text-slate-700'
              }`}
            >
              Summary Length
            </span>
            <div
              className={`inline-flex flex-wrap items-center gap-1 rounded-lg p-1 ${
                hc ? 'border border-white bg-zinc-900' : 'bg-slate-100'
              }`}
              role="group"
              aria-label="Summary length"
            >
              {SUMMARY_LENGTHS.map((option) => {
                const active = summaryLength === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onChangeLength(option.id)}
                    aria-pressed={active}
                    className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      hc
                        ? active
                          ? 'bg-yellow-300 text-black font-bold'
                          : 'text-white hover:bg-zinc-800'
                        : active
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p
              className={`text-xs ${
                hc ? 'text-zinc-300' : 'text-slate-500'
              }`}
            >
              {activeHint}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {!sourceText.trim() && (
              <button
                type="button"
                onClick={() => onNavigate('input')}
                className={
                  hc
                    ? 'inline-flex h-10 items-center gap-1.5 rounded-lg border-2 border-white bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-800 whitespace-nowrap shrink-0'
                    : 'inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0'
                }
              >
                <span>Go to Input &amp; Upload</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              onClick={handleSummarize}
              disabled={isLoading}
              className={`inline-flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0 ${
                hc
                  ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Summarizing...</span>
                </>
              ) : result ? (
                <>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  <span>Regenerate ({summaryLength})</span>
                </>
              ) : (
                <>
                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                  <span>Summarize Content</span>
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className={`mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
              hc
                ? 'border-red-400 bg-zinc-950 text-red-300'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {savedNotice && !error && (
          <div
            role="status"
            className={`mt-4 flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium ${
              hc
                ? 'border-emerald-400 bg-zinc-950 text-emerald-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Saved summary, keywords, and definitions to your account library.</span>
          </div>
        )}
      </div>

      {isLoading && (
        <div
          className={`rounded-xl p-6 space-y-3 ${
            hc
              ? 'border-2 border-white bg-black'
              : 'border border-slate-200 bg-white'
          }`}
          aria-busy="true"
        >
          <div className="h-4 w-1/3 rounded bg-slate-200 animate-pulse" />
          <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
          <div className="h-4 w-4/5 rounded bg-slate-100 animate-pulse" />
        </div>
      )}

      {!isLoading && result && (
        <div className="space-y-6">
          <AccessibleReaderBox
            text={result.summaryText}
            preferences={preferences}
            label={`Summary Overview · ${summaryLength}`}
            testId="summary-output-box"
          />

          {result.keywords.length > 0 && (
            <section
              aria-labelledby="summary-keywords-heading"
              className={`rounded-xl p-5 ${
                hc
                  ? 'border-2 border-white bg-black text-white'
                  : 'border border-slate-200 bg-white text-slate-900'
              }`}
            >
              <h2
                id="summary-keywords-heading"
                className={`mb-3 text-base font-bold ${
                  hc ? 'text-yellow-300' : 'text-slate-900'
                }`}
              >
                Essential Keywords
              </h2>
              <div className="flex flex-wrap gap-2">
                {result.keywords.map((keyword, idx) => (
                  <span
                    key={`${keyword}-${idx}`}
                    className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                      hc
                        ? 'border-yellow-300 bg-zinc-950 text-yellow-300'
                        : 'border-indigo-200 bg-indigo-50/70 text-indigo-800'
                    }`}
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </section>
          )}

          {result.bulletPoints.length > 0 && (
            <section
              aria-labelledby="summary-bullets-heading"
              className={`rounded-xl p-6 ${
                hc
                  ? 'border-2 border-white bg-black text-white'
                  : 'border border-slate-200 bg-white text-slate-900'
              }`}
            >
              <h2
                id="summary-bullets-heading"
                className={`mb-3 text-base font-bold ${
                  hc ? 'text-yellow-300' : 'text-slate-900'
                }`}
              >
                Important Points
              </h2>
              <ul
                className={`space-y-2.5 list-disc pl-5 ${fontClass} ${
                  hc ? 'text-white' : 'text-slate-800'
                }`}
              >
                {result.bulletPoints.map((point, idx) => (
                  <li
                    key={idx}
                    style={{
                      fontSize: `${preferences.fontSize}px`,
                      lineHeight,
                    }}
                  >
                    {point}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.keyConcepts.length > 0 && (
            <section aria-labelledby="key-concepts-heading">
              <h2
                id="key-concepts-heading"
                className={`mb-3 text-base font-bold ${
                  hc ? 'text-yellow-300' : 'text-slate-900'
                }`}
              >
                Highlighted Concepts &amp; Definitions
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {result.keyConcepts.map((concept, idx) => (
                  <div
                    key={`${concept.term}-${idx}`}
                    className={`rounded-xl p-4 ${
                      hc
                        ? 'border-2 border-white bg-black text-white'
                        : 'border border-blue-200/80 bg-white text-slate-900'
                    }`}
                  >
                    <p
                      className={`text-sm font-bold ${
                        hc ? 'text-yellow-300' : 'text-blue-700'
                      }`}
                    >
                      {concept.term}
                    </p>
                    <p
                      className={`mt-1.5 ${fontClass} ${
                        hc ? 'text-white' : 'text-slate-700'
                      }`}
                      style={{
                        fontSize: `${Math.max(14, preferences.fontSize - 1)}px`,
                        lineHeight: 1.6,
                      }}
                    >
                      {concept.definition}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <VideoRecommendationsSection
            preferences={preferences}
            sourceType="summary"
            sourceContent={result.summaryText || sourceText}
            sourceLabel="Discover YouTube tutorials based on your generated summary and extracted keywords."
            keywords={result.keywords}
            learningLevel={readingLevel}
            onChangeLevel={onChangeLevel}
            documentId={activeDocumentId}
            result={videoResult}
            onResultLoaded={onVideoResultLoaded}
            onRefreshHistory={onRefreshVideoHistory}
            onNavigate={onNavigate}
          />
        </div>
      )}

      {!isLoading && !result && (
        <div
          className={`rounded-xl border border-dashed p-8 text-center ${
            hc
              ? 'border-white bg-black text-white'
              : 'border-slate-300 bg-white text-slate-900'
          }`}
        >
          <p className="text-sm font-medium">
            Ready to generate a {summaryLength} summary
          </p>
          <p
            className={`mt-1 text-xs ${
              hc ? 'text-zinc-300' : 'text-slate-500'
            }`}
          >
            {sourceText.trim()
              ? 'Click "Summarize Content" above to generate key takeaways, essential keywords, and definitions.'
              : 'First paste text or upload a PDF/TXT document in Input & Upload.'}
          </p>
        </div>
      )}
    </div>
  );
}
