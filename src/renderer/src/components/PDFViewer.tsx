import { useState, useCallback, useMemo } from 'react'
import { Document, Page } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useWindowedPages } from './useWindowedPages'

interface PDFViewerProps {
  data: ArrayBuffer
}

export default function PDFViewer({ data }: PDFViewerProps): React.JSX.Element {
  const [numPages, setNumPages] = useState<number>(0)
  const file = useMemo(() => ({ data: new Uint8Array(data) }), [data])
  const { inWindow, setPageRef, getPlaceholderHeight, onPageRenderSuccess } =
    useWindowedPages(numPages)

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
  }, [])

  return (
    <div className="pdf-viewer">
      <div className="pdf-document">
        <Document
          file={file}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(err) => console.error('PDF load error:', err)}
        >
          {Array.from({ length: numPages }, (_, i) => {
            const n = i + 1
            return (
              <div
                key={n}
                ref={(el) => setPageRef(n, el)}
                className="pdf-page-wrapper"
                style={inWindow(n) ? undefined : { height: getPlaceholderHeight(n) }}
              >
                {inWindow(n) ? (
                  <Page
                    pageNumber={n}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    onRenderSuccess={({ height }) => onPageRenderSuccess(n, height)}
                  />
                ) : null}
              </div>
            )
          })}
        </Document>
      </div>
    </div>
  )
}
