import { useState, useRef, useEffect, useCallback } from 'react'

const WINDOW_SIZE = 5
const ESTIMATED_HEIGHT = 1100

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
  const pageHeights = useRef<Map<number, number>>(new Map())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const visibilityMap = useRef<Map<number, number>>(new Map())
  const pendingScrollTarget = useRef<number | null>(null)
  const pendingScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (numPages === 0) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.page)
          visibilityMap.current.set(n, entry.intersectionRatio)
        }
        let best = 1
        let bestRatio = -1
        for (const [n, ratio] of visibilityMap.current) {
          if (ratio > bestRatio) {
            bestRatio = ratio
            best = n
          }
        }
        setCurrentPage(best)
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1.0] }
    )

    for (const [, el] of pageRefs.current) {
      observerRef.current.observe(el)
    }

    return () => {
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [numPages])

  const setPageRef = useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) {
      el.dataset.page = String(n)
      pageRefs.current.set(n, el)
      observerRef.current?.observe(el)
    } else {
      const old = pageRefs.current.get(n)
      if (old) observerRef.current?.unobserve(old)
      pageRefs.current.delete(n)
      visibilityMap.current.delete(n)
    }
  }, [])

  const inWindow = useCallback(
    (n: number) => n >= currentPage - WINDOW_SIZE && n <= currentPage + WINDOW_SIZE,
    [currentPage]
  )

  const getPlaceholderHeight = useCallback(
    (n: number) => {
      const raw = pageDimensions.get(n)
      if (raw !== undefined) return raw * scale
      return pageHeights.current.get(n) ?? ESTIMATED_HEIGHT
    },
    [pageDimensions, scale]
  )

  const onPageRenderSuccess = useCallback((n: number, height: number) => {
    pageHeights.current.set(n, height)
    const target = pendingScrollTarget.current
    if (target !== null) {
      const el = pageRefs.current.get(target)
      if (el) el.scrollIntoView({ block: 'start' })
    }
  }, [])

  const scrollToPage = useCallback((n: number) => {
    const el = pageRefs.current.get(n)
    if (!el) return
    el.scrollIntoView({ block: 'start' })
    pendingScrollTarget.current = n
    if (pendingScrollTimer.current) clearTimeout(pendingScrollTimer.current)
    pendingScrollTimer.current = setTimeout(() => {
      pendingScrollTarget.current = null
    }, 800)
  }, [])

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
