import { join, basename } from 'path'
import { createHash, randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

export interface DocumentRow {
  id: string
  filename: string
  last_path: string
  size_bytes: number
  first_opened_at: number
  last_opened_at: number
  open_count: number
}

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
    const { app } = require('electron') as typeof import('electron')
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

  const existing = d
    .prepare<[string], DocumentRow>(`SELECT * FROM documents WHERE id = ?`)
    .get(id)

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

  return d
    .prepare<[string], DocumentRow>(`SELECT * FROM documents WHERE id = ?`)
    .get(id)!
}

export function getDocument(id: string): DocumentRow | null {
  return (
    getDb()
      .prepare<[string], DocumentRow>(`SELECT * FROM documents WHERE id = ?`)
      .get(id) ?? null
  )
}

export function listRecent(limit = 50): DocumentRow[] {
  return getDb()
    .prepare<[number], DocumentRow>(
      `SELECT * FROM documents ORDER BY last_opened_at DESC LIMIT ?`
    )
    .all(limit)
}

export type AnnotationKind = 'highlight' | 'note'

export interface AnnotationRow {
  id: string
  document_id: string
  page_number: number
  kind: AnnotationKind
  color: string | null
  rects_json: string | null
  anchor_x: number | null
  anchor_y: number | null
  text_excerpt: string | null
  comment: string | null
  created_at: number
  updated_at: number
}

export interface CreateAnnotationInput {
  document_id: string
  page_number: number
  kind: AnnotationKind
  color?: string | null
  rects_json?: string | null
  anchor_x?: number | null
  anchor_y?: number | null
  text_excerpt?: string | null
  comment?: string | null
}

export interface UpdateAnnotationInput {
  color?: string | null
  comment?: string | null
  rects_json?: string | null
  anchor_x?: number | null
  anchor_y?: number | null
}

export function listAnnotations(documentId: string): AnnotationRow[] {
  return getDb()
    .prepare<[string], AnnotationRow>(
      `SELECT * FROM annotations WHERE document_id = ? ORDER BY page_number, created_at`
    )
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
  return d
    .prepare<[string], AnnotationRow>(`SELECT * FROM annotations WHERE id = ?`)
    .get(id)!
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
  return d
    .prepare<[string], AnnotationRow>(`SELECT * FROM annotations WHERE id = ?`)
    .get(id)!
}

export function deleteAnnotation(id: string): void {
  getDb().prepare(`DELETE FROM annotations WHERE id = ?`).run(id)
}

export interface ProjectRow {
  path: string
  name: string
  first_opened_at: number
  last_opened_at: number
  open_count: number
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
  return d
    .prepare<[string], ProjectRow>(`SELECT * FROM projects WHERE path = ?`)
    .get(args.path)!
}

export function listRecentProjects(limit = 10): ProjectRow[] {
  return getDb()
    .prepare<[number], ProjectRow>(
      `SELECT * FROM projects ORDER BY last_opened_at DESC LIMIT ?`
    )
    .all(limit)
}

export function deleteProject(path: string): void {
  getDb().prepare(`DELETE FROM projects WHERE path = ?`).run(path)
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
