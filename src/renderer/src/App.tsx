import { useState, useEffect, useCallback, useRef } from 'react'
import PDFViewer, { type PDFViewerHandle } from './components/PDFViewer'
import Toolbar from './components/Toolbar'
import OutlineSidebar from './components/OutlineSidebar'
import { useZoom } from './components/useZoom'
import { useWindowedPages } from './components/useWindowedPages'
import { useSearch } from './components/useSearch'
import { useAnnotations, type HighlightColor } from './components/useAnnotations'
import type { OutlineNode } from './components/loadToc'
import type { SearchIndex } from './components/buildSearchIndex'
import './assets/main.css'

interface PdfFile {
  path: string
  data: Buffer
  documentId: string
}

export default function App(): React.JSX.Element {
  const [pdf, setPdf] = useState<PdfFile | null>(null)
  const [numPages, setNumPages] = useState<number>(0)
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [noteMode, setNoteMode] = useState(false)
  const pdfRef = useRef<PDFViewerHandle>(null)
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key === '\\') {
        if (outline.length === 0) return
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [outline.length, toggleSidebar])
  const { scale, zoomIn, zoomOut, zoomReset, zoomTo, atMin, atMax } = useZoom()
  const windowed = useWindowedPages(numPages, scale)
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(null)
  const search = useSearch(searchIndex, windowed.scrollToPage)
  const annotations = useAnnotations(pdf?.documentId ?? null)

  const handleOpen = async (): Promise<void> => {
    const path = await window.api.openPdf()
    if (!path) return
    const { data, document } = await window.api.readPdf(path)
    setOutline([])
    setSearchIndex(null)
    setSidebarOpen(true)
    setNoteMode(false)
    setPdf({ path, data, documentId: document.id })
  }

  const handleHighlightSelection = useCallback((color: HighlightColor) => {
    pdfRef.current?.triggerHighlight(color)
  }, [])

  return (
    <div className="app-layout">
      <Toolbar
        filename={pdf?.path.split('/').pop() ?? null}
        scale={scale}
        atMin={atMin}
        atMax={atMax}
        onOpen={handleOpen}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        currentPage={windowed.currentPage}
        numPages={numPages}
        onJumpToPage={windowed.scrollToPage}
        showSidebarToggle={outline.length > 0}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        showAnnotationControls={pdf !== null}
        onHighlightSelection={handleHighlightSelection}
        noteMode={noteMode}
        onToggleNoteMode={() => setNoteMode((v) => !v)}
      />
      <div className="main-area">
        {pdf ? (
          <>
            {outline.length > 0 && sidebarOpen && (
              <OutlineSidebar
                outline={outline}
                currentPage={windowed.currentPage}
                onJumpToPage={windowed.scrollToPage}
              />
            )}
            <PDFViewer
              ref={pdfRef}
              data={pdf.data}
              scale={scale}
              setNumPages={setNumPages}
              layout={windowed.layout}
              setPageRef={windowed.setPageRef}
              getPlaceholderHeight={windowed.getPlaceholderHeight}
              onPageRenderSuccess={windowed.onPageRenderSuccess}
              onItemClick={windowed.scrollToPage}
              setPageDimensions={windowed.setPageDimensions}
              setOutline={setOutline}
              setSearchIndex={setSearchIndex}
              onZoomTo={zoomTo}
              search={search}
              searchIndexReady={searchIndex !== null}
              annotations={annotations}
              noteMode={noteMode}
              setNoteMode={setNoteMode}
            />
          </>
        ) : (
          <div className="empty-state">
            <p>Open a PDF to get started</p>
          </div>
        )}
      </div>
    </div>
  )
}
