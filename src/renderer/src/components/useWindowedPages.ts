import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createDebug } from '../lib/debug'

const WINDOW_SIZE = 5
const ESTIMATED_HEIGHT = 1100
const PIN_TIMEOUT_MS = 2000
// Probe just below the top of the viewport — small enough that we never
// "skip" a page when zoomed way out (where pages may be smaller than
// fraction-based probes), large enough to ignore subpixel rounding.
const ACTIVE_PAGE_PROBE_OFFSET = 1

const dTrack = createDebug('pages:track')
const dAnchor = createDebug('pages:anchor')
const dPin = createDebug('pages:pin')

type Anchor = { page: number; fraction: number }

export function useWindowedPages(
  numPages: number,
  scale: number
): {
  currentPage: number
  inWindow: (n: number) => boolean
  setPageRef: (n: number, el: HTMLDivElement | null) => void
  getPlaceholderHeight: (n: number) => number
  onPageRenderSuccess: (n: number, height: number) => void
  scrollToPage: (n: number) => void
  setPageDimensions: (dims: Map<number, number>) => void
} {
  const [currentPage, setCurrentPage] = useState(1)
  const [pageDimensions, setPageDimensions] = useState<Map<number, number>>(new Map())
  const [pinnedTarget, setPinnedTarget] = useState<number | null>(null)
  const pageHeights = useRef<Map<number, number>>(new Map())
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const rafPending = useRef(false)
  const liveAnchorRef = useRef<Anchor | null>(null)
  const prevScaleRef = useRef(scale)
  const prevDimsRef = useRef(pageDimensions)
  const currentPageRef = useRef(currentPage)

  useEffect(() => {
    currentPageRef.current = currentPage
  })

  const findContainer = useCallback((): HTMLElement | null => {
    if (scrollContainerRef.current) return scrollContainerRef.current
    for (const [, el] of pageRefs.current) {
      const c = el.closest('.pdf-document') as HTMLElement | null
      if (c) {
        scrollContainerRef.current = c
        return c
      }
    }
    return null
  }, [])

  const computeActivePage = useCallback((): number | null => {
    const container = scrollContainerRef.current ?? findContainer()
    if (!container) return null
    const containerRect = container.getBoundingClientRect()
    const probeY = containerRect.top + ACTIVE_PAGE_PROBE_OFFSET
    let best: number | null = null
    let bestDistance = Infinity
    for (const [n, el] of pageRefs.current) {
      const r = el.getBoundingClientRect()
      if (r.top <= probeY && r.bottom >= probeY) return n
      const d = r.top > probeY ? r.top - probeY : probeY - r.bottom
      if (d < bestDistance) {
        bestDistance = d
        best = n
      }
    }
    return best
  }, [findContainer])

  const restoreAnchor = useCallback((anchor: Anchor) => {
    const container = scrollContainerRef.current
    if (!container) return
    const el = pageRefs.current.get(anchor.page)
    if (!el) return
    const containerRect = container.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const desired = -anchor.fraction * r.height
    const actual = r.top - containerRect.top
    const delta = actual - desired
    if (Math.abs(delta) < 0.5) return
    dAnchor(`page=${anchor.page} f=${anchor.fraction.toFixed(3)} delta=${delta.toFixed(1)}`)
    container.scrollTop += delta
  }, [])

  const setPageRef = useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) {
      el.dataset.page = String(n)
      pageRefs.current.set(n, el)
    } else {
      pageRefs.current.delete(n)
    }
  }, [])

  // Scroll listener: rAF-throttled. On every scroll tick we update the active
  // page AND refresh liveAnchorRef. liveAnchorRef is the input to zoom-time
  // restoration — keeping it always-fresh means restore reads the LAST stable
  // pre-zoom layout, even if the user clicks zoom seconds after the last scroll.
  useEffect(() => {
    if (numPages === 0) return
    const container = findContainer()
    if (!container) return
    const tick = (): void => {
      rafPending.current = false
      const p = computeActivePage()
      if (p !== null && p !== currentPageRef.current) {
        dTrack(`${currentPageRef.current} -> ${p}`)
        setCurrentPage(p)
      }
      // Reuse the already-found active page for anchor capture instead of
      // iterating page rects a second time.
      if (p !== null) {
        const el = pageRefs.current.get(p)
        if (el) {
          const containerTop = container.getBoundingClientRect().top
          const r = el.getBoundingClientRect()
          const fraction = Math.max(0, Math.min(1, (containerTop - r.top) / Math.max(1, r.height)))
          liveAnchorRef.current = { page: p, fraction }
        }
      }
    }
    const onScroll = (): void => {
      if (rafPending.current) return
      rafPending.current = true
      requestAnimationFrame(tick)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    // Initial sync once pages exist.
    tick()
    return () => container.removeEventListener('scroll', onScroll)
  }, [numPages, findContainer, computeActivePage])

  const inWindow = useCallback(
    (n: number) => {
      if (n >= currentPage - WINDOW_SIZE && n <= currentPage + WINDOW_SIZE) return true
      if (
        pinnedTarget !== null &&
        n >= pinnedTarget - WINDOW_SIZE &&
        n <= pinnedTarget + WINDOW_SIZE
      )
        return true
      return false
    },
    [currentPage, pinnedTarget]
  )

  const getPlaceholderHeight = useCallback(
    (n: number) => {
      const raw = pageDimensions.get(n)
      if (raw !== undefined) return raw * scale
      return pageHeights.current.get(n) ?? ESTIMATED_HEIGHT
    },
    [pageDimensions, scale]
  )

  // Restore-on-zoom: useLayoutEffect runs after DOM mutation, with new scale's
  // layout in place (in-window pages reflect new height via SwappablePage's
  // CSS `zoom`; out-of-window pages reflect new height via getPlaceholderHeight).
  // liveAnchorRef holds the pre-zoom anchor (last refreshed by the scroll tick),
  // so restoring here lands the same (page, fraction) at the same screen position.
  useLayoutEffect(() => {
    const scaleChanged = prevScaleRef.current !== scale
    const dimsChanged = prevDimsRef.current !== pageDimensions
    if (!scaleChanged && !dimsChanged) return
    prevScaleRef.current = scale
    prevDimsRef.current = pageDimensions
    const a = liveAnchorRef.current
    if (a) restoreAnchor(a)
  }, [scale, pageDimensions, restoreAnchor])

  const onPageRenderSuccess = useCallback(
    (n: number, height: number) => {
      pageHeights.current.set(n, height)
      if (pinnedTarget !== null && n === pinnedTarget) {
        const el = pageRefs.current.get(n)
        if (el) {
          dPin(`scroll-to ${n}`)
          el.scrollIntoView({ block: 'start' })
        }
        // Sync currentPage so the window stays centered on the target across
        // the pinnedTarget→null transition (avoids a one-frame de-render).
        setCurrentPage(n)
        setPinnedTarget(null)
      }
    },
    [pinnedTarget]
  )

  const scrollToPage = useCallback((n: number) => {
    const el = pageRefs.current.get(n)
    if (!el) {
      dPin(`pin ${n} (no ref)`)
      setPinnedTarget(n)
      return
    }
    el.scrollIntoView({ block: 'start' })
    const inCurrentWindow =
      n >= currentPageRef.current - WINDOW_SIZE && n <= currentPageRef.current + WINDOW_SIZE
    if (!inCurrentWindow) {
      dPin(`pin ${n} (out of window)`)
      setPinnedTarget(n)
    }
  }, [])

  // Pinned-target timeout fallback: if onPageRenderSuccess never fires for the
  // target (already-rendered, no new render callback), force a scroll after PIN_TIMEOUT_MS.
  useEffect(() => {
    if (pinnedTarget === null) return
    const t = setTimeout(() => {
      const el = pageRefs.current.get(pinnedTarget)
      if (el) el.scrollIntoView({ block: 'start' })
      setPinnedTarget(null)
    }, PIN_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [pinnedTarget])

  return {
    currentPage,
    inWindow,
    setPageRef,
    getPlaceholderHeight,
    onPageRenderSuccess,
    scrollToPage,
    setPageDimensions
  }
}
