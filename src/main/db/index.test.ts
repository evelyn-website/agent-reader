import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import {
  createDb,
  setDbForTesting,
  recordOpen,
  listRecent,
  listChatSessions,
  createChatSession,
  getChatSession,
  updateChatSessionTitle,
  deleteChatSession,
  listChatMessages,
  createChatMessage,
  setChatSessionClaudeId,
  upsertChatMessageFromJsonl,
  createAnnotation,
  listAnnotations,
  updateAnnotation,
  deleteAnnotation,
  getProjectDashboard
} from './index'

const PDF_DATA = Buffer.from('fake-pdf-bytes')
const PDF_PATH = '/tmp/test.pdf'

describe('recordOpen', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDb(':memory:')
    setDbForTesting(db)
  })

  afterEach(() => {
    setDbForTesting(null)
    db.close()
  })

  it('inserts a new document and returns the row', () => {
    const row = recordOpen({ path: PDF_PATH, data: PDF_DATA })
    expect(row.filename).toBe('test.pdf')
    expect(row.last_path).toBe(PDF_PATH)
    expect(row.size_bytes).toBe(PDF_DATA.byteLength)
    expect(row.open_count).toBe(1)
  })

  it('upserts on the same content: increments open_count', () => {
    recordOpen({ path: PDF_PATH, data: PDF_DATA })
    const row = recordOpen({ path: PDF_PATH, data: PDF_DATA })
    expect(row.open_count).toBe(2)
  })

  it('upserts with new path when the same content moves', () => {
    recordOpen({ path: '/old/test.pdf', data: PDF_DATA })
    const row = recordOpen({ path: '/new/test.pdf', data: PDF_DATA })
    expect(row.last_path).toBe('/new/test.pdf')
    expect(row.open_count).toBe(2)
  })

  it('different content produces different ids', () => {
    const r1 = recordOpen({ path: PDF_PATH, data: PDF_DATA })
    const r2 = recordOpen({ path: PDF_PATH, data: Buffer.from('other-content') })
    expect(r1.id).not.toBe(r2.id)
  })

  it('listRecent returns documents newest-first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    recordOpen({ path: '/a.pdf', data: Buffer.from('aaa') })
    vi.setSystemTime(2000)
    recordOpen({ path: '/b.pdf', data: Buffer.from('bbb') })
    vi.useRealTimers()
    const recents = listRecent()
    expect(recents[0].filename).toBe('b.pdf')
    expect(recents[1].filename).toBe('a.pdf')
  })
})

