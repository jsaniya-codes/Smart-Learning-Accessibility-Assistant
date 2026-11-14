export type ActiveSection =
  | 'input'
  | 'simplify'
  | 'summarize'
  | 'assistant'
  | 'videos'
  | 'speech'
  | 'history';

export type ReadingLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export type SummaryLength = 'Short' | 'Medium' | 'Detailed';

export type LineSpacingOption = 'standard' | 'relaxed' | 'wide';

export type ReadingFontOption = 'sans' | 'accessible' | 'dyslexia';

export type TtsVoiceName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export interface ReadingPreferences {
  fontSize: number;
  lineSpacing: LineSpacingOption;
  fontFamily: ReadingFontOption;
  highContrast: boolean;
}

export interface DocumentSourceMeta {
  id?: string | null;
  name: string;
  fileType: 'Text' | 'TXT' | 'PDF' | 'Sample' | 'Saved' | 'Explanation';
  pages: number;
  pagesWithText?: number;
  ocrWarning?: string | null;
}

export interface ConceptExplanation {
  term: string;
  explanation: string;
}

export interface SimplifyResult {
  simplifiedText: string;
  difficultConcepts: ConceptExplanation[];
  examples: string[];
  savedResultId?: string | null;
}

export interface KeyConceptDefinition {
  term: string;
  definition: string;
}

export interface SummaryResult {
  summaryText: string;
  keywords: string[];
  bulletPoints: string[];
  keyConcepts: KeyConceptDefinition[];
  savedResultId?: string | null;
}

export interface QaEntry {
  id: string;
  question: string;
  foundInMaterial: boolean;
  answer: string;
  examples: string[];
  supportingQuote: string;
}

export interface SpeechAudioState {
  url: string;
  voiceName: TtsVoiceName;
  slowPace: boolean;
  sourceLabel: string;
  chunkCount: number;
  language?: string;
}

export interface SamplePassage {
  id: string;
  title: string;
  subject: string;
  text: string;
}

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
}

export interface SavedDocumentSummary {
  id: string;
  filename: string;
  originalFilename: string;
  fileType: 'PDF' | 'TXT';
  mimeType: string;
  wordCount: number;
  pageCount: number;
  pagesWithText: number;
  ocrWarning: string | null;
  processingStatus: string;
  createdAt: string;
}

export interface SavedDocumentDetail extends SavedDocumentSummary {
  text: string;
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  documentId: string | null;
  documentName: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  foundInMaterial: boolean;
  examples: string[];
  supportingQuote: string;
  createdAt: string;
}

export type VideoSourceType = 'text' | 'document' | 'summary' | 'assistant' | 'custom';

export interface RecommendedVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  channelName: string;
  videoUrl: string;
  duration: string;
  recommendationReason: string;
}

export interface VideoRecommendationResult {
  id: string | null;
  conversationId: string | null;
  documentId: string | null;
  sourceType: VideoSourceType | string;
  topic: string;
  keywords: string[];
  searchQuery: string;
  learningLevel: ReadingLevel | string;
  preferredLanguage: string;
  videos: RecommendedVideo[];
  cached?: boolean;
  createdAt: string;
}

export interface ChatDetail {
  id: string;
  title: string;
  documentId: string | null;
  document: SavedDocumentDetail | null;
  messages: ChatMessage[];
  recommendations?: VideoRecommendationResult[];
  createdAt: string;
  updatedAt: string;
}

export interface LearningResultConcept {
  term: string;
  explanation?: string;
  definition?: string;
}

export interface LearningResultRecord {
  id: string;
  documentId: string | null;
  resultType: 'simplified' | 'summary' | 'explanation';
  title: string;
  readingLevel: string | null;
  summaryLength: string | null;
  sourceExcerpt: string;
  contentText: string;
  keywords: string[];
  bulletPoints: string[];
  concepts: LearningResultConcept[];
  examples: string[];
  createdAt: string;
}

export type VoiceTutorSourceType =
  | 'topic'
  | 'text'
  | 'document'
  | 'summary'
  | 'conversation';

export interface VoiceTutorLanguageOption {
  label: string;
  code: string;
  nativeLabel: string;
}

export interface VoiceTutorStepItem {
  stepTitle: string;
  explanation: string;
}

export interface VoiceTutorExampleItem {
  title: string;
  description: string;
}

export interface VoiceTutorAnalogyItem {
  concept: string;
  analogy: string;
}

export interface VoiceTutorExplanation {
  lessonTitle: string;
  introduction: string;
  meaningAndDefinition: string;
  stepByStepExplanation: VoiceTutorStepItem[];
  realWorldExamples: VoiceTutorExampleItem[];
  analogies: VoiceTutorAnalogyItem[];
  importantPoints: string[];
  shortRecap: string;
}

export interface VoiceTutorSection {
  index: number;
  title: string;
  kind: string;
  spokenScript: string;
  wordCount: number;
  estimatedSeconds: number;
}

export interface VoiceTutorAudioRef {
  sectionIndex: number;
  audioId: string;
  mimeType: string;
  languageCode: string;
  voiceName: string;
  slow: boolean;
  audioUrl?: string;
}

export interface VoiceTutorSession {
  id: string;
  documentId: string | null;
  conversationId: string | null;
  sourceType: VoiceTutorSourceType | string;
  topic: string;
  lessonTitle: string;
  sourceExcerpt: string;
  learningLevel: ReadingLevel | string;
  preferredLanguage: string;
  languageCode: string;
  voiceName: TtsVoiceName | string;
  slow: boolean;
  explanation: VoiceTutorExplanation;
  sections: VoiceTutorSection[];
  audioRefs: VoiceTutorAudioRef[];
  primaryAudioUrl?: string | null;
  createdAt: string;
}

export interface VoiceTutorExplainResponse {
  session: VoiceTutorSession;
  explanation: VoiceTutorExplanation;
  sections: VoiceTutorSection[];
  audioId: string | null;
  audioUrl: string | null;
  sectionIndex: number;
  mimeType: string;
  chunkCount: number;
  audioError: string | null;
  metadata: {
    topic: string;
    lessonTitle: string;
    learningLevel: string;
    preferredLanguage: string;
    languageCode: string;
    sourceType: string;
    voiceName: string;
    sectionCount: number;
  };
  cached?: boolean;
}

export interface VoiceTutorSectionAudioResponse {
  audioId: string;
  audioUrl: string;
  sectionIndex: number;
  mimeType: string;
  chunkCount: number;
  cached?: boolean;
}

export interface HistoryBundle {
  query?: string;
  conversations: ChatConversationSummary[];
  documents: SavedDocumentSummary[];
  learningResults: LearningResultRecord[];
  videoRecommendations?: VideoRecommendationResult[];
  voiceTutorSessions?: VoiceTutorSession[];
}

