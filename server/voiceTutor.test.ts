import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AppDatabase } from './db';
import {
  buildSectionsFromExplanation,
  createAudioAccessToken,
  formatExplanationTranscript,
  normalizeTutorLevel,
  normalizeTutorSourceType,
  resolveTutorLanguage,
  splitSpokenScriptForAudio,
  verifyAudioAccessToken,
  type VoiceTutorExplanationPayload,
} from './voiceTutor';

test('normalizeTutorLevel and normalizeTutorSourceType handle valid and unknown values safely', () => {
  assert.equal(normalizeTutorLevel('Beginner'), 'Beginner');
  assert.equal(normalizeTutorLevel('Intermediate'), 'Intermediate');
  assert.equal(normalizeTutorLevel('Advanced'), 'Advanced');
  assert.equal(normalizeTutorLevel('Expert'), 'Beginner');
  assert.equal(normalizeTutorLevel(undefined), 'Beginner');

  assert.equal(normalizeTutorSourceType('document'), 'document');
  assert.equal(normalizeTutorSourceType('summary'), 'summary');
  assert.equal(normalizeTutorSourceType('conversation'), 'conversation');
  assert.equal(normalizeTutorSourceType('text'), 'text');
  assert.equal(normalizeTutorSourceType('invalid'), 'topic');
});

test('resolveTutorLanguage maps language names, codes, and native names cleanly', () => {
  assert.equal(resolveTutorLanguage('Spanish').code, 'es');
  assert.equal(resolveTutorLanguage('fr').label, 'French');
  assert.equal(resolveTutorLanguage('हिन्दी').code, 'hi');
  assert.equal(resolveTutorLanguage('').code, 'en');
  assert.equal(resolveTutorLanguage('UnknownLang').code, 'en');
});

test('splitSpokenScriptForAudio divides overly long scripts into clean sentence-bounded sections', () => {
  const sentences = Array.from(
    { length: 25 },
    (_, i) => `Sentence number ${i + 1} explains how energy moves through cellular pathways clearly.`
  ).join(' ');
  const parts = splitSpokenScriptForAudio(sentences, 350);
  assert.ok(parts.length > 3);
  for (const part of parts) {
    assert.ok(part.length <= 350, `Expected <= 350 chars, got ${part.length}`);
  }
});

test('buildSectionsFromExplanation enforces max section size and generates complete transcript', () => {
  const longText = 'Photosynthesis transforms sunlight into chemical energy inside plant cells. '.repeat(25);
  const explanation: VoiceTutorExplanationPayload = {
    lessonTitle: 'How Photosynthesis Works',
    introduction: 'Welcome! Today we are exploring how plants turn sunlight into food.',
    meaningAndDefinition: 'Photosynthesis literally means making things using light.',
    stepByStepExplanation: [
      { stepTitle: 'Capturing Sunlight', explanation: longText },
      { stepTitle: 'Making Sugar', explanation: 'Carbon dioxide and water combine to build glucose.' },
    ],
    realWorldExamples: [{ title: 'Leaf in Summer', description: 'Green leaves absorb sunlight all afternoon.' }],
    analogies: [{ concept: 'Chloroplast', analogy: 'A tiny solar-powered kitchen inside every leaf cell.' }],
    importantPoints: ['Light energy becomes chemical energy.', 'Oxygen is released as a helpful byproduct.'],
    shortRecap: 'In short, sunlight + water + CO2 gives plants glucose and gives us oxygen.',
  };

  const sections = buildSectionsFromExplanation(explanation, undefined, 450);
  assert.ok(sections.length >= 4);
  for (let i = 0; i < sections.length; i++) {
    assert.equal(sections[i]!.index, i);
    assert.ok(sections[i]!.spokenScript.length <= 450);
    assert.ok(sections[i]!.wordCount > 0);
    assert.ok(sections[i]!.estimatedSeconds >= 4);
  }

  const transcript = formatExplanationTranscript(explanation);
  assert.match(transcript, /1\. Introduction/);
  assert.match(transcript, /7\. Short Recap/);
});

test('createAudioAccessToken and verifyAudioAccessToken enforce audioId, signature, and expiry', () => {
  const secret = 'test-signing-secret-123';
  const token = createAudioAccessToken('audio-1', 'user-1', secret, 600);
  const verified = verifyAudioAccessToken(token, 'audio-1', secret);
  assert.deepEqual(verified, { userId: 'user-1', audioId: 'audio-1' });

  assert.equal(verifyAudioAccessToken(token, 'audio-2', secret), null);
  assert.equal(verifyAudioAccessToken(token + 'x', 'audio-1', secret), null);

  const expired = createAudioAccessToken('audio-1', 'user-1', secret, -5);
  assert.equal(verifyAudioAccessToken(expired, 'audio-1', secret), null);
});

test('AppDatabase persists and isolates Voice Tutor sessions and section audio per user', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaa-vt-test-'));
  const db = new AppDatabase(path.join(tmpDir, 'vt.db'));
  try {
    const u1 = db.createUser({ fullName: 'Alice', email: 'alice@test.edu', passwordHash: 'h1' });
    const u2 = db.createUser({ fullName: 'Bob', email: 'bob@test.edu', passwordHash: 'h2' });

    const session = db.saveVoiceTutorSession({
      userId: u1.id,
      sourceType: 'topic',
      topic: 'Photosynthesis',
      lessonTitle: 'Photosynthesis Explained Simply',
      sourceExcerpt: 'Photosynthesis',
      learningLevel: 'Beginner',
      preferredLanguage: 'English',
      languageCode: 'en',
      voiceName: 'Kore',
      slow: false,
      explanation: {
        lessonTitle: 'Photosynthesis Explained Simply',
        introduction: 'Hello!',
        meaningAndDefinition: 'Making food from light.',
        stepByStepExplanation: [{ stepTitle: 'Step 1', explanation: 'Light hits chlorophyll.' }],
        realWorldExamples: [{ title: 'Tree leaf', description: 'Oak leaves absorb sun.' }],
        analogies: [{ concept: 'Leaf', analogy: 'Solar kitchen.' }],
        importantPoints: ['Needs water and sunlight.'],
        shortRecap: 'Plants feed themselves with light.',
      },
      sections: [
        {
          index: 0,
          title: 'Intro',
          kind: 'introduction',
          spokenScript: 'Hello! Making food from light.',
          wordCount: 5,
          estimatedSeconds: 4,
        },
      ],
    });

    const audioRef = db.saveVoiceTutorAudio({
      userId: u1.id,
      sessionId: session.id,
      sectionIndex: 0,
      languageCode: 'en',
      voiceName: 'Kore',
      slow: false,
      mimeType: 'audio/wav',
      audioBytes: new Uint8Array([82, 73, 70, 70]),
    });

    assert.equal(db.listVoiceTutorSessions(u1.id).length, 1);
    assert.equal(db.listVoiceTutorSessions(u2.id).length, 0);
    assert.equal(db.getVoiceTutorSession(u1.id, session.id)?.audioRefs.length, 1);
    assert.equal(db.getVoiceTutorAudio(u2.id, audioRef.audioId), null);
    assert.ok(db.getVoiceTutorAudio(u1.id, audioRef.audioId));

    const foundCached = db.findVoiceTutorAudioBySection({
      userId: u1.id,
      sessionId: session.id,
      sectionIndex: 0,
      languageCode: 'en',
      voiceName: 'Kore',
      slow: false,
    });
    assert.equal(foundCached?.audioId, audioRef.audioId);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