describe('chat sessions', () => {
  let db: Database.Database
  let docId: string

  beforeEach(() => {
    db = createDb(':memory:')
    setDbForTesting(db)
    docId = recordOpen({ path: PDF_PATH, data: PDF_DATA }).id
  })

  afterEach(() => {
    vi.useRealTimers()
    setDbForTesting(null)
    db.close()
  })

  it('creates and lists sessions for a scope newest-first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const older = createChatSession({
      scope_key: '/project',
      title: 'Older',
      origin_document_id: docId,
      origin_page_number: 2
    })
    vi.setSystemTime(2000)
    const newer = createChatSession({ scope_key: '/project', title: 'Newer' })
    createChatSession({ scope_key: '/other', title: 'Other' })

    const sessions = listChatSessions('/project')

    expect(sessions.map((session) => session.id)).toEqual([newer.id, older.id])
    expect(sessions[1]).toMatchObject({
      title: 'Older',
      origin_document_id: docId,
      origin_page_number: 2,
      message_count: 0
    })
  })

  it('renames and deletes sessions', () => {
    const session = createChatSession({ scope_key: '/project', title: 'Draft' })

    const renamed = updateChatSessionTitle(session.id, 'Renamed')
    expect(renamed?.title).toBe('Renamed')

    deleteChatSession(session.id)
    expect(getChatSession(session.id)).toBeNull()
  })

  it('stores messages and updates session ordering metadata', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const older = createChatSession({ scope_key: '/project', title: 'Older' })
    vi.setSystemTime(2000)
    const newer = createChatSession({ scope_key: '/project', title: 'Newer' })
    vi.setSystemTime(3000)
    const message = createChatMessage({
      session_id: older.id,
      role: 'user',
      content: 'hello from the chat composer'
    })

    expect(message.status).toBe('complete')
    expect(listChatMessages(older.id).map((row) => row.content)).toEqual([
      'hello from the chat composer'
    ])

    const sessions = listChatSessions('/project')
    expect(sessions.map((session) => session.id)).toEqual([older.id, newer.id])
    expect(sessions[0]).toMatchObject({
      message_count: 1,
      last_message_preview: 'hello from the chat composer',
      last_message_at: 3000
    })
  })

  it('cascades messages when a session is deleted', () => {
    const session = createChatSession({ scope_key: '/project' })
    createChatMessage({ session_id: session.id, role: 'user', content: 'hello' })

    deleteChatSession(session.id)

    expect(listChatMessages(session.id)).toHaveLength(0)
  })

  it('defaults omitted or whitespace-only titles to New session on create and update', () => {
    const noTitle = createChatSession({ scope_key: '/project' })
    expect(noTitle.title).toBe('New session')

    const blankTitle = createChatSession({ scope_key: '/project', title: '   \t  ' })
    expect(blankTitle.title).toBe('New session')

    const renamed = updateChatSessionTitle(noTitle.id, '  \n  ')
    expect(renamed?.title).toBe('New session')
  })

  it('setChatSessionClaudeId persists and returns the updated row, no-ops on missing id', () => {
    const session = createChatSession({ scope_key: '/project' })
    const updated = setChatSessionClaudeId(session.id, 'claude-uuid-1')
    expect(updated?.claude_session_id).toBe('claude-uuid-1')
    expect(getChatSession(session.id)?.claude_session_id).toBe('claude-uuid-1')

    expect(setChatSessionClaudeId('does-not-exist', 'x')).toBeNull()
  })

  it('upsertChatMessageFromJsonl inserts, dedupes by (session_id, jsonl_uuid), bumps last_message_at', () => {
    const session = createChatSession({ scope_key: '/project' })

    const first = upsertChatMessageFromJsonl({
      session_id: session.id,
      jsonl_uuid: 'u1',
      role: 'user',
      content: 'hello',
      created_at: 1000
    })
    expect(first.inserted).toBe(true)
    expect(first.row.jsonl_uuid).toBe('u1')
    expect(getChatSession(session.id)?.last_message_at).toBe(1000)

    const dupe = upsertChatMessageFromJsonl({
      session_id: session.id,
      jsonl_uuid: 'u1',
      role: 'user',
      content: 'hello (again)',
      created_at: 9999
    })
    expect(dupe.inserted).toBe(false)
    // existing row returned, last_message_at unchanged
    expect(dupe.row.id).toBe(first.row.id)
    expect(getChatSession(session.id)?.last_message_at).toBe(1000)

    upsertChatMessageFromJsonl({
      session_id: session.id,
      jsonl_uuid: 'u2',
      role: 'assistant',
      content: 'reply',
      created_at: 2000
    })
    expect(listChatMessages(session.id)).toHaveLength(2)
    expect(getChatSession(session.id)?.last_message_at).toBe(2000)
  })

  it('upsertChatMessageFromJsonl scopes dedupe per session — same jsonl_uuid is allowed across sessions', () => {
    const a = createChatSession({ scope_key: '/p' })
    const b = createChatSession({ scope_key: '/p' })

    expect(
      upsertChatMessageFromJsonl({
        session_id: a.id,
        jsonl_uuid: 'shared',
        role: 'user',
        content: 'a',
        created_at: 1
      }).inserted
    ).toBe(true)
    expect(
      upsertChatMessageFromJsonl({
        session_id: b.id,
        jsonl_uuid: 'shared',
        role: 'user',
        content: 'b',
        created_at: 2
      }).inserted
    ).toBe(true)
  })
})

