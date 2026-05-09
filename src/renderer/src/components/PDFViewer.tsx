import { useState, useCallback, useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { Document, Page } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { loadToc, type OutlineNode } from './loadToc'
import type { Layout } from './useWindowedPages'
import type { SearchIndex } from './buildSearchIndex'
import { buildSearchIndex } from './buildSearchIndex'
import SearchBar from './SearchBar'
import type { UseSearchResult } from './useSearch'
import { createDebug } from '../lib/debug'
import AnnotationLayer from './AnnotationLayer'
import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
  type UseAnnotationsResult
} from './useAnnotations'
import { captureSelection, pointToPageCoord } from './captureSelection'

type TextRenderer = (props: { pageNumber: number; itemIndex: number; str: string }) => string

const dSwap = createDebug('pdf:swap')

interface PDFViewerProps {
  data: Uint8Array
  scale: number
  setNumPages: (n: number) => void
  layout: Layout
  setPageRef: (n: number, el: HTMLDivElement | null) => void
  getPlaceholderHeight: (n: number) => number
  onPageRenderSuccess: (n: number, height: number) => void
  onItemClick: (pageNumber: number) => void
  setPageDimensions: (dims: Map<number, number>) => void
  setOutline: (outline: OutlineNode[]) => void
  setSearchIndex: (index: SearchIndex | null) => void
  onZoomTo: (scale: number) => void
  search: UseSearchResult
  searchIndexReady: boolean
  annotations: UseAnnotationsResult
  noteMode: boolean
  setNoteMode: (v: boolean) => void
}

export interface PDFViewerHandle {
  triggerHighlight: (color: HighlightColor) => void
}

const HIDDEN_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: -99999,
  left: 0,
  pointerEvents: 'none'
}

interface SwappablePageProps {
  pageNumber: number
  scale: number
  onRendered: (height: number) => void
  customTextRenderer?: TextRenderer
  renderOverlay?: (frontScale: number) => React.ReactNode
}

const BACK_SLOT_TEARDOWN_MS = 500
// Debounce back-slot scale updates: while the user is actively pinching, the
// scale changes ~60Hz and each change would remount the back <Page>, cancelling
// any in-flight render. Wait for scale to stabilize before kicking off a real
// back render.
const BACK_RENDER_DEBOUNCE_MS = 120

