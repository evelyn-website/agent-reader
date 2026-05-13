import { join, basename } from 'path'
import { createHash, randomUUID } from 'crypto'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'
import type {
  AnnotationRow,
  ChatMessageRow,
  ChatSessionRow,
  ChatSessionSummary,
  CreateAnnotationInput,
  CreateChatMessageInput,
  CreateChatSessionInput,
  DocumentRow,
  ProjectDashboard,
  ProjectMarkSummary,
  ProjectRow,
  UpdateAnnotationInput
} from '../../shared/dbTypes'

export type {
  AnnotationKind,
  AnnotationRow,
  ChatMessageRow,
  ChatMessageRole,
  ChatMessageStatus,
  ChatSessionRow,
  ChatSessionSummary,
  CreateAnnotationInput,
  CreateChatMessageInput,
  CreateChatSessionInput,
  DocumentRow,
  ProjectDashboard,
  ProjectDocumentSummary,
  ProjectMarkSummary,
  ProjectRow,
  UpdateAnnotationInput
} from '../../shared/dbTypes'

let db: Database.Database | null = null

export function createDb(dbPath: string): Database.Database {
  const instance = new Database(dbPath)
  if (dbPath !== ':memory:') instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')
  runMigrations(instance)
  return instance
}

export function initDb(dbPath?: string): void {
  let path = dbPath
  if (!path) {
    path = join(app.getPath('userData'), 'agent-reader.db')
  }
  db = createDb(path)
}

export function setDbForTesting(instance: Database.Database | null): void {
  db = instance
}

