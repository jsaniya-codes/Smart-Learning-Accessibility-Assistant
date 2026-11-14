import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCacheKey,
  clampFontSize,
  cleanPdfPageText,
  computeTextStats,
  getLineHeightValue,
  getReadingFontClass,
  prepareSpeechText,
  splitTextIntoChunks,
  stitchWavClips,
  validateSourceText,
  validateUploadFileName,
} from './textMetrics';

function makeDummyWav(pcmBytes: number[]): Uint8Array {
  const totalPcm = pcmBytes.length;
  const buf = new Uint8Array(44 + totalPcm);
  const view = new DataView(buf.buffer);
  buf.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, 36 + totalPcm, true);
  buf.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  buf.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 24000, true); // 24kHz
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  buf.set([0x64, 0x61, 0x74, 0x61], 36); // data
  view.setUint32(40, totalPcm, true);
  buf.set(pcmBytes, 44);
  return buf;
}

test('computeTextStats handles empty and populated strings', () => {
  assert.deepEqual(computeTextStats('   '), {
    words: 0,
    characters: 0,
    estimatedMinutes: 0,
  });

  const stats = computeTextStats('Photosynthesis converts light energy into chemical energy.');
  assert.equal(stats.words, 7);
  assert.equal(stats.estimatedMinutes, 1);
});

test('clampFontSize respects bounds 14px to 28px', () => {
  assert.equal(clampFontSize(8), 14);
  assert.equal(clampFontSize(40), 28);
  assert.equal(clampFontSize(20.4), 20);
  assert.equal(clampFontSize(Number.NaN), 18);
});

test('getLineHeightValue and getReadingFontClass return accessible options', () => {
  assert.equal(getLineHeightValue('standard'), 1.5);
  assert.equal(getLineHeightValue('relaxed'), 1.75);
  assert.equal(getLineHeightValue('wide'), 2.05);
  assert.equal(getReadingFontClass('sans'), 'font-reading-sans');
  assert.equal(getReadingFontClass('accessible'), 'font-reading-accessible');
  assert.equal(getReadingFontClass('dyslexia'), 'font-reading-dyslexia');
});

test('validateSourceText rejects empty or too-short text', () => {
  assert.equal(validateSourceText('').valid, false);
  assert.equal(validateSourceText('Too short').valid, false);
  assert.equal(
    validateSourceText('Cellular respiration produces ATP from glucose molecules.').valid,
    true
  );
});

test('validateUploadFileName accepts pdf and txt only', () => {
  assert.deepEqual(validateUploadFileName('lecture_notes.PDF'), {
    valid: true,
    extension: 'pdf',
  });
  assert.deepEqual(validateUploadFileName('chapter1.txt'), {
    valid: true,
    extension: 'txt',
  });
  assert.equal(validateUploadFileName('slides.docx').valid, false);
});

test('prepareSpeechText truncates cleanly at word boundary', () => {
  const longText = 'word '.repeat(50).trim();
  const result = prepareSpeechText(longText, 30);
  assert.equal(result.wasTruncated, true);
  assert.ok(result.text.endsWith('...'));
  assert.ok(result.text.length <= 33);
});

test('cleanPdfPageText preserves headings, bullets, and rejoins hyphenated wraps', () => {
  const raw = 'CHAPTER 1: CELLULAR BIOLOGY\n\nCells are the funda-\nmental units of life.\n- Eukaryotes have nuclei\n- Prokaryotes do not';
  const cleaned = cleanPdfPageText(raw);
  assert.ok(cleaned.includes('CHAPTER 1: CELLULAR BIOLOGY'));
  assert.ok(cleaned.includes('fundamental units of life.'));
  assert.ok(cleaned.includes('- Eukaryotes have nuclei'));
});

test('splitTextIntoChunks splits long text along sentence boundaries', () => {
  const longText = 'Photosynthesis converts light energy into chemical energy inside chloroplasts. '.repeat(25).trim();
  const chunks = splitTextIntoChunks(longText, 300);
  assert.ok(chunks.length > 4);
  assert.ok(chunks.every((c) => c.length <= 300));
});

test('stitchWavClips merges multiple WAV clips into one valid RIFF buffer', () => {
  const clip1 = makeDummyWav([1, 2, 3, 4]);
  const clip2 = makeDummyWav([5, 6, 7, 8, 9, 10]);
  const merged = stitchWavClips([clip1, clip2]);
  assert.equal(merged.length, 44 + 10);
  const view = new DataView(merged.buffer);
  assert.equal(view.getUint32(4, true), 36 + 10);
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(Array.from(merged.subarray(44)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('buildCacheKey produces stable distinct keys', () => {
  const k1 = buildCacheKey('simplify', ['Beginner', 'Hello world']);
  const k2 = buildCacheKey('simplify', ['Beginner', 'Hello world']);
  const k3 = buildCacheKey('simplify', ['Advanced', 'Hello world']);
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
});
