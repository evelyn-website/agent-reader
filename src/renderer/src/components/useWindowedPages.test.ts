import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useWindowedPages } from './useWindowedPages'

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
