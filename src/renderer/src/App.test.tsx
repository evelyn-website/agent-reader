import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import App from './App'
import type { DocumentRow } from '../../main/db'

const appMocks = vi.hoisted(() => ({
  setPageDimensions: vi.fn()
}))

vi.mock('./components/PDFViewer', async () => {
  const React = await import('react')
  return {
    default: React.forwardRef(
      (
        props: {
          documentId: string
          setNumPages: (n: number) => void
        },
        ref
      ) => {
        React.useImperativeHandle(ref, () => ({ triggerHighlight: () => {} }))
        React.useEffect(() => {
          props.setNumPages(props.documentId === 'doc-1' ? 12 : 3)
        }, [props])

        return React.createElement('div', { 'data-testid': 'pdf-viewer' }, props.documentId)
      }
    )
  }
})

vi.mock('./components/Toolbar', () => ({
  default: ({
    filename,
    numPages,
    onOpen
  }: {
    filename: string | null
    numPages: number
    onOpen: () => void | Promise<void>
  }) => (
    <div data-testid="toolbar">
      <button type="button" onClick={() => void onOpen()}>
        Open PDF
      </button>
      <span data-testid="filename">{filename ?? ''}</span>
      <span data-testid="num-pages">{numPages}</span>
    </div>
  )
}))

vi.mock('./components/SidePanel', () => ({
  default: () => <aside data-testid="side-panel" />
}))

vi.mock('./components/OutlineTabContent', () => ({
  default: () => <div />
}))

vi.mock('./components/FilesTabContent', () => ({
  default: () => <div />
}))

vi.mock('./components/ChatTabContent', () => ({
  default: () => <div />
}))

vi.mock('./components/MarksTabContent', () => ({
  default: () => <div />
}))

vi.mock('./components/EmptyLauncher', () => ({
  default: () => <div data-testid="empty-launcher" />
}))

vi.mock('./components/useZoom', () => ({
  useZoom: () => ({
    scale: 1,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
    zoomTo: vi.fn(),
    atMin: false,
    atMax: false
  })
}))

vi.mock('./components/useWindowedPages', () => ({
  useWindowedPages: () => ({
    currentPage: 1,
    layout: {
      topSpacer: 0,
      windowA: { from: 1, to: 1 },
      middleSpacer: 0,
      windowB: null,
      bottomSpacer: 0
    },
    setPageRef: vi.fn(),
    getPlaceholderHeight: vi.fn().mockReturnValue(800),
    onPageRenderSuccess: vi.fn(),
    scrollToPage: vi.fn(),
    setPageDimensions: appMocks.setPageDimensions
  })
}))

vi.mock('./components/useSearch', () => ({
  useSearch: () => ({
    open: false,
    query: '',
    caseSensitive: false,
    wholeWord: false,
    matches: [],
    currentMatchIndex: 0,
    matchesTruncated: false,
    openSearch: vi.fn(),
    closeSearch: vi.fn(),
    setQuery: vi.fn(),
    toggleCaseSensitive: vi.fn(),
    toggleWholeWord: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    highlightRegex: null
  })
}))

vi.mock('./components/useAnnotations', () => ({
  useAnnotations: () => ({
    all: [],
    byPage: new Map(),
    createHighlight: vi.fn(),
    createNote: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn()
  })
}))

vi.mock('./components/pdfProxyCache', () => ({
  clearAll: vi.fn()
}))

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

function expectLastPageDimensionsClear(): void {
  const lastArg = appMocks.setPageDimensions.mock.calls.at(-1)?.[0]
  expect(lastArg).toBeInstanceOf(Map)
  expect((lastArg as Map<number, number>).size).toBe(0)
}

let rafCallbacks: FrameRequestCallback[] = []
let originalRequestAnimationFrame: typeof window.requestAnimationFrame

async function flushAnimationFrames(): Promise<void> {
  await act(async () => {
    const callbacks = rafCallbacks.splice(0)
    callbacks.forEach((cb) => cb(performance.now()))
  })
}

beforeEach(() => {
  appMocks.setPageDimensions.mockClear()
  rafCallbacks = []
  originalRequestAnimationFrame = window.requestAnimationFrame
  window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  window.api.openPdf = vi.fn()
  window.api.readPdf = vi.fn()
  window.api.project.listRecent = vi.fn().mockResolvedValue([])
})

afterEach(() => {
  window.requestAnimationFrame = originalRequestAnimationFrame
})

describe('App — PDF switching boundary', () => {
  it('unmounts the current viewer immediately and remounts the new PDF after an animation frame', async () => {
    vi.mocked(window.api.openPdf).mockResolvedValueOnce('/docs/one.pdf')
    vi.mocked(window.api.readPdf).mockResolvedValueOnce(makeReadResult('doc-1', '/docs/one.pdf'))

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }))

    await waitFor(() => expect(screen.getByTestId('filename')).toHaveTextContent('one.pdf'))
    expect(screen.queryByTestId('pdf-viewer')).toBeNull()
    expect(document.querySelector('.pdf-viewer')).toBeInTheDocument()
    expect(screen.getByTestId('num-pages')).toHaveTextContent('0')
    expectLastPageDimensionsClear()

    await flushAnimationFrames()

    expect(await screen.findByTestId('pdf-viewer')).toHaveTextContent('doc-1')
    await waitFor(() => expect(screen.getByTestId('num-pages')).toHaveTextContent('12'))

    const secondRead = deferred<ReadPdfResult>()
    vi.mocked(window.api.openPdf).mockResolvedValueOnce('/docs/two.pdf')
    vi.mocked(window.api.readPdf).mockReturnValueOnce(secondRead.promise)

    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }))

    await waitFor(() => expect(screen.queryByTestId('pdf-viewer')).toBeNull())
    expect(document.querySelector('.pdf-viewer')).toBeInTheDocument()
    expect(screen.getByTestId('filename')).toHaveTextContent('one.pdf')
    expect(screen.getByTestId('num-pages')).toHaveTextContent('12')

    await act(async () => {
      secondRead.resolve(makeReadResult('doc-2', '/docs/two.pdf'))
      await secondRead.promise
    })

    await waitFor(() => expect(screen.getByTestId('filename')).toHaveTextContent('two.pdf'))
    expect(screen.getByTestId('num-pages')).toHaveTextContent('0')
    expect(screen.queryByTestId('pdf-viewer')).toBeNull()
    expectLastPageDimensionsClear()

    await flushAnimationFrames()

    expect(await screen.findByTestId('pdf-viewer')).toHaveTextContent('doc-2')
    await waitFor(() => expect(screen.getByTestId('num-pages')).toHaveTextContent('3'))
    expect(window.api.readPdf).toHaveBeenNthCalledWith(1, '/docs/one.pdf')
    expect(window.api.readPdf).toHaveBeenNthCalledWith(2, '/docs/two.pdf')
  })
})
