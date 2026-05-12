import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentRow } from '../../../main/db'
import { useDocumentSession } from './useDocumentSession'

type ReadPdfResult = {
  data: Buffer
  document: DocumentRow
}

function makeReadResult(id: string, path: string): ReadPdfResult {
  return {
    data: Buffer.from(`bytes for ${id}`),
    document: {
      id,
      filename: path.split('/').pop() ?? path,
      last_path: path,
      size_bytes: 100,
      first_opened_at: 1000,
      last_opened_at: 1000,
      open_count: 1
    }
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let rafCallbacks: FrameRequestCallback[] = []
let originalRequestAnimationFrame: typeof window.requestAnimationFrame

async function flushAnimationFrames(): Promise<void> {
  await act(async () => {
    const callbacks = rafCallbacks.splice(0)
    callbacks.forEach((cb) => cb(performance.now()))
  })
}

describe('useDocumentSession', () => {
  beforeEach(() => {
    rafCallbacks = []
    originalRequestAnimationFrame = window.requestAnimationFrame
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
  })

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
  })

  it('loads a PDF, resets derived document state, and marks the viewer ready on the next frame', async () => {
    vi.mocked(window.api.readPdf).mockResolvedValueOnce(makeReadResult('doc-1', '/docs/one.pdf'))
    const { result } = renderHook(() => useDocumentSession(1))

    act(() => {
      result.current.setNumPages(4)
      result.current.setNoteMode(true)
      result.current.setSearchIndex({
        numPages: 4,
        pageTexts: [],
        pageTextsLower: []
      })
    })

    await act(async () => {
      await result.current.loadPdfPath('/docs/one.pdf')
    })

    expect(result.current.pdf?.path).toBe('/docs/one.pdf')
    expect(result.current.pdf?.documentId).toBe('doc-1')
    expect(result.current.numPages).toBe(0)
    expect(result.current.searchIndex).toBeNull()
    expect(result.current.noteMode).toBe(false)
    expect(result.current.viewerReady).toBe(false)

    await flushAnimationFrames()
    expect(result.current.viewerReady).toBe(true)
  })

  it('ignores stale reads when a newer document load wins the race', async () => {
    const firstRead = deferred<ReadPdfResult>()
    vi.mocked(window.api.readPdf)
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce(makeReadResult('doc-2', '/docs/two.pdf'))
    const { result } = renderHook(() => useDocumentSession(1))

    void act(() => {
      void result.current.loadPdfPath('/docs/one.pdf')
    })
    await act(async () => {
      await result.current.loadPdfPath('/docs/two.pdf')
    })

    await flushAnimationFrames()
    expect(result.current.pdf?.documentId).toBe('doc-2')
    expect(result.current.viewerReady).toBe(true)

    await act(async () => {
      firstRead.resolve(makeReadResult('doc-1', '/docs/one.pdf'))
      await firstRead.promise
    })
    await flushAnimationFrames()

    expect(result.current.pdf?.documentId).toBe('doc-2')
  })

  it('clears the active document and cancels pending viewer readiness', async () => {
    vi.mocked(window.api.readPdf).mockResolvedValueOnce(makeReadResult('doc-1', '/docs/one.pdf'))
    const { result } = renderHook(() => useDocumentSession(1))

    await act(async () => {
      await result.current.loadPdfPath('/docs/one.pdf')
    })
    act(() => {
      result.current.clearDocument()
    })
    await flushAnimationFrames()

    await waitFor(() => expect(result.current.pdf).toBeNull())
    expect(result.current.viewerReady).toBe(false)
    expect(result.current.numPages).toBe(0)
  })
})
