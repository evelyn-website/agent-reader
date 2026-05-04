import { useState, useCallback, useMemo, useEffect } from 'react'
import { Document, Page } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

interface PDFViewerProps {
  data: ArrayBuffer
  scale: number
  numPages: number
  setNumPages: (n: number) => void
  inWindow: (n: number) => boolean
  setPageRef: (n: number, el: HTMLDivElement | null) => void
  getPlaceholderHeight: (n: number) => number
  onPageRenderSuccess: (n: number, height: number) => void
  onItemClick: (pageNumber: number) => void
  setPageDimensions: (dims: Map<number, number>) => void
}

const HIDDEN_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  opacity: 0,
  pointerEvents: 'none'
}

interface SwappablePageProps {
  pageNumber: number
  scale: number
  onRendered: (height: number) => void
}

const BACK_SLOT_TEARDOWN_MS = 500

function SwappablePage({ pageNumber, scale, onRendered }: SwappablePageProps): React.JSX.Element {
  const [slots, setSlots] = useState<{ a: number | null; b: number | null }>({
    a: scale,
    b: null
  })
  const [front, setFront] = useState<'a' | 'b'>('a')

  useEffect(() => {
    const frontScale = front === 'a' ? slots.a : slots.b
    if (scale === frontScale) return
    setSlots((s) => (front === 'a' ? { ...s, b: scale } : { ...s, a: scale }))
  }, [scale, front, slots.a, slots.b])

  useEffect(() => {
    const frontScale = front === 'a' ? slots.a : slots.b
    const backScale = front === 'a' ? slots.b : slots.a
    if (scale !== frontScale || backScale === null) return
    const t = setTimeout(() => {
      setSlots((s) => (front === 'a' ? { ...s, b: null } : { ...s, a: null }))
    }, BACK_SLOT_TEARDOWN_MS)
    return () => clearTimeout(t)
  }, [scale, front, slots.a, slots.b])

  const handleRendered = (slot: 'a' | 'b', slotScale: number, height: number): void => {
    if (slot !== front && slotScale === scale) {
      setFront(slot)
    }
    onRendered(height)
  }

  const frontScale = (front === 'a' ? slots.a : slots.b) ?? scale
  const previewZoom = scale / frontScale

  return (
    <div
      style={{
        position: 'relative',
        ...(previewZoom === 1 ? undefined : { zoom: previewZoom })
      }}
    >
      {slots.a !== null && (
        <div style={front === 'a' ? undefined : HIDDEN_STYLE}>
          <Page
            key={`a-${slots.a}`}
            pageNumber={pageNumber}
            scale={slots.a}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            onRenderSuccess={({ height }) => handleRendered('a', slots.a!, height)}
          />
        </div>
      )}
      {slots.b !== null && (
        <div style={front === 'b' ? undefined : HIDDEN_STYLE}>
          <Page
            key={`b-${slots.b}`}
            pageNumber={pageNumber}
            scale={slots.b}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            onRenderSuccess={({ height }) => handleRendered('b', slots.b!, height)}
          />
        </div>
      )}
    </div>
  )
}

export default function PDFViewer({
  data,
  scale,
  numPages,
  setNumPages,
  inWindow,
  setPageRef,
  getPlaceholderHeight,
  onPageRenderSuccess,
  onItemClick,
  setPageDimensions
}: PDFViewerProps): React.JSX.Element {
  const file = useMemo(() => ({ data: new Uint8Array(data) }), [data])

  const onDocumentLoadSuccess = useCallback(
    async (pdf: { numPages: number; getPage: (n: number) => Promise<{ getViewport: (p: { scale: number }) => { height: number } }> }) => {
      const dims = new Map<number, number>()
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1))
      )
      pages.forEach((page, i) => {
        dims.set(i + 1, page.getViewport({ scale: 1 }).height)
      })
      setPageDimensions(dims)
      setNumPages(pdf.numPages)
    },
    [setNumPages, setPageDimensions]
  )

  return (
    <div className="pdf-viewer">
      <div className="pdf-document">
        <Document
          file={file}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(err) => console.error('PDF load error:', err)}
          onItemClick={({ pageNumber }) => onItemClick(pageNumber)}
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
                  <SwappablePage
                    pageNumber={n}
                    scale={scale}
                    onRendered={(height) => onPageRenderSuccess(n, height)}
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
