import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { SearchIndex } from '../components/buildSearchIndex'
import { createDebug } from '../lib/debug'
import type { OutlineNode } from '../components/loadToc'
import { useSearch, type UseSearchResult } from '../components/useSearch'
import { useWindowedPages, type Layout } from '../components/useWindowedPages'

const dPerf = createDebug('pdf:perf')

export interface PdfFile {
  path: string
  data: Buffer
  documentId: string
}

interface WindowedPagesSession {
  currentPage: number
  layout: Layout
  setPageRef: (n: number, el: HTMLDivElement | null) => void
  getPlaceholderHeight: (n: number) => number
  onPageRenderSuccess: (n: number, height: number) => void
  scrollToPage: (n: number) => void
  setPageDimensions: (dims: Map<number, number>) => void
}

export function useDocumentSession(scale: number): {
  pdf: PdfFile | null
  viewerReady: boolean
  numPages: number
  outline: OutlineNode[]
  searchIndex: SearchIndex | null
  search: UseSearchResult
  windowed: WindowedPagesSession
  noteMode: boolean
  setNumPages: (n: number) => void
  setOutline: (outline: OutlineNode[]) => void
  setSearchIndex: (index: SearchIndex | null) => void
  setNoteMode: Dispatch<SetStateAction<boolean>>
  loadPdfPath: (path: string) => Promise<void>
  clearDocument: () => void
} {
  const [pdf, setPdf] = useState<PdfFile | null>(null)
  const [numPages, setNumPages] = useState<number>(0)
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(null)
  const [noteMode, setNoteMode] = useState(false)
  const [viewerReady, setViewerReady] = useState(false)
  const switchTokenRef = useRef(0)
  const {
    currentPage,
    layout,
    setPageRef,
    getPlaceholderHeight,
    onPageRenderSuccess,
    scrollToPage,
    setPageDimensions
  } = useWindowedPages(numPages, scale)
  const search = useSearch(searchIndex, scrollToPage)

  const resetDocumentState = useCallback(() => {
    setOutline([])
    setSearchIndex(null)
    setNumPages(0)
    setPageDimensions(new Map())
    setNoteMode(false)
  }, [setPageDimensions])

  const loadPdfPath = useCallback(
    async (path: string): Promise<void> => {
      const switchToken = ++switchTokenRef.current
      const t0 = performance.now()
      dPerf(`click→loadPdfPath START ${path.split('/').pop()}`)
      setViewerReady(false)
      const { data, document } = await window.api.readPdf(path)
      if (switchToken !== switchTokenRef.current) return
      const t1 = performance.now()
      dPerf(
        `  loadPdfPath readPdf IPC ${(t1 - t0).toFixed(1)}ms ` +
          `bytes=${data.length} docId=${document.id.slice(0, 8)}`
      )
      resetDocumentState()
      setPdf({ path, data, documentId: document.id })
      requestAnimationFrame(() => {
        if (switchToken === switchTokenRef.current) setViewerReady(true)
      })
      dPerf(`  loadPdfPath setPdf ${(performance.now() - t1).toFixed(1)}ms`)
    },
    [resetDocumentState]
  )

  const clearDocument = useCallback(() => {
    switchTokenRef.current++
    setViewerReady(false)
    setPdf(null)
    resetDocumentState()
  }, [resetDocumentState])

  return {
    pdf,
    viewerReady,
    numPages,
    outline,
    searchIndex,
    search,
    windowed: {
      currentPage,
      layout,
      setPageRef,
      getPlaceholderHeight,
      onPageRenderSuccess,
      scrollToPage,
      setPageDimensions
    },
    noteMode,
    setNumPages,
    setOutline,
    setSearchIndex,
    setNoteMode,
    loadPdfPath,
    clearDocument
  }
}
