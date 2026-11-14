import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  GraduationCap,
  History,
  Lightbulb,
  ListChecks,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { AccessibleReaderBox } from '../components/AccessibleReaderBox';
import {
  explainWithVoiceTutor,
  generateSpeechAudio,
  getVoiceTutorLanguages,
  synthesizeVoiceTutorSectionAudio,
} from '../services/api';
import { getLineHeightValue, getReadingFontClass } from '../utils/accessibility';

const LEARNING_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5];

const VOICE_OPTIONS = [
  { id: 'Kore', label: 'Kore (Clear & Warm)' },
  { id: 'Puck', label: 'Puck (Bright & Friendly)' },
  { id: 'Charon', label: 'Charon (Calm & Steady)' },
  { id: 'Fenrir', label: 'Fenrir (Deep & Measured)' },
  { id: 'Zephyr', label: 'Zephyr (Light & Crisp)' },
];

const PACE_OPTIONS = [
  { id: 'normal', label: 'Normal Reading Speed', slow: false },
  { id: 'slow', label: 'Slow & Clear Accessibility Speed', slow: true },
];

const FALLBACK_LANGUAGES = [
  { label: 'English', code: 'en', nativeLabel: 'English' },
  { label: 'Spanish', code: 'es', nativeLabel: 'Español' },
  { label: 'French', code: 'fr', nativeLabel: 'Français' },
  { label: 'German', code: 'de', nativeLabel: 'Deutsch' },
  { label: 'Hindi', code: 'hi', nativeLabel: 'हिन्दी' },
  { label: 'Portuguese', code: 'pt', nativeLabel: 'Português' },
  { label: 'Italian', code: 'it', nativeLabel: 'Italiano' },
  { label: 'Japanese', code: 'ja', nativeLabel: '日本語' },
  { label: 'Korean', code: 'ko', nativeLabel: '한국어' },
  { label: 'Arabic', code: 'ar', nativeLabel: 'العربية' },
];

const TUTOR_SOURCE_TABS = [
  { id: 'topic', label: 'Enter Topic' },
  { id: 'text', label: 'Study Text' },
  { id: 'document', label: 'Uploaded PDF/TXT' },
  { id: 'summary', label: 'Summary' },
  { id: 'conversation', label: 'Conversation' },
];

function formatDurationSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function SpeechPage({
  sourceText,
  activeDocumentId = null,
  documents = [],
  conversations = [],
  activeChat = null,
  simplifiedResult,
  summaryResult,
  preferences,
  readingLevel = 'Beginner',
  onChangeLevel,
  audioState,
  onAudioGenerated,
  voiceTutorHistory = [],
  activeVoiceTutorSession = null,
  onSelectVoiceTutorSession,
  onRefreshVoiceTutorHistory,
  onDeleteVoiceTutorSession,
  onNavigate,
}) {
  const hc = preferences.highContrast;
  const readerFontClass = getReadingFontClass(preferences.fontFamily);
  const readerLineHeight = getLineHeightValue(preferences.lineSpacing);

  const [studioMode, setStudioMode] = useState('tutor');

  // AI Voice Tutor state
  const [languages, setLanguages] = useState(FALLBACK_LANGUAGES);
  const [tutorSourceType, setTutorSourceType] = useState(
    activeDocumentId ? 'document' : sourceText.trim() ? 'text' : 'topic'
  );
  const [topicInput, setTopicInput] = useState('');
  const [customPassage, setCustomPassage] = useState(sourceText);
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    activeDocumentId || documents[0]?.id || ''
  );
  const [selectedConversationId, setSelectedConversationId] = useState(
    activeChat?.id || conversations[0]?.id || ''
  );
  const [preferredLanguage, setPreferredLanguage] = useState('English');
  const [tutorVoice, setTutorVoice] = useState('Kore');
  const [isGeneratingTutor, setIsGeneratingTutor] = useState(false);
  const [tutorError, setTutorError] = useState(null);
  const [tutorAudioWarning, setTutorAudioWarning] = useState(null);

  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [sectionAudioUrls, setSectionAudioUrls] = useState({});
  const [loadingSectionIdx, setLoadingSectionIdx] = useState(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [autoContinue, setAutoContinue] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackNotice, setPlaybackNotice] = useState(null);

  const tutorAudioRef = useRef(null);
  const pendingAutoPlayRef = useRef(false);

  // Basic Read Text Aloud state (preserved)
  const [selectedSource, setSelectedSource] = useState('original');
  const [readLanguageCode, setReadLanguageCode] = useState('en');
  const [slowPace, setSlowPace] = useState(false);
  const [isLoadingBasic, setIsLoadingBasic] = useState(false);
  const [basicError, setBasicError] = useState(null);

  useEffect(() => {
    let active = true;
    getVoiceTutorLanguages()
      .then((res) => {
        if (active && Array.isArray(res?.languages) && res.languages.length > 0) {
          setLanguages(res.languages);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (sourceText && !customPassage.trim()) {
      setCustomPassage(sourceText);
    }
  }, [sourceText]);

  useEffect(() => {
    if (activeDocumentId) {
      setSelectedDocumentId(activeDocumentId);
    } else if (!selectedDocumentId && documents[0]?.id) {
      setSelectedDocumentId(documents[0].id);
    }
  }, [activeDocumentId, documents, selectedDocumentId]);

  useEffect(() => {
    if (activeChat?.id) {
      setSelectedConversationId(activeChat.id);
    } else if (!selectedConversationId && conversations[0]?.id) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [activeChat, conversations, selectedConversationId]);

  useEffect(() => {
    if (!activeVoiceTutorSession) {
      setSectionAudioUrls({});
      setActiveSectionIdx(0);
      setIsPlaying(false);
      setIsPaused(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    const hydrated = {};
    for (const ref of activeVoiceTutorSession.audioRefs || []) {
      if (ref.audioUrl) {
        hydrated[ref.sectionIndex] = ref.audioUrl;
      }
    }
    setSectionAudioUrls(hydrated);
    setActiveSectionIdx(0);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsPaused(false);
    setPlaybackNotice(null);
  }, [activeVoiceTutorSession?.id]);

  useEffect(() => {
    if (tutorAudioRef.current) {
      tutorAudioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, activeSectionIdx, sectionAudioUrls]);

  const currentTutorAudioUrl = sectionAudioUrls[activeSectionIdx] || '';
  const activeSections = activeVoiceTutorSession?.sections || [];
  const currentSection = activeSections[activeSectionIdx] || null;

  const loadSectionAudio = async (sectionIdx, autoPlay = false) => {
    if (!activeVoiceTutorSession) return null;
    const section = activeVoiceTutorSession.sections[sectionIdx];
    if (!section) return null;

    setTutorAudioWarning(null);
    setPlaybackNotice(null);

    const existing = sectionAudioUrls[sectionIdx];
    if (existing) {
      setActiveSectionIdx(sectionIdx);
      if (autoPlay) {
        pendingAutoPlayRef.current = true;
        if (tutorAudioRef.current && tutorAudioRef.current.src.includes(existing)) {
          tutorAudioRef.current.playbackRate = playbackSpeed;
          await tutorAudioRef.current.play().catch(() => {
            setPlaybackNotice('Tap Play in the audio bar to start playback.');
          });
        }
      }
      return existing;
    }

    setLoadingSectionIdx(sectionIdx);
    try {
      const res = await synthesizeVoiceTutorSectionAudio({
        sessionId: activeVoiceTutorSession.id,
        sectionIndex: section.index,
        text: section.spokenScript,
        preferredLanguage: activeVoiceTutorSession.preferredLanguage,
        voiceName: activeVoiceTutorSession.voiceName || tutorVoice,
        slow: playbackSpeed === 0.75,
      });

      setSectionAudioUrls((prev) => ({ ...prev, [sectionIdx]: res.audioUrl }));
      setActiveSectionIdx(sectionIdx);
      if (autoPlay) {
        pendingAutoPlayRef.current = true;
      }
      onRefreshVoiceTutorHistory?.();
      return res.audioUrl;
    } catch (err) {
      setTutorAudioWarning(
        err instanceof Error
          ? err.message
          : 'Could not synthesize audio for this section.'
      );
      return null;
    } finally {
      setLoadingSectionIdx(null);
    }
  };

  const handleExplainTopic = async () => {
    setTutorError(null);
    setTutorAudioWarning(null);
    setPlaybackNotice(null);

    const trimmedTopic = topicInput.trim();
    const effectiveText = (customPassage.trim() || sourceText.trim()).trim();

    if (tutorSourceType === 'topic' && trimmedTopic.length < 2) {
      setTutorError('Please enter a topic or question for the AI Voice Tutor to teach.');
      return;
    }
    if (tutorSourceType === 'text' && effectiveText.length < 10 && trimmedTopic.length < 2) {
      setTutorError('Please paste or enter educational text (at least 10 characters) or enter a topic.');
      return;
    }
    if (tutorSourceType === 'document' && !selectedDocumentId) {
      setTutorError('Please upload or select a PDF/TXT document first.');
      return;
    }
    if (tutorSourceType === 'summary' && !summaryResult?.summaryText) {
      setTutorError('Generate a summary in Text Summarization first, or choose another source.');
      return;
    }
    if (tutorSourceType === 'conversation' && !selectedConversationId) {
      setTutorError('Please select a saved conversation first.');
      return;
    }

    setIsGeneratingTutor(true);
    try {
      const payloadContent =
        tutorSourceType === 'text'
          ? effectiveText
          : tutorSourceType === 'summary'
          ? summaryResult?.summaryText || ''
          : '';

      const res = await explainWithVoiceTutor({
        topic: trimmedTopic,
        content: payloadContent,
        sourceType: tutorSourceType,
        documentId: tutorSourceType === 'document' ? selectedDocumentId : null,
        conversationId: tutorSourceType === 'conversation' ? selectedConversationId : null,
        learningLevel: readingLevel,
        preferredLanguage,
        voiceName: tutorVoice,
        slow: playbackSpeed === 0.75,
        generateInitialAudio: true,
      });

      onSelectVoiceTutorSession?.(res.session);
      if (res.audioUrl) {
        setSectionAudioUrls({ 0: res.audioUrl });
      }
      if (res.audioError) {
        setTutorAudioWarning(res.audioError);
      }
      onRefreshVoiceTutorHistory?.();
    } catch (err) {
      setTutorError(
        err instanceof Error
          ? err.message
          : 'Failed to generate AI Voice Tutor explanation.'
      );
    } finally {
      setIsGeneratingTutor(false);
    }
  };

  const handlePlay = async () => {
    setPlaybackNotice(null);
    if (!activeVoiceTutorSession) return;
    if (!currentTutorAudioUrl) {
      await loadSectionAudio(activeSectionIdx, true);
      return;
    }
    const audio = tutorAudioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackSpeed;
    await audio.play().catch(() => {
      setPlaybackNotice('Press the native audio play control if autoplay was blocked.');
    });
  };

  const handlePause = () => {
    tutorAudioRef.current?.pause();
  };

  const handleResume = async () => {
    const audio = tutorAudioRef.current;
    if (!audio) {
      await handlePlay();
      return;
    }
    audio.playbackRate = playbackSpeed;
    await audio.play().catch(() => {
      setPlaybackNotice('Press Play to continue.');
    });
  };

  const handleStop = () => {
    const audio = tutorAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentTime(0);
  };

  const handleReplay = async () => {
    if (!currentTutorAudioUrl) {
      await loadSectionAudio(activeSectionIdx, true);
      return;
    }
    const audio = tutorAudioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.playbackRate = playbackSpeed;
    await audio.play().catch(() => {
      setPlaybackNotice('Press Play to replay this section.');
    });
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setIsPaused(false);
    if (
      autoContinue &&
      activeVoiceTutorSession &&
      activeSectionIdx + 1 < activeVoiceTutorSession.sections.length
    ) {
      void loadSectionAudio(activeSectionIdx + 1, true);
    }
  };

  // Preserved basic TTS logic
  const activeText =
    selectedSource === 'simplified' && simplifiedResult?.simplifiedText
      ? simplifiedResult.simplifiedText
      : selectedSource === 'summary' && summaryResult?.summaryText
      ? summaryResult.summaryText
      : sourceText;

  const sourceLabel =
    selectedSource === 'simplified' && simplifiedResult?.simplifiedText
      ? 'Simplified Version'
      : selectedSource === 'summary' && summaryResult?.summaryText
      ? 'Summary Overview'
      : 'Original Input Text';

  const handleGenerateSpeech = async () => {
    setBasicError(null);
    if (!activeText.trim()) {
      setBasicError('Please enter or upload educational text before generating audio.');
      return;
    }

    setIsLoadingBasic(true);
    try {
      const selectedLangObj = languages.find((l) => l.code === readLanguageCode);
      const { blob, chunkCount, wasTruncated } = await generateSpeechAudio({
        text: activeText,
        lang: readLanguageCode,
        slow: slowPace,
      });
      const nextUrl = URL.createObjectURL(blob);
      onAudioGenerated({
        url: nextUrl,
        slowPace,
        sourceLabel,
        languageLabel: selectedLangObj?.label || 'English',
        chunkCount,
        wasTruncated,
      });
    } catch (err) {
      setBasicError(
        err instanceof Error
          ? err.message
          : 'Network error while generating MP3 audio.'
      );
    } finally {
      setIsLoadingBasic(false);
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
            AI Voice Tutor &amp; Audio Studio
          </h1>
          <p
            className={`mt-1 text-sm ${
              hc ? 'text-zinc-200' : 'text-slate-600'
            }`}
          >
            Learn concepts through a spoken teacher-style explanation with examples and analogies, or read any text directly aloud.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Audio Studio Mode"
          className={`inline-flex items-center gap-1 rounded-lg p-1 self-start sm:self-auto ${
            hc ? 'border border-white bg-zinc-900' : 'bg-slate-200/80'
          }`}
        >
          <button
            type="button"
            role="tab"
            aria-selected={studioMode === 'tutor'}
            onClick={() => setStudioMode('tutor')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 ${
              hc
                ? studioMode === 'tutor'
                  ? 'bg-yellow-300 text-black font-bold'
                  : 'text-white hover:bg-zinc-800'
                : studioMode === 'tutor'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
            <span>AI Voice Tutor</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={studioMode === 'read_aloud'}
            onClick={() => setStudioMode('read_aloud')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 ${
              hc
                ? studioMode === 'read_aloud'
                  ? 'bg-yellow-300 text-black font-bold'
                  : 'text-white hover:bg-zinc-800'
                : studioMode === 'read_aloud'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Read Text Aloud</span>
          </button>
        </div>
      </div>

      {studioMode === 'tutor' && (
        <div className="space-y-6">
          <section
            aria-label="Voice Tutor Setup"
            className={`rounded-xl p-5 space-y-5 ${
              hc
                ? 'border-2 border-white bg-black text-white'
                : 'border border-slate-200 bg-white text-slate-900'
            }`}
          >
            <div>
              <p
                className={`text-xs font-semibold mb-2 ${
                  hc ? 'text-yellow-300' : 'text-slate-700'
                }`}
              >
                1. Choose What to Teach
              </p>
              <div className="flex flex-wrap gap-1.5">
                {TUTOR_SOURCE_TABS.map((tab) => {
                  const active = tutorSourceType === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setTutorSourceType(tab.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                        hc
                          ? active
                            ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
                            : 'border border-white text-white hover:bg-zinc-900'
                          : active
                          ? 'bg-indigo-600 text-white'
                          : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="voice-tutor-topic-input"
                  className={`block text-xs font-semibold mb-1.5 ${
                    hc ? 'text-yellow-300' : 'text-slate-700'
                  }`}
                >
                  {tutorSourceType === 'topic'
                    ? 'Topic or Concept to Explain'
                    : 'Optional Focus Question or Lesson Title'}
                </label>
                <input
                  id="voice-tutor-topic-input"
                  type="text"
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  placeholder="e.g., How photosynthesis converts sunlight into glucose"
                  className={
                    hc
                      ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 px-3.5 text-sm text-white placeholder:text-zinc-400 focus:border-yellow-300 focus:outline-none'
                      : 'h-10 w-full rounded-lg border border-slate-300 bg-slate-50/50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none'
                  }
                />
              </div>

              {tutorSourceType === 'text' && (
                <div>
                  <label
                    htmlFor="voice-tutor-passage-input"
                    className={`block text-xs font-semibold mb-1.5 ${
                      hc ? 'text-yellow-300' : 'text-slate-700'
                    }`}
                  >
                    Educational Passage or Study Notes
                  </label>
                  <textarea
                    id="voice-tutor-passage-input"
                    rows={4}
                    value={customPassage}
                    onChange={(e) => setCustomPassage(e.target.value)}
                    placeholder="Paste textbook paragraphs or study notes for the Voice Tutor to teach step by step..."
                    className={
                      hc
                        ? 'w-full rounded-lg border-2 border-white bg-zinc-950 p-3 text-sm text-white placeholder:text-zinc-400 focus:border-yellow-300 focus:outline-none'
                        : 'w-full rounded-lg border border-slate-300 bg-slate-50/50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none'
                    }
                  />
                </div>
              )}

              {tutorSourceType === 'document' && (
                <div>
                  <label
                    htmlFor="voice-tutor-doc-select"
                    className={`block text-xs font-semibold mb-1.5 ${
                      hc ? 'text-yellow-300' : 'text-slate-700'
                    }`}
                  >
                    Select Uploaded PDF or TXT Document
                  </label>
                  {documents.length > 0 ? (
                    <select
                      id="voice-tutor-doc-select"
                      value={selectedDocumentId}
                      onChange={(e) => setSelectedDocumentId(e.target.value)}
                      className={
                        hc
                          ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 px-3 text-sm text-white focus:border-yellow-300 focus:outline-none'
                          : 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none'
                      }
                    >
                      {documents.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.originalFilename || doc.filename} ({doc.fileType} · {doc.wordCount} words)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 px-3.5 py-2.5 text-xs">
                      <span className={hc ? 'text-zinc-300' : 'text-slate-600'}>
                        No uploaded PDF or TXT documents found yet.
                      </span>
                      <button
                        type="button"
                        onClick={() => onNavigate('input')}
                        className="font-semibold text-indigo-600 hover:underline"
                      >
                        Upload a Document
                      </button>
                    </div>
                  )}
                </div>
              )}

              {tutorSourceType === 'summary' && (
                <div
                  className={`rounded-lg border px-3.5 py-2.5 text-xs ${
                    hc
                      ? 'border-white bg-zinc-950 text-zinc-200'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  {summaryResult?.summaryText ? (
                    <>
                      <p className="font-semibold mb-1">Active Generated Summary Ready</p>
                      <p className="line-clamp-3">{summaryResult.summaryText}</p>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>No generated summary in the current session yet.</span>
                      <button
                        type="button"
                        onClick={() => onNavigate('summarize')}
                        className="font-semibold text-indigo-600 hover:underline"
                      >
                        Go to Text Summarization
                      </button>
                    </div>
                  )}
                </div>
              )}

              {tutorSourceType === 'conversation' && (
                <div>
                  <label
                    htmlFor="voice-tutor-chat-select"
                    className={`block text-xs font-semibold mb-1.5 ${
                      hc ? 'text-yellow-300' : 'text-slate-700'
                    }`}
                  >
                    Select Previous Conversation
                  </label>
                  {conversations.length > 0 ? (
                    <select
                      id="voice-tutor-chat-select"
                      value={selectedConversationId}
                      onChange={(e) => setSelectedConversationId(e.target.value)}
                      className={
                        hc
                          ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 px-3 text-sm text-white focus:border-yellow-300 focus:outline-none'
                          : 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none'
                      }
                    >
                      {conversations.map((chat) => (
                        <option key={chat.id} value={chat.id}>
                          {chat.title} ({chat.messageCount} messages)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 px-3.5 py-2.5 text-xs">
                      <span className={hc ? 'text-zinc-300' : 'text-slate-600'}>
                        No saved conversations yet.
                      </span>
                      <button
                        type="button"
                        onClick={() => onNavigate('assistant')}
                        className="font-semibold text-indigo-600 hover:underline"
                      >
                        Open AI Learning Assistant
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <p
                  className={`text-xs font-semibold mb-1.5 ${
                    hc ? 'text-yellow-300' : 'text-slate-700'
                  }`}
                >
                  Explanation Level
                </p>
                <div
                  role="group"
                  aria-label="Explanation level"
                  className={`grid grid-cols-3 gap-1 rounded-lg p-1 ${
                    hc ? 'border border-white bg-zinc-900' : 'bg-slate-100'
                  }`}
                >
                  {LEARNING_LEVELS.map((lvl) => {
                    const active = readingLevel === lvl;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChangeLevel?.(lvl)}
                        className={`rounded-md py-1.5 text-xs font-semibold whitespace-nowrap ${
                          hc
                            ? active
                              ? 'bg-yellow-300 text-black font-bold'
                              : 'text-white hover:bg-zinc-800'
                            : active
                            ? 'bg-white text-indigo-700 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {lvl}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="voice-tutor-language-select"
                  className={`block text-xs font-semibold mb-1.5 ${
                    hc ? 'text-yellow-300' : 'text-slate-700'
                  }`}
                >
                  Explanation Language
                </label>
                <select
                  id="voice-tutor-language-select"
                  value={preferredLanguage}
                  onChange={(e) => setPreferredLanguage(e.target.value)}
                  className={
                    hc
                      ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 px-3 text-sm text-white focus:border-yellow-300 focus:outline-none'
                      : 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none'
                  }
                >
                  {languages.map((lang) => (
                    <option key={lang.code} value={lang.label}>
                      {lang.label} ({lang.nativeLabel})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="voice-tutor-voice-select"
                  className={`block text-xs font-semibold mb-1.5 ${
                    hc ? 'text-yellow-300' : 'text-slate-700'
                  }`}
                >
                  Tutor Voice
                </label>
                <select
                  id="voice-tutor-voice-select"
                  value={tutorVoice}
                  onChange={(e) => setTutorVoice(e.target.value)}
                  className={
                    hc
                      ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 px-3 text-sm text-white focus:border-yellow-300 focus:outline-none'
                      : 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none'
                  }
                >
                  {VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className={`text-xs ${hc ? 'text-zinc-300' : 'text-slate-500'}`}>
                Includes introduction, simple definition, step-by-step walkthrough, examples, analogies, key points, and recap.
              </p>

              <button
                type="button"
                onClick={() => void handleExplainTopic()}
                disabled={isGeneratingTutor}
                className={`inline-flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0 ${
                  hc
                    ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
                    : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'
                }`}
              >
                {isGeneratingTutor ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Preparing Spoken Lesson...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    <span>Explain Topic</span>
                  </>
                )}
              </button>
            </div>

            {tutorError && (
              <div
                role="alert"
                className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
                  hc
                    ? 'border-red-400 bg-zinc-950 text-red-300'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{tutorError}</span>
              </div>
            )}
          </section>

          {activeVoiceTutorSession && (
            <div className="space-y-6">
              <section
                aria-label="Voice Tutor Audio Controls"
                className={`rounded-xl p-5 space-y-4 ${
                  hc
                    ? 'border-2 border-yellow-300 bg-black text-white'
                    : 'border border-indigo-200 bg-indigo-50/40 text-slate-900'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className={`text-xs font-semibold ${
                        hc ? 'text-yellow-300' : 'text-indigo-700'
                      }`}
                    >
                      {activeVoiceTutorSession.learningLevel} ·{' '}
                      {activeVoiceTutorSession.preferredLanguage} ·{' '}
                      {activeVoiceTutorSession.voiceName}
                    </p>
                    <h2 className="text-lg font-bold tracking-tight mt-0.5">
                      {activeVoiceTutorSession.lessonTitle}
                    </h2>
                    {currentSection && (
                      <p className={`text-xs mt-0.5 ${hc ? 'text-zinc-200' : 'text-slate-600'}`}>
                        Section {activeSectionIdx + 1} of {activeSections.length}:{' '}
                        <span className="font-semibold">{currentSection.title}</span>
                      </p>
                    )}
                  </div>

                  {currentTutorAudioUrl && (
                    <a
                      href={currentTutorAudioUrl}
                      download={`voice-tutor-section-${activeSectionIdx + 1}.mp3`}
                      className={
                        hc
                          ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border-2 border-yellow-300 bg-yellow-300 px-3.5 text-xs font-bold text-black whitespace-nowrap shrink-0'
                          : 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 whitespace-nowrap shrink-0'
                      }
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download Section</span>
                    </a>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handlePlay()}
                      disabled={loadingSectionIdx !== null}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                        hc
                          ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {loadingSectionIdx === activeSectionIdx ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>Play</span>
                    </button>

                    <button
                      type="button"
                      onClick={handlePause}
                      disabled={!isPlaying}
                      className={
                        hc
                          ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-white px-3 text-xs font-semibold text-white hover:bg-zinc-900 disabled:opacity-45 whitespace-nowrap shrink-0'
                          : 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap shrink-0'
                      }
                    >
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Pause</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleResume()}
                      disabled={!isPaused || !currentTutorAudioUrl}
                      className={
                        hc
                          ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-white px-3 text-xs font-semibold text-white hover:bg-zinc-900 disabled:opacity-45 whitespace-nowrap shrink-0'
                          : 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap shrink-0'
                      }
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Resume</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleStop}
                      disabled={!currentTutorAudioUrl}
                      className={
                        hc
                          ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-white px-3 text-xs font-semibold text-white hover:bg-zinc-900 disabled:opacity-45 whitespace-nowrap shrink-0'
                          : 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap shrink-0'
                      }
                    >
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Stop</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleReplay()}
                      disabled={loadingSectionIdx !== null}
                      className={
                        hc
                          ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-white px-3 text-xs font-semibold text-white hover:bg-zinc-900 disabled:opacity-45 whitespace-nowrap shrink-0'
                          : 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap shrink-0'
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Replay</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs font-semibold whitespace-nowrap ${
                        hc ? 'text-yellow-300' : 'text-slate-600'
                      }`}
                    >
                      Speed
                    </span>
                    <div
                      role="group"
                      aria-label="Speech playback speed"
                      className={`inline-flex rounded-lg p-0.5 ${
                        hc ? 'border border-white bg-zinc-950' : 'border border-slate-200 bg-white'
                      }`}
                    >
                      {PLAYBACK_SPEEDS.map((spd) => {
                        const active = playbackSpeed === spd;
                        return (
                          <button
                            key={spd}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setPlaybackSpeed(spd)}
                            className={`rounded-md px-2.5 py-1 text-xs font-mono-tabular font-semibold whitespace-nowrap ${
                              hc
                                ? active
                                  ? 'bg-yellow-300 text-black font-bold'
                                  : 'text-white hover:bg-zinc-800'
                                : active
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {spd}x
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono-tabular w-10 text-right">
                      {formatDurationSeconds(currentTime)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={duration || 1}
                      step={0.1}
                      value={Math.min(currentTime, duration || 1)}
                      disabled={!currentTutorAudioUrl || duration <= 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (tutorAudioRef.current) {
                          tutorAudioRef.current.currentTime = val;
                          setCurrentTime(val);
                        }
                      }}
                      aria-label="Audio playback progress"
                      className="flex-1 accent-indigo-600"
                    />
                    <span className="text-xs font-mono-tabular w-10">
                      {formatDurationSeconds(duration)}
                    </span>
                  </div>

                  {currentTutorAudioUrl ? (
                    <audio
                      ref={tutorAudioRef}
                      key={currentTutorAudioUrl}
                      controls
                      playsInline
                      preload="metadata"
                      src={currentTutorAudioUrl}
                      onLoadedMetadata={(e) => {
                        const el = e.currentTarget;
                        el.playbackRate = playbackSpeed;
                        setDuration(el.duration || 0);
                        if (pendingAutoPlayRef.current) {
                          pendingAutoPlayRef.current = false;
                          void el.play().catch(() => {
                            setPlaybackNotice('Tap Play to start the next section.');
                          });
                        }
                      }}
                      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                      onPlay={() => {
                        setIsPlaying(true);
                        setIsPaused(false);
                      }}
                      onPause={() => {
                        setIsPlaying(false);
                        if (
                          tutorAudioRef.current &&
                          tutorAudioRef.current.currentTime > 0 &&
                          !tutorAudioRef.current.ended
                        ) {
                          setIsPaused(true);
                        }
                      }}
                      onEnded={handleAudioEnded}
                      className="w-full"
                      aria-label="AI Voice Tutor audio player"
                    />
                  ) : (
                    <div
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
                        hc
                          ? 'border-white bg-zinc-950 text-zinc-200'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      <span>
                        {loadingSectionIdx === activeSectionIdx
                          ? 'Synthesizing section audio...'
                          : 'Audio for this section is ready to generate on demand.'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void loadSectionAudio(activeSectionIdx, true)}
                        disabled={loadingSectionIdx !== null}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold whitespace-nowrap ${
                          hc
                            ? 'bg-yellow-300 text-black font-bold'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                      >
                        <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Generate &amp; Play Section</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={activeSectionIdx <= 0 || loadingSectionIdx !== null}
                      onClick={() => void loadSectionAudio(activeSectionIdx - 1, true)}
                      className={
                        hc
                          ? 'inline-flex h-8 items-center gap-1 rounded-md border border-white px-2.5 text-xs font-semibold text-white disabled:opacity-40 whitespace-nowrap'
                          : 'inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap'
                      }
                    >
                      <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Prev Section</span>
                    </button>

                    <button
                      type="button"
                      disabled={
                        activeSectionIdx >= activeSections.length - 1 ||
                        loadingSectionIdx !== null
                      }
                      onClick={() => void loadSectionAudio(activeSectionIdx + 1, true)}
                      className={
                        hc
                          ? 'inline-flex h-8 items-center gap-1 rounded-md border border-white px-2.5 text-xs font-semibold text-white disabled:opacity-40 whitespace-nowrap'
                          : 'inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap'
                      }
                    >
                      <span>Next Section</span>
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <label
                    className={`inline-flex cursor-pointer items-center gap-2 text-xs font-medium ${
                      hc ? 'text-white' : 'text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={autoContinue}
                      onChange={(e) => setAutoContinue(e.target.checked)}
                      className={`h-4 w-4 rounded ${
                        hc ? 'accent-yellow-300' : 'accent-indigo-600'
                      }`}
                    />
                    <span>Auto-continue to next section</span>
                  </label>
                </div>

                {tutorAudioWarning && (
                  <div
                    role="status"
                    className={`flex items-start justify-between gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs ${
                      hc
                        ? 'border-yellow-300 bg-zinc-950 text-yellow-200'
                        : 'border-amber-200 bg-amber-50 text-amber-900'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{tutorAudioWarning}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadSectionAudio(activeSectionIdx, true)}
                      className="font-semibold underline whitespace-nowrap shrink-0"
                    >
                      Retry Audio
                    </button>
                  </div>
                )}

                {playbackNotice && (
                  <p className={`text-xs ${hc ? 'text-yellow-300' : 'text-indigo-700'}`}>
                    {playbackNotice}
                  </p>
                )}
              </section>

              {activeSections.length > 0 && (
                <section
                  aria-label="Lesson Audio Sections"
                  className={`rounded-xl p-5 space-y-3 ${
                    hc
                      ? 'border-2 border-white bg-black text-white'
                      : 'border border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">
                      Lesson Audio Sections ({activeSections.length})
                    </h3>
                    <span className={`text-xs ${hc ? 'text-zinc-300' : 'text-slate-500'}`}>
                      Play any section directly or listen sequentially
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                    {activeSections.map((sec, idx) => {
                      const isCurrent = activeSectionIdx === idx;
                      const isCachedReady = Boolean(sectionAudioUrls[idx]);
                      const isSecLoading = loadingSectionIdx === idx;
                      return (
                        <div
                          key={`${sec.index}-${sec.title}`}
                          className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                            hc
                              ? isCurrent
                                ? 'border-yellow-300 bg-zinc-900'
                                : 'border-zinc-700 bg-zinc-950'
                              : isCurrent
                              ? 'border-indigo-300 bg-indigo-50/50'
                              : 'border-slate-200 bg-slate-50/40'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate">
                              {idx + 1}. {sec.title}
                            </p>
                            <p
                              className={`text-[11px] font-mono-tabular mt-0.5 ${
                                hc ? 'text-zinc-300' : 'text-slate-500'
                              }`}
                            >
                              {sec.wordCount} words · ~{formatDurationSeconds(sec.estimatedSeconds)}
                              {isCachedReady ? ' · Audio Ready' : ''}
                            </p>
                          </div>

                          <button
                            type="button"
                            disabled={isSecLoading}
                            onClick={() => void loadSectionAudio(idx, true)}
                            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold whitespace-nowrap shrink-0 ${
                              hc
                                ? isCurrent
                                  ? 'bg-yellow-300 text-black font-bold'
                                  : 'border border-white text-white hover:bg-zinc-800'
                                : isCurrent
                                ? 'bg-indigo-600 text-white'
                                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {isSecLoading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Play className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span>{isCachedReady ? 'Play' : 'Load & Play'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <section
                aria-label="Structured Voice Tutor Explanation"
                className={`rounded-xl p-6 space-y-6 ${readerFontClass} ${
                  hc
                    ? 'border-2 border-white bg-black text-white'
                    : 'border border-slate-200 bg-white text-slate-900'
                }`}
                style={{
                  fontSize: `${preferences.fontSize}px`,
                  lineHeight: readerLineHeight,
                }}
              >
                <div className="border-b pb-4 border-slate-200">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-80">
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                    <span>Complete Spoken Lesson Transcript</span>
                  </div>
                  <h2 className="mt-1 text-xl font-bold">
                    {activeVoiceTutorSession.explanation.lessonTitle}
                  </h2>
                </div>

                {activeVoiceTutorSession.explanation.introduction && (
                  <div className="space-y-1.5">
                    <h3 className={`text-sm font-bold ${hc ? 'text-yellow-300' : 'text-indigo-700'}`}>
                      1. Introduction
                    </h3>
                    <p>{activeVoiceTutorSession.explanation.introduction}</p>
                  </div>
                )}

                {activeVoiceTutorSession.explanation.meaningAndDefinition && (
                  <div className="space-y-1.5">
                    <h3 className={`text-sm font-bold ${hc ? 'text-yellow-300' : 'text-indigo-700'}`}>
                      2. Meaning &amp; Simple Definition
                    </h3>
                    <p>{activeVoiceTutorSession.explanation.meaningAndDefinition}</p>
                  </div>
                )}

                {activeVoiceTutorSession.explanation.stepByStepExplanation?.length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className={`text-sm font-bold ${hc ? 'text-yellow-300' : 'text-indigo-700'}`}>
                      3. Step-by-Step Explanation
                    </h3>
                    <ol className="space-y-2.5">
                      {activeVoiceTutorSession.explanation.stepByStepExplanation.map(
                        (step, idx) => (
                          <li
                            key={`${idx}-${step.stepTitle}`}
                            className={`rounded-lg border p-3.5 ${
                              hc
                                ? 'border-zinc-700 bg-zinc-950'
                                : 'border-slate-200 bg-slate-50/60'
                            }`}
                          >
                            <p className="font-bold">
                              Step {idx + 1}: {step.stepTitle}
                            </p>
                            <p className="mt-1">{step.explanation}</p>
                          </li>
                        )
                      )}
                    </ol>
                  </div>
                )}

                {activeVoiceTutorSession.explanation.realWorldExamples?.length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className={`text-sm font-bold ${hc ? 'text-yellow-300' : 'text-indigo-700'}`}>
                      4. Real-World Examples
                    </h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {activeVoiceTutorSession.explanation.realWorldExamples.map(
                        (ex, idx) => (
                          <div
                            key={`${idx}-${ex.title}`}
                            className={`rounded-lg border p-3.5 ${
                              hc
                                ? 'border-zinc-700 bg-zinc-950'
                                : 'border-slate-200 bg-slate-50/60'
                            }`}
                          >
                            <p className="font-bold">{ex.title}</p>
                            <p className="mt-1">{ex.description}</p>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {activeVoiceTutorSession.explanation.analogies?.length > 0 && (
                  <div className="space-y-2.5">
                    <h3
                      className={`flex items-center gap-1.5 text-sm font-bold ${
                        hc ? 'text-yellow-300' : 'text-indigo-700'
                      }`}
                    >
                      <Lightbulb className="h-4 w-4" aria-hidden="true" />
                      <span>5. Helpful Analogies</span>
                    </h3>
                    <div className="space-y-2">
                      {activeVoiceTutorSession.explanation.analogies.map((item, idx) => (
                        <div
                          key={`${idx}-${item.concept}`}
                          className={`rounded-lg border p-3.5 ${
                            hc
                              ? 'border-zinc-700 bg-zinc-950'
                              : 'border-indigo-100 bg-indigo-50/40'
                          }`}
                        >
                          <p className="font-bold">{item.concept}</p>
                          <p className="mt-1">{item.analogy}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeVoiceTutorSession.explanation.importantPoints?.length > 0 && (
                  <div className="space-y-2">
                    <h3
                      className={`flex items-center gap-1.5 text-sm font-bold ${
                        hc ? 'text-yellow-300' : 'text-indigo-700'
                      }`}
                    >
                      <ListChecks className="h-4 w-4" aria-hidden="true" />
                      <span>6. Important Points to Remember</span>
                    </h3>
                    <ul className="list-disc pl-6 space-y-1.5">
                      {activeVoiceTutorSession.explanation.importantPoints.map((pt, idx) => (
                        <li key={`${idx}-${pt.slice(0, 16)}`}>{pt}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {activeVoiceTutorSession.explanation.shortRecap && (
                  <div
                    className={`rounded-lg border p-4 space-y-1 ${
                      hc
                        ? 'border-yellow-300 bg-zinc-950'
                        : 'border-indigo-200 bg-indigo-50/40'
                    }`}
                  >
                    <h3 className={`text-sm font-bold ${hc ? 'text-yellow-300' : 'text-indigo-700'}`}>
                      7. Short Recap
                    </h3>
                    <p>{activeVoiceTutorSession.explanation.shortRecap}</p>
                  </div>
                )}
              </section>
            </div>
          )}

          {voiceTutorHistory.length > 0 && (
            <section
              aria-label="Recent Voice Tutor Lessons"
              className={`rounded-xl p-5 space-y-3 ${
                hc
                  ? 'border-2 border-white bg-black text-white'
                  : 'border border-slate-200 bg-white text-slate-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <History
                  className={`h-4 w-4 ${hc ? 'text-yellow-300' : 'text-indigo-600'}`}
                  aria-hidden="true"
                />
                <h2 className="text-sm font-bold">
                  Saved Voice Tutor Lessons ({voiceTutorHistory.length})
                </h2>
              </div>

              <div className="space-y-2">
                {voiceTutorHistory.slice(0, 8).map((sess) => {
                  const isActive = activeVoiceTutorSession?.id === sess.id;
                  return (
                    <div
                      key={sess.id}
                      className={`flex flex-col gap-2.5 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
                        hc
                          ? isActive
                            ? 'border-yellow-300 bg-zinc-900'
                            : 'border-zinc-700 bg-zinc-950'
                          : isActive
                          ? 'border-indigo-300 bg-indigo-50/40'
                          : 'border-slate-200 bg-slate-50/40'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{sess.lessonTitle}</p>
                        <p className={`text-xs ${hc ? 'text-zinc-300' : 'text-slate-500'}`}>
                          {sess.learningLevel} · {sess.preferredLanguage} ·{' '}
                          {sess.sections.length} section{sess.sections.length === 1 ? '' : 's'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onSelectVoiceTutorSession?.(sess)}
                          className={
                            hc
                              ? 'inline-flex h-8 items-center gap-1 rounded-md border border-yellow-300 bg-yellow-300 px-3 text-xs font-bold text-black whitespace-nowrap'
                              : 'inline-flex h-8 items-center gap-1 rounded-md bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 whitespace-nowrap'
                          }
                        >
                          <span>{isActive ? 'Loaded' : 'Open Lesson'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteVoiceTutorSession?.(sess.id)}
                          aria-label={`Delete Voice Tutor lesson ${sess.lessonTitle}`}
                          className={
                            hc
                              ? 'inline-flex h-8 items-center justify-center rounded-md border border-red-400 px-2 text-red-300 hover:bg-zinc-900'
                              : 'inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
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
        </div>
      )}

      {studioMode === 'read_aloud' && (
        <div className="space-y-6">
          <div
            className={`rounded-xl p-5 space-y-4 ${
              hc
                ? 'border-2 border-white bg-black text-white'
                : 'border border-slate-200 bg-white text-slate-900'
            }`}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="speech-source-select"
                  className={`block text-xs font-semibold mb-1.5 ${
                    hc ? 'text-yellow-300' : 'text-slate-700'
                  }`}
                >
                  Text to Read Aloud
                </label>
                <select
                  id="speech-source-select"
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                  className={
                    hc
                      ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 px-3 text-sm text-white focus:border-yellow-300 focus:outline-none'
                      : 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none'
                  }
                >
                  <option value="original">Original Input Text</option>
                  <option value="simplified" disabled={!simplifiedResult?.simplifiedText}>
                    Simplified Version {simplifiedResult ? '' : '(Generate first)'}
                  </option>
                  <option value="summary" disabled={!summaryResult?.summaryText}>
                    Summary Overview {summaryResult ? '' : '(Generate first)'}
                  </option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="speech-language-select"
                  className={`block text-xs font-semibold mb-1.5 ${
                    hc ? 'text-yellow-300' : 'text-slate-700'
                  }`}
                >
                  Audio Language
                </label>
                <select
                  id="speech-language-select"
                  value={readLanguageCode}
                  onChange={(e) => setReadLanguageCode(e.target.value)}
                  className={
                    hc
                      ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 px-3 text-sm text-white focus:border-yellow-300 focus:outline-none'
                      : 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none'
                  }
                >
                  {languages.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label} ({lang.nativeLabel})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="speech-pace-select"
                  className={`block text-xs font-semibold mb-1.5 ${
                    hc ? 'text-yellow-300' : 'text-slate-700'
                  }`}
                >
                  Speaking Pace
                </label>
                <select
                  id="speech-pace-select"
                  value={slowPace ? 'slow' : 'normal'}
                  onChange={(e) => setSlowPace(e.target.value === 'slow')}
                  className={
                    hc
                      ? 'h-10 w-full rounded-lg border-2 border-white bg-zinc-950 px-3 text-sm text-white focus:border-yellow-300 focus:outline-none'
                      : 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none'
                  }
                >
                  {PACE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
              {!activeText.trim() && (
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
                onClick={handleGenerateSpeech}
                disabled={isLoadingBasic}
                className={`inline-flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0 ${
                  hc
                    ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
                    : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'
                }`}
              >
                {isLoadingBasic ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Generating MP3...</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="h-4 w-4" aria-hidden="true" />
                    <span>Generate MP3 Audio</span>
                  </>
                )}
              </button>
            </div>

            {basicError && (
              <div
                role="alert"
                className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
                  hc
                    ? 'border-red-400 bg-zinc-950 text-red-300'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{basicError}</span>
              </div>
            )}
          </div>

          {audioState && (
            <section
              aria-label="Audio playback"
              className={`rounded-xl p-5 space-y-3 ${
                hc
                  ? 'border-2 border-yellow-300 bg-black text-white'
                  : 'border border-indigo-200 bg-indigo-50/40 text-slate-900'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2
                    className={`text-sm font-bold ${
                      hc ? 'text-yellow-300' : 'text-slate-900'
                    }`}
                  >
                    MP3 Ready · {audioState.sourceLabel}
                    {audioState.languageLabel ? ` · ${audioState.languageLabel}` : ''} ({audioState.slowPace ? 'Slow' : 'Normal'} pace)
                  </h2>
                  <p
                    className={`text-xs ${
                      hc ? 'text-zinc-200' : 'text-slate-600'
                    }`}
                  >
                    {audioState.chunkCount > 1
                      ? `Combined from ${audioState.chunkCount} sentence-aligned speech segments. `
                      : ''}
                    {audioState.wasTruncated
                      ? 'Long passage trimmed safely to backend speech limit. '
                      : ''}
                    Play directly below or download the MP3 file for offline study.
                  </p>
                </div>
                <a
                  href={audioState.url}
                  download="smart-learning-audio.mp3"
                  className={
                    hc
                      ? 'inline-flex h-10 items-center gap-2 rounded-lg border-2 border-yellow-300 bg-yellow-300 px-4 text-xs font-bold text-black hover:opacity-95 whitespace-nowrap shrink-0'
                      : 'inline-flex h-10 items-center gap-2 rounded-lg border border-indigo-300 bg-white px-4 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 whitespace-nowrap shrink-0'
                  }
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Download MP3</span>
                </a>
              </div>
              <audio
                controls
                playsInline
                src={audioState.url}
                className="w-full"
                aria-label="Generated educational MP3 audio player"
              />
            </section>
          )}

          {activeText.trim() ? (
            <AccessibleReaderBox
              text={activeText}
              preferences={preferences}
              label="Script Preview"
              testId="speech-preview-box"
            />
          ) : (
            <div
              className={`rounded-xl border border-dashed p-8 text-center ${
                hc
                  ? 'border-white bg-black text-white'
                  : 'border-slate-300 bg-white text-slate-900'
              }`}
            >
              <p className="text-sm font-medium">
                No text available for speech conversion
              </p>
              <p
                className={`mt-1 text-xs ${
                  hc ? 'text-zinc-300' : 'text-slate-500'
                }`}
              >
                Add educational text or upload a PDF/TXT file in Input &amp; Upload first.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
