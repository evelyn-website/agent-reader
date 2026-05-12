import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type { ComponentProps } from 'react'
import PDFViewer from './PDFViewer'
import type { UseSearchResult } from './useSearch'
import type { UseAnnotationsResult } from './useAnnotations'

const mocks = vi.hoisted(() => ({
  getOrLoad: vi.fn(),
  getMeta: vi.fn(),
  setMeta: vi.fn(),
  loadToc: vi.fn(),
  buildSearchIndex: vi.fn(),
  pageProps: [] as Array<Record<string, unknown>>
}))

vi.mock('react-pdf', async () => {
  const React = await import('react')
  return {
    Page: (props: Record<string, unknown>) => {
      mocks.pageProps.push(props)
      React.useEffect(() => {
        const onRenderSuccess = props.onRenderSuccess as
          | ((page: { height: number }) => void)
          | undefined
        onRenderSuccess?.({ height: 800 })
      }, [props.onRenderSuccess])

      return React.createElement(
        'div',
        {
          'data-testid': 'pdf-page',
          'data-page-number': String(props.pageNumber),
          'data-has-custom-text-renderer': String(typeof props.customTextRenderer === 'function'),
          'data-has-pdf-prop': Object.prototype.hasOwnProperty.call(props, 'pdf') ? 'yes' : 'no'
        },
        `Page ${String(props.pageNumber)}`
      )
    }
  }
})

vi.mock('react-pdf/dist/esm/DocumentContext.js', async () => {
  const React = await import('react')
  return { default: React.createContext(null) }
})

vi.mock('react-pdf/dist/esm/LinkService.js', () => ({
  default: class LinkService {
    setDocument(): void {}
  }
}))

vi.mock('./pdfProxyCache', () => ({
  getOrLoad: mocks.getOrLoad,
  getMeta: mocks.getMeta,
  setMeta: mocks.setMeta
}))

vi.mock('./loadToc', () => ({
  loadToc: mocks.loadToc
}))

vi.mock('./buildSearchIndex', () => ({
  buildSearchIndex: mocks.buildSearchIndex
}))

vi.mock('./SearchBar', () => ({
  default: () => <div data-testid="search-bar" />
}))

vi.mock('./AnnotationLayer', () => ({
  default: () => <div data-testid="annotation-layer" />
}))

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

function makePdf(numPages: number) {
  return {
    numPages,
    getPage: vi.fn().mockResolvedValue({
      getViewport: () => ({ height: 800 })
    })
  }
}

function makeSearch(highlightRegex: RegExp | null = null): UseSearchResult {
  return {
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
    highlightRegex
  }
}

function makeAnnotations(): UseAnnotationsResult {
  return {
    all: [],
    byPage: new Map(),
    createHighlight: vi.fn().mockResolvedValue(null),
    createNote: vi.fn().mockResolvedValue(null),
    updateAnnotation: vi.fn().mockResolvedValue(null),
    deleteAnnotation: vi.fn().mockResolvedValue(null)
  }
}

function makeProps(overrides: Partial<ComponentProps<typeof PDFViewer>> = {}): ComponentProps<typeof PDFViewer> {
  return {
    data: Buffer.from('pdf bytes'),
    documentId: 'doc-a',
    scale: 1,
    setNumPages: vi.fn(),
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
    setPageDimensions: vi.fn(),
    setOutline: vi.fn(),
    setSearchIndex: vi.fn(),
    onZoomTo: vi.fn(),
    search: makeSearch(),
    searchIndexReady: true,
    annotations: makeAnnotations(),
    noteMode: false,
    setNoteMode: vi.fn(),
    ...overrides
  }
}

beforeEach(() => {
  mocks.getOrLoad.mockReset()
  mocks.getMeta.mockReset()
  mocks.setMeta.mockReset()
  mocks.loadToc.mockReset()
  mocks.buildSearchIndex.mockReset()
  mocks.pageProps.length = 0

  mocks.getMeta.mockReturnValue({
    dims: new Map([[1, 800]]),
    outline: []
  })
  mocks.loadToc.mockResolvedValue([])
  mocks.buildSearchIndex.mockResolvedValue({
    numPages: 1,
    pageTexts: ['', 'cached page'],
    pageTextsLower: ['', 'cached page']
  })
  window.api.searchIndex.get = vi.fn().mockResolvedValue(['', 'cached page'])
  window.api.searchIndex.put = vi.fn().mockResolvedValue(null)
})

describe('PDFViewer — document switching', () => {
  it('removes pages while the next document proxy is still loading', async () => {
    const docB = deferred<ReturnType<typeof makePdf>>()
    const baseProps = makeProps({ documentId: 'doc-a', data: Buffer.from('doc a') })
    mocks.getOrLoad.mockImplementation((documentId: string) => {
      if (documentId === 'doc-a') return Promise.resolve(makePdf(1))
      if (documentId === 'doc-b') return docB.promise
      return Promise.reject(new Error(`unexpected document ${documentId}`))
    })

    const { rerender } = render(<PDFViewer {...baseProps} />)

    expect(await screen.findByTestId('pdf-page')).toHaveTextContent('Page 1')

    rerender(<PDFViewer {...baseProps} documentId="doc-b" data={Buffer.from('doc b')} />)

    expect(screen.queryByTestId('pdf-page')).toBeNull()

    await act(async () => {
      docB.resolve(makePdf(2))
      await docB.promise
    })

    expect(await screen.findByTestId('pdf-page')).toHaveTextContent('Page 1')
  })

  it('passes a plain text renderer and keeps PDF proxies off Page props', async () => {
    mocks.getOrLoad.mockResolvedValue(makePdf(1))

    render(<PDFViewer {...makeProps()} />)

    expect(await screen.findByTestId('pdf-page')).toHaveAttribute(
      'data-has-custom-text-renderer',
      'true'
    )
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-has-pdf-prop', 'no')

    const latestPageProps = mocks.pageProps.at(-1)
    if (!latestPageProps) throw new Error('Expected Page to render')

    const customTextRenderer = latestPageProps.customTextRenderer as (props: {
      pageNumber: number
      itemIndex: number
      str: string
    }) => string

    expect(customTextRenderer({ pageNumber: 1, itemIndex: 0, str: 'A&B <x>' })).toBe(
      'A&amp;B &lt;x&gt;'
    )
  })
})
