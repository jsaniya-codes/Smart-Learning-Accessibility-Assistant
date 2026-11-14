/**
 * Pure UI typography and display helpers.
 * All document, AI, and audio processing happens strictly on the FastAPI backend.
 */

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 28;
export const DEFAULT_FONT_SIZE = 18;

export function clampFontSize(size) {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

export function getLineHeightValue(option) {
  switch (option) {
    case 'standard':
      return 1.5;
    case 'wide':
      return 2.05;
    case 'relaxed':
    default:
      return 1.75;
  }
}

export function getReadingFontClass(fontFamily) {
  switch (fontFamily) {
    case 'accessible':
      return 'font-reading-accessible';
    case 'dyslexia':
      return 'font-reading-dyslexia';
    case 'sans':
    default:
      return 'font-reading-sans';
  }
}

export function formatQuickStats(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return { wordCount: 0, charCount: 0, estimatedMinutes: 0 };
  }
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const charCount = trimmed.length;
  const estimatedMinutes = Math.max(1, Math.ceil(wordCount / 180));
  return { wordCount, charCount, estimatedMinutes };
}
