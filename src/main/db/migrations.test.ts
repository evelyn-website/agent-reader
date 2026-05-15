import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

describe('runMigrations', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
  })

  afterEach(() => db.close())

  it('creates schema_version, documents, annotations, and projects tables', () => {
    runMigrations(db)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('schema_version')
    expect(names).toContain('documents')
    expect(names).toContain('annotations')
    expect(names).toContain('projects')
    expect(names).toContain('search_indexes')
  })

  it('cascades delete: removing a document removes its search_indexes row', () => {
    runMigrations(db)
    db.prepare(
      `INSERT INTO documents (id, filename, last_path, size_bytes, first_opened_at, last_opened_at, open_count)
       VALUES ('doc1', 'test.pdf', '/tmp/test.pdf', 100, 0, 0, 1)`
    ).run()
    db.prepare(
      `INSERT INTO search_indexes (document_id, pages_json, schema_v, built_at)
       VALUES ('doc1', '[]', 1, 0)`
    ).run()
    db.prepare(`DELETE FROM documents WHERE id = 'doc1'`).run()
    const { n } = db.prepare(`SELECT count(*) as n FROM search_indexes`).get() as { n: number }
    expect(n).toBe(0)
  })

  it('sets schema_version to the total migration count', () => {
    runMigrations(db)
    const row = db.prepare(`SELECT version FROM schema_version`).get() as { version: number }
    expect(row.version).toBe(6)
  })

  it('is idempotent — re-running leaves version unchanged', () => {
    runMigrations(db)
    runMigrations(db)
    const row = db.prepare(`SELECT version FROM schema_version`).get() as { version: number }
    expect(row.version).toBe(6)
  })

  it('projects upsert bumps open_count on conflict', () => {
    runMigrations(db)
    const stmt = db.prepare(
      `INSERT INTO projects (path, name, first_opened_at, last_opened_at, open_count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(path) DO UPDATE SET open_count = projects.open_count + 1`
    )
    stmt.run('/tmp/p', 'p', 1, 1)
    stmt.run('/tmp/p', 'p', 2, 2)
    stmt.run('/tmp/p', 'p', 3, 3)
    const row = db.prepare(`SELECT open_count FROM projects WHERE path = '/tmp/p'`).get() as {
      open_count: number
    }
    expect(row.open_count).toBe(3)
  })

  it('enforces FK: inserting an annotation with unknown document_id throws', () => {
    runMigrations(db)
    expect(() => {
      db.prepare(
        `INSERT INTO annotations (id, document_id, page_number, kind, created_at, updated_at)
         VALUES ('a1', 'no-such-doc', 1, 'highlight', 0, 0)`
      ).run()
    }).toThrow()
  })

  it('cascades delete: removing a document removes its annotations', () => {
    runMigrations(db)
    db.prepare(
      `INSERT INTO documents (id, filename, last_path, size_bytes, first_opened_at, last_opened_at, open_count)
       VALUES ('doc1', 'test.pdf', '/tmp/test.pdf', 100, 0, 0, 1)`
    ).run()
    db.prepare(
      `INSERT INTO annotations (id, document_id, page_number, kind, created_at, updated_at)
       VALUES ('ann1', 'doc1', 1, 'highlight', 0, 0)`
    ).run()
    db.prepare(`DELETE FROM documents WHERE id = 'doc1'`).run()
    const { n } = db.prepare(`SELECT count(*) as n FROM annotations`).get() as { n: number }
    expect(n).toBe(0)
  })

  it('rejects invalid annotation kind via CHECK constraint', () => {
    runMigrations(db)
    db.prepare(
      `INSERT INTO documents (id, filename, last_path, size_bytes, first_opened_at, last_opened_at, open_count)
       VALUES ('doc1', 'test.pdf', '/tmp/test.pdf', 100, 0, 0, 1)`
    ).run()
    expect(() => {
      db.prepare(
        `INSERT INTO annotations (id, document_id, page_number, kind, created_at, updated_at)
         VALUES ('ann1', 'doc1', 1, 'bookmark', 0, 0)`
      ).run()
    }).toThrow()
  })
})