describe('annotation CRUD', () => {
  let db: Database.Database
  let docId: string

  beforeEach(() => {
    db = createDb(':memory:')
    setDbForTesting(db)
    docId = recordOpen({ path: PDF_PATH, data: PDF_DATA }).id
  })

  afterEach(() => {
    setDbForTesting(null)
    db.close()
  })

  it('createAnnotation returns a well-formed row', () => {
    const ann = createAnnotation({
      document_id: docId,
      page_number: 3,
      kind: 'highlight',
      color: 'yellow',
      text_excerpt: 'hello world',
      rects_json: '[{"x":1,"y":2,"w":10,"h":5}]'
    })
    expect(ann.document_id).toBe(docId)
    expect(ann.page_number).toBe(3)
    expect(ann.kind).toBe('highlight')
    expect(ann.color).toBe('yellow')
    expect(ann.text_excerpt).toBe('hello world')
    expect(ann.id).toBeTruthy()
    expect(ann.created_at).toBeGreaterThan(0)
  })

  it('listAnnotations orders by page then created_at', () => {
    createAnnotation({ document_id: docId, page_number: 5, kind: 'highlight' })
    createAnnotation({ document_id: docId, page_number: 2, kind: 'note' })
    createAnnotation({ document_id: docId, page_number: 5, kind: 'note' })
    const list = listAnnotations(docId)
    expect(list.map((a) => a.page_number)).toEqual([2, 5, 5])
  })

  it('deleteAnnotation removes the row', () => {
    const ann = createAnnotation({ document_id: docId, page_number: 1, kind: 'highlight' })
    deleteAnnotation(ann.id)
    expect(listAnnotations(docId)).toHaveLength(0)
  })

  it('cascade: deleting a document removes its annotations', () => {
    createAnnotation({ document_id: docId, page_number: 1, kind: 'highlight' })
    db.prepare(`DELETE FROM documents WHERE id = ?`).run(docId)
    expect(listAnnotations(docId)).toHaveLength(0)
  })

  describe('updateAnnotation', () => {
    it('returns null for an unknown id', () => {
      expect(updateAnnotation('no-such-id', {})).toBeNull()
    })

    it('applies patched fields', () => {
      const ann = createAnnotation({
        document_id: docId,
        page_number: 1,
        kind: 'highlight',
        color: 'yellow'
      })
      const updated = updateAnnotation(ann.id, { color: 'blue', comment: 'nice' })!
      expect(updated.color).toBe('blue')
      expect(updated.comment).toBe('nice')
    })

    it('preserves unpatched fields', () => {
      const ann = createAnnotation({
        document_id: docId,
        page_number: 1,
        kind: 'highlight',
        color: 'yellow',
        rects_json: '[{"x":1,"y":2,"w":3,"h":4}]',
        comment: 'original'
      })
      const updated = updateAnnotation(ann.id, { color: 'green' })!
      expect(updated.comment).toBe('original')
      expect(updated.rects_json).toBe('[{"x":1,"y":2,"w":3,"h":4}]')
    })

    it('allows explicitly patching a field to null', () => {
      const ann = createAnnotation({
        document_id: docId,
        page_number: 1,
        kind: 'highlight',
        comment: 'hello'
      })
      const updated = updateAnnotation(ann.id, { comment: null })!
      expect(updated.comment).toBeNull()
    })

    it('bumps updated_at', async () => {
      const ann = createAnnotation({ document_id: docId, page_number: 1, kind: 'highlight' })
      await new Promise((r) => setTimeout(r, 2))
      const updated = updateAnnotation(ann.id, { comment: 'changed' })!
      expect(updated.updated_at).toBeGreaterThanOrEqual(ann.updated_at)
    })
  })
})

describe('project dashboard', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDb(':memory:')
    setDbForTesting(db)
  })

  afterEach(() => {
    vi.useRealTimers()
    setDbForTesting(null)
    db.close()
  })

  it('returns all scanned documents with DB metadata when available', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const older = recordOpen({ path: '/project/a.pdf', data: Buffer.from('a') })
    vi.setSystemTime(2000)
    const newer = recordOpen({ path: '/project/b.pdf', data: Buffer.from('b') })
    createAnnotation({ document_id: newer.id, page_number: 2, kind: 'highlight', color: 'yellow' })
    createAnnotation({ document_id: newer.id, page_number: 3, kind: 'note', comment: 'note' })
    createAnnotation({ document_id: older.id, page_number: 1, kind: 'highlight', color: 'blue' })

    const dashboard = getProjectDashboard('/project', [
      '/project/a.pdf',
      '/project/unread.pdf',
      '/project/b.pdf'
    ])

    expect(dashboard.documents.map((d) => d.path)).toEqual([
      '/project/b.pdf',
      '/project/a.pdf',
      '/project/unread.pdf'
    ])
    expect(dashboard.resumeDocument?.path).toBe('/project/b.pdf')
    expect(dashboard.documents[0]).toMatchObject({
      document_id: newer.id,
      mark_count: 2,
      highlight_count: 1,
      note_count: 1
    })
    expect(dashboard.documents[2]).toMatchObject({
      path: '/project/unread.pdf',
      document_id: null,
      open_count: 0,
      mark_count: 0
    })
  })

  it('returns recent marks for documents in the project only', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const inProject = recordOpen({ path: '/project/a.pdf', data: Buffer.from('a') })
    const outside = recordOpen({ path: '/other/outside.pdf', data: Buffer.from('outside') })
    vi.setSystemTime(2000)
    const oldMark = createAnnotation({
      document_id: inProject.id,
      page_number: 1,
      kind: 'highlight',
      text_excerpt: 'older'
    })
    vi.setSystemTime(3000)
    const newMark = createAnnotation({
      document_id: inProject.id,
      page_number: 2,
      kind: 'note',
      comment: 'newer'
    })
    createAnnotation({
      document_id: outside.id,
      page_number: 1,
      kind: 'highlight',
      text_excerpt: 'outside'
    })

    const dashboard = getProjectDashboard('/project', ['/project/a.pdf'])

    expect(dashboard.recentMarks.map((m) => m.id)).toEqual([newMark.id, oldMark.id])
    expect(dashboard.recentMarks[0]).toMatchObject({
      path: '/project/a.pdf',
      document_name: 'a.pdf',
      page_number: 2
    })
  })
})