function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function recordOpen(args: { path: string; data: Buffer }): DocumentRow {
  const d = getDb()
  const id = createHash('sha256').update(args.data).digest('hex')
  const now = Date.now()
  const filename = basename(args.path)
  const size = args.data.byteLength

  const existing = d.prepare<[string], DocumentRow>(`SELECT * FROM documents WHERE id = ?`).get(id)

  if (existing) {
    d.prepare(
      `UPDATE documents
         SET filename = ?, last_path = ?, last_opened_at = ?, open_count = open_count + 1
       WHERE id = ?`
    ).run(filename, args.path, now, id)
  } else {
    d.prepare(
      `INSERT INTO documents
         (id, filename, last_path, size_bytes, first_opened_at, last_opened_at, open_count)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(id, filename, args.path, size, now, now)
  }

  return d.prepare<[string], DocumentRow>(`SELECT * FROM documents WHERE id = ?`).get(id)!
}

export function getDocument(id: string): DocumentRow | null {
  return (
    getDb().prepare<[string], DocumentRow>(`SELECT * FROM documents WHERE id = ?`).get(id) ?? null
  )
}

export function listRecent(limit = 50): DocumentRow[] {
  return getDb()
    .prepare<[number], DocumentRow>(`SELECT * FROM documents ORDER BY last_opened_at DESC LIMIT ?`)
    .all(limit)
}

export function listChatSessions(scopeKey: string): ChatSessionSummary[] {
  return getDb()
    .prepare<[string], ChatSessionSummary>(
      `SELECT
         chat_sessions.*,
         COUNT(chat_messages.id) AS message_count,
         (
           SELECT content
           FROM chat_messages latest
           WHERE latest.session_id = chat_sessions.id
           ORDER BY latest.created_at DESC
           LIMIT 1
         ) AS last_message_preview
       FROM chat_sessions
       LEFT JOIN chat_messages ON chat_messages.session_id = chat_sessions.id
       WHERE chat_sessions.scope_key = ?
       GROUP BY chat_sessions.id
       ORDER BY COALESCE(chat_sessions.last_message_at, chat_sessions.updated_at) DESC`
    )
    .all(scopeKey)
}

export function createChatSession(input: CreateChatSessionInput): ChatSessionRow {
  const d = getDb()
  const id = randomUUID()
  const now = Date.now()
  d.prepare(
    `INSERT INTO chat_sessions
      (id, scope_key, title, origin_document_id, origin_page_number,
       origin_text_excerpt, claude_session_id, created_at, updated_at, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`
  ).run(
    id,
    input.scope_key,
    input.title?.trim() || 'New session',
    input.origin_document_id ?? null,
    input.origin_page_number ?? null,
    input.origin_text_excerpt ?? null,
    now,
    now
  )
  return d.prepare<[string], ChatSessionRow>(`SELECT * FROM chat_sessions WHERE id = ?`).get(id)!
}

export function getChatSession(id: string): ChatSessionRow | null {
  return (
    getDb().prepare<[string], ChatSessionRow>(`SELECT * FROM chat_sessions WHERE id = ?`).get(id) ??
    null
  )
}

export function updateChatSessionTitle(id: string, title: string): ChatSessionRow | null {
  const d = getDb()
  const existing = getChatSession(id)
  if (!existing) return null
  d.prepare(`UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?`).run(
    title.trim() || 'New session',
    Date.now(),
    id
  )
  return d.prepare<[string], ChatSessionRow>(`SELECT * FROM chat_sessions WHERE id = ?`).get(id)!
}

export function deleteChatSession(id: string): void {
  getDb().prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id)
}

export function listChatMessages(sessionId: string): ChatMessageRow[] {
  return getDb()
    .prepare<
      [string],
      ChatMessageRow
    >(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at, id`)
    .all(sessionId)
}

export function createChatMessage(input: CreateChatMessageInput): ChatMessageRow {
  const d = getDb()
  const id = randomUUID()
  const now = Date.now()
  const create = d.transaction(() => {
    d.prepare(
      `INSERT INTO chat_messages
        (id, session_id, role, content, status, created_at, updated_at, error_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.session_id,
      input.role,
      input.content,
      input.status ?? 'complete',
      now,
      now,
      input.error_text ?? null
    )
    d.prepare(`UPDATE chat_sessions SET updated_at = ?, last_message_at = ? WHERE id = ?`).run(
      now,
      now,
      input.session_id
    )
  })
  create()
  return d.prepare<[string], ChatMessageRow>(`SELECT * FROM chat_messages WHERE id = ?`).get(id)!
}

export function listAnnotations(documentId: string): AnnotationRow[] {
  return getDb()
    .prepare<
      [string],
      AnnotationRow
    >(`SELECT * FROM annotations WHERE document_id = ? ORDER BY page_number, created_at`)
    .all(documentId)
}

export function createAnnotation(input: CreateAnnotationInput): AnnotationRow {
  const d = getDb()
  const id = randomUUID()
  const now = Date.now()
  d.prepare(
    `INSERT INTO annotations
      (id, document_id, page_number, kind, color, rects_json,
       anchor_x, anchor_y, text_excerpt, comment, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.document_id,
    input.page_number,
    input.kind,
    input.color ?? null,
    input.rects_json ?? null,
    input.anchor_x ?? null,
    input.anchor_y ?? null,
    input.text_excerpt ?? null,
    input.comment ?? null,
    now,
    now
  )
  return d.prepare<[string], AnnotationRow>(`SELECT * FROM annotations WHERE id = ?`).get(id)!
}

export function updateAnnotation(id: string, patch: UpdateAnnotationInput): AnnotationRow | null {
  const d = getDb()
  const existing = d
    .prepare<[string], AnnotationRow>(`SELECT * FROM annotations WHERE id = ?`)
    .get(id)
  if (!existing) return null
  const merged = {
    color: patch.color !== undefined ? patch.color : existing.color,
    rects_json: patch.rects_json !== undefined ? patch.rects_json : existing.rects_json,
    anchor_x: patch.anchor_x !== undefined ? patch.anchor_x : existing.anchor_x,
    anchor_y: patch.anchor_y !== undefined ? patch.anchor_y : existing.anchor_y,
    comment: patch.comment !== undefined ? patch.comment : existing.comment
  }
  d.prepare(
    `UPDATE annotations
       SET color = ?, rects_json = ?, anchor_x = ?, anchor_y = ?, comment = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    merged.color,
    merged.rects_json,
    merged.anchor_x,
    merged.anchor_y,
    merged.comment,
    Date.now(),
    id
  )
  return d.prepare<[string], AnnotationRow>(`SELECT * FROM annotations WHERE id = ?`).get(id)!
}

export function deleteAnnotation(id: string): void {
  getDb().prepare(`DELETE FROM annotations WHERE id = ?`).run(id)
}

export function recordProjectOpen(args: { path: string; name: string }): ProjectRow {
  const d = getDb()
  const now = Date.now()
  d.prepare(
    `INSERT INTO projects (path, name, first_opened_at, last_opened_at, open_count)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(path) DO UPDATE SET
       name = excluded.name,
       last_opened_at = excluded.last_opened_at,
       open_count = projects.open_count + 1`
  ).run(args.path, args.name, now, now)
  return d.prepare<[string], ProjectRow>(`SELECT * FROM projects WHERE path = ?`).get(args.path)!
}

export function listRecentProjects(limit = 10): ProjectRow[] {
  return getDb()
    .prepare<[number], ProjectRow>(`SELECT * FROM projects ORDER BY last_opened_at DESC LIMIT ?`)
    .all(limit)
}

export function deleteProject(path: string): void {
  getDb().prepare(`DELETE FROM projects WHERE path = ?`).run(path)
}

interface ProjectDocumentRow extends DocumentRow {
  mark_count: number
  highlight_count: number
  note_count: number
}

function pathPlaceholders(paths: string[]): string {
  return paths.map(() => '?').join(', ')
}

export function getProjectDashboard(paths: string[], markLimit = 24): ProjectDashboard {
  if (paths.length === 0) {
    return { documents: [], resumeDocument: null, recentMarks: [] }
  }

  const d = getDb()
  const placeholders = pathPlaceholders(paths)
  const rows = d
    .prepare(
      `SELECT
         documents.*,
         COUNT(annotations.id) AS mark_count,
         SUM(CASE WHEN annotations.kind = 'highlight' THEN 1 ELSE 0 END) AS highlight_count,
         SUM(CASE WHEN annotations.kind = 'note' THEN 1 ELSE 0 END) AS note_count
       FROM documents
       LEFT JOIN annotations ON annotations.document_id = documents.id
       WHERE documents.last_path IN (${placeholders})
       GROUP BY documents.id
       ORDER BY documents.last_opened_at DESC`
    )
    .all(...paths) as ProjectDocumentRow[]

  const latestByPath = new Map<string, ProjectDocumentRow>()
  for (const row of rows) {
    const existing = latestByPath.get(row.last_path)
    if (!existing || row.last_opened_at > existing.last_opened_at) {
      latestByPath.set(row.last_path, row)
    }
  }

  const documents = paths.map((path) => {
    const row = latestByPath.get(path)
    return {
      path,
      name: row?.filename ?? basename(path),
      document_id: row?.id ?? null,
      last_opened_at: row?.last_opened_at ?? null,
      open_count: row?.open_count ?? 0,
      mark_count: row?.mark_count ?? 0,
      highlight_count: row?.highlight_count ?? 0,
      note_count: row?.note_count ?? 0
    }
  })

  documents.sort((a, b) => {
    if (a.last_opened_at !== b.last_opened_at) {
      return (b.last_opened_at ?? -1) - (a.last_opened_at ?? -1)
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  const recentMarks = d
    .prepare(
      `SELECT
         annotations.id,
         annotations.document_id,
         documents.last_path AS path,
         documents.filename AS document_name,
         annotations.page_number,
         annotations.kind,
         annotations.color,
         annotations.text_excerpt,
         annotations.comment,
         annotations.created_at,
         annotations.updated_at
       FROM annotations
       JOIN documents ON documents.id = annotations.document_id
       WHERE documents.last_path IN (${placeholders})
       ORDER BY annotations.updated_at DESC
       LIMIT ?`
    )
    .all(...paths, markLimit) as ProjectMarkSummary[]

  return {
    documents,
    resumeDocument: documents.find((doc) => doc.last_opened_at !== null) ?? null,
    recentMarks
  }
}

export const SEARCH_INDEX_SCHEMA_V = 1

export function getSearchIndex(documentId: string): string[] | null {
  const row = getDb()
    .prepare<[string, number], { pages_json: string }>(
      `SELECT pages_json FROM search_indexes
        WHERE document_id = ? AND schema_v = ?`
    )
    .get(documentId, SEARCH_INDEX_SCHEMA_V)
  return row ? (JSON.parse(row.pages_json) as string[]) : null
}

export function putSearchIndex(documentId: string, pageTexts: string[]): void {
  getDb()
    .prepare(
      `INSERT INTO search_indexes (document_id, pages_json, schema_v, built_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(document_id) DO UPDATE SET
         pages_json = excluded.pages_json,
         schema_v   = excluded.schema_v,
         built_at   = excluded.built_at`
    )
    .run(documentId, JSON.stringify(pageTexts), SEARCH_INDEX_SCHEMA_V, Date.now())
}
