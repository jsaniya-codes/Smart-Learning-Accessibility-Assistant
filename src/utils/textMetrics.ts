import type { LineSpacingOption, ReadingFontOption } from '../types/learning';

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 28;
export const DEFAULT_FONT_SIZE = 18;
export const MAX_TTS_CHARACTERS = 18000;

export interface TextStats {
  words: number;
  characters: number;
  estimatedMinutes: number;
}

export function computeTextStats(text: string): TextStats {
  const trimmed = text.trim();
  if (!trimmed) {
    return { words: 0, characters: 0, estimatedMinutes: 0 };
  }

  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const characters = trimmed.length;
  const estimatedMinutes = Math.max(1, Math.ceil(words / 180));

  return { words, characters, estimatedMinutes };
}

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

export function getLineHeightValue(option: LineSpacingOption): number {
  switch (option) {
    case 'standard':
      return 1.5;
    case 'relaxed':
      return 1.75;
    case 'wide':
      return 2.05;
  }
}

export function getReadingFontClass(fontFamily: ReadingFontOption): string {
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

export function validateSourceText(text: string): { valid: boolean; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Please enter educational text or upload a PDF/TXT document first.',
    };
  }
  if (trimmed.length < 15) {
    return {
      valid: false,
      error: 'Please provide at least a short sentence (15+ characters) for meaningful results.',
    };
  }
  return { valid: true };
}

export function validateUploadFileName(fileName: string): {
  valid: boolean;
  extension?: 'pdf' | 'txt';
  error?: string;
} {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.pdf')) {
    return { valid: true, extension: 'pdf' };
  }
  if (lower.endsWith('.txt')) {
    return { valid: true, extension: 'txt' };
  }
  return {
    valid: false,
    error: 'Unsupported file format. Please upload a .pdf or .txt document.',
  };
}

export function prepareSpeechText(text: string, maxChars = MAX_TTS_CHARACTERS): {
  text: string;
  wasTruncated: boolean;
} {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return { text: trimmed, wasTruncated: false };
  }
  const slice = trimmed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const safeEnd = lastSpace > maxChars * 0.7 ? lastSpace : maxChars;
  return {
    text: `${slice.slice(0, safeEnd).trim()}...`,
    wasTruncated: true,
  };
}

export function cleanPdfPageText(rawPageText: string): string {
  if (!rawPageText) return '';

  const lines = rawPageText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));

  const paragraphs: string[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length > 0) {
      paragraphs.push(buffer.join(' ').trim());
      buffer = [];
    }
  };

  const headingPattern = /^(\d+(\.\d+)*\.?\s+[A-Z]|[A-Z][A-Z0-9\s\-:]{3,60}$|Chapter\s+\d+|Section\s+\d+)/;
  const bulletPattern = /^\s*([•\-*]|\d+[.)])\s+/;

  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) {
      flushBuffer();
      continue;
    }

    if (bulletPattern.test(stripped)) {
      flushBuffer();
      paragraphs.push(stripped);
      continue;
    }

    const isShortHeading =
      stripped.length <= 70 &&
      !stripped.endsWith('.') &&
      !stripped.endsWith(',') &&
      !stripped.endsWith(';') &&
      headingPattern.test(stripped);

    if (isShortHeading) {
      flushBuffer();
      paragraphs.push(stripped);
      continue;
    }

    if (
      buffer.length > 0 &&
      buffer[buffer.length - 1].endsWith('-') &&
      !buffer[buffer.length - 1].endsWith(' -')
    ) {
      buffer[buffer.length - 1] = buffer[buffer.length - 1].slice(0, -1) + stripped;
    } else {
      buffer.push(stripped);
    }
  }

  flushBuffer();
  return paragraphs.filter(Boolean).join('\n\n');
}

export function splitTextIntoChunks(text: string, chunkLimit = 1400): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= chunkLimit) return [cleaned];

  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > chunkLimit) {
      const words = sentence.split(' ');
      for (const word of words) {
        if (word.length > chunkLimit) {
          if (current) {
            chunks.push(current);
            current = '';
          }
          for (let i = 0; i < word.length; i += chunkLimit) {
            chunks.push(word.slice(i, i + chunkLimit));
          }
          continue;
        }
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= chunkLimit) {
          current = candidate;
        } else {
          if (current) chunks.push(current);
          current = word;
        }
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= chunkLimit) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = 0; i < length && start + i < bytes.length; i++) {
    out += String.fromCharCode(bytes[start + i]);
  }
  return out;
}

function extractWavPcmAndFormat(wav: Uint8Array): {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  pcm: Uint8Array;
} {
  if (wav.length < 44 || readAscii(wav, 0, 4) !== 'RIFF' || readAscii(wav, 8, 4) !== 'WAVE') {
    throw new Error('Invalid WAV audio buffer');
  }

  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let pcm: Uint8Array | null = null;

  while (offset + 8 <= wav.length) {
    const chunkId = readAscii(wav, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadStart = offset + 8;

    if (chunkId === 'fmt ' && payloadStart + 16 <= wav.length) {
      audioFormat = view.getUint16(payloadStart, true);
      numChannels = view.getUint16(payloadStart + 2, true);
      sampleRate = view.getUint32(payloadStart + 4, true);
      bitsPerSample = view.getUint16(payloadStart + 14, true);
    } else if (chunkId === 'data') {
      const end = Math.min(wav.length, payloadStart + chunkSize);
      pcm = wav.subarray(payloadStart, end);
      break;
    }

    offset = payloadStart + chunkSize + (chunkSize % 2);
  }

  if (!pcm) {
    pcm = wav.subarray(44);
  }

  return { audioFormat, numChannels, sampleRate, bitsPerSample, pcm };
}

export function stitchWavClips(clips: Uint8Array[]): Uint8Array {
  if (clips.length === 0) {
    throw new Error('No WAV clips to stitch.');
  }
  if (clips.length === 1) {
    return clips[0];
  }

  const parsed = clips.map(extractWavPcmAndFormat);
  const first = parsed[0];
  const totalPcmBytes = parsed.reduce((sum, clip) => sum + clip.pcm.byteLength, 0);

  const output = new Uint8Array(44 + totalPcmBytes);
  const view = new DataView(output.buffer);

  // RIFF header
  output.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + totalPcmBytes, true);
  output.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

  // fmt subchunk
  output.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, first.audioFormat, true);
  view.setUint16(22, first.numChannels, true);
  view.setUint32(24, first.sampleRate, true);
  const byteRate = (first.sampleRate * first.numChannels * first.bitsPerSample) / 8;
  const blockAlign = (first.numChannels * first.bitsPerSample) / 8;
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, first.bitsPerSample, true);

  // data subchunk
  output.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, totalPcmBytes, true);

  let writeOffset = 44;
  for (const clip of parsed) {
    output.set(clip.pcm, writeOffset);
    writeOffset += clip.pcm.byteLength;
  }

  return output;
}

export function buildCacheKey(namespace: string, parts: string[]): string {
  const joined = `${namespace}::${parts.join('::')}`;
  let hash = 2166136261;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${namespace}:${joined.length}:${(hash >>> 0).toString(16)}`;
}
