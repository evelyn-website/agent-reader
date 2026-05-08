import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { createDebug } from '../lib/debug'

const WINDOW_SIZE = 5
const ESTIMATED_HEIGHT = 1100
const PIN_TIMEOUT_MS = 2000
const GAP_PX = 16
const INNER_PAD_TOP_PX = 16
// Probe just below the top of the viewport — small enough that we never
// "skip" a page when zoomed way out (where pages may be smaller than
// fraction-based probes), large enough to ignore subpixel rounding.
const ACTIVE_PAGE_PROBE_OFFSET = 1

const dTrack = createDebug('pages:track')
const dAnchor = createDebug('pages:anchor')
const dPin = createDebug('pages:pin')

type Anchor = { page: number; fraction: number }

export type Layout = {
  topSpacer: number
  windowA: { from: number; to: number }
  middleSpacer: number
  windowB: { from: number; to: number } | null
  bottomSpacer: number
}

export function useWindowedPages(
  numPages: number,
  scale: number
): {
  currentPage: number
  layout: Layout
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

  // Prefix sums of natural page heights. cumulativeNaturalH[k] = sum of
  // getNaturalH(1..k). cumulativeNaturalH[0] = 0. Length = numPages + 1.
  const cumulativeNaturalH = useMemo(() => {
    const arr = new Float64Array(numPages + 1)
    let acc = 0
    for (let i = 1; i <= numPages; i++) {
      acc += pageDimensions.get(i) ?? ESTIMATED_HEIGHT
      arr[i] = acc
    }
    return arr
  }, [numPages, pageDimensions])

  // Height occupied by pages [a..b] (1-indexed, inclusive) at the given scale,
  // including each represented page's trailing GAP_PX (margin-bottom equivalent).
  // Returns 0 when a > b (empty range).
  const heightSum = useCallback(
    (a: number, b: number, s: number): number => {
      if (a > b) return 0
      const lo = Math.max(1, a)
      const hi = Math.min(numPages, b)
      if (lo > hi) return 0
      const naturals = cumulativeNaturalH[hi] - cumulativeNaturalH[lo - 1]
      return naturals * s + (hi - lo + 1) * GAP_PX
    },
    [cumulativeNaturalH, numPages]
  )

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

  // Binary-search the page whose cumulative-height range contains the given
  // pixel offset (measured from the start of pages, in current-scale pixels).
  const pageAtOffset = useCallback(
    (offsetPx: number): number => {
      if (numPages === 0) return 1
      // Convert to natural-height units. We want the smallest n such that
      // (cumulativeNaturalH[n] * scale + n * GAP_PX) > offsetPx.
      let lo = 1
      let hi = numPages
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const endOfMid = cumulativeNaturalH[mid] * scale + mid * GAP_PX
        if (endOfMid <= offsetPx) lo = mid + 1
        else hi = mid
      }
      return lo
    },
    [cumulativeNaturalH, numPages, scale]
  )

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
    // Fallback: scroll has landed outside the rendered window (e.g. fast fling
    // or far jump). Compute from scrollTop + prefix sums.
    if (best === null || bestDistance > 200) {
      const offset = container.scrollTop - INNER_PAD_TOP_PX
      return pageAtOffset(Math.max(0, offset))
    }
    return best
  }, [findContainer, pageAtOffset])

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

  // Compute layout: up to two visible windows separated by spacers. When
  // pinnedTarget is null or near currentPage, windows merge.
  const layout = useMemo<Layout>(() => {
    if (numPages === 0) {
      return {
        topSpacer: 0,
        windowA: { from: 1, to: 0 },
        middleSpacer: 0,
        windowB: null,
        bottomSpacer: 0
      }
    }
    const a = currentPage
    const b = pinnedTarget
    const clamp = (x: number): number => Math.max(1, Math.min(numPages, x))
    const aFrom = clamp(a - WINDOW_SIZE)
    const aTo = clamp(a + WINDOW_SIZE)
    if (b === null) {
      return {
        topSpacer: heightSum(1, aFrom - 1, scale),
        windowA: { from: aFrom, to: aTo },
        middleSpacer: 0,
        windowB: null,
        bottomSpacer: heightSum(aTo + 1, numPages, scale)
      }
    }
    const bFrom = clamp(b - WINDOW_SIZE)
    const bTo = clamp(b + WINDOW_SIZE)
    // Merge if windows overlap or touch.
    if (!(bTo < aFrom - 1 || bFrom > aTo + 1)) {
      const lo = Math.min(aFrom, bFrom)
      const hi = Math.max(aTo, bTo)
      return {
        topSpacer: heightSum(1, lo - 1, scale),
        windowA: { from: lo, to: hi },
        middleSpacer: 0,
        windowB: null,
        bottomSpacer: heightSum(hi + 1, numPages, scale)
      }
    }
    // Two distinct windows; order them.
    const [lo1, lo2, hi1, hi2] = a < b ? [aFrom, bFrom, aTo, bTo] : [bFrom, aFrom, bTo, aTo]
    return {
      topSpacer: heightSum(1, lo1 - 1, scale),
      windowA: { from: lo1, to: hi1 },
      middleSpacer: heightSum(hi1 + 1, lo2 - 1, scale),
      windowB: { from: lo2, to: hi2 },
      bottomSpacer: heightSum(hi2 + 1, numPages, scale)
    }
  }, [numPages, currentPage, pinnedTarget, scale, heightSum])

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
  // CSS `zoom`; out-of-window pages are now spacer divs whose heights also
  // reflect the new scale via the `layout` memo). liveAnchorRef holds the
  // pre-zoom anchor (last refreshed by the scroll tick), so restoring here
  // lands the same (page, fraction) at the same screen position.
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
        // We already scrolled to the right scrollTop in scrollToPage; just
        // collapse the two-window layout back to one.
        dPin(`landed ${n}`)
        setCurrentPage(n)
        setPinnedTarget(null)
      }
    },
    [pinnedTarget]
  )

  const scrollToPage = useCallback(
    (n: number) => {
      const target = Math.max(1, Math.min(numPages, n))
      if (!scrollContainerRef.current) findContainer()
      const container = scrollContainerRef.current
      if (!container) {
        dPin(`pin ${target} (no container)`)
        setPinnedTarget(target)
        return
      }
      // Compute desired scrollTop directly from prefix sums — works even for
      // pages that aren't currently rendered.
      const desired = INNER_PAD_TOP_PX + heightSum(1, target - 1, scale)
      container.scrollTop = desired
      const inCurrentWindow =
        target >= currentPageRef.current - WINDOW_SIZE &&
        target <= currentPageRef.current + WINDOW_SIZE
      if (!inCurrentWindow) {
        dPin(`pin ${target} (out of window)`)
        setPinnedTarget(target)
      }
    },
    [findContainer, heightSum, numPages, scale]
  )

  // Pinned-target timeout fallback: if onPageRenderSuccess never fires for the
  // target (already-rendered, no new render callback), force collapse after PIN_TIMEOUT_MS.
  useEffect(() => {
    if (pinnedTarget === null) return
    const t = setTimeout(() => {
      setCurrentPage(pinnedTarget)
      setPinnedTarget(null)
    }, PIN_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [pinnedTarget])

  return {
    currentPage,
    layout,
    setPageRef,
    getPlaceholderHeight,
    onPageRenderSuccess,
    scrollToPage,
    setPageDimensions
  }
}
