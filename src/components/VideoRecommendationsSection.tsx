import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Clock,
  ExternalLink,
  Film,
  Globe,
  GraduationCap,
  Loader2,
  PlayCircle,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Tv,
} from 'lucide-react';
import { fetchYoutubeRecommendations } from '../services/api';
import type {
  ActiveSection,
  ReadingLevel,
  ReadingPreferences,
  RecommendedVideo,
  VideoRecommendationResult,
  VideoSourceType,
} from '../types/learning';
import { getLineHeightValue, getReadingFontClass } from '../utils/textMetrics';

export const VIDEO_LANGUAGES = [
  'English',
  'Spanish',
  'Hindi',
  'French',
  'German',
  'Arabic',
  'Portuguese',
  'Japanese',
] as const;

const LEARNING_LEVELS: ReadingLevel[] = ['Beginner', 'Intermediate', 'Advanced'];

interface VideoThumbnailProps {
  thumbnailUrl: string;
  title: string;
  duration: string;
  highContrast: boolean;
}

function VideoThumbnail({
  thumbnailUrl,
  title,
  duration,
  highContrast,
}: VideoThumbnailProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-lg border ${
        highContrast
          ? 'border-white bg-zinc-900'
          : 'border-slate-200 bg-slate-100'
      }`}
    >
      {!imgFailed && thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className={`flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center ${
            highContrast
              ? 'bg-zinc-900 text-yellow-300'
              : 'bg-gradient-to-br from-slate-100 to-indigo-50 text-indigo-700'
          }`}
        >
          <Film className="h-8 w-8" aria-hidden="true" />
          <span className="text-xs font-semibold line-clamp-2">{title}</span>
        </div>
      )}

      {duration && (
        <span
          className={`absolute bottom-2 right-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold font-mono-tabular ${
            highContrast
              ? 'border border-yellow-300 bg-black text-yellow-300'
              : 'bg-slate-950/85 text-white'
          }`}
        >
          <Clock className="h-3 w-3" aria-hidden="true" />
          <span>{duration}</span>
        </span>
      )}
    </div>
  );
}

export interface VideoCardProps {
  video: RecommendedVideo;
  preferences: ReadingPreferences;
}

export function RecommendedVideoCard({ video, preferences }: VideoCardProps) {
  const hc = preferences.highContrast;
  const fontClass = getReadingFontClass(preferences.fontFamily);
  const lineHeight = getLineHeightValue(preferences.lineSpacing);

  return (
    <article
      data-testid="recommended-video-card"
      className={`flex flex-col justify-between rounded-xl p-4 gap-3.5 transition-colors ${
        hc
          ? 'border-2 border-white bg-black text-white'
          : 'border border-slate-200 bg-white text-slate-900 hover:border-indigo-200'
      }`}
    >
      <div className="space-y-3">
        <VideoThumbnail
          thumbnailUrl={video.thumbnailUrl}
          title={video.title}
          duration={video.duration}
          highContrast={hc}
        />

        <div className="space-y-1.5">
          <h3
            className={`text-sm font-bold leading-snug line-clamp-2 ${fontClass} ${
              hc ? 'text-white' : 'text-slate-900'
            }`}
            style={{
              fontSize: `${Math.max(15, preferences.fontSize - 1)}px`,
            }}
          >
            {video.title}
          </h3>

          <div
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
              hc ? 'text-yellow-300' : 'text-slate-600'
            }`}
          >
            <span className="inline-flex items-center gap-1.5 font-medium truncate">
              <Tv className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{video.channelName}</span>
            </span>
            {video.duration && (
              <span
                className={`inline-flex items-center gap-1 font-mono-tabular ${
                  hc ? 'text-zinc-200' : 'text-slate-500'
                }`}
              >
                <span>· {video.duration}</span>
              </span>
            )}
          </div>
        </div>

        <p
          className={`rounded-lg border p-2.5 text-xs ${fontClass} ${
            hc
              ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
              : 'border-slate-200/80 bg-slate-50/80 text-slate-700'
          }`}
          style={{
            fontSize: `${Math.max(13, preferences.fontSize - 3)}px`,
            lineHeight: Math.min(1.65, lineHeight),
          }}
        >
          {video.recommendationReason}
        </p>
      </div>

      <a
        href={video.videoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold transition-opacity hover:opacity-95 whitespace-nowrap ${
          hc
            ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
            : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'
        }`}
      >
        <PlayCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Watch on YouTube</span>
        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </a>
    </article>
  );
}

interface VideoRecommendationsSectionProps {
  preferences: ReadingPreferences;
  sourceType: VideoSourceType;
  sourceContent: string;
  sourceLabel?: string;
  keywords?: string[];
  learningLevel: ReadingLevel;
  onChangeLevel?: (level: ReadingLevel) => void;
  documentId?: string | null;
  conversationId?: string | null;
  result: VideoRecommendationResult | null;
  onResultLoaded: (result: VideoRecommendationResult) => void;
  savedHistory?: VideoRecommendationResult[];
  onSelectSavedHistory?: (item: VideoRecommendationResult) => void;
  onDeleteSavedHistory?: (id: string) => void;
  onNavigate?: (section: ActiveSection) => void;
  variant?: 'embedded' | 'workspace';
  summaryContext?: { text: string; keywords: string[] } | null;
  assistantContext?: string;
  onRefreshHistory?: () => void;
}

export function VideoRecommendationsSection({
  preferences,
  sourceType,
  sourceContent,
  sourceLabel,
  keywords = [],
  learningLevel,
  onChangeLevel,
  documentId = null,
  conversationId = null,
  result,
  onResultLoaded,
  savedHistory = [],
  onSelectSavedHistory,
  onDeleteSavedHistory,
  onNavigate,
  variant = 'embedded',
  summaryContext = null,
  assistantContext = '',
  onRefreshHistory,
}: VideoRecommendationsSectionProps) {
  const safeSourceContent = typeof sourceContent === 'string' ? sourceContent : '';
  const safeKeywords = Array.isArray(keywords) ? keywords : [];
  const safeSavedHistory = Array.isArray(savedHistory) ? savedHistory : [];
  const safeAssistantContext = typeof assistantContext === 'string' ? assistantContext : '';
  const safeSummaryText =
    typeof summaryContext?.text === 'string' ? summaryContext.text : '';
  const safeSummaryKeywords = Array.isArray(summaryContext?.keywords)
    ? summaryContext.keywords
    : [];
  const safeResultVideos = Array.isArray(result?.videos) ? result.videos : [];
  const safeResultKeywords = Array.isArray(result?.keywords) ? result.keywords : [];

  const [customTopic, setCustomTopic] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<string>('English');
  const [selectedSourceMode, setSelectedSourceMode] = useState<VideoSourceType>(
    safeSourceContent.trim() ? sourceType : 'custom'
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearchedOnce, setHasSearchedOnce] = useState(false);

  const hc = preferences.highContrast;

  const resolveEffectivePayload = (overrideCustom?: string) => {
    const trimmedCustom = (overrideCustom ?? customTopic).trim();
    if (trimmedCustom) {
      return {
        effectiveType: 'custom' as VideoSourceType,
        content: safeSourceContent.trim().slice(0, 1500),
        customTopic: trimmedCustom,
        keywords: safeKeywords,
      };
    }

    if (variant === 'workspace') {
      if (selectedSourceMode === 'summary' && safeSummaryText.trim()) {
        return {
          effectiveType: 'summary' as VideoSourceType,
          content: safeSummaryText,
          customTopic: '',
          keywords: safeSummaryKeywords,
        };
      }
      if (selectedSourceMode === 'assistant' && safeAssistantContext.trim()) {
        return {
          effectiveType: 'assistant' as VideoSourceType,
          content: safeAssistantContext,
          customTopic: '',
          keywords: [],
        };
      }
    }

    return {
      effectiveType: sourceType,
      content: safeSourceContent.trim(),
      customTopic: '',
      keywords: safeKeywords,
    };
  };

  const handleFetch = async (opts: { forceRefresh?: boolean; topicOverride?: string } = {}) => {
    setError(null);
    const resolved = resolveEffectivePayload(opts.topicOverride);

    if (!resolved.customTopic && resolved.content.length < 3 && !documentId) {
      setError(
        'Enter a custom topic above, or first load study text / upload a document / generate a summary.'
      );
      return;
    }

    setIsLoading(true);
    setHasSearchedOnce(true);
    try {
      const data = await fetchYoutubeRecommendations({
        content: resolved.content,
        customTopic: resolved.customTopic,
        keywords: resolved.keywords,
        learningLevel,
        preferredLanguage,
        sourceType: resolved.effectiveType,
        documentId: documentId || null,
        conversationId: conversationId || null,
        forceRefresh: Boolean(opts.forceRefresh),
        saveToHistory: true,
      });
      onResultLoaded(data);
      onRefreshHistory?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load YouTube video recommendations. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCustomSubmit = (e: FormEvent) => {
    e.preventDefault();
    void handleFetch({ forceRefresh: false });
  };

  const hasContextMaterial = Boolean(
    safeSourceContent.trim().length >= 3 ||
      safeSummaryText.trim() ||
      safeAssistantContext.trim() ||
      documentId
  );

  return (
    <section
      aria-labelledby={
        variant === 'workspace'
          ? 'recommended-videos-main-heading'
          : `recommended-videos-heading-${sourceType}`
      }
      className={variant === 'workspace' ? 'space-y-6' : 'space-y-4'}
    >
      {/* Header */}
      {variant === 'workspace' ? (
        <div>
          <h1
            id="recommended-videos-main-heading"
            className={`text-2xl font-bold tracking-tight ${
              hc ? 'text-white' : 'text-slate-900'
            }`}
          >
            Recommended Learning Videos
          </h1>
          <p
            className={`mt-1 text-sm ${
              hc ? 'text-zinc-200' : 'text-slate-600'
            }`}
          >
            Discover curated educational YouTube tutorials, visual explanations, and step-by-step lessons tailored to your study material, level, and language.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id={`recommended-videos-heading-${sourceType}`}
              className={`text-base font-bold ${
                hc ? 'text-yellow-300' : 'text-slate-900'
              }`}
            >
              Recommended Learning Videos
            </h2>
            <p
              className={`text-xs ${
                hc ? 'text-zinc-300' : 'text-slate-500'
              }`}
            >
              {sourceLabel ||
                'Watch beginner-friendly visual explanations and educational demonstrations matched to this material.'}
            </p>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('videos')}
              className={
                hc
                  ? 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-yellow-300 px-3 text-xs font-semibold text-yellow-300 hover:bg-zinc-900 self-start sm:self-auto whitespace-nowrap'
                  : 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 self-start sm:self-auto whitespace-nowrap'
              }
            >
              <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Open Full Video Hub</span>
            </button>
          )}
        </div>
      )}

      {/* Control Panel */}
      <div
        className={`rounded-xl p-5 space-y-4 ${
          hc
            ? 'border-2 border-white bg-black text-white'
            : 'border border-slate-200 bg-white text-slate-900'
        }`}
      >
        {/* Workspace source selector when on dedicated videos hub */}
        {variant === 'workspace' && (
          <div className="space-y-2">
            <span
              className={`block text-xs font-semibold ${
                hc ? 'text-yellow-300' : 'text-slate-700'
              }`}
            >
              Discovery Source
            </span>
            <div className="flex flex-wrap gap-2">
              {[
                {
                  id: 'text' as VideoSourceType,
                  label: sourceLabel || 'Entered Text / Document',
                  available: Boolean(safeSourceContent.trim() || documentId),
                },
                {
                  id: 'summary' as VideoSourceType,
                  label: 'Generated Summary',
                  available: Boolean(safeSummaryText.trim()),
                },
                {
                  id: 'assistant' as VideoSourceType,
                  label: 'Assistant Chat Topic',
                  available: Boolean(safeAssistantContext.trim()),
                },
              ].map((src) => {
                const active = selectedSourceMode === src.id && !customTopic.trim();
                return (
                  <button
                    key={src.id}
                    type="button"
                    disabled={!src.available}
                    onClick={() => {
                      setCustomTopic('');
                      setSelectedSourceMode(src.id);
                    }}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      hc
                        ? active
                          ? 'border-yellow-300 bg-yellow-300 text-black font-bold'
                          : 'border-white bg-zinc-950 text-white hover:bg-zinc-900'
                        : active
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{src.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <form onSubmit={handleCustomSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            {/* Custom Topic Search */}
            <div className="md:col-span-6 space-y-1.5">
              <label
                htmlFor={`video-topic-input-${variant}-${sourceType}`}
                className={`block text-xs font-semibold ${
                  hc ? 'text-yellow-300' : 'text-slate-700'
                }`}
              >
                Custom Topic Search (optional)
              </label>
              <div className="relative">
                <Search
                  className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${
                    hc ? 'text-zinc-300' : 'text-slate-400'
                  }`}
                  aria-hidden="true"
                />
                <input
                  id={`video-topic-input-${variant}-${sourceType}`}
                  type="text"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  placeholder="e.g. Photosynthesis light reactions, Quantum entanglement..."
                  className={
                    hc
                      ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 pl-9 pr-3 text-xs text-white placeholder:text-zinc-400 focus:border-yellow-300 focus:outline-none'
                      : 'h-10 w-full rounded-lg border border-slate-300 bg-slate-50/60 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none'
                  }
                />
              </div>
            </div>

            {/* Learning Level Selector */}
            <div className="md:col-span-3 space-y-1.5">
              <label
                htmlFor={`video-level-select-${variant}-${sourceType}`}
                className={`flex items-center gap-1.5 text-xs font-semibold ${
                  hc ? 'text-yellow-300' : 'text-slate-700'
                }`}
              >
                <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Learning Level</span>
              </label>
              <select
                id={`video-level-select-${variant}-${sourceType}`}
                value={learningLevel}
                onChange={(e) => onChangeLevel?.(e.target.value as ReadingLevel)}
                className={
                  hc
                    ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 px-3 text-xs font-medium text-white focus:border-yellow-300 focus:outline-none'
                    : 'h-10 w-full rounded-lg border border-slate-300 bg-slate-50/60 px-3 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none'
                }
              >
                {LEARNING_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </div>

            {/* Preferred Language Selector */}
            <div className="md:col-span-3 space-y-1.5">
              <label
                htmlFor={`video-lang-select-${variant}-${sourceType}`}
                className={`flex items-center gap-1.5 text-xs font-semibold ${
                  hc ? 'text-yellow-300' : 'text-slate-700'
                }`}
              >
                <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Video Language</span>
              </label>
              <select
                id={`video-lang-select-${variant}-${sourceType}`}
                value={preferredLanguage}
                onChange={(e) => setPreferredLanguage(e.target.value)}
                className={
                  hc
                    ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 px-3 text-xs font-medium text-white focus:border-yellow-300 focus:outline-none'
                    : 'h-10 w-full rounded-lg border border-slate-300 bg-slate-50/60 px-3 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none'
                }
              >
                {VIDEO_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p
              className={`text-xs ${
                hc ? 'text-zinc-300' : 'text-slate-500'
              }`}
            >
              {customTopic.trim()
                ? `Searching YouTube for custom topic: "${customTopic.trim()}"`
                : hasContextMaterial
                ? `Using your current ${sourceType} material · Level: ${learningLevel}`
                : 'Enter a custom topic above or load study text first.'}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {result && (
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleFetch({ forceRefresh: true })}
                  className={
                    hc
                      ? 'inline-flex h-10 items-center gap-1.5 rounded-lg border-2 border-white bg-zinc-900 px-3.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 whitespace-nowrap'
                      : 'inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap'
                  }
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Request New Recommendations</span>
                </button>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className={`inline-flex h-10 items-center gap-2 rounded-lg px-5 text-xs font-semibold hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap ${
                  hc
                    ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
                    : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'
                }`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Finding Videos...</span>
                  </>
                ) : (
                  <>
                    <PlayCircle className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {customTopic.trim()
                        ? 'Search Topic Videos'
                        : 'Get Recommended Videos'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

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

      {/* Loading Skeleton */}
      {isLoading && (
        <div
          aria-busy="true"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className={`rounded-xl p-4 space-y-3 ${
                hc
                  ? 'border-2 border-white bg-black'
                  : 'border border-slate-200 bg-white'
              }`}
            >
              <div className="aspect-video w-full rounded-lg bg-slate-200 animate-pulse" />
              <div className="h-4 w-4/5 rounded bg-slate-200 animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse" />
              <div className="h-12 w-full rounded bg-slate-100 animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* Results Grid */}
      {!isLoading && result && (
        <div className="space-y-4">
          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 ${
              hc
                ? 'border border-white bg-zinc-950 text-white'
                : 'border border-indigo-100 bg-indigo-50/50 text-slate-800'
            }`}
          >
            <div className="space-y-0.5 min-w-0">
              <p className="text-xs font-bold">
                Topic: <span className={hc ? 'text-yellow-300' : 'text-indigo-700'}>{result.topic}</span>
              </p>
              <p
                className={`text-[11px] truncate ${
                  hc ? 'text-zinc-300' : 'text-slate-600'
                }`}
              >
                Query: {result.searchQuery} · Level: {result.learningLevel} · Language: {result.preferredLanguage}
              </p>
            </div>
            {safeResultKeywords.length > 0 && (
              <p
                className={`text-[11px] font-medium ${
                  hc ? 'text-yellow-300' : 'text-indigo-700'
                }`}
              >
                Keywords: {safeResultKeywords.slice(0, 5).join(', ')}
              </p>
            )}
          </div>

          {safeResultVideos.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {safeResultVideos.map((video, idx) => (
                <RecommendedVideoCard
                  key={video.videoId || video.videoUrl || `video-${idx}`}
                  video={video}
                  preferences={preferences}
                />
              ))}
            </div>
          ) : (
            <div
              className={`rounded-xl border border-dashed p-8 text-center ${
                hc
                  ? 'border-white bg-black text-white'
                  : 'border-slate-300 bg-white text-slate-900'
              }`}
            >
              <p className="text-sm font-semibold">No relevant educational videos found</p>
              <p
                className={`mt-1 text-xs ${
                  hc ? 'text-zinc-300' : 'text-slate-500'
                }`}
              >
                Try shortening your custom topic or switching the learning level to Beginner.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Helpful Empty State before first search */}
      {!isLoading && !result && !error && !hasSearchedOnce && (
        <div
          className={`rounded-xl border border-dashed p-6 text-center ${
            hc
              ? 'border-white bg-black text-white'
              : 'border-slate-300 bg-white text-slate-900'
          }`}
        >
          <p className="text-sm font-medium">
            {hasContextMaterial
              ? 'Ready to recommend educational YouTube videos'
              : 'Search any topic or load study material first'}
          </p>
          <p
            className={`mt-1 text-xs ${
              hc ? 'text-zinc-300' : 'text-slate-500'
            }`}
          >
            {hasContextMaterial
              ? 'Click "Get Recommended Videos" to extract key concepts and rank top educational tutorials.'
              : 'Type a custom topic above, or paste/upload your study notes in Input & Upload.'}
          </p>
        </div>
      )}

      {/* Saved Recommendation History inside Dedicated Hub */}
      {variant === 'workspace' && safeSavedHistory.length > 0 && (
        <section
          aria-labelledby="saved-video-history-heading"
          className="space-y-3 pt-2"
        >
          <h2
            id="saved-video-history-heading"
            className={`text-base font-bold ${
              hc ? 'text-yellow-300' : 'text-slate-900'
            }`}
          >
            Saved Video Recommendation Sets ({safeSavedHistory.length})
          </h2>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {safeSavedHistory.map((item, idx) => {
              const itemVideos = Array.isArray(item?.videos) ? item.videos : [];
              return (
                <div
                  key={item.id || `${item.topic || 'topic'}-${item.createdAt || idx}`}
                  className={`rounded-xl p-4 flex items-center justify-between gap-3 ${
                    hc
                      ? 'border-2 border-white bg-black text-white'
                      : 'border border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{item.topic || 'Study Topic'}</p>
                    <p
                      className={`mt-0.5 text-xs font-mono-tabular ${
                        hc ? 'text-zinc-300' : 'text-slate-500'
                      }`}
                    >
                      {itemVideos.length} video{itemVideos.length === 1 ? '' : 's'} ·{' '}
                      {item.learningLevel || 'Beginner'} · {item.preferredLanguage || 'English'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {onSelectSavedHistory && (
                      <button
                        type="button"
                        onClick={() => onSelectSavedHistory(item)}
                        className={
                          hc
                            ? 'inline-flex h-8 items-center rounded-md border border-yellow-300 bg-yellow-300 px-3 text-xs font-bold text-black'
                            : 'inline-flex h-8 items-center rounded-md bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100'
                        }
                      >
                        View
                      </button>
                    )}
                    {item.id && onDeleteSavedHistory && (
                      <button
                        type="button"
                        onClick={() => onDeleteSavedHistory(item.id!)}
                        aria-label={`Delete saved video set ${item.topic || 'topic'}`}
                        className={
                          hc
                            ? 'inline-flex h-8 items-center justify-center rounded-md border border-red-400 px-2 text-red-300 hover:bg-zinc-900'
                            : 'inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
