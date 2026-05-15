import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import App from './App'
import type { DocumentRow } from '../../shared/dbTypes'

const appMocks = vi.hoisted(() => ({
  currentPage: 1,
  scrollToPage: vi.fn(),
  setPageDimensions: vi.fn()
}))

vi.mock('./components/PDFViewer', async () => {
  const React = await import('react')
  const MockPDFViewer = React.forwardRef(
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
  MockPDFViewer.displayName = 'MockPDFViewer'

  return {
    default: MockPDFViewer
  }
})

vi.mock('./components/Toolbar', () => ({
  default: ({
    filename,
    numPages,
    onOpen,
    showOpenButton = true,
    onDismissDocument
  }: {
    filename: string | null
    numPages: number
    onOpen: () => void | Promise<void>
    showOpenButton?: boolean
    onDismissDocument?: () => void
  }) => (
    <div data-testid="toolbar">
      {showOpenButton && (
        <button type="button" onClick={() => void onOpen()}>
          Open PDF
        </button>
      )}
      {onDismissDocument && (
        <button type="button" onClick={onDismissDocument}>
          Back to project
        </button>
      )}
      <span data-testid="filename">{filename ?? ''}</span>
      <span data-testid="num-pages">{numPages}</span>
    </div>
  )
}))

vi.mock('./components/SidePanel', () => ({
  default: ({
    tabs,
    activeTabId
  }: {
    tabs: Array<{ id: string; content: ReactNode }>
    activeTabId: string
  }) => (
    <aside data-testid="side-panel">
      {tabs.find((tab) => tab.id === activeTabId)?.content ?? null}
    </aside>
  )
}))

vi.mock('./components/OutlineTabContent', () => ({
  default: () => <div />
}))

vi.mock('./components/FilesTabContent', () => ({
  default: ({ onOpenFile }: { onOpenFile: (path: string) => void | Promise<void> }) => (
    <div>
      <button type="button" onClick={() => void onOpenFile('/project/one.pdf')}>
        Open one from files tab
      </button>
      <button type="button" onClick={() => void onOpenFile('/project/two.pdf')}>
        Open two from files tab
      </button>
    </div>
  )
}))

vi.mock('./components/ChatTabContent', () => ({
  default: () => <div />
}))

vi.mock('./components/MarksTabContent', () => ({
  default: () => <div />
}))

vi.mock('./components/EmptyLauncher', () => ({
  default: ({ onOpenRecent }: { onOpenRecent: (path: string) => void | Promise<void> }) => (
    <div data-testid="empty-launcher">
      <button type="button" onClick={() => void onOpenRecent('/project')}>
        Open recent project
      </button>
    </div>
  )
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
    currentPage: appMocks.currentPage,
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
    scrollToPage: appMocks.scrollToPage,
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
  appMocks.currentPage = 1
  appMocks.scrollToPage.mockClear()
  appMocks.setPageDimensions.mockClear()
  rafCallbacks = []
  originalRequestAnimationFrame = window.requestAnimationFrame
  window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  window.api.openPdf = vi.fn()
  window.api.readPdf = vi.fn()
  window.api.project.scan = vi.fn().mockResolvedValue({
    path: '/project',
    name: 'Project',
    tree: [
      { kind: 'file', name: 'one.pdf', path: '/project/one.pdf' },
      { kind: 'file', name: 'two.pdf', path: '/project/two.pdf' }
    ]
  })
  window.api.project.dashboard = vi.fn().mockResolvedValue({
    documents: [
      {
        path: '/project/one.pdf',
        name: 'one.pdf',
        document_id: null,
        last_opened_at: null,
        open_count: 0,
        mark_count: 0,
        highlight_count: 0,
        note_count: 0
      },
      {
        path: '/project/two.pdf',
        name: 'two.pdf',
        document_id: null,
        last_opened_at: null,
        open_count: 0,
        mark_count: 0,
        highlight_count: 0,
        note_count: 0
      }
    ],
    resumeDocument: null,
    recentMarks: [],
    recentSessions: []
  })
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

    expect(screen.getByRole('button', { name: 'Open PDF' })).toBeInTheDocument()

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

  it('can dismiss an open project document back to the project dashboard', async () => {
    vi.mocked(window.api.readPdf).mockResolvedValue(makeReadResult('doc-1', '/project/one.pdf'))

    render(<App />)

    expect(screen.getByRole('button', { name: 'Open PDF' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open recent project' }))

    expect(await screen.findByRole('heading', { name: 'Project' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open PDF' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /one\.pdf/i }))

    await waitFor(() => expect(screen.getByTestId('filename')).toHaveTextContent('one.pdf'))
    await flushAnimationFrames()
    expect(await screen.findByTestId('pdf-viewer')).toHaveTextContent('doc-1')
    expect(screen.queryByRole('button', { name: 'Open PDF' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to project' }))

    await waitFor(() => expect(screen.queryByTestId('pdf-viewer')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /one\.pdf/i })).toBeInTheDocument()
    expect(screen.getByTestId('filename')).toHaveTextContent('')
    expect(screen.getByTestId('num-pages')).toHaveTextContent('0')
    expectLastPageDimensionsClear()
  })

  it('restores the cached page when switching back to a project document from the files tab', async () => {
    vi.mocked(window.api.readPdf).mockImplementation(async (path: string) =>
      makeReadResult(path.endsWith('one.pdf') ? 'doc-1' : 'doc-2', path)
    )

    const { rerender } = render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open recent project' }))
    fireEvent.click(await screen.findByRole('button', { name: /one\.pdf/i }))
    await waitFor(() => expect(screen.getByTestId('filename')).toHaveTextContent('one.pdf'))
    await flushAnimationFrames()
    expect(await screen.findByTestId('pdf-viewer')).toHaveTextContent('doc-1')
    await waitFor(() => expect(screen.getByTestId('num-pages')).toHaveTextContent('12'))

    appMocks.currentPage = 7
    rerender(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open two from files tab' }))
    await waitFor(() => expect(screen.getByTestId('filename')).toHaveTextContent('two.pdf'))
    await flushAnimationFrames()
    expect(await screen.findByTestId('pdf-viewer')).toHaveTextContent('doc-2')
    await waitFor(() => expect(screen.getByTestId('num-pages')).toHaveTextContent('3'))
    expect(appMocks.scrollToPage).not.toHaveBeenCalled()

    appMocks.currentPage = 2
    rerender(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open one from files tab' }))
    await waitFor(() => expect(screen.getByTestId('filename')).toHaveTextContent('one.pdf'))
    await flushAnimationFrames()
    expect(await screen.findByTestId('pdf-viewer')).toHaveTextContent('doc-1')
    await waitFor(() => expect(screen.getByTestId('num-pages')).toHaveTextContent('12'))
    expect(appMocks.scrollToPage).toHaveBeenCalledWith(7)
  })
})
