import { join, basename } from 'path'
import { createHash, randomUUID } from 'crypto'
import { app } from 'electron'
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

export interface ProjectRow {
  path: string
  name: string
  first_opened_at: number
  last_opened_at: number
  open_count: number
}

export interface ProjectDocumentSummary {
  path: string
  name: string
  document_id: string | null
  last_opened_at: number | null
  open_count: number
  mark_count: number
  highlight_count: number
  note_count: number
}

export interface ProjectMarkSummary {
  id: string
  document_id: string
  path: string
  document_name: string
  page_number: number
  kind: AnnotationKind
  color: string | null
  text_excerpt: string | null
  comment: string | null
  created_at: number
  updated_at: number
}

export interface ProjectDashboard {
  documents: ProjectDocumentSummary[]
  resumeDocument: ProjectDocumentSummary | null
  recentMarks: ProjectMarkSummary[]
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
