import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { Page } from 'react-pdf'
import DocumentContext from 'react-pdf/dist/esm/DocumentContext.js'
import LinkService from 'react-pdf/dist/esm/LinkService.js'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { loadToc, type OutlineNode } from './loadToc'
import type { Layout } from './useWindowedPages'
import type { SearchIndex } from './buildSearchIndex'
import { buildSearchIndex } from './buildSearchIndex'
import { getOrLoad, getMeta, setMeta, type PDFDocumentProxy } from './pdfProxyCache'
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
const dPerf = createDebug('pdf:perf')

interface PDFViewerProps {
  data: Buffer
  documentId: string
  scale: number
  setNumPages: (n: number) => void
  layout: Layout
  setPageRef: (n: number, el: HTMLDivElement | null) => void
  getPlaceholderHeight: (n: number) => number
  onPageRenderSuccess: (n: number, height: number) => void
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
  documentId: string
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
  documentId,
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
            key={`${documentId}-a-${slots.a}`}
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
            key={`${documentId}-b-${slots.b}`}
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
  documentId: string,
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
          key={`${documentId}-${n}`}
          documentId={documentId}
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

const plainTextRenderer: TextRenderer = ({ str }) => escapeHtml(str)

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
    documentId,
    scale,
    setNumPages,
    layout,
    setPageRef,
    getPlaceholderHeight,
    onPageRenderSuccess,
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
  const [loadedPdfProxy, setLoadedPdfProxy] = useState<{
    documentId: string
    pdf: PDFDocumentProxy
  } | null>(null)
  const pdfProxy = loadedPdfProxy?.documentId === documentId ? loadedPdfProxy.pdf : null
  const switchStartRef = useRef<number | null>(null)
  const firstRenderLoggedForRef = useRef<string | null>(null)
  const linkServiceRef = useRef(new LinkService())
  const documentContextValue = useMemo(
    () => ({
      linkService: linkServiceRef.current,
      pdf: pdfProxy ?? undefined,
      registerPage: () => {},
      unregisterPage: () => {}
    }),
    [pdfProxy]
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const pageRefsLocal = useRef<Map<number, HTMLDivElement>>(new Map())
  const lastColorRef = useRef<HighlightColor>('yellow')
  const noteModeRef = useRef(noteMode)
  noteModeRef.current = noteMode

  const { byPage: annotationsByPage, createHighlight, createNote, updateAnnotation, deleteAnnotation } = annotations

  const loggedCommitForRef = useRef<PDFDocumentProxy | null>(null)
  useLayoutEffect(() => {
    if (!pdfProxy) return
    if (loggedCommitForRef.current === pdfProxy) return
    loggedCommitForRef.current = pdfProxy
    const start = switchStartRef.current
    if (start == null) return
    const id = documentId.slice(0, 8)
    dPerf(`  ${id} commit (post-setPdfProxy) ${(performance.now() - start).toFixed(1)}ms`)
  }, [pdfProxy, documentId])

  const renderedPagesRef = useRef<Set<number>>(new Set())
  const allRenderedLoggedForRef = useRef<string | null>(null)
  const expectedVisible =
    layout.windowA.to - layout.windowA.from + 1 +
    (layout.windowB ? layout.windowB.to - layout.windowB.from + 1 : 0)

  const wrappedOnPageRenderSuccess = useCallback(
    (n: number, height: number): void => {
      const start = switchStartRef.current
      if (start != null && firstRenderLoggedForRef.current !== documentId) {
        firstRenderLoggedForRef.current = documentId
        dPerf(
          `  ${documentId.slice(0, 8)} first-page-rendered p${n} ` +
            `${(performance.now() - start).toFixed(1)}ms (since switch START)`
        )
      }
      renderedPagesRef.current.add(n)
      if (
        start != null &&
        allRenderedLoggedForRef.current !== documentId &&
        renderedPagesRef.current.size >= expectedVisible
      ) {
        allRenderedLoggedForRef.current = documentId
        dPerf(
          `  ${documentId.slice(0, 8)} all-${expectedVisible}-visible-rendered ` +
            `${(performance.now() - start).toFixed(1)}ms (since switch START)`
        )
      }
      onPageRenderSuccess(n, height)
    },
    [documentId, onPageRenderSuccess, expectedVisible]
  )

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
    () => buildTextRenderer(search.highlightRegex) ?? plainTextRenderer,
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

  useEffect(() => {
    const id = documentId.slice(0, 8)
    const tStart = performance.now()
    switchStartRef.current = tStart
    firstRenderLoggedForRef.current = null
    allRenderedLoggedForRef.current = null
    renderedPagesRef.current = new Set()
    dPerf(`switch START ${id}`)
    let cancelled = false
    void (async () => {
      let pdf: PDFDocumentProxy
      try {
        pdf = await getOrLoad(documentId, data)
      } catch (err) {
        console.error('PDF load error:', err)
        return
      }
      const tProxy = performance.now()
      if (cancelled) return
      linkServiceRef.current.setDocument(pdf)
      setLoadedPdfProxy({ documentId, pdf })
      setNumPages(pdf.numPages)
      const tSet = performance.now()
      dPerf(`  ${id} proxy-ready ${(tProxy - tStart).toFixed(1)}ms; setState ${(tSet - tProxy).toFixed(1)}ms`)

      const cachedMeta = getMeta(documentId)
      if (cachedMeta) {
        setPageDimensions(cachedMeta.dims)
        setOutline(cachedMeta.outline)
        dPerf(`  ${id} meta HIT (dims+outline) ${(performance.now() - tSet).toFixed(1)}ms`)
      } else {
        const pages = await Promise.all(
          Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1))
        )
        const tPages = performance.now()
        if (cancelled) return
        const dims = new Map<number, number>()
        pages.forEach((page, i) => {
          dims.set(i + 1, page.getViewport({ scale: 1 }).height)
        })
        setPageDimensions(dims)
        const tDims = performance.now()
        dPerf(`  ${id} getPage×${pdf.numPages} ${(tPages - tSet).toFixed(1)}ms; dims ${(tDims - tPages).toFixed(1)}ms`)
        const outline = await loadToc(pdf as unknown as Parameters<typeof loadToc>[0])
        const tOutline = performance.now()
        if (cancelled) return
        setOutline(outline)
        setMeta(documentId, { dims, outline })
        dPerf(`  ${id} loadToc ${(tOutline - tDims).toFixed(1)}ms; meta cached`)
      }
      const tAfterMeta = performance.now()

      const cached = await window.api.searchIndex.get(documentId)
      const tCache = performance.now()
      if (cancelled) return
      if (cached) {
        const pageTextsLower = cached.map((s) => s.toLowerCase())
        setSearchIndex({ numPages: cached.length - 1, pageTexts: cached, pageTextsLower })
        dPerf(
          `  ${id} searchIndex HIT ${(tCache - tAfterMeta).toFixed(1)}ms; ` +
            `switch TOTAL ${(performance.now() - tStart).toFixed(1)}ms`
        )
        return
      }
      dPerf(`  ${id} searchIndex MISS, building (lookup ${(tCache - tAfterMeta).toFixed(1)}ms)`)
      buildSearchIndex(pdf as unknown as Parameters<typeof buildSearchIndex>[0])
        .then((idx) => {
          if (cancelled) return
          setSearchIndex(idx)
          void window.api.searchIndex.put(documentId, idx.pageTexts)
          dPerf(`  ${id} buildSearchIndex done ${(performance.now() - tCache).toFixed(1)}ms`)
        })
        .catch((err) => console.error('search index build failed:', err))
      dPerf(`  ${id} switch TOTAL (no-search) ${(performance.now() - tStart).toFixed(1)}ms`)
    })()
    return () => {
      cancelled = true
      const dt = performance.now() - tStart
      // Effect cleanup: either StrictMode immediate remount (~ms) or the user
      // switching docs later (sec+). Only the former matters for latency.
      if (dt < 100) dPerf(`switch cleanup ${id} after ${dt.toFixed(1)}ms (likely StrictMode)`)
    }
  }, [documentId, data, setNumPages, setPageDimensions, setOutline, setSearchIndex])

  return (
    <div className={`pdf-viewer${noteMode ? ' pdf-viewer--note-mode' : ''}`}>
      <SearchBar search={search} indexReady={searchIndexReady} />
      <div className="pdf-document" ref={containerRef}>
        <div className="pdf-pages-inner">
          {pdfProxy && (
            <DocumentContext.Provider value={documentContextValue}>
              {layout.topSpacer > 0 && (
                <div className="pdf-spacer" style={{ height: layout.topSpacer }} />
              )}
              {renderWindow(
                documentId,
                layout.windowA,
                scale,
                setPageRefCombined,
                getPlaceholderHeight,
                wrappedOnPageRenderSuccess,
                customTextRenderer,
                renderPageOverlay,
                handlePageMouseDown
              )}
              {layout.middleSpacer > 0 && (
                <div className="pdf-spacer" style={{ height: layout.middleSpacer }} />
              )}
              {layout.windowB &&
                renderWindow(
                  documentId,
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
            </DocumentContext.Provider>
          )}
        </div>
      </div>
    </div>
  )
}

const PDFViewer = forwardRef<PDFViewerHandle, PDFViewerProps>(PDFViewerInner)
export default PDFViewer
