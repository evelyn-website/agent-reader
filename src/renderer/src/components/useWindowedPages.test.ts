import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useWindowedPages } from './useWindowedPages'

describe('useWindowedPages — deferred scroll', () => {
  const containers: HTMLElement[] = []

  afterEach(() => {
    containers.forEach((c) => c.remove())
    containers.length = 0
  })

  function makeContainer(): { container: HTMLElement; scrollTopWrites: number[] } {
    const scrollTopWrites: number[] = []
    const container = document.createElement('div')
    container.className = 'pdf-document'
    let _scrollTop = 0
    Object.defineProperty(container, 'scrollTop', {
      get: () => _scrollTop,
      set: (v: number) => {
        _scrollTop = v
        scrollTopWrites.push(v)
      },
      configurable: true
    })
    document.body.appendChild(container)
    containers.push(container)
    return { container, scrollTopWrites }
  }

  it('performs the scroll in onPageRenderSuccess when scrollToPage found no container', async () => {
    const { result } = renderHook(({ n }) => useWindowedPages(n, 1), {
      initialProps: { n: 20 }
    })

    // No page refs registered yet — scrollToPage cannot find the scroll container.
    act(() => {
      result.current.scrollToPage(15)
    })
    // pinnedTarget should be set, creating a two-window layout.
    expect(result.current.layout.windowB).not.toBeNull()

    // Simulate windowA pages mounting: attach a .pdf-document container and
    // register one of its children as a page ref.
    const { container, scrollTopWrites } = makeContainer()
    const pageDiv = document.createElement('div')
    container.appendChild(pageDiv)

    act(() => {
      result.current.setPageRef(1, pageDiv)
    })

    // Pinned page renders — deferred scroll should fire now.
    act(() => {
      result.current.onPageRenderSuccess(15, 800)
    })

    expect(result.current.currentPage).toBe(15)
    expect(result.current.layout.windowB).toBeNull()
    // scrollTop must have been written (value > 0 for page 15 of 20).
    expect(scrollTopWrites.length).toBeGreaterThan(0)
    expect(scrollTopWrites[scrollTopWrites.length - 1]).toBeGreaterThan(0)
  })

  it('does not defer the scroll when the container is already available', () => {
    const { result } = renderHook(({ n }) => useWindowedPages(n, 1), {
      initialProps: { n: 20 }
    })

    const { container, scrollTopWrites } = makeContainer()
    const pageDiv = document.createElement('div')
    container.appendChild(pageDiv)

    act(() => {
      result.current.setPageRef(1, pageDiv)
      result.current.scrollToPage(15)
    })

    // Container was available — scroll should have happened immediately.
    expect(scrollTopWrites.length).toBeGreaterThan(0)
    // onPageRenderSuccess should not write scrollTop a second time.
    const writesAfterScroll = scrollTopWrites.length
    act(() => {
      result.current.onPageRenderSuccess(15, 800)
    })
    expect(scrollTopWrites.length).toBe(writesAfterScroll)
  })
})

describe('useWindowedPages — document reset', () => {
  it('clears cached page state when numPages drops to zero', async () => {
    const { result, rerender } = renderHook(({ numPages }) => useWindowedPages(numPages, 1), {
      initialProps: { numPages: 20 }
    })

    act(() => {
      result.current.onPageRenderSuccess(1, 1234)
      result.current.scrollToPage(18)
    })

    expect(result.current.getPlaceholderHeight(1)).toBe(1234)
    expect(result.current.layout.windowB).toEqual({ from: 13, to: 20 })

    rerender({ numPages: 0 })

    await waitFor(() => expect(result.current.getPlaceholderHeight(1)).toBe(1100))
    expect(result.current.currentPage).toBe(1)
    expect(result.current.layout).toEqual({
      topSpacer: 0,
      windowA: { from: 1, to: 0 },
      middleSpacer: 0,
      windowB: null,
      bottomSpacer: 0
    })
  })
})
