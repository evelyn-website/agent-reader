import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAnnotations, type AnnotationKind } from './useAnnotations'
import type { UnscaledRect } from './captureSelection'

interface AnnotationRowFixture {
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

function makeRow(overrides: Partial<AnnotationRowFixture> = {}): AnnotationRowFixture {
  return {
    id: 'ann-1',
    document_id: 'doc-1',
    page_number: 1,
    kind: 'highlight' as const,
    color: 'yellow',
    rects_json: null,
    anchor_x: null,
    anchor_y: null,
    text_excerpt: 'some text',
    comment: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides
  }
}

describe('useAnnotations — loading', () => {
  it('fetches annotations on mount', async () => {
    const row = makeRow()
    window.api.annotations.list = vi.fn().mockResolvedValue([row])

    const { result } = renderHook(() => useAnnotations('doc-1'))
    await waitFor(() => expect(result.current.all).toHaveLength(1))
    expect(window.api.annotations.list).toHaveBeenCalledWith('doc-1')
    expect(result.current.all[0].id).toBe('ann-1')
  })

  it('converts snake_case row to camelCase Annotation', async () => {
    const rects: UnscaledRect[] = [{ x: 1, y: 2, w: 10, h: 5 }]
    const row = makeRow({
      rects_json: JSON.stringify(rects),
      anchor_x: 0.5,
      anchor_y: 0.8,
      text_excerpt: 'hello',
      comment: 'my comment'
    })
    window.api.annotations.list = vi.fn().mockResolvedValue([row])

    const { result } = renderHook(() => useAnnotations('doc-1'))
    await waitFor(() => expect(result.current.all).toHaveLength(1))
    const ann = result.current.all[0]
    expect(ann.documentId).toBe('doc-1')
    expect(ann.pageNumber).toBe(1)
    expect(ann.rects).toEqual(rects)
    expect(ann.anchor).toEqual({ x: 0.5, y: 0.8 })
    expect(ann.textExcerpt).toBe('hello')
    expect(ann.comment).toBe('my comment')
  })

  it('returns empty state when documentId is null', () => {
    const { result } = renderHook(() => useAnnotations(null))
    expect(result.current.all).toHaveLength(0)
    expect(window.api.annotations.list).not.toHaveBeenCalled()
  })

  it('groups annotations by page in byPage', async () => {
    window.api.annotations.list = vi
      .fn()
      .mockResolvedValue([
        makeRow({ id: 'a1', page_number: 3 }),
        makeRow({ id: 'a2', page_number: 1 }),
        makeRow({ id: 'a3', page_number: 3 })
      ])
    const { result } = renderHook(() => useAnnotations('doc-1'))
    await waitFor(() => expect(result.current.all).toHaveLength(3))
    expect(result.current.byPage.get(1)).toHaveLength(1)
    expect(result.current.byPage.get(3)).toHaveLength(2)
  })
})

describe('useAnnotations — createHighlight', () => {
  it('calls the API and appends to state', async () => {
    const created = makeRow({ id: 'new-ann', kind: 'highlight', color: 'blue' })
    window.api.annotations.create = vi.fn().mockResolvedValue(created)

    const { result } = renderHook(() => useAnnotations('doc-1'))
    await act(async () => {
      await result.current.createHighlight({
        pageNumber: 1,
        rects: [{ x: 0, y: 0, w: 10, h: 5 }],
        color: 'blue',
        text: 'hello'
      })
    })

    expect(window.api.annotations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: 'doc-1',
        kind: 'highlight',
        color: 'blue',
        page_number: 1
      })
    )
    expect(result.current.all).toHaveLength(1)
    expect(result.current.all[0].id).toBe('new-ann')
  })

  it('returns null and does not call API when documentId is null', async () => {
    const { result } = renderHook(() => useAnnotations(null))
    let returned: unknown
    await act(async () => {
      returned = await result.current.createHighlight({
        pageNumber: 1,
        rects: [],
        color: 'yellow',
        text: ''
      })
    })
    expect(returned).toBeNull()
    expect(window.api.annotations.create).not.toHaveBeenCalled()
  })
})

