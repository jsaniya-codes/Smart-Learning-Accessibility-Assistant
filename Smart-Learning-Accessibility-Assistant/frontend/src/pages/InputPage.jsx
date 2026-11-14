import { useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  FileUp,
  FolderOpen,
  ListChecks,
  MessageCircleQuestion,
  PlayCircle,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { AccessibleReaderBox } from '../components/AccessibleReaderBox';
import { VideoRecommendationsSection } from '../components/VideoRecommendationsSection';
import { SAMPLE_PASSAGES } from '../data/samplePassages';
import { uploadDocumentFile } from '../services/api';
import { formatQuickStats } from '../utils/accessibility';

export function InputPage({
  sourceText,
  sourceMeta,
  activeDocumentId,
  documents = [],
  preferences,
  onUpdateText,
  onDocumentUploaded,
  onReopenDocument,
  onDownloadDocument,
  onDeleteDocument,
  onNavigate,
  readingLevel = 'Beginner',
  onChangeLevel,
  videoResult = null,
  onVideoResultLoaded,
  onRefreshVideoHistory,
}) {
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);

  const hc = preferences.highContrast;
  const stats = formatQuickStats(sourceText);

  const handleFileChange = async (file) => {
    if (!file) return;
    setUploadError(null);
    setUploadSuccess(null);

    setIsUploading(true);
    try {
      const data = await uploadDocumentFile(file);
      onUpdateText(data.text, {
        id: data.id || null,
        name: data.filename,
        fileType: data.fileType,
        pages: data.pageCount || 1,
        pagesWithText: data.pagesWithText || data.pageCount || 1,
        ocrWarning: data.ocrWarning || null,
      });
      if (onDocumentUploaded) {
        onDocumentUploaded(data);
      }
      setUploadSuccess(
        `Extracted ${data.wordCount} words from "${data.filename}" (${data.pageCount} page${
          data.pageCount === 1 ? '' : 's'
        }) and saved to your account.`
      );
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : 'Could not extract text from this file.'
      );
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            className={`text-2xl font-bold tracking-tight ${
              hc ? 'text-white' : 'text-slate-900'
            }`}
          >
            Upload Document or Enter Study Text
          </h1>
          <p
            className={`mt-1 text-sm ${
              hc ? 'text-zinc-200' : 'text-slate-600'
            }`}
          >
            Upload a PDF or TXT study document for backend extraction, paste your textbook passage, or load a sample topic to begin.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {sourceText.trim().length > 0 && (
            <button
              type="button"
              onClick={() => {
                onUpdateText('', null);
                setUploadError(null);
                setUploadSuccess(null);
              }}
              className={
                hc
                  ? 'inline-flex h-10 items-center gap-1.5 rounded-lg border-2 border-white bg-black px-3.5 text-xs font-semibold text-white hover:bg-zinc-900 whitespace-nowrap shrink-0'
                  : 'inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0'
              }
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span>Clear Text</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div
          className={`lg:col-span-2 rounded-xl p-5 flex flex-col justify-between ${
            hc
              ? 'border-2 border-white bg-black text-white'
              : 'border border-slate-200 bg-white text-slate-900'
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2
                className={`text-sm font-semibold ${
                  hc ? 'text-yellow-300' : 'text-slate-900'
                }`}
              >
                Upload PDF or TXT File
              </h2>
              <p
                className={`text-xs ${
                  hc ? 'text-zinc-300' : 'text-slate-500'
                }`}
              >
                Validated and extracted on the Python FastAPI backend; detects scanned pages requiring OCR.
              </p>
            </div>

            <div>
              <input
                ref={fileInputRef}
                id="document-file-upload"
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                onChange={(e) => handleFileChange(e.target.files?.[0])}
                className="sr-only"
              />
              <label
                htmlFor="document-file-upload"
                className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-opacity hover:opacity-95 whitespace-nowrap shrink-0 ${
                  hc
                    ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
                    : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'
                } ${isUploading ? 'pointer-events-none opacity-60' : ''}`}
              >
                <FileUp className="h-4 w-4" aria-hidden="true" />
                <span>{isUploading ? 'Extracting on Server...' : 'Choose PDF or TXT'}</span>
              </label>
            </div>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              handleFileChange(e.dataTransfer.files?.[0]);
            }}
            className={`mt-4 rounded-lg border border-dashed px-4 py-5 text-center transition-colors ${
              hc
                ? isDragging
                  ? 'border-yellow-300 bg-zinc-900'
                  : 'border-white bg-zinc-950'
                : isDragging
                ? 'border-indigo-500 bg-indigo-50/70'
                : 'border-slate-300 bg-slate-50/70'
            }`}
          >
            <p
              className={`text-xs font-medium ${
                hc ? 'text-white' : 'text-slate-700'
              }`}
            >
              Drag and drop a{' '}
              <span className={`font-semibold ${hc ? 'text-yellow-300' : 'text-indigo-700'}`}>
                .pdf
              </span>{' '}
              or{' '}
              <span className={`font-semibold ${hc ? 'text-blue-300' : 'text-blue-700'}`}>
                .txt
              </span>{' '}
              file here, or click Choose PDF or TXT
            </p>
            <p
              className={`mt-1 text-[11px] ${
                hc ? 'text-zinc-300' : 'text-slate-500'
              }`}
            >
              Multi-page text-based PDFs and plain text files up to 12 MB
            </p>
          </div>

          {uploadError && (
            <div
              role="alert"
              className={`mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
                hc
                  ? 'border-red-400 bg-zinc-950 text-red-300'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{uploadError}</span>
            </div>
          )}

          {uploadSuccess && (
            <div
              role="status"
              className={`mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
                hc
                  ? 'border-emerald-400 bg-zinc-950 text-emerald-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{uploadSuccess}</span>
            </div>
          )}

          {sourceMeta?.ocrWarning && (
            <div
              role="status"
              className={`mt-3 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
                hc
                  ? 'border-yellow-300 bg-zinc-950 text-yellow-200'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{sourceMeta.ocrWarning}</span>
            </div>
          )}
        </div>

        <div
          className={`rounded-xl p-5 ${
            hc
              ? 'border-2 border-white bg-black text-white'
              : 'border border-slate-200 bg-white text-slate-900'
          }`}
        >
          <h2
            className={`text-sm font-semibold ${
              hc ? 'text-yellow-300' : 'text-slate-900'
            }`}
          >
            Sample Passages
          </h2>
          <p
            className={`mt-0.5 text-xs ${
              hc ? 'text-zinc-300' : 'text-slate-500'
            }`}
          >
            Try a sample textbook paragraph right away.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {SAMPLE_PASSAGES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => {
                  setUploadError(null);
                  onUpdateText(sample.text, {
                    name: sample.title,
                    fileType: 'Sample',
                    pages: 1,
                    pagesWithText: 1,
                    ocrWarning: null,
                  });
                  setUploadSuccess(`Loaded sample passage: ${sample.title}.`);
                }}
                className={
                  hc
                    ? 'flex items-center justify-between rounded-lg border border-white bg-zinc-900 px-3 py-2 text-left text-xs font-medium text-white hover:border-yellow-300'
                    : 'flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-800 hover:border-indigo-300 hover:bg-indigo-50/60'
                }
              >
                <span className="truncate">{sample.title}</span>
                <span
                  className={`ml-2 shrink-0 ${
                    hc ? 'text-yellow-300' : 'text-slate-500'
                  }`}
                >
                  {sample.subject}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`rounded-xl p-5 ${
          hc
            ? 'border-2 border-white bg-black text-white'
            : 'border border-slate-200 bg-white text-slate-900'
        }`}
      >
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="educational-text-input"
            className={`text-sm font-semibold ${
              hc ? 'text-yellow-300' : 'text-slate-900'
            }`}
          >
            Educational Text Editor
          </label>
          <p
            className={`text-xs font-mono-tabular ${
              hc ? 'text-zinc-200' : 'text-slate-500'
            }`}
          >
            {stats.wordCount} words · {stats.charCount} characters ·{' '}
            {stats.estimatedMinutes > 0
              ? `~${stats.estimatedMinutes} min read`
              : '0 min read'}
          </p>
        </div>

        <textarea
          id="educational-text-input"
          value={sourceText}
          onChange={(e) => {
            setUploadSuccess(null);
            onUpdateText(
              e.target.value,
              sourceMeta?.fileType === 'PDF' || sourceMeta?.fileType === 'TXT'
                ? sourceMeta
                : { name: 'Typed Educational Text', fileType: 'Text', pages: 1 }
            );
          }}
          rows={7}
          placeholder="Paste a difficult textbook paragraph, lecture excerpt, or research abstract here..."
          className={
            hc
              ? 'w-full rounded-lg border-2 border-white bg-zinc-950 p-3.5 text-sm leading-relaxed text-white placeholder:text-zinc-400 focus:border-yellow-300 focus:outline-none'
              : 'w-full rounded-lg border border-slate-300 bg-slate-50/50 p-3.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none'
          }
        />

        {sourceText.trim() && (
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('simplify')}
              className={
                hc
                  ? 'inline-flex h-10 items-center gap-2 rounded-lg border-2 border-yellow-300 bg-yellow-300 px-4 text-xs font-bold text-black whitespace-nowrap shrink-0'
                  : 'inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 whitespace-nowrap shrink-0'
              }
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span>Simplify This Text</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('summarize')}
              className={
                hc
                  ? 'inline-flex h-10 items-center gap-2 rounded-lg border-2 border-blue-300 bg-blue-300 px-4 text-xs font-bold text-black whitespace-nowrap shrink-0'
                  : 'inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0'
              }
            >
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              <span>Summarize Content</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('assistant')}
              className={
                hc
                  ? 'inline-flex h-10 items-center gap-2 rounded-lg border-2 border-white bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-800 whitespace-nowrap shrink-0'
                  : 'inline-flex h-10 items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 whitespace-nowrap shrink-0'
              }
            >
              <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
              <span>Ask AI Assistant</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('speech')}
              className={
                hc
                  ? 'inline-flex h-10 items-center gap-2 rounded-lg border-2 border-white bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-800 whitespace-nowrap shrink-0'
                  : 'inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0'
              }
            >
              <Volume2
                className={`h-4 w-4 ${hc ? 'text-yellow-300' : 'text-indigo-600'}`}
                aria-hidden="true"
              />
              <span>Listen as Audio</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('videos')}
              className={
                hc
                  ? 'inline-flex h-10 items-center gap-2 rounded-lg border-2 border-yellow-300 bg-zinc-900 px-4 text-xs font-semibold text-yellow-300 hover:bg-zinc-800 whitespace-nowrap shrink-0'
                  : 'inline-flex h-10 items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/70 px-4 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 whitespace-nowrap shrink-0'
              }
            >
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              <span>Recommended Videos</span>
            </button>
          </div>
        )}
      </div>

      {documents.length > 0 && (
        <section
          aria-labelledby="your-saved-documents-heading"
          className={`rounded-xl p-5 space-y-3 ${
            hc
              ? 'border-2 border-white bg-black text-white'
              : 'border border-slate-200 bg-white text-slate-900'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2
                id="your-saved-documents-heading"
                className={`text-sm font-bold ${
                  hc ? 'text-yellow-300' : 'text-slate-900'
                }`}
              >
                Your Saved Documents ({documents.length})
              </h2>
              <p
                className={`text-xs ${
                  hc ? 'text-zinc-300' : 'text-slate-500'
                }`}
              >
                Previously uploaded PDF and TXT files stored in your account. Reopen or download anytime.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {documents.map((doc) => {
              const isActive = activeDocumentId === doc.id;
              const displayName = doc.originalFilename || doc.filename;
              return (
                <div
                  key={doc.id}
                  className={`rounded-lg p-3.5 flex flex-col justify-between gap-2.5 ${
                    hc
                      ? isActive
                        ? 'border-2 border-yellow-300 bg-zinc-900'
                        : 'border border-white bg-zinc-950'
                      : isActive
                      ? 'border border-indigo-300 bg-indigo-50/50'
                      : 'border border-slate-200 bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <FileText
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        hc ? 'text-yellow-300' : 'text-indigo-600'
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{displayName}</p>
                      <p
                        className={`mt-0.5 text-[11px] font-mono-tabular ${
                          hc ? 'text-zinc-300' : 'text-slate-500'
                        }`}
                      >
                        {doc.fileType} · {doc.wordCount} words · {doc.pageCount} page
                        {doc.pageCount === 1 ? '' : 's'}
                        {isActive ? ' · Active' : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onReopenDocument(doc.id)}
                      className={
                        hc
                          ? 'inline-flex h-8 items-center gap-1 rounded-md border border-yellow-300 bg-yellow-300 px-2.5 text-xs font-bold text-black'
                          : 'inline-flex h-8 items-center gap-1 rounded-md bg-white border border-indigo-200 px-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50'
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
                          ? 'inline-flex h-8 items-center gap-1 rounded-md border border-white px-2.5 text-xs font-semibold text-white hover:bg-zinc-800'
                          : 'inline-flex h-8 items-center gap-1 rounded-md bg-white border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100'
                      }
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteDocument(doc.id)}
                      aria-label={`Delete saved document ${displayName}`}
                      className={
                        hc
                          ? 'inline-flex h-8 items-center justify-center rounded-md border border-red-400 px-2 text-red-300 hover:bg-zinc-900'
                          : 'inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {sourceText.trim() ? (
        <div className="space-y-6">
          <AccessibleReaderBox
            text={sourceText}
            preferences={preferences}
            label="Accessible Reading Preview (updates live with your text size, font & contrast controls)"
            testId="accessible-preview-box"
          />

          <VideoRecommendationsSection
            preferences={preferences}
            sourceType={activeDocumentId ? 'document' : 'text'}
            sourceContent={sourceText}
            sourceLabel={
              sourceMeta?.name
                ? `Matched to ${sourceMeta.name}`
                : 'Matched to your entered educational text'
            }
            learningLevel={readingLevel}
            onChangeLevel={onChangeLevel}
            documentId={activeDocumentId}
            result={videoResult}
            onResultLoaded={onVideoResultLoaded}
            onRefreshHistory={onRefreshVideoHistory}
            onNavigate={onNavigate}
          />
        </div>
      ) : (
        <div
          className={`rounded-xl border border-dashed p-8 text-center ${
            hc
              ? 'border-white bg-black text-white'
              : 'border-slate-300 bg-white text-slate-900'
          }`}
        >
          <p className="text-sm font-medium">No study passage loaded yet</p>
          <p
            className={`mt-1 text-xs ${
              hc ? 'text-zinc-300' : 'text-slate-500'
            }`}
          >
            Upload a PDF/TXT file, paste educational text above, or pick a sample passage to preview it with adjustable typography.
          </p>
        </div>
      )}
    </div>
  );
}
