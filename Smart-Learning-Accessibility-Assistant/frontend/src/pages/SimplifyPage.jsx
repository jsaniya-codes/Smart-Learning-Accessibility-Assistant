import { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { AccessibleReaderBox } from '../components/AccessibleReaderBox';
import { simplifyText } from '../services/api';

const READING_LEVELS = [
  {
    id: 'Beginner',
    label: 'Beginner',
    hint: 'Short sentences, everyday words & relatable analogies',
  },
  {
    id: 'Intermediate',
    label: 'Intermediate',
    hint: 'Clear plain English with standard academic terms explained',
  },
  {
    id: 'Advanced',
    label: 'Advanced',
    hint: 'Full technical precision with cleaner sentence structure',
  },
];

export function SimplifyPage({
  sourceText,
  activeDocumentId = null,
  preferences,
  readingLevel,
  onChangeLevel,
  simplifyResults,
  onSaveResult,
  onResultPersisted,
  onNavigate,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const hc = preferences.highContrast;
  const result = sourceText.trim() ? simplifyResults[readingLevel] ?? null : null;

  const handleSimplify = async () => {
    setError(null);
    setSavedNotice(false);
    if (!sourceText.trim()) {
      setError('Please enter educational text or upload a PDF/TXT document first.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await simplifyText(sourceText, readingLevel, activeDocumentId, true);
      onSaveResult(readingLevel, {
        simplifiedText: data.simplifiedText,
        difficultConcepts: data.difficultConcepts || [],
        examples: data.examples || [],
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
          : 'Could not simplify text. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const activeHint =
    READING_LEVELS.find((item) => item.id === readingLevel)?.hint ?? '';

  return (
    <div className="space-y-6">
      <div>
        <h1
          className={`text-2xl font-bold tracking-tight ${
            hc ? 'text-white' : 'text-slate-900'
          }`}
        >
          AI Text Simplification
        </h1>
        <p
          className={`mt-1 text-sm ${
            hc ? 'text-zinc-200' : 'text-slate-600'
          }`}
        >
          Convert complex academic passages into clear explanations tailored to your chosen level, powered by the Python FastAPI + Gemini backend.
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
              Explanation Level
            </span>
            <div
              className={`inline-flex flex-wrap items-center gap-1 rounded-lg p-1 ${
                hc ? 'border border-white bg-zinc-900' : 'bg-slate-100'
              }`}
              role="group"
              aria-label="Explanation level"
            >
              {READING_LEVELS.map((level) => {
                const active = readingLevel === level.id;
                return (
                  <button
                    key={level.id}
                    type="button"
                    onClick={() => onChangeLevel(level.id)}
                    aria-pressed={active}
                    className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      hc
                        ? active
                          ? 'bg-yellow-300 text-black font-bold'
                          : 'text-white hover:bg-zinc-800'
                        : active
                        ? 'bg-white text-indigo-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {level.label}
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
              onClick={handleSimplify}
              disabled={isLoading}
              className={`inline-flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0 ${
                hc
                  ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
                  : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Simplifying...</span>
                </>
              ) : result ? (
                <>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  <span>Regenerate ({readingLevel})</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  <span>Simplify Text</span>
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
            <span>Saved simplified explanation to your account library.</span>
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
          <div className="h-4 w-5/6 rounded bg-slate-100 animate-pulse" />
          <div className="h-4 w-2/3 rounded bg-slate-100 animate-pulse" />
        </div>
      )}

      {!isLoading && result && (
        <div className="space-y-6">
          <AccessibleReaderBox
            text={result.simplifiedText}
            preferences={preferences}
            label={`Simplified Explanation · ${readingLevel} Level`}
            testId="simplified-output-box"
          />

          {result.difficultConcepts.length > 0 && (
            <section aria-labelledby="difficult-concepts-heading">
              <h2
                id="difficult-concepts-heading"
                className={`mb-3 text-base font-bold ${
                  hc ? 'text-yellow-300' : 'text-slate-900'
                }`}
              >
                Technical Terms Explained
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {result.difficultConcepts.map((item, idx) => (
                  <div
                    key={`${item.term}-${idx}`}
                    className={`rounded-xl p-4 ${
                      hc
                        ? 'border-2 border-white bg-black text-white'
                        : 'border border-indigo-200/80 bg-white text-slate-900'
                    }`}
                  >
                    <p
                      className={`text-sm font-bold ${
                        hc ? 'text-yellow-300' : 'text-indigo-700'
                      }`}
                    >
                      {item.term}
                    </p>
                    <p
                      className={`mt-1.5 ${
                        hc ? 'text-white' : 'text-slate-700'
                      }`}
                      style={{
                        fontSize: `${Math.max(14, preferences.fontSize - 1)}px`,
                        lineHeight: 1.6,
                      }}
                    >
                      {item.explanation}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {result.examples.length > 0 && (
            <section
              aria-labelledby="examples-heading"
              className={`rounded-xl p-5 ${
                hc
                  ? 'border-2 border-white bg-black text-white'
                  : 'border border-slate-200 bg-white text-slate-900'
              }`}
            >
              <h2
                id="examples-heading"
                className={`mb-3 text-base font-bold ${
                  hc ? 'text-yellow-300' : 'text-slate-900'
                }`}
              >
                Real-World Examples
              </h2>
              <ol
                className={`space-y-2.5 list-decimal pl-5 ${
                  hc ? 'text-white' : 'text-slate-800'
                }`}
              >
                {result.examples.map((example, idx) => (
                  <li
                    key={idx}
                    style={{
                      fontSize: `${Math.max(14, preferences.fontSize - 1)}px`,
                      lineHeight: 1.6,
                    }}
                  >
                    {example}
                  </li>
                ))}
              </ol>
            </section>
          )}
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
            Ready to simplify at the {readingLevel} level
          </p>
          <p
            className={`mt-1 text-xs ${
              hc ? 'text-zinc-300' : 'text-slate-500'
            }`}
          >
            {sourceText.trim()
              ? 'Click "Simplify Text" above to generate a clear explanation with definitions and real-world examples.'
              : 'First paste text or upload a PDF/TXT document in Input & Upload.'}
          </p>
        </div>
      )}
    </div>
  );
}