describe('useAnnotations — createNote', () => {
  it('calls the API with anchor coords and appends to state', async () => {
    const created = makeRow({ id: 'note-1', kind: 'note', anchor_x: 0.3, anchor_y: 0.7 })
    window.api.annotations.create = vi.fn().mockResolvedValue(created)

    const { result } = renderHook(() => useAnnotations('doc-1'))
    await act(async () => {
      await result.current.createNote({ pageNumber: 2, x: 0.3, y: 0.7, comment: 'note text' })
    })

    expect(window.api.annotations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'note',
        anchor_x: 0.3,
        anchor_y: 0.7,
        page_number: 2
      })
    )
    expect(result.current.all[0].anchor).toEqual({ x: 0.3, y: 0.7 })
  })
})

describe('useAnnotations — updateAnnotation', () => {
  it('replaces the annotation in state', async () => {
    const initial = makeRow({ id: 'ann-1', color: 'yellow', comment: null })
    window.api.annotations.list = vi.fn().mockResolvedValue([initial])
    const updated = makeRow({ id: 'ann-1', color: 'green', comment: 'changed' })
    window.api.annotations.update = vi.fn().mockResolvedValue(updated)

    const { result } = renderHook(() => useAnnotations('doc-1'))
    await waitFor(() => expect(result.current.all).toHaveLength(1))

    await act(async () => {
      await result.current.updateAnnotation('ann-1', { color: 'green', comment: 'changed' })
    })

    expect(result.current.all[0].color).toBe('green')
    expect(result.current.all[0].comment).toBe('changed')
  })

  it('does nothing when API returns null (unknown id)', async () => {
    const initial = makeRow({ id: 'ann-1' })
    window.api.annotations.list = vi.fn().mockResolvedValue([initial])
    window.api.annotations.update = vi.fn().mockResolvedValue(null)

    const { result } = renderHook(() => useAnnotations('doc-1'))
    await waitFor(() => expect(result.current.all).toHaveLength(1))

    await act(async () => {
      await result.current.updateAnnotation('ann-1', { color: 'blue' })
    })

    expect(result.current.all[0].color).toBe('yellow')
  })
})

describe('useAnnotations — updateAnnotation anchor', () => {
  it('passes anchor_x and anchor_y to the API and updates state', async () => {
    const initial = makeRow({ id: 'ann-1', kind: 'note', anchor_x: 100, anchor_y: 200 })
    window.api.annotations.list = vi.fn().mockResolvedValue([initial])
    const updated = makeRow({ id: 'ann-1', kind: 'note', anchor_x: 300, anchor_y: 400 })
    window.api.annotations.update = vi.fn().mockResolvedValue(updated)

    const { result } = renderHook(() => useAnnotations('doc-1'))
    await waitFor(() => expect(result.current.all).toHaveLength(1))

    await act(async () => {
      await result.current.updateAnnotation('ann-1', { anchor_x: 300, anchor_y: 400 })
    })

    expect(window.api.annotations.update).toHaveBeenCalledWith(
      'ann-1',
      expect.objectContaining({ anchor_x: 300, anchor_y: 400 })
    )
    expect(result.current.all[0].anchor).toEqual({ x: 300, y: 400 })
  })
})

describe('useAnnotations — deleteAnnotation', () => {
  it('removes the annotation from state', async () => {
    const row = makeRow({ id: 'ann-1' })
    window.api.annotations.list = vi.fn().mockResolvedValue([row])
    window.api.annotations.delete = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => useAnnotations('doc-1'))
    await waitFor(() => expect(result.current.all).toHaveLength(1))

    await act(async () => {
      await result.current.deleteAnnotation('ann-1')
    })

    expect(window.api.annotations.delete).toHaveBeenCalledWith('ann-1')
    expect(result.current.all).toHaveLength(0)
  })
})
