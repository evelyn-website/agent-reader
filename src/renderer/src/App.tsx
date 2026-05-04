import { useState, useEffect, useCallback } from 'react'
import PDFViewer from './components/PDFViewer'
import Toolbar from './components/Toolbar'
import OutlineSidebar from './components/OutlineSidebar'
import { useZoom } from './components/useZoom'
import { useWindowedPages } from './components/useWindowedPages'
import type { OutlineNode } from './components/loadToc'
import './assets/main.css'

interface PdfFile {
  path: string
  data: Buffer
}

export default function App(): React.JSX.Element {
  const [pdf, setPdf] = useState<PdfFile | null>(null)
  const [numPages, setNumPages] = useState<number>(0)
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
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
  const { scale, zoomIn, zoomOut, zoomReset, atMin, atMax } = useZoom()
  const windowed = useWindowedPages(numPages, scale)

  const handleOpen = async (): Promise<void> => {
    const path = await window.api.openPdf()
    if (!path) return
    const data = await window.api.readPdf(path)
    setOutline([])
    setSidebarOpen(true)
    setPdf({ path, data })
  }

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
              data={pdf.data}
              scale={scale}
              numPages={numPages}
              setNumPages={setNumPages}
              inWindow={windowed.inWindow}
              setPageRef={windowed.setPageRef}
              getPlaceholderHeight={windowed.getPlaceholderHeight}
              onPageRenderSuccess={windowed.onPageRenderSuccess}
              onItemClick={windowed.scrollToPage}
              setPageDimensions={windowed.setPageDimensions}
              setOutline={setOutline}
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