function SwappablePage({
  pageNumber,
  scale,
  onRendered,
  customTextRenderer,
  renderOverlay
}: SwappablePageProps): React.JSX.Element {
  const [slots, setSlots] = useState<{ a: number | null; b: number | null }>({
    a: scale,
    b: null
  })
  const [front, setFront] = useState<'a' | 'b'>('a')
  const slotARef = useRef<HTMLDivElement>(null)
  const slotBRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frontScale = front === 'a' ? slots.a : slots.b
    if (scale === frontScale) return
    const backSlot = front === 'a' ? 'b' : 'a'
    const t = setTimeout(() => {
      dSwap(`p${pageNumber} new-back slot=${backSlot} scale=${scale} front=${front}@${frontScale}`)
      setSlots((s) => (front === 'a' ? { ...s, b: scale } : { ...s, a: scale }))
    }, BACK_RENDER_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [scale, front, slots.a, slots.b, pageNumber])

  useEffect(() => {
    const frontScale = front === 'a' ? slots.a : slots.b
    const backScale = front === 'a' ? slots.b : slots.a
    if (scale !== frontScale || backScale === null) return
    const t = setTimeout(() => {
      dSwap(`p${pageNumber} teardown back-slot=${front === 'a' ? 'b' : 'a'}@${backScale}`)
      setSlots((s) => (front === 'a' ? { ...s, b: null } : { ...s, a: null }))
    }, BACK_SLOT_TEARDOWN_MS)
    return () => clearTimeout(t)
  }, [scale, front, slots.a, slots.b, pageNumber])

  const handleRendered = (slot: 'a' | 'b', slotScale: number, height: number): void => {
    const isBack = slot !== front
    const stale = slotScale !== scale
    dSwap(
      `p${pageNumber} rendered slot=${slot}@${slotScale} h=${height.toFixed(0)} ` +
        `front=${front} curScale=${scale} ${isBack ? 'BACK' : 'FRONT'}${stale ? ' STALE' : ''}`
    )
    if (isBack && !stale) {
      const t0 = performance.now()
      requestAnimationFrame(() => {
        // The back slot may have been re-keyed (slotsRef[slot] changed) while
        // we waited for rAF, leaving an empty placeholder canvas. Verify the
        // canvas is actually drawn before swapping — otherwise we'd reveal a
        // white frame.
        const ref = slot === 'a' ? slotARef.current : slotBRef.current
        const canvas = ref?.querySelector('canvas')
        const cw = canvas?.width ?? 0
        const ch = canvas?.height ?? 0
        const rect = ref?.getBoundingClientRect()
        if (cw === 0 || ch === 0) {
          dSwap(
            `p${pageNumber} swap-aborted slot=${slot}@${slotScale} canvas=${cw}x${ch} ` +
              `rect=${rect?.width.toFixed(0)}x${rect?.height.toFixed(0)} curScale=${scale}`
          )
          return
        }
        dSwap(
          `p${pageNumber} swap-exec slot=${slot}@${slotScale} ` +
            `dt=${(performance.now() - t0).toFixed(1)}ms ` +
            `canvas=${cw}x${ch} rect=${rect?.width.toFixed(0)}x${rect?.height.toFixed(0)} ` +
            `curScale=${scale}`
        )
        setFront(slot)
      })
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
        <div ref={slotARef} style={front === 'a' ? undefined : HIDDEN_STYLE}>
          <Page
            key={`a-${slots.a}`}
            pageNumber={pageNumber}
            scale={slots.a}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            customTextRenderer={customTextRenderer}
            onRenderSuccess={({ height }) => handleRendered('a', slots.a!, height)}
          />
        </div>
      )}
      {slots.b !== null && (
        <div ref={slotBRef} style={front === 'b' ? undefined : HIDDEN_STYLE}>
          <Page
            key={`b-${slots.b}`}
            pageNumber={pageNumber}
            scale={slots.b}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            customTextRenderer={customTextRenderer}
            onRenderSuccess={({ height }) => handleRendered('b', slots.b!, height)}
          />
        </div>
      )}
      {renderOverlay && (
        <div className="annotation-overlay-host">{renderOverlay(frontScale)}</div>
      )}
    </div>
  )
}

function renderWindow(
  range: { from: number; to: number },
  scale: number,
  setPageRef: (n: number, el: HTMLDivElement | null) => void,
  getPlaceholderHeight: (n: number) => number,
  onPageRenderSuccess: (n: number, height: number) => void,
  customTextRenderer: TextRenderer | undefined,
  renderPageOverlay: (n: number, frontScale: number) => React.ReactNode,
  onPageMouseDown: (n: number, e: React.MouseEvent) => void | Promise<void>
): React.JSX.Element[] {
  const out: React.JSX.Element[] = []
  for (let n = range.from; n <= range.to; n++) {
    out.push(
      <div
        key={n}
        ref={(el) => setPageRef(n, el)}
        className="pdf-page-wrapper"
        style={{ height: getPlaceholderHeight(n), overflow: 'hidden' }}
        data-page-number={n}
        onMouseDown={(e) => void onPageMouseDown(n, e)}
      >
        <SwappablePage
          pageNumber={n}
          scale={scale}
          onRendered={(height) => onPageRenderSuccess(n, height)}
          customTextRenderer={customTextRenderer}
          renderOverlay={(frontScale) => renderPageOverlay(n, frontScale)}
        />
      </div>
    )
  }
  return out
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c])
}

