// server.ts
import express from "express";
import dotenv from "dotenv";
import path3 from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel as ThinkingLevel3, Type as Type3 } from "@google/genai";
import { extractText } from "unpdf";

// server/auth.ts
import crypto from "crypto";
import fs from "fs";
import path from "path";
var DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}
function verifyPassword(password, storedHash) {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) {
    return false;
  }
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, "hex");
    if (derived.length !== expected.length) {
      return false;
    }
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
function base64UrlEncode(input) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}
function base64UrlDecode(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}
function createJwtToken(payload, secret, ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1e3);
  const claims = {
    sub: payload.sub,
    email: payload.email,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID()
  };
  const headerEncoded = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadEncoded = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const signature = crypto.createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}
function verifyJwtToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
  if (!headerEncoded || !payloadEncoded || !signatureEncoded) return null;
  try {
    const signingInput = `${headerEncoded}.${payloadEncoded}`;
    const expectedSig = crypto.createHmac("sha256", secret).update(signingInput).digest("base64url");
    const sigBuf = Buffer.from(signatureEncoded, "utf8");
    const expectedBuf = Buffer.from(expectedSig, "utf8");
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const header = JSON.parse(base64UrlDecode(headerEncoded));
    if (header.alg !== "HS256") {
      return null;
    }
    const claims = JSON.parse(base64UrlDecode(payloadEncoded));
    const now = Math.floor(Date.now() / 1e3);
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || typeof claims.exp !== "number" || claims.exp <= now) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
function getOrInitJwtSecret(dataDir) {
  const envSecret = process.env.JWT_SECRET_KEY?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const secretPath = path.join(dataDir, ".jwt_secret");
  if (fs.existsSync(secretPath)) {
    const stored = fs.readFileSync(secretPath, "utf8").trim();
    if (stored.length >= 32) {
      return stored;
    }
  }
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretPath, generated, { mode: 384 });
  return generated;
}
function deriveChatTitle(firstQuestion) {
  const compact = firstQuestion.replace(/\s+/g, " ").trim();
  if (!compact) return "New Chat";
  if (compact.length <= 54) return compact;
  const sliced = compact.slice(0, 51);
  const lastSpace = sliced.lastIndexOf(" ");
  const cutoff = lastSpace >= 28 ? lastSpace : 51;
  return `${sliced.slice(0, cutoff).trim()}...`;
}
function sanitizeEmail(email) {
  return email.trim().toLowerCase();
}

