import crypto from 'crypto';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';

export interface DbUser {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
}

export interface DbDocumentSummary {
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

export interface DbDocumentDetail extends DbDocumentSummary {
  text: string;
}

export interface DbConversationSummary {
  id: string;
  title: string;
  documentId: string | null;
  documentName: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DbChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  foundInMaterial: boolean;
  examples: string[];
  supportingQuote: string;
  createdAt: string;
}

import type { RecommendedVideo } from './youtube';
import type {
  VoiceTutorExplanationPayload,
  VoiceTutorSection,
} from './voiceTutor';

export interface DbVoiceTutorAudioRef {
  sectionIndex: number;
  audioId: string;
  mimeType: string;
  languageCode: string;
  voiceName: string;
  slow: boolean;
}

export interface DbVoiceTutorSession {
  id: string;
  documentId: string | null;
  conversationId: string | null;
  sourceType: string;
  topic: string;
  lessonTitle: string;
  sourceExcerpt: string;
  learningLevel: string;
  preferredLanguage: string;
  languageCode: string;
  voiceName: string;
  slow: boolean;
  explanation: VoiceTutorExplanationPayload;
  sections: VoiceTutorSection[];
  audioRefs: DbVoiceTutorAudioRef[];
  createdAt: string;
}

export interface DbVideoRecommendation {
  id: string;
  conversationId: string | null;
  documentId: string | null;
  sourceType: string;
  topic: string;
  searchQuery: string;
  learningLevel: string;
  preferredLanguage: string;
  keywords: string[];
  videos: RecommendedVideo[];
  createdAt: string;
}

export interface DbConversationDetail {
  id: string;
  title: string;
  documentId: string | null;
  document: DbDocumentDetail | null;
  messages: DbChatMessage[];
  recommendations: DbVideoRecommendation[];
  createdAt: string;
  updatedAt: string;
}

export interface DbLearningResult {
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
  concepts: { term: string; explanation?: string; definition?: string }[];
  examples: string[];
  createdAt: string;
}

function safeJsonArrayParse<T>(raw: unknown, fallback: T[]): T[] {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function safeJsonObjectParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
}

export class AppDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        original_filename TEXT NOT NULL,
        file_type TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        word_count INTEGER NOT NULL,
        page_count INTEGER NOT NULL,
        pages_with_text INTEGER NOT NULL,
        ocr_warning TEXT,
        extracted_text TEXT NOT NULL,
        file_content BLOB NOT NULL,
        processing_status TEXT NOT NULL DEFAULT 'ready',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_documents_user_created
        ON documents(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
        ON conversations(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        found_in_material INTEGER NOT NULL DEFAULT 1,
        examples_json TEXT NOT NULL DEFAULT '[]',
        supporting_quote TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
        ON messages(conversation_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS learning_results (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
        result_type TEXT NOT NULL,
        title TEXT NOT NULL,
        reading_level TEXT,
        summary_length TEXT,
        source_excerpt TEXT NOT NULL DEFAULT '',
        content_text TEXT NOT NULL,
        keywords_json TEXT NOT NULL DEFAULT '[]',
        bullet_points_json TEXT NOT NULL DEFAULT '[]',
        concepts_json TEXT NOT NULL DEFAULT '[]',
        examples_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_learning_results_user_created
        ON learning_results(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS video_recommendations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
        source_type TEXT NOT NULL DEFAULT 'text',
        topic TEXT NOT NULL,
        search_query TEXT NOT NULL,
        learning_level TEXT NOT NULL DEFAULT 'Beginner',
        preferred_language TEXT NOT NULL DEFAULT 'English',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        videos_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_video_recs_user_created
        ON video_recommendations(user_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_video_recs_conversation_created
        ON video_recommendations(conversation_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS voice_tutor_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        source_type TEXT NOT NULL DEFAULT 'topic',
        topic TEXT NOT NULL,
        lesson_title TEXT NOT NULL,
        source_excerpt TEXT NOT NULL DEFAULT '',
        learning_level TEXT NOT NULL DEFAULT 'Beginner',
        preferred_language TEXT NOT NULL DEFAULT 'English',
        language_code TEXT NOT NULL DEFAULT 'en',
        voice_name TEXT NOT NULL DEFAULT 'Kore',
        slow INTEGER NOT NULL DEFAULT 0,
        explanation_json TEXT NOT NULL DEFAULT '{}',
        sections_json TEXT NOT NULL DEFAULT '[]',
        audio_refs_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_voice_tutor_user_created
        ON voice_tutor_sessions(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS voice_tutor_audio (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES voice_tutor_sessions(id) ON DELETE CASCADE,
        section_index INTEGER NOT NULL DEFAULT 0,
        language_code TEXT NOT NULL DEFAULT 'en',
        voice_name TEXT NOT NULL DEFAULT 'Kore',
        slow INTEGER NOT NULL DEFAULT 0,
        mime_type TEXT NOT NULL DEFAULT 'audio/wav',
        audio_bytes BLOB NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_voice_tutor_audio_session
        ON voice_tutor_audio(session_id, section_index);
    `);
  }

  close(): void {
    this.db.close();
  }

  createUser(params: { fullName: string; email: string; passwordHash: string }): DbUser {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, full_name, email, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, params.fullName, params.email, params.passwordHash, createdAt);

    return { id, fullName: params.fullName, email: params.email, createdAt };
  }

  findUserByEmail(email: string): (DbUser & { passwordHash: string }) | null {
    const row = this.db
      .prepare(
        `SELECT id, full_name, email, password_hash, created_at
         FROM users WHERE email = ?`
      )
      .get(email) as
      | {
          id: string;
          full_name: string;
          email: string;
          password_hash: string;
          created_at: string;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    };
  }

  findUserById(userId: string): DbUser | null {
    const row = this.db
      .prepare(`SELECT id, full_name, email, created_at FROM users WHERE id = ?`)
      .get(userId) as
      | { id: string; full_name: string; email: string; created_at: string }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      createdAt: row.created_at,
    };
  }

  createDocument(params: {
    userId: string;
    originalFilename: string;
    fileType: 'PDF' | 'TXT';
    mimeType: string;
    wordCount: number;
    pageCount: number;
    pagesWithText: number;
    ocrWarning: string | null;
    extractedText: string;
    fileContent: Uint8Array;
  }): DbDocumentDetail {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO documents (
          id, user_id, original_filename, file_type, mime_type,
          word_count, page_count, pages_with_text, ocr_warning,
          extracted_text, file_content, processing_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`
      )
      .run(
        id,
        params.userId,
        params.originalFilename,
        params.fileType,
        params.mimeType,
        params.wordCount,
        params.pageCount,
        params.pagesWithText,
        params.ocrWarning,
        params.extractedText,
        params.fileContent,
        createdAt
      );

    return {
      id,
      filename: params.originalFilename,
      originalFilename: params.originalFilename,
      fileType: params.fileType,
      mimeType: params.mimeType,
      wordCount: params.wordCount,
      pageCount: params.pageCount,
      pagesWithText: params.pagesWithText,
      ocrWarning: params.ocrWarning,
      processingStatus: 'ready',
      text: params.extractedText,
      createdAt,
    };
  }

  listDocuments(userId: string, query?: string): DbDocumentSummary[] {
    const q = query?.trim();
    const rows = (
      q
        ? this.db
            .prepare(
              `SELECT id, original_filename, file_type, mime_type, word_count,
                      page_count, pages_with_text, ocr_warning, processing_status, created_at
               FROM documents
               WHERE user_id = ? AND (
                 original_filename LIKE ? ESCAPE '\\' OR
                 extracted_text LIKE ? ESCAPE '\\'
               )
               ORDER BY created_at DESC`
            )
            .all(userId, `%${escapeLike(q)}%`, `%${escapeLike(q)}%`)
        : this.db
            .prepare(
              `SELECT id, original_filename, file_type, mime_type, word_count,
                      page_count, pages_with_text, ocr_warning, processing_status, created_at
               FROM documents
               WHERE user_id = ?
               ORDER BY created_at DESC`
            )
            .all(userId)
    ) as {
      id: string;
      original_filename: string;
      file_type: 'PDF' | 'TXT';
      mime_type: string;
      word_count: number;
      page_count: number;
      pages_with_text: number;
      ocr_warning: string | null;
      processing_status: string;
      created_at: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      filename: row.original_filename,
      originalFilename: row.original_filename,
      fileType: row.file_type,
      mimeType: row.mime_type,
      wordCount: row.word_count,
      pageCount: row.page_count,
      pagesWithText: row.pages_with_text,
      ocrWarning: row.ocr_warning,
      processingStatus: row.processing_status,
      createdAt: row.created_at,
    }));
  }

  getDocument(userId: string, documentId: string): DbDocumentDetail | null {
    const row = this.db
      .prepare(
        `SELECT id, original_filename, file_type, mime_type, word_count,
                page_count, pages_with_text, ocr_warning, extracted_text,
                processing_status, created_at
         FROM documents
         WHERE id = ? AND user_id = ?`
      )
      .get(documentId, userId) as
      | {
          id: string;
          original_filename: string;
          file_type: 'PDF' | 'TXT';
          mime_type: string;
          word_count: number;
          page_count: number;
          pages_with_text: number;
          ocr_warning: string | null;
          extracted_text: string;
          processing_status: string;
          created_at: string;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      filename: row.original_filename,
      originalFilename: row.original_filename,
      fileType: row.file_type,
      mimeType: row.mime_type,
      wordCount: row.word_count,
      pageCount: row.page_count,
      pagesWithText: row.pages_with_text,
      ocrWarning: row.ocr_warning,
      processingStatus: row.processing_status,
      text: row.extracted_text,
      createdAt: row.created_at,
    };
  }

  getDocumentBinary(
    userId: string,
    documentId: string
  ): { filename: string; mimeType: string; content: Uint8Array } | null {
    const row = this.db
      .prepare(
        `SELECT original_filename, mime_type, file_content
         FROM documents WHERE id = ? AND user_id = ?`
      )
      .get(documentId, userId) as
      | { original_filename: string; mime_type: string; file_content: Uint8Array }
      | undefined;

    if (!row) return null;
    return {
      filename: row.original_filename,
      mimeType: row.mime_type,
      content: row.file_content,
    };
  }

  deleteDocument(userId: string, documentId: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM documents WHERE id = ? AND user_id = ?`)
      .run(documentId, userId);
    return info.changes > 0;
  }

  createConversation(params: {
    userId: string;
    title?: string;
    documentId?: string | null;
  }): DbConversationDetail {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    let linkedDoc: DbDocumentDetail | null = null;
    if (params.documentId) {
      linkedDoc = this.getDocument(params.userId, params.documentId);
    }

    const title = params.title?.trim() || 'New Chat';
    this.db
      .prepare(
        `INSERT INTO conversations (id, user_id, document_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, params.userId, linkedDoc ? linkedDoc.id : null, title, now, now);

    return {
      id,
      title,
      documentId: linkedDoc ? linkedDoc.id : null,
      document: linkedDoc,
      messages: [],
      recommendations: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  listConversations(userId: string, query?: string): DbConversationSummary[] {
    const q = query?.trim();
    const baseSql = `
      SELECT c.id, c.title, c.document_id, c.created_at, c.updated_at,
             d.original_filename AS document_name,
             COUNT(m.id) AS message_count
      FROM conversations c
      LEFT JOIN documents d ON d.id = c.document_id
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.user_id = ?
    `;

    const rows = (
      q
        ? this.db
            .prepare(
              `${baseSql}
               AND (
                 c.title LIKE ? ESCAPE '\\' OR
                 EXISTS (
                   SELECT 1 FROM messages m2
                   WHERE m2.conversation_id = c.id AND m2.content LIKE ? ESCAPE '\\'
                 )
               )
               GROUP BY c.id
               ORDER BY c.updated_at DESC`
            )
            .all(userId, `%${escapeLike(q)}%`, `%${escapeLike(q)}%`)
        : this.db
            .prepare(
              `${baseSql}
               GROUP BY c.id
               ORDER BY c.updated_at DESC`
            )
            .all(userId)
    ) as {
      id: string;
      title: string;
      document_id: string | null;
      created_at: string;
      updated_at: string;
      document_name: string | null;
      message_count: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      documentId: row.document_id,
      documentName: row.document_name,
      messageCount: Number(row.message_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getConversation(userId: string, conversationId: string): DbConversationDetail | null {
    const row = this.db
      .prepare(
        `SELECT id, title, document_id, created_at, updated_at
         FROM conversations WHERE id = ? AND user_id = ?`
      )
      .get(conversationId, userId) as
      | {
          id: string;
          title: string;
          document_id: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;
    const document = row.document_id ? this.getDocument(userId, row.document_id) : null;
    const messageRows = this.db
      .prepare(
        `SELECT id, role, content, found_in_material, examples_json, supporting_quote, created_at
         FROM messages WHERE conversation_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(conversationId) as {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      found_in_material: number;
      examples_json: string;
      supporting_quote: string;
      created_at: string;
    }[];

    const recommendations = this.listVideoRecommendations(userId, { conversationId });

    return {
      id: row.id,
      title: row.title,
      documentId: row.document_id,
      document,
      messages: messageRows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        foundInMaterial: Boolean(m.found_in_material),
        examples: safeJsonArrayParse<string>(m.examples_json, []),
        supportingQuote: m.supporting_quote || '',
        createdAt: m.created_at,
      })),
      recommendations,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateConversation(
    userId: string,
    conversationId: string,
    updates: { title?: string; documentId?: string | null }
  ): DbConversationSummary | null {
    const existing = this.db
      .prepare(`SELECT id, title, document_id FROM conversations WHERE id = ? AND user_id = ?`)
      .get(conversationId, userId) as
      | { id: string; title: string; document_id: string | null }
      | undefined;

    if (!existing) return null;

    const nextTitle = updates.title?.trim() || existing.title;
    let nextDocId = existing.document_id;
    if (updates.documentId !== undefined) {
      if (updates.documentId === null) {
        nextDocId = null;
      } else {
        const doc = this.getDocument(userId, updates.documentId);
        if (doc) nextDocId = doc.id;
      }
    }

    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE conversations SET title = ?, document_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(nextTitle, nextDocId, updatedAt, conversationId, userId);

    const summaries = this.listConversations(userId);
    return summaries.find((c) => c.id === conversationId) ?? null;
  }

  appendChatTurn(params: {
    userId: string;
    conversationId: string;
    userQuestion: string;
    assistantAnswer: string;
    foundInMaterial: boolean;
    examples: string[];
    supportingQuote: string;
    newTitle?: string;
    documentId?: string | null;
  }): {
    conversation: DbConversationSummary;
    userMessage: DbChatMessage;
    assistantMessage: DbChatMessage;
  } | null {
    const conv = this.db
      .prepare(`SELECT id, title, document_id FROM conversations WHERE id = ? AND user_id = ?`)
      .get(params.conversationId, params.userId) as
      | { id: string; title: string; document_id: string | null }
      | undefined;

    if (!conv) return null;

    const userCreatedAt = new Date().toISOString();
    const assistantCreatedAt = new Date(Date.now() + 1).toISOString();
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();

    const nextTitle =
      conv.title === 'New Chat' && params.newTitle?.trim()
        ? params.newTitle.trim()
        : conv.title;

    let nextDocId = conv.document_id;
    if (!nextDocId && params.documentId) {
      const owned = this.getDocument(params.userId, params.documentId);
      if (owned) nextDocId = owned.id;
    }

    this.db
      .prepare(
        `INSERT INTO messages (
          id, conversation_id, role, content, found_in_material, examples_json, supporting_quote, created_at
        ) VALUES (?, ?, 'user', ?, 1, '[]', '', ?)`
      )
      .run(userMessageId, params.conversationId, params.userQuestion, userCreatedAt);

    this.db
      .prepare(
        `INSERT INTO messages (
          id, conversation_id, role, content, found_in_material, examples_json, supporting_quote, created_at
        ) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`
      )
      .run(
        assistantMessageId,
        params.conversationId,
        params.assistantAnswer,
        params.foundInMaterial ? 1 : 0,
        JSON.stringify(params.examples),
        params.supportingQuote,
        assistantCreatedAt
      );

    this.db
      .prepare(
        `UPDATE conversations SET title = ?, document_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(nextTitle, nextDocId, assistantCreatedAt, params.conversationId, params.userId);

    const summary = this.listConversations(params.userId).find(
      (c) => c.id === params.conversationId
    )!;

    return {
      conversation: summary,
      userMessage: {
        id: userMessageId,
        role: 'user',
        content: params.userQuestion,
        foundInMaterial: true,
        examples: [],
        supportingQuote: '',
        createdAt: userCreatedAt,
      },
      assistantMessage: {
        id: assistantMessageId,
        role: 'assistant',
        content: params.assistantAnswer,
        foundInMaterial: params.foundInMaterial,
        examples: params.examples,
        supportingQuote: params.supportingQuote,
        createdAt: assistantCreatedAt,
      },
    };
  }

  deleteConversation(userId: string, conversationId: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM conversations WHERE id = ? AND user_id = ?`)
      .run(conversationId, userId);
    return info.changes > 0;
  }

  createLearningResult(params: {
    userId: string;
    documentId?: string | null;
    resultType: 'simplified' | 'summary' | 'explanation';
    title: string;
    readingLevel?: string | null;
    summaryLength?: string | null;
    sourceExcerpt?: string;
    contentText: string;
    keywords?: string[];
    bulletPoints?: string[];
    concepts?: { term: string; explanation?: string; definition?: string }[];
    examples?: string[];
  }): DbLearningResult {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    let ownedDocId: string | null = null;
    if (params.documentId) {
      const doc = this.getDocument(params.userId, params.documentId);
      if (doc) ownedDocId = doc.id;
    }

    const keywords = params.keywords ?? [];
    const bulletPoints = params.bulletPoints ?? [];
    const concepts = params.concepts ?? [];
    const examples = params.examples ?? [];

    this.db
      .prepare(
        `INSERT INTO learning_results (
          id, user_id, document_id, result_type, title, reading_level, summary_length,
          source_excerpt, content_text, keywords_json, bullet_points_json, concepts_json,
          examples_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.userId,
        ownedDocId,
        params.resultType,
        params.title,
        params.readingLevel ?? null,
        params.summaryLength ?? null,
        params.sourceExcerpt ?? '',
        params.contentText,
        JSON.stringify(keywords),
        JSON.stringify(bulletPoints),
        JSON.stringify(concepts),
        JSON.stringify(examples),
        createdAt
      );

    return {
      id,
      documentId: ownedDocId,
      resultType: params.resultType,
      title: params.title,
      readingLevel: params.readingLevel ?? null,
      summaryLength: params.summaryLength ?? null,
      sourceExcerpt: params.sourceExcerpt ?? '',
      contentText: params.contentText,
      keywords,
      bulletPoints,
      concepts,
      examples,
      createdAt,
    };
  }

  listLearningResults(
    userId: string,
    opts?: { resultType?: string; query?: string }
  ): DbLearningResult[] {
    const conditions: string[] = ['user_id = ?'];
    const args: (string | number)[] = [userId];

    if (
      opts?.resultType &&
      ['simplified', 'summary', 'explanation'].includes(opts.resultType)
    ) {
      conditions.push('result_type = ?');
      args.push(opts.resultType);
    }

    if (opts?.query?.trim()) {
      const pattern = `%${escapeLike(opts.query.trim())}%`;
      conditions.push(
        `(title LIKE ? ESCAPE '\\' OR content_text LIKE ? ESCAPE '\\' OR keywords_json LIKE ? ESCAPE '\\' OR source_excerpt LIKE ? ESCAPE '\\')`
      );
      args.push(pattern, pattern, pattern, pattern);
    }

    const rows = this.db
      .prepare(
        `SELECT id, document_id, result_type, title, reading_level, summary_length,
                source_excerpt, content_text, keywords_json, bullet_points_json,
                concepts_json, examples_json, created_at
         FROM learning_results
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC`
      )
      .all(...args) as {
      id: string;
      document_id: string | null;
      result_type: 'simplified' | 'summary' | 'explanation';
      title: string;
      reading_level: string | null;
      summary_length: string | null;
      source_excerpt: string;
      content_text: string;
      keywords_json: string;
      bullet_points_json: string;
      concepts_json: string;
      examples_json: string;
      created_at: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      resultType: row.result_type,
      title: row.title,
      readingLevel: row.reading_level,
      summaryLength: row.summary_length,
      sourceExcerpt: row.source_excerpt,
      contentText: row.content_text,
      keywords: safeJsonArrayParse<string>(row.keywords_json, []),
      bulletPoints: safeJsonArrayParse<string>(row.bullet_points_json, []),
      concepts: safeJsonArrayParse<{
        term: string;
        explanation?: string;
        definition?: string;
      }>(row.concepts_json, []),
      examples: safeJsonArrayParse<string>(row.examples_json, []),
      createdAt: row.created_at,
    }));
  }

  deleteLearningResult(userId: string, resultId: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM learning_results WHERE id = ? AND user_id = ?`)
      .run(resultId, userId);
    return info.changes > 0;
  }

  saveVideoRecommendation(params: {
    userId: string;
    conversationId?: string | null;
    documentId?: string | null;
    sourceType: string;
    topic: string;
    searchQuery: string;
    learningLevel: string;
    preferredLanguage: string;
    keywords: string[];
    videos: RecommendedVideo[];
  }): DbVideoRecommendation {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    let ownedDocId: string | null = null;
    if (params.documentId) {
      const doc = this.getDocument(params.userId, params.documentId);
      if (doc) ownedDocId = doc.id;
    }

    let ownedConvId: string | null = null;
    if (params.conversationId) {
      const convRow = this.db
        .prepare(`SELECT id FROM conversations WHERE id = ? AND user_id = ?`)
        .get(params.conversationId, params.userId) as { id: string } | undefined;
      if (convRow) ownedConvId = convRow.id;
    }

    this.db
      .prepare(
        `INSERT INTO video_recommendations (
          id, user_id, conversation_id, document_id, source_type, topic, search_query,
          learning_level, preferred_language, keywords_json, videos_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.userId,
        ownedConvId,
        ownedDocId,
        params.sourceType,
        params.topic,
        params.searchQuery,
        params.learningLevel,
        params.preferredLanguage,
        JSON.stringify(params.keywords ?? []),
        JSON.stringify(params.videos ?? []),
        createdAt
      );

    return {
      id,
      conversationId: ownedConvId,
      documentId: ownedDocId,
      sourceType: params.sourceType,
      topic: params.topic,
      searchQuery: params.searchQuery,
      learningLevel: params.learningLevel,
      preferredLanguage: params.preferredLanguage,
      keywords: params.keywords ?? [],
      videos: params.videos ?? [],
      createdAt,
    };
  }

  listVideoRecommendations(
    userId: string,
    opts?: { conversationId?: string; query?: string }
  ): DbVideoRecommendation[] {
    const conditions: string[] = ['user_id = ?'];
    const args: (string | number)[] = [userId];

    if (opts?.conversationId) {
      conditions.push('conversation_id = ?');
      args.push(opts.conversationId);
    }

    if (opts?.query?.trim()) {
      const pattern = `%${escapeLike(opts.query.trim())}%`;
      conditions.push(
        `(topic LIKE ? ESCAPE '\\' OR search_query LIKE ? ESCAPE '\\' OR keywords_json LIKE ? ESCAPE '\\' OR videos_json LIKE ? ESCAPE '\\')`
      );
      args.push(pattern, pattern, pattern, pattern);
    }

    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, document_id, source_type, topic, search_query,
                learning_level, preferred_language, keywords_json, videos_json, created_at
         FROM video_recommendations
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC`
      )
      .all(...args) as {
      id: string;
      conversation_id: string | null;
      document_id: string | null;
      source_type: string;
      topic: string;
      search_query: string;
      learning_level: string;
      preferred_language: string;
      keywords_json: string;
      videos_json: string;
      created_at: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      documentId: row.document_id,
      sourceType: row.source_type,
      topic: row.topic,
      searchQuery: row.search_query,
      learningLevel: row.learning_level,
      preferredLanguage: row.preferred_language,
      keywords: safeJsonArrayParse<string>(row.keywords_json, []),
      videos: safeJsonArrayParse<RecommendedVideo>(row.videos_json, []),
      createdAt: row.created_at,
    }));
  }

  deleteVideoRecommendation(userId: string, recommendationId: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM video_recommendations WHERE id = ? AND user_id = ?`)
      .run(recommendationId, userId);
    return info.changes > 0;
  }

  saveVoiceTutorSession(params: {
    userId: string;
    documentId?: string | null;
    conversationId?: string | null;
    sourceType: string;
    topic: string;
    lessonTitle: string;
    sourceExcerpt: string;
    learningLevel: string;
    preferredLanguage: string;
    languageCode: string;
    voiceName: string;
    slow: boolean;
    explanation: VoiceTutorExplanationPayload;
    sections: VoiceTutorSection[];
    audioRefs?: DbVoiceTutorAudioRef[];
  }): DbVoiceTutorSession {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    let ownedDocId: string | null = null;
    if (params.documentId) {
      const doc = this.getDocument(params.userId, params.documentId);
      if (doc) ownedDocId = doc.id;
    }

    let ownedConvId: string | null = null;
    if (params.conversationId) {
      const convRow = this.db
        .prepare(`SELECT id FROM conversations WHERE id = ? AND user_id = ?`)
        .get(params.conversationId, params.userId) as { id: string } | undefined;
      if (convRow) ownedConvId = convRow.id;
    }

    const audioRefs = params.audioRefs ?? [];

    this.db
      .prepare(
        `INSERT INTO voice_tutor_sessions (
          id, user_id, document_id, conversation_id, source_type, topic, lesson_title,
          source_excerpt, learning_level, preferred_language, language_code, voice_name, slow,
          explanation_json, sections_json, audio_refs_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.userId,
        ownedDocId,
        ownedConvId,
        params.sourceType,
        params.topic,
        params.lessonTitle,
        params.sourceExcerpt.slice(0, 600),
        params.learningLevel,
        params.preferredLanguage,
        params.languageCode,
        params.voiceName,
        params.slow ? 1 : 0,
        JSON.stringify(params.explanation),
        JSON.stringify(params.sections),
        JSON.stringify(audioRefs),
        createdAt
      );

    return {
      id,
      documentId: ownedDocId,
      conversationId: ownedConvId,
      sourceType: params.sourceType,
      topic: params.topic,
      lessonTitle: params.lessonTitle,
      sourceExcerpt: params.sourceExcerpt.slice(0, 600),
      learningLevel: params.learningLevel,
      preferredLanguage: params.preferredLanguage,
      languageCode: params.languageCode,
      voiceName: params.voiceName,
      slow: Boolean(params.slow),
      explanation: params.explanation,
      sections: params.sections,
      audioRefs,
      createdAt,
    };
  }

  private mapVoiceTutorRow(row: {
    id: string;
    document_id: string | null;
    conversation_id: string | null;
    source_type: string;
    topic: string;
    lesson_title: string;
    source_excerpt: string;
    learning_level: string;
    preferred_language: string;
    language_code: string;
    voice_name: string;
    slow: number;
    explanation_json: string;
    sections_json: string;
    audio_refs_json: string;
    created_at: string;
  }): DbVoiceTutorSession {
    const emptyExplanation: VoiceTutorExplanationPayload = {
      lessonTitle: row.lesson_title,
      introduction: '',
      meaningAndDefinition: '',
      stepByStepExplanation: [],
      realWorldExamples: [],
      analogies: [],
      importantPoints: [],
      shortRecap: '',
    };
    return {
      id: row.id,
      documentId: row.document_id,
      conversationId: row.conversation_id,
      sourceType: row.source_type,
      topic: row.topic,
      lessonTitle: row.lesson_title,
      sourceExcerpt: row.source_excerpt,
      learningLevel: row.learning_level,
      preferredLanguage: row.preferred_language,
      languageCode: row.language_code,
      voiceName: row.voice_name,
      slow: Boolean(row.slow),
      explanation: safeJsonObjectParse<VoiceTutorExplanationPayload>(
        row.explanation_json,
        emptyExplanation
      ),
      sections: safeJsonArrayParse<VoiceTutorSection>(row.sections_json, []),
      audioRefs: safeJsonArrayParse<DbVoiceTutorAudioRef>(row.audio_refs_json, []),
      createdAt: row.created_at,
    };
  }

  listVoiceTutorSessions(
    userId: string,
    opts?: { query?: string }
  ): DbVoiceTutorSession[] {
    const q = opts?.query?.trim();
    const rows = (
      q
        ? this.db
            .prepare(
              `SELECT id, document_id, conversation_id, source_type, topic, lesson_title,
                      source_excerpt, learning_level, preferred_language, language_code, voice_name,
                      slow, explanation_json, sections_json, audio_refs_json, created_at
               FROM voice_tutor_sessions
               WHERE user_id = ? AND (
                 topic LIKE ? ESCAPE '\\' OR
                 lesson_title LIKE ? ESCAPE '\\' OR
                 explanation_json LIKE ? ESCAPE '\\' OR
                 source_excerpt LIKE ? ESCAPE '\\'
               )
               ORDER BY created_at DESC`
            )
            .all(
              userId,
              `%${escapeLike(q)}%`,
              `%${escapeLike(q)}%`,
              `%${escapeLike(q)}%`,
              `%${escapeLike(q)}%`
            )
        : this.db
            .prepare(
              `SELECT id, document_id, conversation_id, source_type, topic, lesson_title,
                      source_excerpt, learning_level, preferred_language, language_code, voice_name,
                      slow, explanation_json, sections_json, audio_refs_json, created_at
               FROM voice_tutor_sessions
               WHERE user_id = ?
               ORDER BY created_at DESC`
            )
            .all(userId)
    ) as Parameters<AppDatabase['mapVoiceTutorRow']>[0][];

    return rows.map((row) => this.mapVoiceTutorRow(row));
  }

  getVoiceTutorSession(userId: string, sessionId: string): DbVoiceTutorSession | null {
    const row = this.db
      .prepare(
        `SELECT id, document_id, conversation_id, source_type, topic, lesson_title,
                source_excerpt, learning_level, preferred_language, language_code, voice_name,
                slow, explanation_json, sections_json, audio_refs_json, created_at
         FROM voice_tutor_sessions
         WHERE id = ? AND user_id = ?`
      )
      .get(sessionId, userId) as Parameters<AppDatabase['mapVoiceTutorRow']>[0] | undefined;

    return row ? this.mapVoiceTutorRow(row) : null;
  }

  deleteVoiceTutorSession(userId: string, sessionId: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM voice_tutor_sessions WHERE id = ? AND user_id = ?`)
      .run(sessionId, userId);
    return info.changes > 0;
  }

  saveVoiceTutorAudio(params: {
    userId: string;
    sessionId?: string | null;
    sectionIndex: number;
    languageCode: string;
    voiceName: string;
    slow: boolean;
    mimeType: string;
    audioBytes: Uint8Array;
  }): DbVoiceTutorAudioRef {
    const audioId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    let ownedSessionId: string | null = null;
    if (params.sessionId) {
      const sess = this.getVoiceTutorSession(params.userId, params.sessionId);
      if (sess) ownedSessionId = sess.id;
    }

    this.db
      .prepare(
        `INSERT INTO voice_tutor_audio (
          id, user_id, session_id, section_index, language_code, voice_name, slow, mime_type, audio_bytes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        audioId,
        params.userId,
        ownedSessionId,
        params.sectionIndex,
        params.languageCode,
        params.voiceName,
        params.slow ? 1 : 0,
        params.mimeType,
        params.audioBytes,
        createdAt
      );

    const ref: DbVoiceTutorAudioRef = {
      sectionIndex: params.sectionIndex,
      audioId,
      mimeType: params.mimeType,
      languageCode: params.languageCode,
      voiceName: params.voiceName,
      slow: Boolean(params.slow),
    };

    if (ownedSessionId) {
      const existing = this.getVoiceTutorSession(params.userId, ownedSessionId);
      if (existing) {
        const filtered = existing.audioRefs.filter(
          (item) =>
            !(
              item.sectionIndex === params.sectionIndex &&
              item.languageCode === params.languageCode &&
              item.voiceName === params.voiceName &&
              item.slow === Boolean(params.slow)
            )
        );
        filtered.push(ref);
        this.db
          .prepare(`UPDATE voice_tutor_sessions SET audio_refs_json = ? WHERE id = ? AND user_id = ?`)
          .run(JSON.stringify(filtered), ownedSessionId, params.userId);
      }
    }

    return ref;
  }

  findVoiceTutorAudioBySection(params: {
    userId: string;
    sessionId: string;
    sectionIndex: number;
    languageCode: string;
    voiceName: string;
    slow: boolean;
  }): DbVoiceTutorAudioRef | null {
    const row = this.db
      .prepare(
        `SELECT id, section_index, mime_type, language_code, voice_name, slow
         FROM voice_tutor_audio
         WHERE user_id = ? AND session_id = ? AND section_index = ?
           AND language_code = ? AND voice_name = ? AND slow = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(
        params.userId,
        params.sessionId,
        params.sectionIndex,
        params.languageCode,
        params.voiceName,
        params.slow ? 1 : 0
      ) as
      | {
          id: string;
          section_index: number;
          mime_type: string;
          language_code: string;
          voice_name: string;
          slow: number;
        }
      | undefined;

    if (!row) return null;
    return {
      audioId: row.id,
      sectionIndex: row.section_index,
      mimeType: row.mime_type,
      languageCode: row.language_code,
      voiceName: row.voice_name,
      slow: Boolean(row.slow),
    };
  }

  getVoiceTutorAudio(
    userId: string,
    audioId: string
  ): { id: string; mimeType: string; bytes: Uint8Array } | null {
    const row = this.db
      .prepare(
        `SELECT id, mime_type, audio_bytes
         FROM voice_tutor_audio
         WHERE id = ? AND user_id = ?`
      )
      .get(audioId, userId) as
      | { id: string; mime_type: string; audio_bytes: Uint8Array }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      mimeType: row.mime_type || 'audio/wav',
      bytes: row.audio_bytes,
    };
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