function buildTextRenderer(regex: RegExp | null): TextRenderer | undefined {
  if (!regex) return undefined
  return ({ str }) => {
    if (!str) return ''
    // Reset lastIndex on each call (regex is /g).
    regex.lastIndex = 0
    let out = ''
    let last = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(str)) !== null) {
      if (m[0].length === 0) {
        regex.lastIndex++
        continue
      }
      out += escapeHtml(str.slice(last, m.index))
      out += `<mark class="pdf-match">${escapeHtml(m[0])}</mark>`
      last = m.index + m[0].length
    }
    if (last === 0) return escapeHtml(str)
    out += escapeHtml(str.slice(last))
    return out
  }
}

function PDFViewerInner(
  {
    data,
    scale,
    setNumPages,
    layout,
    setPageRef,
    getPlaceholderHeight,
    onPageRenderSuccess,
    onItemClick,
    setPageDimensions,
    setOutline,
    setSearchIndex,
    onZoomTo,
    search,
    searchIndexReady,
    annotations,
    noteMode,
    setNoteMode
  }: PDFViewerProps,
  ref: React.Ref<PDFViewerHandle>
): React.JSX.Element {
  const file = useMemo(() => ({ data: new Uint8Array(data) }), [data])
  const containerRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const pageRefsLocal = useRef<Map<number, HTMLDivElement>>(new Map())
  const lastColorRef = useRef<HighlightColor>('yellow')
  const noteModeRef = useRef(noteMode)
  noteModeRef.current = noteMode

  const { byPage: annotationsByPage, createHighlight, createNote, updateAnnotation, deleteAnnotation } = annotations

  const setPageRefCombined = useCallback(
    (n: number, el: HTMLDivElement | null) => {
      setPageRef(n, el)
      if (el) pageRefsLocal.current.set(n, el)
      else pageRefsLocal.current.delete(n)
    },
    [setPageRef]
  )

  const [openAnnotationId, setOpenAnnotationId] = useState<string | null>(null)
  const justCreatedIdRef = useRef<string | null>(null)

  const triggerHighlight = useCallback(
    async (color: HighlightColor, openEditor = false): Promise<void> => {
      const cap = captureSelection(pageRefsLocal.current, scaleRef.current)
      if (!cap) return
      window.getSelection()?.removeAllRanges()
      lastColorRef.current = color
      const ann = await createHighlight({
        pageNumber: cap.pageNumber,
        rects: cap.rects,
        color,
        text: cap.text
      })
      if (openEditor && ann) {
        justCreatedIdRef.current = ann.id
        setOpenAnnotationId(ann.id)
      }
    },
    [createHighlight]
  )

  useImperativeHandle(ref, () => ({ triggerHighlight: (c) => void triggerHighlight(c) }), [
    triggerHighlight
  ])

  const handlePageMouseDown = useCallback(
    async (pageNumber: number, e: React.MouseEvent): Promise<void> => {
      if (!noteModeRef.current) return
      // Don't drop a pin when clicking on an existing annotation control.
      const target = e.target as HTMLElement
      if (target.closest('.annotation-highlight, .annotation-pin, .annotation-popover')) {
        return
      }
      const el = pageRefsLocal.current.get(pageNumber)
      if (!el) return
      e.preventDefault()
      const { x, y } = pointToPageCoord(e.clientX, e.clientY, el, scaleRef.current)
      setNoteMode(false)
      const ann = await createNote({ pageNumber, x, y })
      if (ann) {
        justCreatedIdRef.current = ann.id
        setOpenAnnotationId(ann.id)
      }
    },
    [createNote, setNoteMode]
  )

  const customTextRenderer = useMemo(
    () => buildTextRenderer(search.highlightRegex),
    [search.highlightRegex]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = 1 - e.deltaY * 0.008
      onZoomTo(scaleRef.current * factor)
    }

    let startDist = 0
    let startScale = 1

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 2) return
      startDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      )
      startScale = scaleRef.current
    }

    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2) return
      e.preventDefault()
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      )
      if (startDist === 0) return
      onZoomTo(startScale * (dist / startDist))
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
    }
  }, [onZoomTo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (e.key === 'Escape' && noteModeRef.current) {
        e.preventDefault()
        setNoteMode(false)
        return
      }
      const sel = window.getSelection()
      const hasSelection = !!sel && !sel.isCollapsed && sel.toString().trim().length > 0
      if (e.key >= '1' && e.key <= '5' && hasSelection) {
        const idx = parseInt(e.key, 10) - 1
        const color = HIGHLIGHT_COLORS[idx]
        if (color) {
          e.preventDefault()
          triggerHighlight(color)
        }
        return
      }
      if ((e.key === 'h' || e.key === 'H') && hasSelection) {
        e.preventDefault()
        triggerHighlight(lastColorRef.current)
        return
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        if (hasSelection) {
          void triggerHighlight(lastColorRef.current, true)
        } else {
          setNoteMode(!noteModeRef.current)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [triggerHighlight, setNoteMode])

  const renderPageOverlay = useCallback(
    (pageNumber: number, frontScale: number): React.ReactNode => {
      const list = annotationsByPage.get(pageNumber)
      if (!list || list.length === 0) return null
      return (
        <AnnotationLayer
          annotations={list}
          scale={frontScale}
          openId={openAnnotationId}
          openIsNew={justCreatedIdRef.current === openAnnotationId && openAnnotationId !== null}
          onOpenChange={(id) => {
            justCreatedIdRef.current = null
            setOpenAnnotationId(id)
          }}
          onUpdate={updateAnnotation}
          onDelete={deleteAnnotation}
        />
      )
    },
    [annotationsByPage, openAnnotationId, updateAnnotation, deleteAnnotation]
  )

  const onDocumentLoadSuccess = useCallback(
    async (pdf: {
      numPages: number
      getPage: (n: number) => Promise<{ getViewport: (p: { scale: number }) => { height: number } }>
    }) => {
      const dims = new Map<number, number>()
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1))
      )
      pages.forEach((page, i) => {
        dims.set(i + 1, page.getViewport({ scale: 1 }).height)
      })
      setPageDimensions(dims)
      setNumPages(pdf.numPages)
      const outline = await loadToc(pdf as unknown as Parameters<typeof loadToc>[0])
      setOutline(outline)
      buildSearchIndex(pdf as unknown as Parameters<typeof buildSearchIndex>[0])
        .then(setSearchIndex)
        .catch((err) => console.error('search index build failed:', err))
    },
    [setNumPages, setPageDimensions, setOutline, setSearchIndex]
  )

  return (
    <div className={`pdf-viewer${noteMode ? ' pdf-viewer--note-mode' : ''}`}>
      <SearchBar search={search} indexReady={searchIndexReady} />
      <div className="pdf-document" ref={containerRef}>
        <div className="pdf-pages-inner">
          <Document
            file={file}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(err) => console.error('PDF load error:', err)}
            onItemClick={({ pageNumber }) => onItemClick(pageNumber)}
          >
            {layout.topSpacer > 0 && (
              <div className="pdf-spacer" style={{ height: layout.topSpacer }} />
            )}
            {renderWindow(
              layout.windowA,
              scale,
              setPageRefCombined,
              getPlaceholderHeight,
              onPageRenderSuccess,
              customTextRenderer,
              renderPageOverlay,
              handlePageMouseDown
            )}
            {layout.middleSpacer > 0 && (
              <div className="pdf-spacer" style={{ height: layout.middleSpacer }} />
            )}
            {layout.windowB &&
              renderWindow(
                layout.windowB,
                scale,
                setPageRefCombined,
                getPlaceholderHeight,
                onPageRenderSuccess,
                customTextRenderer,
                renderPageOverlay,
                handlePageMouseDown
              )}
            {layout.bottomSpacer > 0 && (
              <div className="pdf-spacer" style={{ height: layout.bottomSpacer }} />
            )}
          </Document>
        </div>
      </div>
    </div>
  )
}

const PDFViewer = forwardRef<PDFViewerHandle, PDFViewerProps>(PDFViewerInner)
export default PDFViewer
