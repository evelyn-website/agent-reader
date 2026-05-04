import { useState } from 'react'
import PDFViewer from './components/PDFViewer'
import Toolbar from './components/Toolbar'
import { useZoom } from './components/useZoom'
import { useWindowedPages } from './components/useWindowedPages'
import './assets/main.css'

interface PdfFile {
  path: string
  data: Buffer
}

export default function App(): React.JSX.Element {
  const [pdf, setPdf] = useState<PdfFile | null>(null)
  const [numPages, setNumPages] = useState<number>(0)
  const { scale, zoomIn, zoomOut, zoomReset, atMin, atMax } = useZoom()
  const windowed = useWindowedPages(numPages, scale)

  const handleOpen = async (): Promise<void> => {
    const path = await window.api.openPdf()
    if (!path) return
    const data = await window.api.readPdf(path)
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
      />
      <div className="main-area">
        {pdf ? (
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
          />
        ) : (
          <div className="empty-state">
            <p>Open a PDF to get started</p>
          </div>
        )}
      </div>
    </div>
  )
}