// server/db.ts
import crypto2 from "crypto";
import fs2 from "fs";
import { DatabaseSync } from "node:sqlite";
import path2 from "path";
function safeJsonArrayParse(raw, fallback) {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}
function safeJsonObjectParse(raw, fallback) {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}
var AppDatabase = class {
  constructor(dbPath) {
    fs2.mkdirSync(path2.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initSchema();
  }
  initSchema() {
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
  close() {
    this.db.close();
  }
  createUser(params) {
    const id = crypto2.randomUUID();
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO users (id, full_name, email, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(id, params.fullName, params.email, params.passwordHash, createdAt);
    return { id, fullName: params.fullName, email: params.email, createdAt };
  }
  findUserByEmail(email) {
    const row = this.db.prepare(
      `SELECT id, full_name, email, password_hash, created_at
         FROM users WHERE email = ?`
    ).get(email);
    if (!row) return null;
    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at
    };
  }
  findUserById(userId) {
    const row = this.db.prepare(`SELECT id, full_name, email, created_at FROM users WHERE id = ?`).get(userId);
    if (!row) return null;
    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      createdAt: row.created_at
    };
  }
  createDocument(params) {
    const id = crypto2.randomUUID();
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO documents (
          id, user_id, original_filename, file_type, mime_type,
          word_count, page_count, pages_with_text, ocr_warning,
          extracted_text, file_content, processing_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`
    ).run(
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
      processingStatus: "ready",
      text: params.extractedText,
      createdAt
    };
  }
  listDocuments(userId, query) {
    const q = query?.trim();
    const rows = q ? this.db.prepare(
      `SELECT id, original_filename, file_type, mime_type, word_count,
                      page_count, pages_with_text, ocr_warning, processing_status, created_at
               FROM documents
               WHERE user_id = ? AND (
                 original_filename LIKE ? ESCAPE '\\' OR
                 extracted_text LIKE ? ESCAPE '\\'
               )
               ORDER BY created_at DESC`
    ).all(userId, `%${escapeLike(q)}%`, `%${escapeLike(q)}%`) : this.db.prepare(
      `SELECT id, original_filename, file_type, mime_type, word_count,
                      page_count, pages_with_text, ocr_warning, processing_status, created_at
               FROM documents
               WHERE user_id = ?
               ORDER BY created_at DESC`
    ).all(userId);
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
      createdAt: row.created_at
    }));
  }
  getDocument(userId, documentId) {
    const row = this.db.prepare(
      `SELECT id, original_filename, file_type, mime_type, word_count,
                page_count, pages_with_text, ocr_warning, extracted_text,
                processing_status, created_at
         FROM documents
         WHERE id = ? AND user_id = ?`
    ).get(documentId, userId);
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
      createdAt: row.created_at
    };
  }
  getDocumentBinary(userId, documentId) {
    const row = this.db.prepare(
      `SELECT original_filename, mime_type, file_content
         FROM documents WHERE id = ? AND user_id = ?`
    ).get(documentId, userId);
    if (!row) return null;
    return {
      filename: row.original_filename,
      mimeType: row.mime_type,
      content: row.file_content
    };
  }
  deleteDocument(userId, documentId) {
    const info = this.db.prepare(`DELETE FROM documents WHERE id = ? AND user_id = ?`).run(documentId, userId);
    return info.changes > 0;
  }
  createConversation(params) {
    const id = crypto2.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let linkedDoc = null;
    if (params.documentId) {
      linkedDoc = this.getDocument(params.userId, params.documentId);
    }
    const title = params.title?.trim() || "New Chat";
    this.db.prepare(
      `INSERT INTO conversations (id, user_id, document_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, params.userId, linkedDoc ? linkedDoc.id : null, title, now, now);
    return {
      id,
      title,
      documentId: linkedDoc ? linkedDoc.id : null,
      document: linkedDoc,
      messages: [],
      recommendations: [],
      createdAt: now,
      updatedAt: now
    };
  }
  listConversations(userId, query) {
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
    const rows = q ? this.db.prepare(
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
    ).all(userId, `%${escapeLike(q)}%`, `%${escapeLike(q)}%`) : this.db.prepare(
      `${baseSql}
               GROUP BY c.id
               ORDER BY c.updated_at DESC`
    ).all(userId);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      documentId: row.document_id,
      documentName: row.document_name,
      messageCount: Number(row.message_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }
  getConversation(userId, conversationId) {
    const row = this.db.prepare(
      `SELECT id, title, document_id, created_at, updated_at
         FROM conversations WHERE id = ? AND user_id = ?`
    ).get(conversationId, userId);
    if (!row) return null;
    const document = row.document_id ? this.getDocument(userId, row.document_id) : null;
    const messageRows = this.db.prepare(
      `SELECT id, role, content, found_in_material, examples_json, supporting_quote, created_at
         FROM messages WHERE conversation_id = ?
         ORDER BY created_at ASC, rowid ASC`
    ).all(conversationId);
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
        examples: safeJsonArrayParse(m.examples_json, []),
        supportingQuote: m.supporting_quote || "",
        createdAt: m.created_at
      })),
      recommendations,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  updateConversation(userId, conversationId, updates) {
    const existing = this.db.prepare(`SELECT id, title, document_id FROM conversations WHERE id = ? AND user_id = ?`).get(conversationId, userId);
    if (!existing) return null;
    const nextTitle = updates.title?.trim() || existing.title;
    let nextDocId = existing.document_id;
    if (updates.documentId !== void 0) {
      if (updates.documentId === null) {
        nextDocId = null;
      } else {
        const doc = this.getDocument(userId, updates.documentId);
        if (doc) nextDocId = doc.id;
      }
    }
    const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `UPDATE conversations SET title = ?, document_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
    ).run(nextTitle, nextDocId, updatedAt, conversationId, userId);
    const summaries = this.listConversations(userId);
    return summaries.find((c) => c.id === conversationId) ?? null;
  }
  appendChatTurn(params) {
    const conv = this.db.prepare(`SELECT id, title, document_id FROM conversations WHERE id = ? AND user_id = ?`).get(params.conversationId, params.userId);
    if (!conv) return null;
    const userCreatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const assistantCreatedAt = new Date(Date.now() + 1).toISOString();
    const userMessageId = crypto2.randomUUID();
    const assistantMessageId = crypto2.randomUUID();
    const nextTitle = conv.title === "New Chat" && params.newTitle?.trim() ? params.newTitle.trim() : conv.title;
    let nextDocId = conv.document_id;
    if (!nextDocId && params.documentId) {
      const owned = this.getDocument(params.userId, params.documentId);
      if (owned) nextDocId = owned.id;
    }
    this.db.prepare(
      `INSERT INTO messages (
          id, conversation_id, role, content, found_in_material, examples_json, supporting_quote, created_at
        ) VALUES (?, ?, 'user', ?, 1, '[]', '', ?)`
    ).run(userMessageId, params.conversationId, params.userQuestion, userCreatedAt);
    this.db.prepare(
      `INSERT INTO messages (
          id, conversation_id, role, content, found_in_material, examples_json, supporting_quote, created_at
        ) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`
    ).run(
      assistantMessageId,
      params.conversationId,
      params.assistantAnswer,
      params.foundInMaterial ? 1 : 0,
      JSON.stringify(params.examples),
      params.supportingQuote,
      assistantCreatedAt
    );
    this.db.prepare(
      `UPDATE conversations SET title = ?, document_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
    ).run(nextTitle, nextDocId, assistantCreatedAt, params.conversationId, params.userId);
    const summary = this.listConversations(params.userId).find(
      (c) => c.id === params.conversationId
    );
    return {
      conversation: summary,
      userMessage: {
        id: userMessageId,
        role: "user",
        content: params.userQuestion,
        foundInMaterial: true,
        examples: [],
        supportingQuote: "",
        createdAt: userCreatedAt
      },
      assistantMessage: {
        id: assistantMessageId,
        role: "assistant",
        content: params.assistantAnswer,
        foundInMaterial: params.foundInMaterial,
        examples: params.examples,
        supportingQuote: params.supportingQuote,
        createdAt: assistantCreatedAt
      }
    };
  }
  deleteConversation(userId, conversationId) {
    const info = this.db.prepare(`DELETE FROM conversations WHERE id = ? AND user_id = ?`).run(conversationId, userId);
    return info.changes > 0;
  }
  createLearningResult(params) {
    const id = crypto2.randomUUID();
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    let ownedDocId = null;
    if (params.documentId) {
      const doc = this.getDocument(params.userId, params.documentId);
      if (doc) ownedDocId = doc.id;
    }
    const keywords = params.keywords ?? [];
    const bulletPoints = params.bulletPoints ?? [];
    const concepts = params.concepts ?? [];
    const examples = params.examples ?? [];
    this.db.prepare(
      `INSERT INTO learning_results (
          id, user_id, document_id, result_type, title, reading_level, summary_length,
          source_excerpt, content_text, keywords_json, bullet_points_json, concepts_json,
          examples_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.userId,
      ownedDocId,
      params.resultType,
      params.title,
      params.readingLevel ?? null,
      params.summaryLength ?? null,
      params.sourceExcerpt ?? "",
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
      sourceExcerpt: params.sourceExcerpt ?? "",
      contentText: params.contentText,
      keywords,
      bulletPoints,
      concepts,
      examples,
      createdAt
    };
  }
  listLearningResults(userId, opts) {
    const conditions = ["user_id = ?"];
    const args = [userId];
    if (opts?.resultType && ["simplified", "summary", "explanation"].includes(opts.resultType)) {
      conditions.push("result_type = ?");
      args.push(opts.resultType);
    }
    if (opts?.query?.trim()) {
      const pattern = `%${escapeLike(opts.query.trim())}%`;
      conditions.push(
        `(title LIKE ? ESCAPE '\\' OR content_text LIKE ? ESCAPE '\\' OR keywords_json LIKE ? ESCAPE '\\' OR source_excerpt LIKE ? ESCAPE '\\')`
      );
      args.push(pattern, pattern, pattern, pattern);
    }
    const rows = this.db.prepare(
      `SELECT id, document_id, result_type, title, reading_level, summary_length,
                source_excerpt, content_text, keywords_json, bullet_points_json,
                concepts_json, examples_json, created_at
         FROM learning_results
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC`
    ).all(...args);
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      resultType: row.result_type,
      title: row.title,
      readingLevel: row.reading_level,
      summaryLength: row.summary_length,
      sourceExcerpt: row.source_excerpt,
      contentText: row.content_text,
      keywords: safeJsonArrayParse(row.keywords_json, []),
      bulletPoints: safeJsonArrayParse(row.bullet_points_json, []),
      concepts: safeJsonArrayParse(row.concepts_json, []),
      examples: safeJsonArrayParse(row.examples_json, []),
      createdAt: row.created_at
    }));
  }
  deleteLearningResult(userId, resultId) {
    const info = this.db.prepare(`DELETE FROM learning_results WHERE id = ? AND user_id = ?`).run(resultId, userId);
    return info.changes > 0;
  }
  saveVideoRecommendation(params) {
    const id = crypto2.randomUUID();
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    let ownedDocId = null;
    if (params.documentId) {
      const doc = this.getDocument(params.userId, params.documentId);
      if (doc) ownedDocId = doc.id;
    }
    let ownedConvId = null;
    if (params.conversationId) {
      const convRow = this.db.prepare(`SELECT id FROM conversations WHERE id = ? AND user_id = ?`).get(params.conversationId, params.userId);
      if (convRow) ownedConvId = convRow.id;
    }
    this.db.prepare(
      `INSERT INTO video_recommendations (
          id, user_id, conversation_id, document_id, source_type, topic, search_query,
          learning_level, preferred_language, keywords_json, videos_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
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
      createdAt
    };
  }
  listVideoRecommendations(userId, opts) {
    const conditions = ["user_id = ?"];
    const args = [userId];
    if (opts?.conversationId) {
      conditions.push("conversation_id = ?");
      args.push(opts.conversationId);
    }
    if (opts?.query?.trim()) {
      const pattern = `%${escapeLike(opts.query.trim())}%`;
      conditions.push(
        `(topic LIKE ? ESCAPE '\\' OR search_query LIKE ? ESCAPE '\\' OR keywords_json LIKE ? ESCAPE '\\' OR videos_json LIKE ? ESCAPE '\\')`
      );
      args.push(pattern, pattern, pattern, pattern);
    }
    const rows = this.db.prepare(
      `SELECT id, conversation_id, document_id, source_type, topic, search_query,
                learning_level, preferred_language, keywords_json, videos_json, created_at
         FROM video_recommendations
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC`
    ).all(...args);
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      documentId: row.document_id,
      sourceType: row.source_type,
      topic: row.topic,
      searchQuery: row.search_query,
      learningLevel: row.learning_level,
      preferredLanguage: row.preferred_language,
      keywords: safeJsonArrayParse(row.keywords_json, []),
      videos: safeJsonArrayParse(row.videos_json, []),
      createdAt: row.created_at
    }));
  }
  deleteVideoRecommendation(userId, recommendationId) {
    const info = this.db.prepare(`DELETE FROM video_recommendations WHERE id = ? AND user_id = ?`).run(recommendationId, userId);
    return info.changes > 0;
  }
  saveVoiceTutorSession(params) {
    const id = crypto2.randomUUID();
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    let ownedDocId = null;
    if (params.documentId) {
      const doc = this.getDocument(params.userId, params.documentId);
      if (doc) ownedDocId = doc.id;
    }
    let ownedConvId = null;
    if (params.conversationId) {
      const convRow = this.db.prepare(`SELECT id FROM conversations WHERE id = ? AND user_id = ?`).get(params.conversationId, params.userId);
      if (convRow) ownedConvId = convRow.id;
    }
    const audioRefs = params.audioRefs ?? [];
    this.db.prepare(
      `INSERT INTO voice_tutor_sessions (
          id, user_id, document_id, conversation_id, source_type, topic, lesson_title,
          source_excerpt, learning_level, preferred_language, language_code, voice_name, slow,
          explanation_json, sections_json, audio_refs_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
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
      createdAt
    };
  }
  mapVoiceTutorRow(row) {
    const emptyExplanation = {
      lessonTitle: row.lesson_title,
      introduction: "",
      meaningAndDefinition: "",
      stepByStepExplanation: [],
      realWorldExamples: [],
      analogies: [],
      importantPoints: [],
      shortRecap: ""
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
      explanation: safeJsonObjectParse(
        row.explanation_json,
        emptyExplanation
      ),
      sections: safeJsonArrayParse(row.sections_json, []),
      audioRefs: safeJsonArrayParse(row.audio_refs_json, []),
      createdAt: row.created_at
    };
  }
  listVoiceTutorSessions(userId, opts) {
    const q = opts?.query?.trim();
    const rows = q ? this.db.prepare(
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
    ).all(
      userId,
      `%${escapeLike(q)}%`,
      `%${escapeLike(q)}%`,
      `%${escapeLike(q)}%`,
      `%${escapeLike(q)}%`
    ) : this.db.prepare(
      `SELECT id, document_id, conversation_id, source_type, topic, lesson_title,
                      source_excerpt, learning_level, preferred_language, language_code, voice_name,
                      slow, explanation_json, sections_json, audio_refs_json, created_at
               FROM voice_tutor_sessions
               WHERE user_id = ?
               ORDER BY created_at DESC`
    ).all(userId);
    return rows.map((row) => this.mapVoiceTutorRow(row));
  }
  getVoiceTutorSession(userId, sessionId) {
    const row = this.db.prepare(
      `SELECT id, document_id, conversation_id, source_type, topic, lesson_title,
                source_excerpt, learning_level, preferred_language, language_code, voice_name,
                slow, explanation_json, sections_json, audio_refs_json, created_at
         FROM voice_tutor_sessions
         WHERE id = ? AND user_id = ?`
    ).get(sessionId, userId);
    return row ? this.mapVoiceTutorRow(row) : null;
  }
  deleteVoiceTutorSession(userId, sessionId) {
    const info = this.db.prepare(`DELETE FROM voice_tutor_sessions WHERE id = ? AND user_id = ?`).run(sessionId, userId);
    return info.changes > 0;
  }
  saveVoiceTutorAudio(params) {
    const audioId = crypto2.randomUUID();
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    let ownedSessionId = null;
    if (params.sessionId) {
      const sess = this.getVoiceTutorSession(params.userId, params.sessionId);
      if (sess) ownedSessionId = sess.id;
    }
    this.db.prepare(
      `INSERT INTO voice_tutor_audio (
          id, user_id, session_id, section_index, language_code, voice_name, slow, mime_type, audio_bytes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
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
    const ref = {
      sectionIndex: params.sectionIndex,
      audioId,
      mimeType: params.mimeType,
      languageCode: params.languageCode,
      voiceName: params.voiceName,
      slow: Boolean(params.slow)
    };
    if (ownedSessionId) {
      const existing = this.getVoiceTutorSession(params.userId, ownedSessionId);
      if (existing) {
        const filtered = existing.audioRefs.filter(
          (item) => !(item.sectionIndex === params.sectionIndex && item.languageCode === params.languageCode && item.voiceName === params.voiceName && item.slow === Boolean(params.slow))
        );
        filtered.push(ref);
        this.db.prepare(`UPDATE voice_tutor_sessions SET audio_refs_json = ? WHERE id = ? AND user_id = ?`).run(JSON.stringify(filtered), ownedSessionId, params.userId);
      }
    }
    return ref;
  }
  findVoiceTutorAudioBySection(params) {
    const row = this.db.prepare(
      `SELECT id, section_index, mime_type, language_code, voice_name, slow
         FROM voice_tutor_audio
         WHERE user_id = ? AND session_id = ? AND section_index = ?
           AND language_code = ? AND voice_name = ? AND slow = ?
         ORDER BY created_at DESC LIMIT 1`
    ).get(
      params.userId,
      params.sessionId,
      params.sectionIndex,
      params.languageCode,
      params.voiceName,
      params.slow ? 1 : 0
    );
    if (!row) return null;
    return {
      audioId: row.id,
      sectionIndex: row.section_index,
      mimeType: row.mime_type,
      languageCode: row.language_code,
      voiceName: row.voice_name,
      slow: Boolean(row.slow)
    };
  }
  getVoiceTutorAudio(userId, audioId) {
    const row = this.db.prepare(
      `SELECT id, mime_type, audio_bytes
         FROM voice_tutor_audio
         WHERE id = ? AND user_id = ?`
    ).get(audioId, userId);
    if (!row) return null;
    return {
      id: row.id,
      mimeType: row.mime_type || "audio/wav",
      bytes: row.audio_bytes
    };
  }
};
function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

// server/youtube.ts
import { ThinkingLevel, Type } from "@google/genai";
var YouTubeServiceError = class extends Error {
  constructor(status, message) {
    super(message);
    this.name = "YouTubeServiceError";
    this.status = status;
  }
};
var DEPRECATED_GEMINI_MODELS = /* @__PURE__ */ new Set([
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-pro",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-2.0-flash-thinking"
]);
function resolveGeminiTextModel(rawModel) {
  const trimmed = (rawModel ?? "").trim();
  if (!trimmed) return "gemini-4-hydrogen";
  const normalized = trimmed.replace(/^models\//i, "").toLowerCase();
  if (!/^gemini-[a-z0-9._-]+$/.test(normalized)) {
    return "gemini-4-hydrogen";
  }
  if (DEPRECATED_GEMINI_MODELS.has(normalized)) {
    return "gemini-4-hydrogen";
  }
  return trimmed.replace(/^models\//i, "");
}
var DEFAULT_MODEL = resolveGeminiTextModel(process.env.GEMINI_MODEL);
var LANGUAGE_MAP = {
  english: "en",
  en: "en",
  spanish: "es",
  espanol: "es",
  es: "es",
  hindi: "hi",
  hi: "hi",
  french: "fr",
  francais: "fr",
  fr: "fr",
  german: "de",
  deutsch: "de",
  de: "de",
  arabic: "ar",
  ar: "ar",
  portuguese: "pt",
  pt: "pt",
  japanese: "ja",
  ja: "ja",
  korean: "ko",
  ko: "ko",
  chinese: "zh-Hans",
  mandarin: "zh-Hans",
  zh: "zh-Hans",
  italian: "it",
  it: "it"
};
var STOPWORDS = /* @__PURE__ */ new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "almost",
  "alone",
  "along",
  "already",
  "also",
  "although",
  "always",
  "among",
  "another",
  "answer",
  "around",
  "because",
  "become",
  "before",
  "being",
  "below",
  "between",
  "both",
  "called",
  "cannot",
  "could",
  "course",
  "describe",
  "described",
  "does",
  "doing",
  "during",
  "each",
  "either",
  "enough",
  "every",
  "example",
  "explain",
  "explained",
  "first",
  "following",
  "found",
  "from",
  "further",
  "gives",
  "great",
  "have",
  "having",
  "helpful",
  "here",
  "hers",
  "herself",
  "himself",
  "however",
  "important",
  "include",
  "including",
  "inside",
  "into",
  "itself",
  "just",
  "known",
  "learn",
  "learning",
  "lesson",
  "like",
  "made",
  "make",
  "many",
  "material",
  "mean",
  "meaning",
  "might",
  "more",
  "most",
  "much",
  "must",
  "nearly",
  "need",
  "never",
  "only",
  "other",
  "others",
  "otherwise",
  "ours",
  "ourselves",
  "over",
  "page",
  "paragraph",
  "part",
  "passage",
  "process",
  "question",
  "quite",
  "rather",
  "really",
  "same",
  "section",
  "several",
  "shall",
  "should",
  "since",
  "some",
  "someone",
  "something",
  "sometimes",
  "still",
  "student",
  "study",
  "such",
  "summary",
  "take",
  "than",
  "that",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "thing",
  "things",
  "think",
  "this",
  "those",
  "though",
  "through",
  "thus",
  "together",
  "toward",
  "under",
  "understand",
  "until",
  "upon",
  "used",
  "using",
  "usually",
  "very",
  "video",
  "want",
  "watch",
  "well",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "whom",
  "whose",
  "will",
  "with",
  "within",
  "without",
  "word",
  "words",
  "work",
  "works",
  "would",
  "your",
  "yours",
  "yourself"
]);
var EDUCATIONAL_POSITIVE_SIGNALS = [
  { pattern: /\b(explained|explanation|tutorial|lesson|lecture|course|crash course)\b/i, weight: 18 },
  { pattern: /\b(introduction|intro|basics|fundamentals|overview|guide|walkthrough)\b/i, weight: 14 },
  { pattern: /\b(visual|animation|animated|demonstration|demo|step by step|how .+ works)\b/i, weight: 15 },
  { pattern: /\b(khan academy|mit|stanford|harvard|ted-ed|crashcourse|3blue1brown|amoeba sisters|organic chemistry tutor|kurzgesagt|bozeman|professor|academy)\b/i, weight: 22 },
  { pattern: /\b(concept|concepts|theory|example|examples|study|science|math|biology|physics|history|economics|chemistry)\b/i, weight: 8 }
];
var ENTERTAINMENT_NEGATIVE_SIGNALS = [
  { pattern: /\b(prank|roast|reaction|reacts|tiktok|memes?|funny moments|unboxing|vlog|drama|gossip|diss track|official music video|lyric video|gameplay|speedrun|fortnite|minecraft|roblox)\b/i, weight: -50 },
  { pattern: /#shorts?\b/i, weight: -35 },
  { pattern: /\b(top 10 shocking|you won't believe|gone wrong|clickbait)\b/i, weight: -40 }
];
function normalizeLearningLevel(level) {
  if (level === "Intermediate" || level === "Advanced") {
    return level;
  }
  return "Beginner";
}
function normalizeSourceType(sourceType) {
  if (sourceType === "document" || sourceType === "summary" || sourceType === "assistant" || sourceType === "custom") {
    return sourceType;
  }
  return "text";
}
function mapLanguageCode(preferredLanguage) {
  const key = (preferredLanguage || "English").trim().toLowerCase();
  return LANGUAGE_MAP[key] || "en";
}
function parseDurationSeconds(isoDuration) {
  if (!isoDuration || typeof isoDuration !== "string") return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(isoDuration.trim());
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}
function parseIso8601Duration(isoDuration) {
  const totalSeconds = parseDurationSeconds(isoDuration);
  if (totalSeconds <= 0) return "";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const secStr = String(seconds).padStart(2, "0");
  if (hours > 0) {
    const minStr = String(minutes).padStart(2, "0");
    return `${hours}:${minStr}:${secStr}`;
  }
  return `${minutes}:${secStr}`;
}
function extractKeywordsHeuristic(text, limit = 5) {
  const cleaned = text.replace(/\[Page \d+\]/gi, " ").replace(/https?:\/\/\S+/g, " ").replace(/[^a-zA-Z0-9\s-]/g, " ").toLowerCase();
  const counts = /* @__PURE__ */ new Map();
  for (const token of cleaned.split(/\s+/)) {
    const word = token.replace(/^-+|-+$/g, "");
    if (word.length < 4 || /^\d+$/.test(word) || STOPWORDS.has(word)) {
      continue;
    }
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, limit).map(([word]) => word);
}
function buildFallbackSearchQuery(params) {
  const custom = (params.customTopic || "").trim();
  const providedKeywords = (params.keywords || []).map((k) => k.trim()).filter(Boolean).slice(0, 6);
  const sourceText = custom || params.topicOrText.trim();
  const extracted = providedKeywords.length > 0 ? providedKeywords : extractKeywordsHeuristic(sourceText, 5);
  let topic = custom;
  if (!topic) {
    const firstSentence = sourceText.replace(/\[Page \d+\]\s*/gi, "").split(/[.!?\n]/)[0]?.trim() || "";
    if (firstSentence && firstSentence.length <= 80 && firstSentence.split(/\s+/).length <= 10) {
      topic = firstSentence;
    } else if (extracted.length > 0) {
      topic = extracted.slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    } else {
      topic = sourceText.slice(0, 60).trim() || "Study Topic";
    }
  }
  const levelQualifier = params.learningLevel === "Beginner" ? "explained for beginners tutorial" : params.learningLevel === "Intermediate" ? "concept explanation tutorial" : "in depth lecture explained";
  const langSuffix = params.preferredLanguage && params.preferredLanguage.trim().toLowerCase() !== "english" ? ` in ${params.preferredLanguage.trim()}` : "";
  const coreTerms = custom ? custom : extracted.length > 0 ? extracted.slice(0, 4).join(" ") : topic;
  const searchQuery = `${coreTerms} ${levelQualifier}${langSuffix}`.replace(/\s+/g, " ").trim();
  return {
    topic,
    keywords: extracted.length > 0 ? extracted : topic.toLowerCase().split(/\s+/).slice(0, 4),
    searchQuery
  };
}
function decodeHtmlEntities(input) {
  return input.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function scoreAndFilterCandidates(candidates, context) {
  const seen = /* @__PURE__ */ new Set();
  const normalizedKeywords = [
    ...new Set(
      [...context.keywords, ...context.topic.split(/\s+/)].map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3 && !STOPWORDS.has(k))
    )
  ];
  const scored = candidates.filter((item) => {
    if (!item.videoId || seen.has(item.videoId)) return false;
    seen.add(item.videoId);
    return Boolean(item.title?.trim());
  }).map((item) => {
    const title = decodeHtmlEntities(item.title.trim());
    const desc = decodeHtmlEntities((item.description || "").trim());
    const channel = decodeHtmlEntities((item.channelName || "Educational Channel").trim());
    const combined = `${title} ${desc} ${channel}`.toLowerCase();
    const seconds = parseDurationSeconds(item.durationIso);
    let score = 0;
    let matchedKeywords = [];
    for (const kw of normalizedKeywords) {
      if (title.toLowerCase().includes(kw)) {
        score += 18;
        matchedKeywords.push(kw);
      } else if (combined.includes(kw)) {
        score += 8;
        matchedKeywords.push(kw);
      }
    }
    for (const sig of EDUCATIONAL_POSITIVE_SIGNALS) {
      if (sig.pattern.test(combined)) {
        score += sig.weight;
      }
    }
    for (const neg of ENTERTAINMENT_NEGATIVE_SIGNALS) {
      if (neg.pattern.test(combined)) {
        score += neg.weight;
      }
    }
    if (item.categoryId === "27") score += 16;
    else if (item.categoryId === "28") score += 10;
    if (context.learningLevel === "Beginner") {
      if (/\b(beginner|beginners|intro|introduction|basics|simple|made easy|for kids|101)\b/i.test(combined)) {
        score += 14;
      }
    } else if (context.learningLevel === "Intermediate") {
      if (/\b(explained|visual|deep dive|mechanism|how|principles|guide)\b/i.test(combined)) {
        score += 12;
      }
    } else if (context.learningLevel === "Advanced") {
      if (/\b(lecture|university|advanced|derivation|proof|seminar|research|mit)\b/i.test(combined)) {
        score += 14;
      }
    }
    if (seconds > 0 && seconds < 60) {
      score -= 25;
    } else if (seconds >= 120 && seconds <= 2700) {
      score += 12;
    } else if (seconds > 2700) {
      score += 4;
    }
    if (item.viewCount && item.viewCount > 1e3) {
      score += Math.min(10, Math.log10(item.viewCount));
    }
    const duration = parseIso8601Duration(item.durationIso);
    const customReason = context.reasonMap?.[item.videoId]?.trim();
    const matchedLabel = matchedKeywords.length > 0 ? matchedKeywords.slice(0, 3).join(", ") : context.topic;
    const defaultReason = seconds >= 120 ? `Recommended ${context.learningLevel.toLowerCase()}-friendly lesson by ${channel} covering ${matchedLabel}.` : `Helpful video explanation from ${channel} focused on ${matchedLabel}.`;
    return {
      score,
      video: {
        videoId: item.videoId,
        title,
        thumbnailUrl: item.thumbnailUrl || `https://i.ytimg.com/vi/${encodeURIComponent(item.videoId)}/hqdefault.jpg`,
        channelName: channel,
        videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`,
        duration,
        recommendationReason: customReason || defaultReason
      }
    };
  });
  const positiveMatches = scored.filter((entry) => entry.score > -10);
  const pool = positiveMatches.length > 0 ? positiveMatches : scored.filter((entry) => entry.score > -35);
  return pool.sort((a, b) => b.score - a.score).slice(0, 5).map((entry) => entry.video);
}
var SlidingWindowRateLimiter = class {
  constructor(maxRequests = 15, windowMs = 6e4) {
    this.hits = /* @__PURE__ */ new Map();
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }
  allow(key, now = Date.now()) {
    const cutoff = now - this.windowMs;
    const prev = (this.hits.get(key) || []).filter((ts) => ts > cutoff);
    if (prev.length >= this.maxRequests) {
      const oldest = prev[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1e3));
      this.hits.set(key, prev);
      return { allowed: false, retryAfterSeconds };
    }
    prev.push(now);
    this.hits.set(key, prev);
    return { allowed: true, retryAfterSeconds: 0 };
  }
};
var RECOMMENDATION_CACHE_TTL_MS = 15 * 60 * 1e3;
var recommendationCache = /* @__PURE__ */ new Map();
function readRecommendationCache(key) {
  const entry = recommendationCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    recommendationCache.delete(key);
    return null;
  }
  return entry.data;
}
function writeRecommendationCache(key, data) {
  if (recommendationCache.size >= 80) {
    const oldest = recommendationCache.keys().next().value;
    if (oldest !== void 0) recommendationCache.delete(oldest);
  }
  recommendationCache.set(key, {
    expiresAt: Date.now() + RECOMMENDATION_CACHE_TTL_MS,
    data
  });
}
async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function analyzeTopicWithGemini(ai, params) {
  const fallback = buildFallbackSearchQuery({
    topicOrText: params.content,
    customTopic: params.customTopic,
    keywords: params.keywords,
    learningLevel: params.learningLevel,
    preferredLanguage: params.preferredLanguage
  });
  try {
    const boundedContent = params.content.slice(0, 8e3);
    const promptParts = [
      `Student Learning Level: ${params.learningLevel}`,
      `Preferred Video Language: ${params.preferredLanguage}`,
      `Source Type: ${params.sourceType}`
    ];
    if (params.customTopic?.trim()) {
      promptParts.push(`Explicit Student Topic Request: ${params.customTopic.trim()}`);
    }
    if (params.keywords && params.keywords.length > 0) {
      promptParts.push(`Pre-extracted Keywords: ${params.keywords.join(", ")}`);
    }
    if (boundedContent.trim()) {
      promptParts.push(`Study Content / Context:
"""
${boundedContent}
"""`);
    }
    const res = await withTimeout(
      ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: promptParts.join("\n\n"),
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: "You help students discover clear educational YouTube videos. Extract the core academic topic, 3 to 6 concise subject keywords, and generate a clean YouTube search query optimized for tutorials, conceptual explanations, or classroom lectures matching the requested learning level and language. Do not include quotes, boolean operators, or hashtags in searchQuery.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              topic: {
                type: Type.STRING,
                description: "Concise 2 to 6 word main academic topic."
              },
              keywords: {
                type: Type.ARRAY,
                description: "3 to 6 relevant educational search keywords.",
                items: { type: Type.STRING }
              },
              searchQuery: {
                type: Type.STRING,
                description: "Focused YouTube educational search query targeting tutorials/explanations at the requested learning level."
              }
            },
            required: ["topic", "keywords", "searchQuery"]
          }
        }
      }),
      6e3,
      "Gemini topic analysis"
    );
    const parsed = JSON.parse((res.text ?? "{}").trim());
    const topic = (parsed.topic || fallback.topic).trim();
    const keywords = Array.isArray(parsed.keywords) && parsed.keywords.length > 0 ? parsed.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 6) : fallback.keywords;
    const searchQuery = (parsed.searchQuery || fallback.searchQuery).trim();
    return { topic, keywords, searchQuery };
  } catch {
    return fallback;
  }
}
async function enrichRecommendationReasonsWithGemini(ai, videos, context) {
  if (videos.length === 0) return {};
  try {
    const candidateLines = videos.map(
      (v, idx) => `${idx + 1}. videoId="${v.videoId}" | title="${v.title}" | channel="${v.channelName}" | duration="${v.duration || "N/A"}"`
    ).join("\n");
    const res = await withTimeout(
      ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: `Topic: ${context.topic}
Student Level: ${context.learningLevel}
Preferred Language: ${context.preferredLanguage}

Videos:
${candidateLines}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: "Write a crisp 1-sentence student-friendly explanation (12 to 24 words) for each video explaining why it helps learn the topic at the given level.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reasons: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    videoId: { type: Type.STRING },
                    reason: { type: Type.STRING }
                  },
                  required: ["videoId", "reason"]
                }
              }
            },
            required: ["reasons"]
          }
        }
      }),
      6e3,
      "Gemini video reason enrichment"
    );
    const parsed = JSON.parse((res.text ?? "{}").trim());
    const reasonMap = {};
    for (const item of parsed.reasons || []) {
      if (item.videoId && item.reason) {
        reasonMap[item.videoId] = item.reason.trim();
      }
    }
    return reasonMap;
  } catch {
    return {};
  }
}
function normalizeYoutubeApiKey(rawKey) {
  let cleaned = (rawKey ?? "").trim();
  if (!cleaned) return "";
  cleaned = cleaned.replace(/^YOUTUBE_API_KEY\s*=\s*/i, "").trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"') || cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  const upper = cleaned.toUpperCase();
  if (!cleaned || upper === "MY_YOUTUBE_DATA_API_V3_KEY" || upper === "YOUR_YOUTUBE_API_KEY" || upper === "REPLACE_WITH_YOUTUBE_API_KEY") {
    return "";
  }
  return cleaned;
}
function sanitizeYouTubeErrorText(text) {
  return text.replace(/AIza[0-9A-Za-z_-]{10,}/g, "[REDACTED_KEY]").replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]");
}
function classifyYouTubeApiError(status, errBody) {
  const errorReasons = (errBody?.error?.errors || []).map((e) => e.reason || "").filter(Boolean);
  const detailReasons = (errBody?.error?.details || []).map((d) => d.reason || "").filter(Boolean);
  const allReasons = [...errorReasons, ...detailReasons].map((r) => r.toLowerCase());
  const rawMessage = sanitizeYouTubeErrorText(errBody?.error?.message || "");
  const lowerMsg = rawMessage.toLowerCase();
  if (allReasons.some(
    (r) => r.includes("quota") || r === "dailylimitexceeded" || r === "ratelimitexceeded" || r === "userratelimitexceeded"
  ) || status === 429 || lowerMsg.includes("quota")) {
    return new YouTubeServiceError(
      429,
      "YouTube Data API daily quota has been exceeded. Please try again later or verify your Google Cloud quota."
    );
  }
  if (allReasons.some((r) => r.includes("referer")) || lowerMsg.includes("referer")) {
    return new YouTubeServiceError(
      503,
      'YouTube Data API key is blocked by HTTP referrer restrictions. Since requests run server-side, set Application restrictions to "None" for YOUTUBE_API_KEY in Google Cloud Console.'
    );
  }
  if (allReasons.some(
    (r) => r === "accessnotconfigured" || r === "service_disabled" || r === "api_key_service_blocked"
  ) || lowerMsg.includes("has not been used in project") || lowerMsg.includes("is disabled") || lowerMsg.includes("service_blocked") || lowerMsg.includes("are blocked")) {
    return new YouTubeServiceError(
      503,
      'YouTube Data API v3 is not enabled or is blocked for this key. Enable "YouTube Data API v3" and include it under API restrictions in Google Cloud Console.'
    );
  }
  if (status === 400 || status === 401 || status === 403) {
    if (lowerMsg.includes("api keys are not supported")) {
      return new YouTubeServiceError(
        503,
        'The value in YOUTUBE_API_KEY was rejected by YouTube Data API v3 ("API keys are not supported by this API"). Please create a standard Google Cloud Console API Key (starting with "AIza...") under APIs & Services > Credentials with YouTube Data API v3 enabled, rather than an AI Studio / OAuth credential.'
      );
    }
    if (allReasons.some((r) => r === "keyinvalid" || r === "api_key_invalid") || lowerMsg.includes("api key not valid") || lowerMsg.includes("api key")) {
      const reasonDetail = rawMessage ? ` (Google API: ${rawMessage})` : "";
      return new YouTubeServiceError(
        503,
        `YouTube Data API authentication failed. Please verify YOUTUBE_API_KEY is valid and YouTube Data API v3 is enabled${reasonDetail}.`
      );
    }
    return new YouTubeServiceError(
      status,
      rawMessage || "YouTube Data API rejected the request."
    );
  }
  return new YouTubeServiceError(
    502,
    rawMessage || `YouTube API request failed with status ${status}.`
  );
}
async function fetchYouTubeJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(1e4)
    });
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new YouTubeServiceError(
      504,
      isTimeout ? "YouTube Data API request timed out. Please try again." : "Could not reach YouTube Data API. Please try again."
    );
  }
  if (!response.ok) {
    let errBody = null;
    try {
      errBody = await response.json();
    } catch {
    }
    throw classifyYouTubeApiError(response.status, errBody);
  }
  return await response.json();
}
async function queryYouTubeCandidates(params) {
  const runSearch = async (query, categoryId) => {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("maxResults", "12");
    searchUrl.searchParams.set("safeSearch", "strict");
    searchUrl.searchParams.set("videoEmbeddable", "true");
    searchUrl.searchParams.set("relevanceLanguage", params.relevanceLanguage);
    searchUrl.searchParams.set("q", query);
    if (categoryId) {
      searchUrl.searchParams.set("videoCategoryId", categoryId);
    }
    searchUrl.searchParams.set("key", params.apiKey);
    const searchData = await fetchYouTubeJson(
      searchUrl.toString()
    );
    return Array.isArray(searchData.items) ? searchData.items : [];
  };
  let searchItems = await runSearch(params.searchQuery, "27");
  if (searchItems.length < 4) {
    const broadened = await runSearch(`${params.searchQuery} tutorial lesson`);
    const seenIds = new Set(searchItems.map((i) => i.id?.videoId).filter(Boolean));
    for (const item of broadened) {
      const id = item.id?.videoId;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        searchItems.push(item);
      }
    }
  }
  const videoIds = searchItems.map((item) => item.id?.videoId?.trim()).filter((id) => Boolean(id)).slice(0, 15);
  if (videoIds.length === 0) {
    return [];
  }
  const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailsUrl.searchParams.set("part", "snippet,contentDetails,statistics");
  detailsUrl.searchParams.set("id", videoIds.join(","));
  detailsUrl.searchParams.set("key", params.apiKey);
  const detailsData = await fetchYouTubeJson(
    detailsUrl.toString()
  );
  const detailsById = /* @__PURE__ */ new Map();
  for (const d of detailsData.items || []) {
    if (d.id) detailsById.set(d.id, d);
  }
  return videoIds.map((videoId) => {
    const searchItem = searchItems.find((s) => s.id?.videoId === videoId);
    const detail = detailsById.get(videoId);
    const snippet = detail?.snippet || searchItem?.snippet;
    const thumbs = snippet?.thumbnails;
    const thumbnailUrl = thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url || `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
    return {
      videoId,
      title: snippet?.title || "Educational Video",
      description: snippet?.description || "",
      thumbnailUrl,
      channelName: snippet?.channelTitle || "Educational Channel",
      publishedAt: snippet?.publishedAt,
      durationIso: detail?.contentDetails?.duration,
      viewCount: detail?.statistics?.viewCount ? Number(detail.statistics.viewCount) : void 0,
      likeCount: detail?.statistics?.likeCount ? Number(detail.statistics.likeCount) : void 0,
      categoryId: detail?.snippet?.categoryId
    };
  });
}
async function recommendYoutubeVideos(params) {
  const youtubeApiKey = normalizeYoutubeApiKey(
    params.youtubeApiKey ?? process.env.YOUTUBE_API_KEY
  );
  if (!youtubeApiKey) {
    throw new YouTubeServiceError(
      503,
      "YouTube Data API v3 key (YOUTUBE_API_KEY) is not configured on the backend server. Please add a valid YOUTUBE_API_KEY in AI Studio Secrets."
    );
  }
  const learningLevel = normalizeLearningLevel(params.learningLevel);
  const preferredLanguage = (params.preferredLanguage || "English").trim() || "English";
  const sourceType = normalizeSourceType(params.sourceType);
  const relevanceLanguage = mapLanguageCode(preferredLanguage);
  const cacheIdentity = [
    params.customTopic?.trim().toLowerCase() || "",
    params.content.trim().slice(0, 1200).toLowerCase(),
    (params.keywords || []).join(",").toLowerCase(),
    learningLevel.toLowerCase(),
    relevanceLanguage
  ].join("|");
  if (!params.forceRefresh) {
    const cached = readRecommendationCache(cacheIdentity);
    if (cached) {
      return { ...cached, sourceType, cached: true };
    }
  }
  const ai = params.getAiClient();
  const analysis = ai ? await analyzeTopicWithGemini(ai, {
    content: params.content,
    customTopic: params.customTopic,
    keywords: params.keywords,
    learningLevel,
    preferredLanguage,
    sourceType
  }) : buildFallbackSearchQuery({
    topicOrText: params.content,
    customTopic: params.customTopic,
    keywords: params.keywords,
    learningLevel,
    preferredLanguage
  });
  const candidates = await queryYouTubeCandidates({
    apiKey: youtubeApiKey,
    searchQuery: analysis.searchQuery,
    relevanceLanguage
  });
  const initialTop5 = scoreAndFilterCandidates(candidates, {
    topic: analysis.topic,
    keywords: analysis.keywords,
    learningLevel,
    preferredLanguage
  });
  const reasonMap = ai && initialTop5.length > 0 ? await enrichRecommendationReasonsWithGemini(ai, initialTop5, {
    topic: analysis.topic,
    learningLevel,
    preferredLanguage
  }) : {};
  const finalVideos = initialTop5.map((video) => ({
    ...video,
    recommendationReason: reasonMap[video.videoId] || video.recommendationReason
  }));
  const responsePayload = {
    topic: analysis.topic,
    keywords: analysis.keywords,
    searchQuery: analysis.searchQuery,
    learningLevel,
    preferredLanguage,
    sourceType,
    videos: finalVideos
  };
  if (finalVideos.length > 0) {
    writeRecommendationCache(cacheIdentity, responsePayload);
  }
  return { ...responsePayload, cached: false };
}

// server/voiceTutor.ts
import crypto3 from "crypto";
import { ThinkingLevel as ThinkingLevel2, Type as Type2 } from "@google/genai";
var SUPPORTED_TUTOR_LANGUAGES = [
  { label: "English", code: "en", nativeLabel: "English" },
  { label: "Spanish", code: "es", nativeLabel: "Espa\xF1ol" },
  { label: "French", code: "fr", nativeLabel: "Fran\xE7ais" },
  { label: "German", code: "de", nativeLabel: "Deutsch" },
  { label: "Hindi", code: "hi", nativeLabel: "\u0939\u093F\u0928\u094D\u0926\u0940" },
  { label: "Portuguese", code: "pt", nativeLabel: "Portugu\xEAs" },
  { label: "Italian", code: "it", nativeLabel: "Italiano" },
  { label: "Japanese", code: "ja", nativeLabel: "\u65E5\u672C\u8A9E" },
  { label: "Korean", code: "ko", nativeLabel: "\uD55C\uAD6D\uC5B4" },
  { label: "Arabic", code: "ar", nativeLabel: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629" }
];
var DEFAULT_MODEL2 = resolveGeminiTextModel(process.env.GEMINI_MODEL);
var MAX_SECTION_CHARS = 1350;
var EXPLANATION_CACHE_LIMIT = 40;
var explanationCache = /* @__PURE__ */ new Map();
function normalizeTutorLevel(raw) {
  if (raw === "Intermediate" || raw === "Advanced") {
    return raw;
  }
  return "Beginner";
}
function normalizeTutorSourceType(raw) {
  if (raw === "text" || raw === "document" || raw === "summary" || raw === "conversation") {
    return raw;
  }
  return "topic";
}
function resolveTutorLanguage(raw) {
  const input = (raw ?? "").trim().toLowerCase();
  if (!input) {
    return SUPPORTED_TUTOR_LANGUAGES[0];
  }
  const match = SUPPORTED_TUTOR_LANGUAGES.find(
    (item) => item.label.toLowerCase() === input || item.code.toLowerCase() === input || item.nativeLabel.toLowerCase() === input
  );
  return match ?? SUPPORTED_TUTOR_LANGUAGES[0];
}
function getTutorLevelPromptGuidance(level) {
  switch (level) {
    case "Intermediate":
      return "LEVEL: INTERMEDIATE. Teach like an engaging high-school or early-college instructor. Introduce standard terminology naturally, immediately define every technical term in plain English, walk through mechanisms step by step, and connect concepts with practical real-world examples and vivid analogies.";
    case "Advanced":
      return "LEVEL: ADVANCED. Teach like an insightful university seminar mentor. Include deeper mechanisms, edge cases, formal principles, and nuanced real-world applications while keeping spoken sentences clear, conversational, and easy to follow by ear.";
    case "Beginner":
    default:
      return "LEVEL: BEGINNER. Teach like a patient, encouraging private tutor explaining to someone encountering this for the first time. Use short, natural spoken sentences, everyday vocabulary, relatable household/daily-life examples, and memorable analogies.";
  }
}
function splitSpokenScriptForAudio(text, maxChars = MAX_SECTION_CHARS) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];
  const sentences = cleaned.split(/(?<=[.!?।。！？])\s+/);
  const parts = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      const words = sentence.split(" ");
      for (const word of words) {
        const candidate2 = current ? `${current} ${word}` : word;
        if (candidate2.length <= maxChars) {
          current = candidate2;
        } else {
          if (current) parts.push(current);
          if (word.length > maxChars) {
            for (let i = 0; i < word.length; i += maxChars) {
              parts.push(word.slice(i, i + maxChars));
            }
            current = "";
          } else {
            current = word;
          }
        }
      }
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}
function makeSection(index, title, kind, script) {
  const cleaned = script.replace(/\s+/g, " ").trim();
  const wordCount = cleaned ? cleaned.split(/\s+/).length : 0;
  const estimatedSeconds = Math.max(4, Math.round(wordCount / 145 * 60));
  return {
    index,
    title: title.trim() || `Section ${index + 1}`,
    kind: kind.trim() || "lesson",
    spokenScript: cleaned,
    wordCount,
    estimatedSeconds
  };
}
function buildSectionsFromExplanation(explanation, rawSections, maxSectionChars = MAX_SECTION_CHARS) {
  const fallbackCandidates = [
    {
      title: "Introduction & Core Meaning",
      kind: "introduction",
      script: `${explanation.introduction} ${explanation.meaningAndDefinition}`.trim()
    },
    {
      title: "Step-by-Step Walkthrough",
      kind: "steps",
      script: explanation.stepByStepExplanation.map((s, idx) => `Step ${idx + 1}: ${s.stepTitle}. ${s.explanation}`).join(" ")
    },
    {
      title: "Real-World Examples & Analogies",
      kind: "examples",
      script: [
        ...explanation.realWorldExamples.map((e) => `For example, ${e.title}: ${e.description}`),
        ...explanation.analogies.map((a) => `Think of ${a.concept} like this: ${a.analogy}`)
      ].join(" ")
    },
    {
      title: "Key Takeaways & Quick Recap",
      kind: "recap",
      script: [
        explanation.importantPoints.length > 0 ? `Important points to remember: ${explanation.importantPoints.join(" ")}` : "",
        `To wrap up: ${explanation.shortRecap}`
      ].filter(Boolean).join(" ")
    }
  ].filter((c) => c.script.trim().length > 0);
  const sourceList = Array.isArray(rawSections) && rawSections.some((s) => (s?.spokenScript || "").trim().length > 25) ? rawSections.map((s, idx) => ({
    title: (s.title || `Part ${idx + 1}`).trim(),
    kind: (s.kind || "lesson").trim(),
    script: (s.spokenScript || "").trim()
  })).filter((s) => s.script.length > 0) : fallbackCandidates;
  const finalSections = [];
  for (const item of sourceList) {
    const splits = splitSpokenScriptForAudio(item.script, maxSectionChars);
    if (splits.length <= 1) {
      finalSections.push(makeSection(finalSections.length, item.title, item.kind, splits[0] || item.script));
    } else {
      splits.forEach((chunk, partIdx) => {
        finalSections.push(
          makeSection(
            finalSections.length,
            `${item.title} (Part ${partIdx + 1}/${splits.length})`,
            item.kind,
            chunk
          )
        );
      });
    }
  }
  return finalSections;
}
function formatExplanationTranscript(explanation) {
  const parts = [
    explanation.lessonTitle,
    "",
    "1. Introduction",
    explanation.introduction,
    "",
    "2. Meaning & Simple Definition",
    explanation.meaningAndDefinition,
    "",
    "3. Step-by-Step Explanation",
    ...explanation.stepByStepExplanation.map(
      (s, i) => `Step ${i + 1} \u2014 ${s.stepTitle}: ${s.explanation}`
    ),
    "",
    "4. Real-World Examples",
    ...explanation.realWorldExamples.map((e) => `- ${e.title}: ${e.description}`),
    "",
    "5. Helpful Analogies",
    ...explanation.analogies.map((a) => `- ${a.concept}: ${a.analogy}`),
    "",
    "6. Important Points to Remember",
    ...explanation.importantPoints.map((pt) => `- ${pt}`),
    "",
    "7. Short Recap",
    explanation.shortRecap
  ];
  return parts.filter((line) => line !== void 0).join("\n").trim();
}
function buildCacheKey(params) {
  const hash = crypto3.createHash("sha256").update(
    JSON.stringify([
      params.sourceType,
      params.learningLevel,
      params.languageCode,
      params.topic.trim().toLowerCase(),
      params.content.trim().slice(0, 2e4)
    ])
  ).digest("hex");
  return `vt:${hash}`;
}
function parseJsonSafe(rawText) {
  let cleaned = (rawText ?? "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  if (!cleaned) {
    throw new Error("The AI Voice Tutor returned an empty explanation. Please try again.");
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("The AI Voice Tutor returned an unreadable format. Please try again.");
  }
}
async function generateVoiceTutorLesson(params) {
  const learningLevel = normalizeTutorLevel(params.learningLevel);
  const language = resolveTutorLanguage(params.preferredLanguage);
  const sourceType = normalizeTutorSourceType(params.sourceType);
  const trimmedTopic = (params.topic ?? "").trim();
  const trimmedContent = (params.content ?? "").trim();
  const effectiveTopic = trimmedTopic || params.sourceDocumentName || trimmedContent.split(/[.!?\n]/)[0]?.slice(0, 80).trim() || "Study Topic";
  const cacheKey = buildCacheKey({
    topic: effectiveTopic,
    content: trimmedContent,
    learningLevel,
    languageCode: language.code,
    sourceType
  });
  const cached = explanationCache.get(cacheKey);
  if (cached) {
    explanationCache.delete(cacheKey);
    explanationCache.set(cacheKey, cached);
    return { ...cached, cached: true };
  }
  const isLengthyMaterial = trimmedContent.length > 3500;
  const boundedContent = trimmedContent.length > 26e3 ? `${trimmedContent.slice(0, 26e3)}

[Material truncated for lesson focus]` : trimmedContent;
  const contentPromptSection = boundedContent ? `Source Material (${sourceType}${params.sourceDocumentName ? ` \xB7 "${params.sourceDocumentName}"` : ""}):
"""
${boundedContent}
"""

IMPORTANT: Teach and explain the ACTUAL concepts contained in this source material rather than drifting off-topic.` : "No external passage was provided; teach the requested topic thoroughly and accurately.";
  const sectionGuidance = isLengthyMaterial ? "Because the study material is lengthy, divide the spoken lesson into 4 to 7 well-paced, meaningful sections (each ~140-220 words) covering each major part of the material plus examples, key takeaways, and a recap." : "Divide the spoken lesson into 3 to 5 clear, focused sections (each ~100-190 words) so the student can listen section by section.";
  const selectedModel = resolveGeminiTextModel(params.model || DEFAULT_MODEL2);
  const response = await params.ai.models.generateContent({
    model: selectedModel,
    contents: [
      `Target Language: ${language.label} (${language.code})`,
      getTutorLevelPromptGuidance(learningLevel),
      `Topic / Focus: ${effectiveTopic}`,
      contentPromptSection,
      sectionGuidance,
      `Write EVERY field in natural, warm, spoken-friendly ${language.label} so a teacher can read it aloud naturally to a student.`
    ].join("\n\n"),
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel2.LOW },
      systemInstruction: 'You are a gifted, empathetic AI Voice Tutor speaking directly to a student in a 1-on-1 lesson. Do NOT sound like a dry textbook or bullet-list readout. Use natural conversational phrasing, rhetorical signposts ("Let us start with...", "Here is an everyday way to picture this...", "Before we wrap up..."), and crystal-clear pedagogy covering: (1) Introduction, (2) Simple meaning & definition, (3) Step-by-step explanation, (4) Real-world examples, (5) Analogies, (6) Important points to remember, and (7) Short recap. Avoid markdown asterisks or raw URLs inside spokenScript fields so TTS pronounces every sentence smoothly.',
      responseMimeType: "application/json",
      responseSchema: {
        type: Type2.OBJECT,
        properties: {
          lessonTitle: { type: Type2.STRING, description: "Clear lesson title." },
          introduction: {
            type: Type2.STRING,
            description: "Warm, engaging teacher introduction explaining why the topic matters."
          },
          meaningAndDefinition: {
            type: Type2.STRING,
            description: "Meaning and definition explained in simple, accessible language."
          },
          stepByStepExplanation: {
            type: Type2.ARRAY,
            description: "Clear sequential teaching steps walking through how the concept works.",
            items: {
              type: Type2.OBJECT,
              properties: {
                stepTitle: { type: Type2.STRING },
                explanation: { type: Type2.STRING }
              },
              required: ["stepTitle", "explanation"]
            }
          },
          realWorldExamples: {
            type: Type2.ARRAY,
            description: "Concrete real-world examples illustrating the topic.",
            items: {
              type: Type2.OBJECT,
              properties: {
                title: { type: Type2.STRING },
                description: { type: Type2.STRING }
              },
              required: ["title", "description"]
            }
          },
          analogies: {
            type: Type2.ARRAY,
            description: "Relatable analogies comparing hard concepts to familiar everyday situations.",
            items: {
              type: Type2.OBJECT,
              properties: {
                concept: { type: Type2.STRING },
                analogy: { type: Type2.STRING }
              },
              required: ["concept", "analogy"]
            }
          },
          importantPoints: {
            type: Type2.ARRAY,
            description: "3 to 6 essential points the student should remember.",
            items: { type: Type2.STRING }
          },
          shortRecap: {
            type: Type2.STRING,
            description: "Encouraging 2-4 sentence spoken recap at the end of the lesson."
          },
          sections: {
            type: Type2.ARRAY,
            description: "Meaningful sequential audio-ready lesson sections covering the full explanation in natural spoken prose (no markdown symbols).",
            items: {
              type: Type2.OBJECT,
              properties: {
                title: { type: Type2.STRING },
                kind: { type: Type2.STRING },
                spokenScript: { type: Type2.STRING }
              },
              required: ["title", "kind", "spokenScript"]
            }
          }
        },
        required: [
          "lessonTitle",
          "introduction",
          "meaningAndDefinition",
          "stepByStepExplanation",
          "realWorldExamples",
          "analogies",
          "importantPoints",
          "shortRecap",
          "sections"
        ]
      }
    }
  });
  const parsed = parseJsonSafe(response.text);
  const explanation = {
    lessonTitle: (parsed.lessonTitle || effectiveTopic).trim(),
    introduction: (parsed.introduction || "").trim(),
    meaningAndDefinition: (parsed.meaningAndDefinition || "").trim(),
    stepByStepExplanation: Array.isArray(parsed.stepByStepExplanation) ? parsed.stepByStepExplanation.filter((s) => s && (s.stepTitle || s.explanation)).map((s) => ({
      stepTitle: String(s.stepTitle || "Key Step").trim(),
      explanation: String(s.explanation || "").trim()
    })) : [],
    realWorldExamples: Array.isArray(parsed.realWorldExamples) ? parsed.realWorldExamples.filter((e) => e && (e.title || e.description)).map((e) => ({
      title: String(e.title || "Example").trim(),
      description: String(e.description || "").trim()
    })) : [],
    analogies: Array.isArray(parsed.analogies) ? parsed.analogies.filter((a) => a && (a.concept || a.analogy)).map((a) => ({
      concept: String(a.concept || "Core Idea").trim(),
      analogy: String(a.analogy || "").trim()
    })) : [],
    importantPoints: Array.isArray(parsed.importantPoints) ? parsed.importantPoints.map((p) => String(p).trim()).filter(Boolean) : [],
    shortRecap: (parsed.shortRecap || "").trim()
  };
  const sections = buildSectionsFromExplanation(explanation, parsed.sections);
  const fullExplanationText = formatExplanationTranscript(explanation);
  const result = {
    lessonTitle: explanation.lessonTitle,
    topic: effectiveTopic,
    learningLevel,
    preferredLanguage: language.label,
    languageCode: language.code,
    sourceType,
    explanation,
    sections,
    fullExplanationText
  };
  if (explanationCache.size >= EXPLANATION_CACHE_LIMIT) {
    const oldest = explanationCache.keys().next().value;
    if (oldest !== void 0) explanationCache.delete(oldest);
  }
  explanationCache.set(cacheKey, result);
  return { ...result, cached: false };
}
function createAudioAccessToken(audioId, userId, secret, ttlSeconds = 60 * 60 * 24) {
  const exp = Math.floor(Date.now() / 1e3) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ audioId, sub: userId, exp })).toString("base64url");
  const sig = crypto3.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyAudioAccessToken(token, expectedAudioId, secret) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto3.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  if (sigB64.length !== expectedSig.length) return null;
  if (!crypto3.timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!parsed.audioId || !parsed.sub || typeof parsed.exp !== "number") return null;
    if (parsed.audioId !== expectedAudioId) return null;
    if (Math.floor(Date.now() / 1e3) > parsed.exp) return null;
    return { userId: parsed.sub, audioId: parsed.audioId };
  } catch {
    return null;
  }
}

// src/utils/textMetrics.ts
function computeTextStats(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return { words: 0, characters: 0, estimatedMinutes: 0 };
  }
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const characters = trimmed.length;
  const estimatedMinutes = Math.max(1, Math.ceil(words / 180));
  return { words, characters, estimatedMinutes };
}
function validateUploadFileName(fileName) {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".pdf")) {
    return { valid: true, extension: "pdf" };
  }
  if (lower.endsWith(".txt")) {
    return { valid: true, extension: "txt" };
  }
  return {
    valid: false,
    error: "Unsupported file format. Please upload a .pdf or .txt document."
  };
}
function cleanPdfPageText(rawPageText) {
  if (!rawPageText) return "";
  const lines = rawPageText.replace(/\r\n/g, "\n").split("\n").map((line) => line.replace(/\s+$/, ""));
  const paragraphs = [];
  let buffer = [];
  const flushBuffer = () => {
    if (buffer.length > 0) {
      paragraphs.push(buffer.join(" ").trim());
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
    const isShortHeading = stripped.length <= 70 && !stripped.endsWith(".") && !stripped.endsWith(",") && !stripped.endsWith(";") && headingPattern.test(stripped);
    if (isShortHeading) {
      flushBuffer();
      paragraphs.push(stripped);
      continue;
    }
    if (buffer.length > 0 && buffer[buffer.length - 1].endsWith("-") && !buffer[buffer.length - 1].endsWith(" -")) {
      buffer[buffer.length - 1] = buffer[buffer.length - 1].slice(0, -1) + stripped;
    } else {
      buffer.push(stripped);
    }
  }
  flushBuffer();
  return paragraphs.filter(Boolean).join("\n\n");
}
function splitTextIntoChunks(text, chunkLimit = 1400) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length <= chunkLimit) return [cleaned];
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > chunkLimit) {
      const words = sentence.split(" ");
      for (const word of words) {
        if (word.length > chunkLimit) {
          if (current) {
            chunks.push(current);
            current = "";
          }
          for (let i = 0; i < word.length; i += chunkLimit) {
            chunks.push(word.slice(i, i + chunkLimit));
          }
          continue;
        }
        const candidate2 = current ? `${current} ${word}` : word;
        if (candidate2.length <= chunkLimit) {
          current = candidate2;
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
function readAscii(bytes, start, length) {
  let out = "";
  for (let i = 0; i < length && start + i < bytes.length; i++) {
    out += String.fromCharCode(bytes[start + i]);
  }
  return out;
}
function extractWavPcmAndFormat(wav) {
  if (wav.length < 44 || readAscii(wav, 0, 4) !== "RIFF" || readAscii(wav, 8, 4) !== "WAVE") {
    throw new Error("Invalid WAV audio buffer");
  }
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = 24e3;
  let bitsPerSample = 16;
  let pcm = null;
  while (offset + 8 <= wav.length) {
    const chunkId = readAscii(wav, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadStart = offset + 8;
    if (chunkId === "fmt " && payloadStart + 16 <= wav.length) {
      audioFormat = view.getUint16(payloadStart, true);
      numChannels = view.getUint16(payloadStart + 2, true);
      sampleRate = view.getUint32(payloadStart + 4, true);
      bitsPerSample = view.getUint16(payloadStart + 14, true);
    } else if (chunkId === "data") {
      const end = Math.min(wav.length, payloadStart + chunkSize);
      pcm = wav.subarray(payloadStart, end);
      break;
    }
    offset = payloadStart + chunkSize + chunkSize % 2;
  }
  if (!pcm) {
    pcm = wav.subarray(44);
  }
  return { audioFormat, numChannels, sampleRate, bitsPerSample, pcm };
}
function stitchWavClips(clips) {
  if (clips.length === 0) {
    throw new Error("No WAV clips to stitch.");
  }
  if (clips.length === 1) {
    return clips[0];
  }
  const parsed = clips.map(extractWavPcmAndFormat);
  const first = parsed[0];
  const totalPcmBytes = parsed.reduce((sum, clip) => sum + clip.pcm.byteLength, 0);
  const output = new Uint8Array(44 + totalPcmBytes);
  const view = new DataView(output.buffer);
  output.set([82, 73, 70, 70], 0);
  view.setUint32(4, 36 + totalPcmBytes, true);
  output.set([87, 65, 86, 69], 8);
  output.set([102, 109, 116, 32], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, first.audioFormat, true);
  view.setUint16(22, first.numChannels, true);
  view.setUint32(24, first.sampleRate, true);
  const byteRate = first.sampleRate * first.numChannels * first.bitsPerSample / 8;
  const blockAlign = first.numChannels * first.bitsPerSample / 8;
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, first.bitsPerSample, true);
  output.set([100, 97, 116, 97], 36);
  view.setUint32(40, totalPcmBytes, true);
  let writeOffset = 44;
  for (const clip of parsed) {
    output.set(clip.pcm, writeOffset);
    writeOffset += clip.pcm.byteLength;
  }
  return output;
}
function buildCacheKey2(namespace, parts) {
  const joined = `${namespace}::${parts.join("::")}`;
  let hash = 2166136261;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${namespace}:${joined.length}:${(hash >>> 0).toString(16)}`;
}

// server.ts
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
var ROOT_DIR = path3.basename(__dirname) === "dist-server" ? path3.resolve(__dirname, "..") : __dirname;
var PORT = Number(process.env.PORT) || 3e3;
var DEFAULT_TEXT_MODEL = resolveGeminiTextModel(process.env.GEMINI_MODEL);
var FALLBACK_TEXT_MODEL = "gemini-3.1-flash-lite";
var TTS_MODEL = "gemini-3.8-flash-lite-tts";
var FALLBACK_TTS_MODEL = "gemini-3.8-flash-tts";
var MAX_SINGLE_CALL_CHARS = 28e3;
var MAX_CACHE_ENTRIES = 60;
var MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
var DATA_DIR = process.env.DATA_DIR?.trim() ? path3.resolve(process.env.DATA_DIR.trim()) : path3.resolve(ROOT_DIR, ".data");
var db = new AppDatabase(path3.join(DATA_DIR, "smart_learning.db"));
var jwtSecret = getOrInitJwtSecret(DATA_DIR);
var youtubeRateLimiter = new SlidingWindowRateLimiter(15, 6e4);
function isAllowedCorsOrigin(origin) {
  const normalized = origin.trim().replace(/\/+$/, "");
  if (!normalized) return false;
  const configuredAppUrl = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (configuredAppUrl && normalized === configuredAppUrl) {
    return true;
  }
  const extraOrigins = (process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  if (extraOrigins.includes("*") || extraOrigins.includes(normalized)) {
    return true;
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return true;
    }
    if (host.endsWith(".run.app")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
var responseCache = /* @__PURE__ */ new Map();
function getCached(key) {
  if (!responseCache.has(key)) return void 0;
  const val = responseCache.get(key);
  responseCache.delete(key);
  responseCache.set(key, val);
  return val;
}
function setCached(key, value) {
  if (responseCache.has(key)) {
    responseCache.delete(key);
  } else if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey !== void 0) {
      responseCache.delete(oldestKey);
    }
  }
  responseCache.set(key, value);
}
function getGeminiClient(apiVersion) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Please add it in Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...apiVersion ? { apiVersion } : {},
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function extractErrorStatus(err) {
  if (err && typeof err === "object") {
    const obj = err;
    if (typeof obj.status === "number") return obj.status;
    if (typeof obj.statusCode === "number") return obj.statusCode;
    if (typeof obj.code === "number") return obj.code;
  }
  return null;
}
function parseGeminiJson(rawText) {
  let cleaned = (rawText ?? "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  if (!cleaned) {
    throw new Error("The AI model returned an empty response. Please try again.");
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("The AI model returned an unreadable response format. Please try again.");
  }
}
async function generateWithRetry(fn, maxAttempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = extractErrorStatus(err);
      const msg = err instanceof Error ? err.message : String(err);
      const isPermanent = status === 400 || status === 401 || status === 403 || msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID") || msg.includes("INVALID_ARGUMENT") || msg.includes("GEMINI_API_KEY") || /\b403\b/.test(msg);
      if (isPermanent || attempt === maxAttempts - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }
  }
  throw lastError;
}
function isQuotaOrModelUnavailable(err) {
  const status = extractErrorStatus(err);
  const msg = err instanceof Error ? err.message : String(err);
  return status === 429 || status === 404 || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("NOT_FOUND") || /"code"\s*:\s*(?:429|404)/i.test(msg);
}
async function generateTextWithFallback(runner) {
  try {
    return await generateWithRetry(() => runner(DEFAULT_TEXT_MODEL), 2);
  } catch (err) {
    if (DEFAULT_TEXT_MODEL !== FALLBACK_TEXT_MODEL && isQuotaOrModelUnavailable(err)) {
      return await generateWithRetry(() => runner(FALLBACK_TEXT_MODEL), 2);
    }
    throw err;
  }
}
function formatApiError(err, fallback) {
  const status = extractErrorStatus(err);
  const msg = err instanceof Error ? err.message : fallback;
  if (msg.includes("GEMINI_API_KEY")) {
    return { status: 500, message: msg };
  }
  if (status === 401 || status === 403 || msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID") || status === null && /"code"\s*:\s*403|"status"\s*:\s*"PERMISSION_DENIED"/i.test(msg)) {
    return {
      status: 403,
      message: "Gemini API authentication failed. Please verify GEMINI_API_KEY in Settings > Secrets."
    };
  }
  if (status === 429 || msg.includes("RESOURCE_EXHAUSTED") || status === null && /"code"\s*:\s*429|"status"\s*:\s*"RESOURCE_EXHAUSTED"/i.test(msg)) {
    return {
      status: 429,
      message: "Rate limit reached on Gemini API. Please wait a moment and try again."
    };
  }
  return { status: 500, message: msg || fallback };
}
var ALLOWED_TTS_VOICES = /* @__PURE__ */ new Set(["Kore", "Puck", "Charon", "Fenrir", "Zephyr"]);
function normalizeTtsVoice(voiceName) {
  return voiceName && ALLOWED_TTS_VOICES.has(voiceName) ? voiceName : "Kore";
}
async function synthesizeVoiceAudioClip(params) {
  const cleaned = (params.text ?? "").trim();
  if (!cleaned) {
    throw new Error("No speakable text was found.");
  }
  const selectedVoice = normalizeTtsVoice(params.voiceName);
  const slow = Boolean(params.slow);
  const languageLabel = (params.languageLabel || "English").trim() || "English";
  const cacheKey = buildCacheKey2("tts-clip", [
    selectedVoice,
    String(slow),
    languageLabel,
    cleaned
  ]);
  const cached = getCached(cacheKey);
  if (cached) {
    return {
      audioBytes: new Uint8Array(Buffer.from(cached.audioBase64, "base64")),
      mimeType: cached.mimeType,
      chunkCount: cached.chunkCount,
      cached: true
    };
  }
  const chunks = splitTextIntoChunks(cleaned, 1400);
  if (chunks.length === 0) {
    throw new Error("No speakable text was found.");
  }
  const ai = getGeminiClient("v1beta");
  const clipBuffers = [];
  for (const chunk of chunks) {
    const runTtsForModel = (modelName) => ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: chunk,
              speechMetadata: {
                style: slow ? `Warm, calm, slow, crystal-clear ${languageLabel} teacher voice for accessibility` : `Warm, clear, engaging ${languageLabel} teacher voice explaining concepts naturally`
              }
            }
          ]
        }
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: selectedVoice }
          }
        }
      }
    });
    let response;
    try {
      response = await generateWithRetry(() => runTtsForModel(TTS_MODEL), 2);
    } catch (ttsErr) {
      if (isQuotaOrModelUnavailable(ttsErr)) {
        response = await generateWithRetry(() => runTtsForModel(FALLBACK_TTS_MODEL), 2);
      } else {
        throw ttsErr;
      }
    }
    const partBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!partBase64) {
      throw new Error(
        "Audio generation returned empty data for a passage segment. Please try again."
      );
    }
    clipBuffers.push(new Uint8Array(Buffer.from(partBase64, "base64")));
  }
  const stitched = stitchWavClips(clipBuffers);
  setCached(cacheKey, {
    audioBase64: Buffer.from(stitched).toString("base64"),
    mimeType: "audio/wav",
    chunkCount: chunks.length
  });
  return {
    audioBytes: stitched,
    mimeType: "audio/wav",
    chunkCount: chunks.length,
    cached: false
  };
}
function buildSignedAudioUrl(audioId, userId) {
  const token = createAudioAccessToken(audioId, userId, jwtSecret);
  return `/api/voice-tutor/audio/${encodeURIComponent(audioId)}?token=${encodeURIComponent(token)}`;
}
function hydrateVoiceTutorSession(userId, session) {
  const audioRefs = (session.audioRefs || []).map((ref) => ({
    ...ref,
    audioUrl: buildSignedAudioUrl(ref.audioId, userId)
  }));
  const primaryRef = audioRefs.find((r) => r.sectionIndex === 0) ?? audioRefs[0] ?? null;
  return {
    ...session,
    audioRefs,
    primaryAudioUrl: primaryRef ? primaryRef.audioUrl : null
  };
}
function getLevelGuidance(readingLevel) {
  switch (readingLevel) {
    case "Intermediate":
      return "Target level: INTERMEDIATE (high-school / early undergraduate level). Use clear everyday English while retaining standard academic vocabulary where useful, unpacking abstract sentences and providing concrete examples.";
    case "Advanced":
      return "Target level: ADVANCED (clarity-focused academic revision). Preserve full technical nuance and precision while untangling overly dense sentence structures and illustrating complex mechanisms with sharp examples.";
    case "Beginner":
    default:
      return "Target level: BEGINNER (plain everyday English). Use short sentences, familiar words, and clear everyday analogies so any student new to the topic can understand effortlessly.";
  }
}
function getSummaryGuidance(summaryLength) {
  switch (summaryLength) {
    case "Detailed":
      return "Length: DETAILED (3 to 4 thorough paragraphs covering main arguments, supporting mechanisms, and relationships), plus 6 to 8 comprehensive bullet points and 4 to 6 key concepts.";
    case "Medium":
      return "Length: MEDIUM (1 to 2 balanced paragraphs covering the core message and key supporting ideas), plus 4 to 6 clear bullet points and 3 to 5 key concepts.";
    case "Short":
    default:
      return "Length: SHORT (a crisp 2 to 4 sentence overview capturing the central thesis), plus 3 to 4 concise bullet points and 2 to 4 key concepts.";
  }
}
async function condenseLongDocument(ai, text) {
  if (text.length <= MAX_SINGLE_CALL_CHARS) {
    return text;
  }
  const sections = splitTextIntoChunks(text, 14e3).slice(0, 6);
  const notes = [];
  for (let i = 0; i < sections.length; i++) {
    const res = await generateTextWithFallback(
      (model) => ai.models.generateContent({
        model,
        contents: `Extract all factual key points, definitions, and claims from Section ${i + 1} of the study material. Include ONLY information explicitly present in the text:

` + sections[i],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel3.LOW },
          systemInstruction: "Extract faithful, grounded study notes strictly from the provided section without adding outside facts."
        }
      })
    );
    const extracted = (res.text ?? "").trim();
    if (extracted) {
      notes.push(`[Section ${i + 1}]
${extracted}`);
    }
  }
  return notes.join("\n\n") || text.slice(0, MAX_SINGLE_CALL_CHARS);
}
async function extractPdfBuffer(buffer, fileName) {
  const uint8 = new Uint8Array(buffer);
  const result = await extractText(uint8, { mergePages: false });
  const rawPages = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
  const totalPages = result.totalPages || rawPages.length || 1;
  const formattedPages = [];
  let emptyPageCount = 0;
  for (let i = 0; i < rawPages.length; i++) {
    const cleanedPage = cleanPdfPageText(rawPages[i] ?? "");
    if (cleanedPage) {
      if (totalPages > 1) {
        formattedPages.push(`[Page ${i + 1}]
${cleanedPage}`);
      } else {
        formattedPages.push(cleanedPage);
      }
    } else {
      emptyPageCount += 1;
    }
  }
  const combinedText = formattedPages.join("\n\n").trim();
  if (!combinedText) {
    throw new Error(
      `No extractable text was found in "${fileName || "this PDF"}". It appears to be a scanned or image-only PDF, so OCR (Optical Character Recognition) is required before its text can be processed. Please run OCR on the PDF or upload a text-based PDF/TXT file.`
    );
  }
  const pagesWithText = Math.max(1, rawPages.length - emptyPageCount);
  const ocrWarning = emptyPageCount > 0 ? `${emptyPageCount} of ${totalPages} page(s) contained no selectable text (likely scanned images or diagrams requiring OCR). Extracted text from the remaining ${pagesWithText} page(s).` : null;
  return {
    text: combinedText,
    pageCount: totalPages,
    pagesWithText,
    ocrWarning
  };
}
async function generateAssistantPayload(studyMaterial, question) {
  const cacheKey = buildCacheKey2("assistant", [question.toLowerCase(), studyMaterial]);
  const cached = getCached(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }
  const ai = getGeminiClient();
  const boundedMaterial = studyMaterial.length > 36e3 ? `${studyMaterial.slice(0, 36e3)}

[Material truncated to 36,000 characters]` : studyMaterial;
  const response = await generateTextWithFallback(
    (model) => ai.models.generateContent({
      model,
      contents: `Study Material:
"""
${boundedMaterial}
"""

Student Question: ${question}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel3.LOW },
        systemInstruction: "You are a strict, student-friendly AI Learning Assistant. Answer the student question using ONLY the provided Study Material. Never invent facts or rely on outside knowledge. If the Study Material does NOT contain enough information to answer the question, you MUST set foundInMaterial to false, explain clearly that this answer is not available in the uploaded material, set examples to an empty array, and set supportingQuote to an empty string. When foundInMaterial is true, answer in simple, encouraging English, include 1-2 relatable examples based on the concept, and provide a short direct quote from the Study Material as supportingQuote.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type3.OBJECT,
          properties: {
            foundInMaterial: {
              type: Type3.BOOLEAN,
              description: "True only if the answer is supported by the provided study material."
            },
            answer: {
              type: Type3.STRING,
              description: "Clear, beginner-friendly answer grounded in the study material, or explicit notice that the answer is not in the material."
            },
            examples: {
              type: Type3.ARRAY,
              description: "1 to 2 simple examples illustrating the answer when foundInMaterial is true.",
              items: { type: Type3.STRING }
            },
            supportingQuote: {
              type: Type3.STRING,
              description: "Short exact snippet from the study material supporting the answer, or empty string."
            }
          },
          required: ["foundInMaterial", "answer", "examples", "supportingQuote"]
        }
      }
    })
  );
  const parsed = parseGeminiJson(response.text);
  const payload = {
    foundInMaterial: Boolean(parsed.foundInMaterial),
    answer: parsed.answer ?? "I could not find an answer in the provided material.",
    examples: Array.isArray(parsed.examples) ? parsed.examples : [],
    supportingQuote: typeof parsed.supportingQuote === "string" ? parsed.supportingQuote : ""
  };
  setCached(cacheKey, payload);
  return payload;
}
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required. Please sign in." });
    return;
  }
  const token = header.slice(7).trim();
  const claims = verifyJwtToken(token, jwtSecret);
  if (!claims) {
    res.status(401).json({ error: "Your session has expired. Please sign in again." });
    return;
  }
  const user = db.findUserById(claims.sub);
  if (!user) {
    res.status(401).json({ error: "Account not found. Please sign in again." });
    return;
  }
  req.authUser = user;
  next();
}
async function startServer() {
  const app = express();
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    if (origin && isAllowedCorsOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Accept, X-Requested-With, Cache-Control"
      );
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "18mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      model: DEFAULT_TEXT_MODEL,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      youtubeConfigured: Boolean(normalizeYoutubeApiKey(process.env.YOUTUBE_API_KEY))
    });
  });
  app.post("/api/auth/register", (req, res) => {
    try {
      const { fullName, email, password } = req.body;
      const trimmedName = (fullName ?? "").trim();
      const normalizedEmail = sanitizeEmail(email ?? "");
      const rawPassword = password ?? "";
      if (trimmedName.length < 2) {
        res.status(400).json({ error: "Please enter your full name (at least 2 characters)." });
        return;
      }
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        res.status(400).json({ error: "Please enter a valid email address." });
        return;
      }
      if (rawPassword.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters long." });
        return;
      }
      const existing = db.findUserByEmail(normalizedEmail);
      if (existing) {
        res.status(409).json({ error: "An account with this email already exists." });
        return;
      }
      const user = db.createUser({
        fullName: trimmedName,
        email: normalizedEmail,
        passwordHash: hashPassword(rawPassword)
      });
      const accessToken = createJwtToken({ sub: user.id, email: user.email }, jwtSecret);
      res.status(201).json({ accessToken, tokenType: "bearer", user });
    } catch {
      res.status(500).json({ error: "Failed to create account. Please try again." });
    }
  });
  app.post("/api/auth/login", (req, res) => {
    try {
      const { email, password } = req.body;
      const normalizedEmail = sanitizeEmail(email ?? "");
      const rawPassword = password ?? "";
      if (!normalizedEmail || !rawPassword) {
        res.status(400).json({ error: "Please enter your email and password." });
        return;
      }
      const user = db.findUserByEmail(normalizedEmail);
      if (!user || !verifyPassword(rawPassword, user.passwordHash)) {
        res.status(401).json({ error: "Invalid email or password." });
        return;
      }
      const accessToken = createJwtToken({ sub: user.id, email: user.email }, jwtSecret);
      res.json({
        accessToken,
        tokenType: "bearer",
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          createdAt: user.createdAt
        }
      });
    } catch {
      res.status(500).json({ error: "Sign in failed. Please try again." });
    }
  });
  app.post("/api/auth/logout", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ user: req.authUser });
  });
  app.post("/api/documents/upload", requireAuth, async (req, res) => {
    try {
      const userId = req.authUser.id;
      const { fileName, base64Data } = req.body;
      if (!fileName || typeof fileName !== "string") {
        res.status(400).json({ error: "A filename is required." });
        return;
      }
      const check = validateUploadFileName(fileName);
      if (!check.valid || !check.extension) {
        res.status(400).json({ error: check.error ?? "Unsupported file format." });
        return;
      }
      if (!base64Data || typeof base64Data !== "string") {
        res.status(400).json({ error: "No file data was provided." });
        return;
      }
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length === 0) {
        res.status(400).json({ error: "The selected file is empty." });
        return;
      }
      if (buffer.length > MAX_UPLOAD_BYTES) {
        res.status(413).json({ error: "File exceeds the 12 MB upload limit." });
        return;
      }
      let extractedText = "";
      let pageCount = 1;
      let pagesWithText = 1;
      let ocrWarning = null;
      let fileType = "TXT";
      let mimeType = "text/plain";
      if (check.extension === "txt") {
        extractedText = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
        if (!extractedText) {
          res.status(422).json({ error: "The uploaded TXT file contains no readable text." });
          return;
        }
      } else {
        fileType = "PDF";
        mimeType = "application/pdf";
        try {
          const pdfResult = await extractPdfBuffer(buffer, fileName);
          extractedText = pdfResult.text;
          pageCount = pdfResult.pageCount;
          pagesWithText = pdfResult.pagesWithText;
          ocrWarning = pdfResult.ocrWarning;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unable to extract text from this PDF.";
          res.status(422).json({
            error: message.includes("No extractable text") ? message : `Could not read this PDF file. Please ensure it is not password-protected or corrupted. (${message})`
          });
          return;
        }
      }
      const stats = computeTextStats(extractedText);
      const saved = db.createDocument({
        userId,
        originalFilename: fileName.trim(),
        fileType,
        mimeType,
        wordCount: stats.words,
        pageCount,
        pagesWithText,
        ocrWarning,
        extractedText,
        fileContent: new Uint8Array(buffer)
      });
      res.status(201).json(saved);
    } catch {
      res.status(500).json({ error: "Failed to process uploaded document." });
    }
  });
  app.get("/api/documents", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const documents = db.listDocuments(userId);
    res.json({ documents });
  });
  app.get("/api/documents/:id", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const doc = db.getDocument(userId, String(req.params.id));
    if (!doc) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.json(doc);
  });
  app.get("/api/documents/:id/download", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const file = db.getDocumentBinary(userId, String(req.params.id));
    if (!file) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const safeFilename = file.filename.replace(/["\\\r\n]/g, "_");
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
    res.send(Buffer.from(file.content));
  });
  app.delete("/api/documents/:id", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const deleted = db.deleteDocument(userId, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.json({ ok: true });
  });
  app.post("/api/chats", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const { title, documentId } = req.body || {};
    const conversation = db.createConversation({
      userId,
      title,
      documentId: documentId ?? null
    });
    res.status(201).json(conversation);
  });
  app.get("/api/chats", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const q = typeof req.query.q === "string" ? req.query.q : void 0;
    const conversations = db.listConversations(userId, q);
    res.json({ conversations });
  });
  app.get("/api/chats/:chatId", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const detail = db.getConversation(userId, String(req.params.chatId));
    if (!detail) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    res.json(detail);
  });
  app.patch("/api/chats/:chatId", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const { title, documentId } = req.body || {};
    const updated = db.updateConversation(userId, String(req.params.chatId), {
      title,
      documentId
    });
    if (!updated) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    res.json(updated);
  });
  app.delete("/api/chats/:chatId", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const deleted = db.deleteConversation(userId, String(req.params.chatId));
    if (!deleted) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    res.json({ ok: true });
  });
  app.post("/api/chats/:chatId/messages", requireAuth, async (req, res) => {
    try {
      const userId = req.authUser.id;
      const chatId = String(req.params.chatId);
      const chat = db.getConversation(userId, chatId);
      if (!chat) {
        res.status(404).json({ error: "Conversation not found." });
        return;
      }
      const { content, sourceText, documentId } = req.body || {};
      const cleanedQuestion = (content ?? "").trim();
      if (cleanedQuestion.length < 3) {
        res.status(400).json({ error: "Please enter a clear question (at least 3 characters)." });
        return;
      }
      let material = (sourceText ?? "").trim();
      if (!material && documentId) {
        material = db.getDocument(userId, documentId)?.text ?? "";
      }
      if (!material && chat.document?.text) {
        material = chat.document.text;
      }
      if (!material || material.length < 15) {
        res.status(400).json({
          error: "Please load or select study material before asking a question."
        });
        return;
      }
      const aiReply = await generateAssistantPayload(material, cleanedQuestion);
      const turn = db.appendChatTurn({
        userId,
        conversationId: chatId,
        userQuestion: cleanedQuestion,
        assistantAnswer: aiReply.answer,
        foundInMaterial: aiReply.foundInMaterial,
        examples: aiReply.examples,
        supportingQuote: aiReply.supportingQuote,
        newTitle: deriveChatTitle(cleanedQuestion),
        documentId: documentId ?? null
      });
      if (!turn) {
        res.status(404).json({ error: "Conversation not found." });
        return;
      }
      res.status(201).json(turn);
    } catch (err) {
      const formatted = formatApiError(err, "Failed to answer your learning question.");
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  app.get("/api/learning-results", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const resultType = typeof req.query.resultType === "string" ? req.query.resultType : void 0;
    const q = typeof req.query.q === "string" ? req.query.q : void 0;
    const results = db.listLearningResults(userId, { resultType, query: q });
    res.json({ results });
  });
  app.post("/api/learning-results", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const {
      resultType,
      title,
      readingLevel,
      summaryLength,
      sourceExcerpt,
      contentText,
      documentId,
      keywords,
      bulletPoints,
      concepts,
      examples
    } = req.body || {};
    if (!contentText || !contentText.trim()) {
      res.status(400).json({ error: "Result content text is required." });
      return;
    }
    const normalizedType = resultType === "simplified" || resultType === "summary" ? resultType : "explanation";
    const created = db.createLearningResult({
      userId,
      documentId: documentId ?? null,
      resultType: normalizedType,
      title: (title ?? "").trim() || "Saved Study Result",
      readingLevel: readingLevel ?? null,
      summaryLength: summaryLength ?? null,
      sourceExcerpt: (sourceExcerpt ?? "").slice(0, 600),
      contentText: contentText.trim(),
      keywords: Array.isArray(keywords) ? keywords : [],
      bulletPoints: Array.isArray(bulletPoints) ? bulletPoints : [],
      concepts: Array.isArray(concepts) ? concepts : [],
      examples: Array.isArray(examples) ? examples : []
    });
    res.status(201).json(created);
  });
  app.delete("/api/learning-results/:id", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const deleted = db.deleteLearningResult(userId, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "Saved result not found." });
      return;
    }
    res.json({ ok: true });
  });
  app.get("/api/history", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    res.json({
      conversations: db.listConversations(userId),
      documents: db.listDocuments(userId),
      learningResults: db.listLearningResults(userId),
      videoRecommendations: db.listVideoRecommendations(userId),
      voiceTutorSessions: db.listVoiceTutorSessions(userId).map((session) => hydrateVoiceTutorSession(userId, session))
    });
  });
  app.get("/api/history/search", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    res.json({
      query,
      conversations: db.listConversations(userId, query),
      documents: db.listDocuments(userId, query),
      learningResults: db.listLearningResults(userId, { query }),
      videoRecommendations: db.listVideoRecommendations(userId, { query }),
      voiceTutorSessions: db.listVoiceTutorSessions(userId, { query }).map((session) => hydrateVoiceTutorSession(userId, session))
    });
  });
  app.post("/api/recommendations/youtube", requireAuth, async (req, res) => {
    try {
      const userId = req.authUser.id;
      const rateCheck = youtubeRateLimiter.allow(userId);
      if (!rateCheck.allowed) {
        res.status(429).json({
          error: `Too many recommendation requests. Please wait ${rateCheck.retryAfterSeconds} second(s) and try again.`
        });
        return;
      }
      const {
        content = "",
        customTopic = "",
        keywords = [],
        learningLevel = "Beginner",
        preferredLanguage = "English",
        sourceType = "text",
        documentId = null,
        conversationId = null,
        forceRefresh = false,
        saveToHistory = true
      } = req.body || {};
      let effectiveContent = typeof content === "string" ? content.trim() : "";
      const trimmedCustomTopic = typeof customTopic === "string" ? customTopic.trim() : "";
      if (!effectiveContent && documentId) {
        const doc = db.getDocument(userId, documentId);
        if (doc?.text) {
          effectiveContent = doc.text;
        }
      }
      if (!effectiveContent && conversationId) {
        const conv = db.getConversation(userId, conversationId);
        if (conv) {
          const msgContext = conv.messages.map((m) => m.content).join("\n");
          effectiveContent = msgContext || conv.document?.text || conv.title;
        }
      }
      if (effectiveContent.length < 3 && trimmedCustomTopic.length < 2) {
        res.status(400).json({
          error: "Please provide a custom topic, study text, summary, or question to recommend educational videos."
        });
        return;
      }
      const result = await recommendYoutubeVideos({
        content: effectiveContent,
        customTopic: trimmedCustomTopic,
        keywords: Array.isArray(keywords) ? keywords : [],
        learningLevel,
        preferredLanguage,
        sourceType: trimmedCustomTopic && !effectiveContent ? "custom" : sourceType,
        forceRefresh: Boolean(forceRefresh),
        getAiClient: () => {
          try {
            return getGeminiClient();
          } catch {
            return null;
          }
        }
      });
      let savedRecordId = null;
      let createdAt = (/* @__PURE__ */ new Date()).toISOString();
      if (saveToHistory && result.videos.length > 0) {
        const saved = db.saveVideoRecommendation({
          userId,
          conversationId,
          documentId,
          sourceType: result.sourceType,
          topic: result.topic,
          searchQuery: result.searchQuery,
          learningLevel: result.learningLevel,
          preferredLanguage: result.preferredLanguage,
          keywords: result.keywords,
          videos: result.videos
        });
        savedRecordId = saved.id;
        createdAt = saved.createdAt;
      }
      res.json({
        id: savedRecordId,
        conversationId: conversationId ?? null,
        documentId: documentId ?? null,
        ...result,
        createdAt
      });
    } catch (err) {
      if (err instanceof YouTubeServiceError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const formatted = formatApiError(
        err,
        "Failed to fetch YouTube educational video recommendations."
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  app.get("/api/recommendations/youtube/history", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId : void 0;
    const query = typeof req.query.q === "string" ? req.query.q : void 0;
    const recommendations = db.listVideoRecommendations(userId, { conversationId, query });
    res.json({ recommendations });
  });
  app.delete("/api/recommendations/youtube/:id", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const deleted = db.deleteVideoRecommendation(userId, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "Saved video recommendation not found." });
      return;
    }
    res.json({ ok: true });
  });
  app.post("/api/extract-pdf", requireAuth, async (req, res) => {
    try {
      const { base64Data, fileName } = req.body;
      if (!base64Data || typeof base64Data !== "string") {
        res.status(400).json({ error: "No PDF data was provided." });
        return;
      }
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length === 0) {
        res.status(400).json({ error: "The uploaded PDF file is empty." });
        return;
      }
      const pdfResult = await extractPdfBuffer(buffer, fileName || "this PDF");
      res.json(pdfResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to extract text from this PDF.";
      res.status(422).json({
        error: message.includes("No extractable text") ? message : `Could not read this PDF file. Please ensure it is not password-protected or corrupted. (${message})`
      });
    }
  });
  app.post("/api/simplify", requireAuth, async (req, res) => {
    try {
      const userId = req.authUser.id;
      const {
        text,
        readingLevel = "Beginner",
        documentId = null,
        saveToHistory = true
      } = req.body;
      const cleaned = (text ?? "").trim();
      if (!cleaned) {
        res.status(400).json({ error: "Please provide educational text to simplify." });
        return;
      }
      const normalizedLevel = readingLevel === "Intermediate" || readingLevel === "Advanced" ? readingLevel : "Beginner";
      const cacheKey = buildCacheKey2("simplify", [normalizedLevel, cleaned]);
      let payload = getCached(cacheKey);
      let fromCache = Boolean(payload);
      if (!payload) {
        const ai = getGeminiClient();
        const effectiveText = cleaned.length > MAX_SINGLE_CALL_CHARS ? await condenseLongDocument(ai, cleaned) : cleaned;
        const response = await generateTextWithFallback(
          (model) => ai.models.generateContent({
            model,
            contents: `${getLevelGuidance(normalizedLevel)}

Simplify the following educational content while preserving 100% of its core meaning and important details:

${effectiveText}`,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel3.LOW },
              systemInstruction: "You are an empathetic educational accessibility assistant. Rewrite complex academic or technical passages cleanly according to the requested explanation level while preserving 100% of the original meaning and accuracy. Explain difficult technical terms clearly and give relatable real-world examples.",
              responseMimeType: "application/json",
              responseSchema: {
                type: Type3.OBJECT,
                properties: {
                  simplifiedText: {
                    type: Type3.STRING,
                    description: "The rewritten passage tailored to the chosen explanation level."
                  },
                  difficultConcepts: {
                    type: Type3.ARRAY,
                    description: "Technical or difficult terms explained in plain language.",
                    items: {
                      type: Type3.OBJECT,
                      properties: {
                        term: { type: Type3.STRING },
                        explanation: { type: Type3.STRING }
                      },
                      required: ["term", "explanation"]
                    }
                  },
                  examples: {
                    type: Type3.ARRAY,
                    description: "Helpful real-world examples illustrating the ideas.",
                    items: { type: Type3.STRING }
                  }
                },
                required: ["simplifiedText", "difficultConcepts", "examples"]
              }
            }
          })
        );
        const parsed = parseGeminiJson(response.text);
        payload = {
          simplifiedText: parsed.simplifiedText ?? "",
          difficultConcepts: Array.isArray(parsed.difficultConcepts) ? parsed.difficultConcepts : [],
          examples: Array.isArray(parsed.examples) ? parsed.examples : []
        };
        setCached(cacheKey, payload);
      }
      let savedResultId = null;
      if (saveToHistory) {
        const doc = documentId ? db.getDocument(userId, documentId) : null;
        const titlePrefix = doc ? doc.originalFilename : deriveChatTitle(cleaned);
        const saved = db.createLearningResult({
          userId,
          documentId: doc?.id ?? null,
          resultType: "simplified",
          title: `Simplified (${normalizedLevel}) \xB7 ${titlePrefix}`,
          readingLevel: normalizedLevel,
          sourceExcerpt: cleaned.slice(0, 600),
          contentText: payload.simplifiedText,
          concepts: payload.difficultConcepts,
          examples: payload.examples
        });
        savedResultId = saved.id;
      }
      res.json({ ...payload, cached: fromCache, savedResultId });
    } catch (err) {
      const formatted = formatApiError(err, "Failed to simplify educational text.");
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  app.post("/api/summarize", requireAuth, async (req, res) => {
    try {
      const userId = req.authUser.id;
      const {
        text,
        summaryLength = "Short",
        documentId = null,
        saveToHistory = true
      } = req.body;
      const cleaned = (text ?? "").trim();
      if (!cleaned) {
        res.status(400).json({ error: "Please provide educational text to summarize." });
        return;
      }
      const normalizedLength = summaryLength === "Medium" || summaryLength === "Detailed" ? summaryLength : "Short";
      const cacheKey = buildCacheKey2("summarize", [normalizedLength, cleaned]);
      let payload = getCached(cacheKey);
      let fromCache = Boolean(payload);
      if (!payload) {
        const ai = getGeminiClient();
        const sourceForSummary = await condenseLongDocument(ai, cleaned);
        const response = await generateTextWithFallback(
          (model) => ai.models.generateContent({
            model,
            contents: `${getSummaryGuidance(normalizedLength)}

Strictly summarize ONLY what is supported by the source material below. Do NOT introduce external facts or unsupported claims:

` + sourceForSummary,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel3.LOW },
              systemInstruction: "You are an accurate educational study-skills assistant. Produce faithful summaries calibrated to the requested length (Short, Medium, or Detailed). Extract high-value keywords, bullet-point takeaways, and key definitions strictly supported by the source text.",
              responseMimeType: "application/json",
              responseSchema: {
                type: Type3.OBJECT,
                properties: {
                  summaryText: {
                    type: Type3.STRING,
                    description: "Overview summary calibrated to the requested length."
                  },
                  keywords: {
                    type: Type3.ARRAY,
                    description: "5 to 10 essential keywords explicitly present in the source text.",
                    items: { type: Type3.STRING }
                  },
                  bulletPoints: {
                    type: Type3.ARRAY,
                    description: "Important study takeaways as concise bullet points.",
                    items: { type: Type3.STRING }
                  },
                  keyConcepts: {
                    type: Type3.ARRAY,
                    description: "Important concepts and definitions supported by the text.",
                    items: {
                      type: Type3.OBJECT,
                      properties: {
                        term: { type: Type3.STRING },
                        definition: { type: Type3.STRING }
                      },
                      required: ["term", "definition"]
                    }
                  }
                },
                required: ["summaryText", "keywords", "bulletPoints", "keyConcepts"]
              }
            }
          })
        );
        const parsed = parseGeminiJson(response.text);
        payload = {
          summaryText: parsed.summaryText ?? "",
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
          bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints : [],
          keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : []
        };
        setCached(cacheKey, payload);
      }
      let savedResultId = null;
      if (saveToHistory) {
        const doc = documentId ? db.getDocument(userId, documentId) : null;
        const titlePrefix = doc ? doc.originalFilename : deriveChatTitle(cleaned);
        const saved = db.createLearningResult({
          userId,
          documentId: doc?.id ?? null,
          resultType: "summary",
          title: `Summary (${normalizedLength}) \xB7 ${titlePrefix}`,
          summaryLength: normalizedLength,
          sourceExcerpt: cleaned.slice(0, 600),
          contentText: payload.summaryText,
          keywords: payload.keywords,
          bulletPoints: payload.bulletPoints,
          concepts: payload.keyConcepts
        });
        savedResultId = saved.id;
      }
      res.json({ ...payload, cached: fromCache, savedResultId });
    } catch (err) {
      const formatted = formatApiError(err, "Failed to summarize educational text.");
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  app.post("/api/assistant", requireAuth, async (req, res) => {
    try {
      const { text, question } = req.body;
      const cleanedText = (text ?? "").trim();
      const cleanedQuestion = (question ?? "").trim();
      if (!cleanedText || cleanedText.length < 15) {
        res.status(400).json({ error: "Please load or enter educational material before asking a question." });
        return;
      }
      if (!cleanedQuestion || cleanedQuestion.length < 3) {
        res.status(400).json({ error: "Please enter a clear question about your study material." });
        return;
      }
      const payload = await generateAssistantPayload(cleanedText, cleanedQuestion);
      res.json(payload);
    } catch (err) {
      const formatted = formatApiError(err, "Failed to answer your learning question.");
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  app.get("/api/voice-tutor/languages", (_req, res) => {
    res.json({ languages: SUPPORTED_TUTOR_LANGUAGES });
  });
  app.post("/api/voice-tutor/explain", requireAuth, async (req, res) => {
    try {
      const userId = req.authUser.id;
      const {
        topic = "",
        content = "",
        sourceType = "topic",
        documentId = null,
        conversationId = null,
        learningLevel = "Beginner",
        preferredLanguage = "English",
        voiceName = "Kore",
        slow = false,
        generateInitialAudio = true
      } = req.body || {};
      let effectiveTopic = typeof topic === "string" ? topic.trim() : "";
      let effectiveContent = typeof content === "string" ? content.trim() : "";
      let sourceDocumentName = "";
      const normalizedSourceType = normalizeTutorSourceType(sourceType);
      const normalizedLevel = normalizeTutorLevel(learningLevel);
      const language = resolveTutorLanguage(preferredLanguage);
      const selectedVoice = normalizeTtsVoice(voiceName);
      const slowFlag = Boolean(slow);
      if (documentId) {
        const doc = db.getDocument(userId, documentId);
        if (doc) {
          sourceDocumentName = doc.originalFilename || doc.filename;
          if (!effectiveContent && doc.text) {
            effectiveContent = doc.text.trim();
          }
          if (!effectiveTopic) {
            effectiveTopic = sourceDocumentName;
          }
        }
      }
      if (conversationId) {
        const conv = db.getConversation(userId, conversationId);
        if (conv) {
          if (!effectiveContent) {
            const msgContext = conv.messages.map((m) => `${m.role === "user" ? "Student Question" : "Tutor Answer"}: ${m.content}`).join("\n\n");
            effectiveContent = msgContext || conv.document?.text || conv.title;
          }
          if (!effectiveTopic) {
            effectiveTopic = conv.title || "Previous Conversation";
          }
        }
      }
      if (effectiveTopic.length < 2 && effectiveContent.length < 10) {
        res.status(400).json({
          error: "Please enter a topic, paste study text, or select a document, summary, or conversation to explain."
        });
        return;
      }
      const ai = getGeminiClient();
      const condensedContent = effectiveContent.length > MAX_SINGLE_CALL_CHARS ? await condenseLongDocument(ai, effectiveContent) : effectiveContent;
      const lesson = await generateTextWithFallback(
        (model) => generateVoiceTutorLesson({
          ai,
          topic: effectiveTopic,
          content: condensedContent,
          sourceType: normalizedSourceType,
          learningLevel: normalizedLevel,
          preferredLanguage: language.label,
          sourceDocumentName,
          model
        })
      );
      const savedSession = db.saveVoiceTutorSession({
        userId,
        documentId,
        conversationId,
        sourceType: lesson.sourceType,
        topic: lesson.topic,
        lessonTitle: lesson.lessonTitle,
        sourceExcerpt: effectiveContent || effectiveTopic,
        learningLevel: lesson.learningLevel,
        preferredLanguage: lesson.preferredLanguage,
        languageCode: lesson.languageCode,
        voiceName: selectedVoice,
        slow: slowFlag,
        explanation: lesson.explanation,
        sections: lesson.sections,
        audioRefs: []
      });
      let audioId = null;
      let audioUrl = null;
      let audioError = null;
      let chunkCount = 0;
      if (generateInitialAudio !== false && lesson.sections.length > 0) {
        try {
          const clip = await synthesizeVoiceAudioClip({
            text: lesson.sections[0].spokenScript,
            voiceName: selectedVoice,
            slow: slowFlag,
            languageLabel: lesson.preferredLanguage
          });
          const audioRef = db.saveVoiceTutorAudio({
            userId,
            sessionId: savedSession.id,
            sectionIndex: 0,
            languageCode: lesson.languageCode,
            voiceName: selectedVoice,
            slow: slowFlag,
            mimeType: clip.mimeType,
            audioBytes: clip.audioBytes
          });
          audioId = audioRef.audioId;
          audioUrl = buildSignedAudioUrl(audioRef.audioId, userId);
          chunkCount = clip.chunkCount;
        } catch (ttsErr) {
          audioError = formatApiError(
            ttsErr,
            "Explanation generated, but speech synthesis failed."
          ).message;
        }
      }
      const latestSession = db.getVoiceTutorSession(userId, savedSession.id) ?? savedSession;
      const hydrated = hydrateVoiceTutorSession(userId, latestSession);
      res.json({
        session: hydrated,
        explanation: hydrated.explanation,
        sections: hydrated.sections,
        audioId,
        audioUrl,
        sectionIndex: 0,
        mimeType: "audio/wav",
        chunkCount,
        audioError,
        metadata: {
          topic: hydrated.topic,
          lessonTitle: hydrated.lessonTitle,
          learningLevel: hydrated.learningLevel,
          preferredLanguage: hydrated.preferredLanguage,
          languageCode: hydrated.languageCode,
          sourceType: hydrated.sourceType,
          voiceName: hydrated.voiceName,
          sectionCount: hydrated.sections.length
        },
        cached: lesson.cached
      });
    } catch (err) {
      const formatted = formatApiError(
        err,
        "Failed to generate AI Voice Tutor explanation."
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  app.post("/api/voice-tutor/sections/audio", requireAuth, async (req, res) => {
    try {
      const userId = req.authUser.id;
      const {
        sessionId = null,
        sectionIndex = 0,
        text = "",
        preferredLanguage = "English",
        voiceName = "Kore",
        slow = false
      } = req.body || {};
      const selectedVoice = normalizeTtsVoice(voiceName);
      const slowFlag = Boolean(slow);
      const numericIndex = Number.isInteger(sectionIndex) && sectionIndex >= 0 ? sectionIndex : 0;
      let targetSession = sessionId ? db.getVoiceTutorSession(userId, sessionId) : null;
      if (sessionId && !targetSession) {
        res.status(404).json({ error: "Voice Tutor session not found." });
        return;
      }
      const language = resolveTutorLanguage(
        targetSession?.preferredLanguage || preferredLanguage
      );
      let spokenText = typeof text === "string" ? text.trim() : "";
      if (!spokenText && targetSession) {
        const matchedSection = targetSession.sections.find(
          (s) => s.index === numericIndex
        );
        if (!matchedSection) {
          res.status(400).json({ error: "Requested lesson section was not found." });
          return;
        }
        spokenText = matchedSection.spokenScript;
      }
      if (!spokenText) {
        res.status(400).json({ error: "Section text is required to synthesize audio." });
        return;
      }
      if (targetSession) {
        const existingRef = db.findVoiceTutorAudioBySection({
          userId,
          sessionId: targetSession.id,
          sectionIndex: numericIndex,
          languageCode: language.code,
          voiceName: selectedVoice,
          slow: slowFlag
        });
        if (existingRef) {
          res.json({
            audioId: existingRef.audioId,
            audioUrl: buildSignedAudioUrl(existingRef.audioId, userId),
            sectionIndex: numericIndex,
            mimeType: existingRef.mimeType,
            chunkCount: 1,
            cached: true
          });
          return;
        }
      }
      const clip = await synthesizeVoiceAudioClip({
        text: spokenText,
        voiceName: selectedVoice,
        slow: slowFlag,
        languageLabel: language.label
      });
      const audioRef = db.saveVoiceTutorAudio({
        userId,
        sessionId: targetSession?.id ?? null,
        sectionIndex: numericIndex,
        languageCode: language.code,
        voiceName: selectedVoice,
        slow: slowFlag,
        mimeType: clip.mimeType,
        audioBytes: clip.audioBytes
      });
      res.json({
        audioId: audioRef.audioId,
        audioUrl: buildSignedAudioUrl(audioRef.audioId, userId),
        sectionIndex: numericIndex,
        mimeType: audioRef.mimeType,
        chunkCount: clip.chunkCount,
        cached: clip.cached
      });
    } catch (err) {
      const formatted = formatApiError(
        err,
        "Failed to generate section audio."
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  app.get("/api/voice-tutor/audio/:audioId", (req, res) => {
    const audioId = String(req.params.audioId || "").trim();
    if (!audioId) {
      res.status(400).json({ error: "Audio ID is required." });
      return;
    }
    let userId = null;
    const queryToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (queryToken) {
      const verified = verifyAudioAccessToken(queryToken, audioId, jwtSecret);
      if (verified) {
        userId = verified.userId;
      }
    }
    if (!userId) {
      const header = req.headers.authorization || "";
      if (header.startsWith("Bearer ")) {
        const claims = verifyJwtToken(header.slice(7).trim(), jwtSecret);
        if (claims?.sub) {
          userId = claims.sub;
        }
      }
    }
    if (!userId) {
      res.status(401).json({ error: "Authentication required to access audio." });
      return;
    }
    const record = db.getVoiceTutorAudio(userId, audioId);
    if (!record) {
      res.status(404).json({ error: "Audio clip not found." });
      return;
    }
    const buffer = Buffer.from(record.bytes);
    const totalLength = buffer.length;
    const mimeType = record.mimeType || "audio/wav";
    const rangeHeader = req.headers.range;
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="voice-tutor-${audioId}.wav"`
    );
    if (rangeHeader && /^bytes=\d*-\d*$/i.test(rangeHeader.trim())) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/i, "").split("-");
      let start = startStr ? Number.parseInt(startStr, 10) : 0;
      let end = endStr ? Number.parseInt(endStr, 10) : totalLength - 1;
      if (Number.isNaN(start) || start < 0) start = 0;
      if (Number.isNaN(end) || end >= totalLength) end = totalLength - 1;
      if (start > end || start >= totalLength) {
        res.status(416).setHeader("Content-Range", `bytes */${totalLength}`).end();
        return;
      }
      const chunk = buffer.subarray(start, end + 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${totalLength}`);
      res.setHeader("Content-Length", String(chunk.length));
      res.send(chunk);
      return;
    }
    res.setHeader("Content-Length", String(totalLength));
    res.send(buffer);
  });
  app.get("/api/voice-tutor/history", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const query = typeof req.query.q === "string" ? req.query.q.trim() : void 0;
    const sessions = db.listVoiceTutorSessions(userId, { query }).map((session) => hydrateVoiceTutorSession(userId, session));
    res.json({ sessions });
  });
  app.delete("/api/voice-tutor/:id", requireAuth, (req, res) => {
    const userId = req.authUser.id;
    const deleted = db.deleteVoiceTutorSession(userId, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "Voice Tutor session not found." });
      return;
    }
    res.json({ ok: true });
  });
  app.post("/api/tts", requireAuth, async (req, res) => {
    try {
      const {
        text,
        voiceName = "Kore",
        slow = false,
        language = "English"
      } = req.body;
      const cleaned = (text ?? "").trim();
      if (!cleaned) {
        res.status(400).json({ error: "Please provide text to convert into speech." });
        return;
      }
      const resolvedLanguage = resolveTutorLanguage(language);
      const clip = await synthesizeVoiceAudioClip({
        text: cleaned,
        voiceName,
        slow,
        languageLabel: resolvedLanguage.label
      });
      res.json({
        audioBase64: Buffer.from(clip.audioBytes).toString("base64"),
        mimeType: clip.mimeType,
        chunkCount: clip.chunkCount,
        language: resolvedLanguage.label,
        cached: clip.cached
      });
    } catch (err) {
      const formatted = formatApiError(err, "Failed to generate speech audio.");
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });
  app.use((err, req, res, next) => {
    if (!req.path.startsWith("/api")) {
      next(err);
      return;
    }
    if (res.headersSent) {
      next(err);
      return;
    }
    const errObj = err;
    const status = typeof errObj?.status === "number" ? errObj.status : typeof errObj?.statusCode === "number" ? errObj.statusCode : 500;
    const message = errObj?.type === "entity.too.large" ? "Request payload exceeds the 18 MB limit." : err instanceof Error && err.message ? err.message : "Unexpected server error.";
    res.status(status).json({ error: message });
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa"
    });
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        res.status(404).json({ error: "API endpoint not found." });
        return;
      }
      vite.middlewares(req, res, next);
    });
  } else {
    const distDir = path3.resolve(ROOT_DIR, "dist");
    app.use(express.static(distDir));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api")) {
        res.status(404).json({ error: "API endpoint not found." });
        return;
      }
      res.sendFile(path3.join(distDir, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Smart Learning Accessibility Assistant running on http://0.0.0.0:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
