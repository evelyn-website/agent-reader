import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import {
  createDb,
  setDbForTesting,
  recordOpen,
  listRecent,
  createAnnotation,
  listAnnotations,
  updateAnnotation,
  deleteAnnotation
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
