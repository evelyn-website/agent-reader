import { app } from 'electron'
import { join, basename } from 'path'
import { createHash } from 'crypto'
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

export function initDb(): void {
  const dbPath = join(app.getPath('userData'), 'agent-reader.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
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
