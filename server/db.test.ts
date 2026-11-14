import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AppDatabase } from './db';

test('AppDatabase enforces per-user isolation across documents, chats, and learning results', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaa-db-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new AppDatabase(dbPath);

  try {
    const alice = db.createUser({
      fullName: 'Alice Student',
      email: 'alice@study.edu',
      passwordHash: 'scrypt$abc$def',
    });
    const bob = db.createUser({
      fullName: 'Bob Learner',
      email: 'bob@study.edu',
      passwordHash: 'scrypt$ghi$jkl',
    });

    const doc = db.createDocument({
      userId: alice.id,
      originalFilename: 'cell_biology.txt',
      fileType: 'TXT',
      mimeType: 'text/plain',
      wordCount: 14,
      pageCount: 1,
      pagesWithText: 1,
      ocrWarning: null,
      extractedText: 'Photosynthesis converts light energy into chemical energy inside chloroplasts.',
      fileContent: Buffer.from('Photosynthesis converts light energy into chemical energy inside chloroplasts.'),
    });

    assert.equal(db.listDocuments(alice.id).length, 1);
    assert.equal(db.listDocuments(bob.id).length, 0);
    assert.equal(db.getDocument(bob.id, doc.id), null);
    assert.equal(db.deleteDocument(bob.id, doc.id), false);

    const chat = db.createConversation({ userId: alice.id, documentId: doc.id });
    assert.equal(chat.title, 'New Chat');

    const turn = db.appendChatTurn({
      userId: alice.id,
      conversationId: chat.id,
      userQuestion: 'Where does photosynthesis occur?',
      assistantAnswer: 'Inside chloroplasts.',
      foundInMaterial: true,
      examples: ['Like solar panels on a roof.'],
      supportingQuote: 'inside chloroplasts',
      newTitle: 'Where does photosynthesis occur?',
      documentId: doc.id,
    });
    assert.ok(turn);
    assert.equal(turn.conversation.title, 'Where does photosynthesis occur?');
    assert.equal(db.getConversation(alice.id, chat.id)?.messages.length, 2);
    assert.equal(db.getConversation(bob.id, chat.id), null);
    assert.equal(db.deleteConversation(bob.id, chat.id), false);

    const saved = db.createLearningResult({
      userId: alice.id,
      documentId: doc.id,
      resultType: 'summary',
      title: 'Summary · Medium · Photosynthesis',
      summaryLength: 'Medium',
      sourceExcerpt: 'Photosynthesis converts light energy...',
      contentText: 'Plants convert sunlight into chemical energy.',
      keywords: ['chloroplasts', 'glucose'],
      bulletPoints: ['Converts light energy into chemical energy.'],
      concepts: [{ term: 'Chloroplast', definition: 'Cell organelle where photosynthesis takes place.' }],
    });

    assert.equal(db.listLearningResults(alice.id).length, 1);
    assert.equal(db.listLearningResults(alice.id, { query: 'chloroplasts' }).length, 1);
    assert.equal(db.listLearningResults(bob.id).length, 0);
    assert.equal(db.deleteLearningResult(bob.id, saved.id), false);

    const videoBatch = db.saveVideoRecommendation({
      userId: alice.id,
      conversationId: chat.id,
      documentId: doc.id,
      sourceType: 'assistant',
      topic: 'Photosynthesis & Chloroplasts',
      searchQuery: 'photosynthesis chloroplasts beginner tutorial',
      learningLevel: 'Beginner',
      preferredLanguage: 'English',
      keywords: ['photosynthesis', 'chloroplasts'],
      videos: [
        {
          videoId: 'edu123',
          title: 'Photosynthesis Explained',
          thumbnailUrl: 'https://i.ytimg.com/vi/edu123/hqdefault.jpg',
          channelName: 'Amoeba Sisters',
          videoUrl: 'https://www.youtube.com/watch?v=edu123',
          duration: '8:14',
          recommendationReason: 'Clear beginner animation of photosynthesis inside chloroplasts.',
        },
      ],
    });
    assert.equal(db.listVideoRecommendations(alice.id).length, 1);
    assert.equal(db.listVideoRecommendations(alice.id, { query: 'chloroplasts' }).length, 1);
    assert.equal(db.listVideoRecommendations(bob.id).length, 0);
    assert.equal(db.getConversation(alice.id, chat.id)?.recommendations.length, 1);
    assert.equal(db.deleteVideoRecommendation(bob.id, videoBatch.id), false);

    assert.equal(db.deleteLearningResult(alice.id, saved.id), true);
    assert.equal(db.deleteConversation(alice.id, chat.id), true);
    // Cascading conversation deletion removes conversation-linked recommendations cleanly
    assert.equal(db.listVideoRecommendations(alice.id).length, 0);
    assert.equal(db.deleteDocument(alice.id, doc.id), true);
    assert.equal(db.listDocuments(alice.id).length, 0);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AppDatabase safeJsonArrayParse recovers cleanly when videos_json or keywords_json is null or non-array', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slaa-db-corrupt-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new AppDatabase(dbPath);

  try {
    const alice = db.createUser({
      fullName: 'Alice Student',
      email: 'alice-corrupt@study.edu',
      passwordHash: 'scrypt$abc$def',
    });

    const batch = db.saveVideoRecommendation({
      userId: alice.id,
      sourceType: 'custom',
      topic: 'Photosynthesis',
      searchQuery: 'photosynthesis tutorial',
      learningLevel: 'Beginner',
      preferredLanguage: 'English',
      keywords: ['photosynthesis'],
      videos: [],
    });

    // Simulate corrupted/legacy non-array JSON strings directly in SQLite
    const internalDb = (db as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
    internalDb
      .prepare(`UPDATE video_recommendations SET videos_json = 'null', keywords_json = '{"bad":true}' WHERE id = ?`)
      .run(batch.id);

    const rows = db.listVideoRecommendations(alice.id);
    assert.equal(rows.length, 1);
    assert.ok(Array.isArray(rows[0].videos));
    assert.equal(rows[0].videos.length, 0);
    assert.ok(Array.isArray(rows[0].keywords));
    assert.equal(rows[0].keywords.length, 0);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
