import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { createServer, type CreateServerOptions } from './server'

type ServerOpts = Partial<Omit<CreateServerOptions, 'db'>>

function freshDb(): Database.Database {
  const db = new BetterSqlite3(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO documents (id, filename, last_path, size_bytes, first_opened_at, last_opened_at, open_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('doc-A', 'a.pdf', '/tmp/a.pdf', 1000, 0, 0, 1)
  db.prepare(
    `INSERT INTO documents (id, filename, last_path, size_bytes, first_opened_at, last_opened_at, open_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('doc-B', 'b.pdf', '/tmp/b.pdf', 2000, 0, 0, 1)
  db.prepare(
    `INSERT INTO search_indexes (document_id, pages_json, schema_v, built_at) VALUES (?, ?, ?, ?)`
  // pages_json is 1-indexed in production (buildSearchIndex produces [''] + page texts).
  ).run('doc-A', JSON.stringify(['', 'Hello world', 'Second page about AGENTS']), 1, 0)
  return db
}

describe('mcp-server', () => {
  let db: Database.Database
  let tmp: string
  let locPath: string

  beforeEach(() => {
    db = freshDb()
    tmp = mkdtempSync(join(tmpdir(), 'mcp-server-test-'))
    locPath = join(tmp, 'active.json')
  })

  afterEach(() => {
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  })

  function build(opts: ServerOpts = {}): ReturnType<typeof createServer> {
    return createServer({
      db,
      activeLocationPath: opts.activeLocationPath ?? null,
      originDocId: opts.originDocId ?? null,
      originPage: opts.originPage ?? null
    })
  }

  describe('initialize', () => {
    it('responds with protocol version and tools capability', () => {
      const s = build()
      const resp = s.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }) as {
        result: { protocolVersion: string; capabilities: { tools: object } }
      }
      expect(resp.result.protocolVersion).toBe('2024-11-05')
      expect(resp.result.capabilities.tools).toBeDefined()
    })
  })

  describe('tools/list', () => {
    it('returns the five tools', () => {
      const s = build()
      const resp = s.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as {
        result: { tools: Array<{ name: string }> }
      }
      const names = resp.result.tools.map((t) => t.name).sort()
      expect(names).toEqual(['get_page', 'get_pages', 'save_highlight', 'save_note', 'search_text'])
    })
  })

  describe('get_page', () => {
    it('returns the page text for an explicit document_id', () => {
      const s = build()
      const r = s.handleToolCall('get_page', { document_id: 'doc-A', page: 2 })
      expect(r.content[0].text).toBe('Second page about AGENTS')
    })

    it('falls back to the active-location documentId when document_id is omitted', () => {
      writeFileSync(locPath, JSON.stringify({ documentId: 'doc-A', page: 1 }), 'utf8')
      const s = build({ activeLocationPath: locPath })
      const r = s.handleToolCall('get_page', { page: 1 })
      expect(r.content[0].text).toBe('Hello world')
    })

    it('errors when no document_id and no active location', () => {
      const s = build()
      const r = s.handleToolCall('get_page', { page: 1 })
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toMatch(/No document_id/)
    })

    it('returns current-page text when page is omitted', () => {
      writeFileSync(locPath, JSON.stringify({ documentId: 'doc-A', page: 2 }), 'utf8')
      const s = build({ activeLocationPath: locPath })
      const r = s.handleToolCall('get_page', {})
      expect(r.content[0].text).toBe('Second page about AGENTS')
    })

    it('errors when page is omitted and no active location exists', () => {
      const s = build()
      const r = s.handleToolCall('get_page', { document_id: 'doc-A' })
      expect(r.content[0].text).toMatch(/No page specified/)
    })

    it('returns an out-of-range message for unknown pages', () => {
      const s = build()
      const r = s.handleToolCall('get_page', { document_id: 'doc-A', page: 99 })
      expect(r.content[0].text).toMatch(/out of range/)
    })
  })

  describe('search_text', () => {
    it('matches case-insensitively and returns page-keyed snippets', () => {
      const s = build()
      const r = s.handleToolCall('search_text', { document_id: 'doc-A', query: 'agents' })
      const parsed = JSON.parse(r.content[0].text)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].page).toBe(2)
      expect(parsed[0].snippet.toLowerCase()).toContain('agents')
    })
  })

  describe('anchor resolution', () => {
    it('save_note with anchor="origin" uses the session origin doc/page', () => {
      const s = build({ originDocId: 'doc-B', originPage: 5 })
      const r = s.handleToolCall('save_note', { content: 'pinned-to-origin', anchor: 'origin' })
      expect(r.isError).toBeUndefined()
      const row = db
        .prepare(
          'SELECT document_id, page_number, kind, comment FROM annotations ORDER BY created_at DESC LIMIT 1'
        )
        .get() as {
        document_id: string
        page_number: number
        kind: string
        comment: string
      }
      expect(row).toEqual({
        document_id: 'doc-B',
        page_number: 5,
        kind: 'note',
        comment: 'pinned-to-origin'
      })
    })

    it('save_note with anchor="current" uses the active-location file', () => {
      writeFileSync(locPath, JSON.stringify({ documentId: 'doc-A', page: 9 }), 'utf8')
      const s = build({ activeLocationPath: locPath })
      s.handleToolCall('save_note', { content: 'here', anchor: 'current' })
      const row = db
        .prepare(
          'SELECT document_id, page_number FROM annotations ORDER BY created_at DESC LIMIT 1'
        )
        .get() as { document_id: string; page_number: number }
      expect(row).toEqual({ document_id: 'doc-A', page_number: 9 })
    })

    it('save_note with explicit anchor honors the literal doc/page', () => {
      const s = build()
      s.handleToolCall('save_note', {
        content: 'literal',
        anchor: { document_id: 'doc-B', page: 3 }
      })
      const row = db
        .prepare(
          'SELECT document_id, page_number FROM annotations ORDER BY created_at DESC LIMIT 1'
        )
        .get() as { document_id: string; page_number: number }
      expect(row).toEqual({ document_id: 'doc-B', page_number: 3 })
    })

    it('save_note errors when anchor="origin" but the session has no origin', () => {
      const s = build()
      const r = s.handleToolCall('save_note', { content: 'x', anchor: 'origin' })
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toMatch(/No origin/)
    })

    it('save_note errors when anchor="current" but no document is open', () => {
      const s = build({ activeLocationPath: locPath })
      const r = s.handleToolCall('save_note', { content: 'x', anchor: 'current' })
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toMatch(/No document is currently open/)
    })
  })

  describe('save_highlight', () => {
    it('stores text_excerpt, color, and optional note', () => {
      const s = build({ originDocId: 'doc-A', originPage: 1 })
      const r = s.handleToolCall('save_highlight', {
        text: 'Hello world',
        anchor: 'origin',
        color: 'yellow',
        note: 'greeting'
      })
      expect(r.isError).toBeUndefined()
      const row = db
        .prepare(
          'SELECT kind, color, text_excerpt, comment FROM annotations ORDER BY created_at DESC LIMIT 1'
        )
        .get() as { kind: string; color: string; text_excerpt: string; comment: string }
      expect(row).toEqual({
        kind: 'highlight',
        color: 'yellow',
        text_excerpt: 'Hello world',
        comment: 'greeting'
      })
    })
  })

  describe('mark_event_queue', () => {
    it('save_note enqueues a row with the document id', () => {
      const s = build({ originDocId: 'doc-A', originPage: 1 })
      s.handleToolCall('save_note', { content: 'hello', anchor: 'origin' })
      const rows = db.prepare('SELECT document_id FROM mark_event_queue').all() as {
        document_id: string
      }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].document_id).toBe('doc-A')
    })

    it('save_highlight enqueues a row with the document id', () => {
      const s = build({ originDocId: 'doc-B', originPage: 2 })
      s.handleToolCall('save_highlight', { text: 'x', anchor: 'origin' })
      const rows = db.prepare('SELECT document_id FROM mark_event_queue').all() as {
        document_id: string
      }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].document_id).toBe('doc-B')
    })

    it('queue row id matches the annotation id', () => {
      const s = build({ originDocId: 'doc-A', originPage: 1 })
      s.handleToolCall('save_note', { content: 'hi', anchor: 'origin' })
      const ann = db.prepare('SELECT id FROM annotations LIMIT 1').get() as { id: string }
      const q = db.prepare('SELECT id FROM mark_event_queue LIMIT 1').get() as { id: string }
      expect(q.id).toBe(ann.id)
    })
  })

  describe('save_note default position', () => {
    it('writes a non-null anchor so the note is visible in the renderer', () => {
      const s = build({ originDocId: 'doc-A', originPage: 1 })
      s.handleToolCall('save_note', { content: 'hi', anchor: 'origin' })
      const row = db
        .prepare('SELECT anchor_x, anchor_y FROM annotations ORDER BY created_at DESC LIMIT 1')
        .get() as { anchor_x: number | null; anchor_y: number | null }
      expect(row.anchor_x).not.toBeNull()
      expect(row.anchor_y).not.toBeNull()
    })
  })
})
