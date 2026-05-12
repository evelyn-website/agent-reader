import { describe, it, expect, afterEach, vi } from 'vitest'
import { captureSelection, pointToPageCoord } from './captureSelection'

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeBoundingRect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({})
  }
}

describe('pointToPageCoord', () => {
  it('converts client coords to unscaled page coords', () => {
    const el = document.createElement('div')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(makeBoundingRect(100, 50, 400, 250))
    expect(pointToPageCoord(150, 80, el, 2)).toEqual({ x: 25, y: 15 })
  })

  it('handles scale = 1 (identity)', () => {
    const el = document.createElement('div')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(makeBoundingRect(0, 0, 600, 800))
    expect(pointToPageCoord(100, 200, el, 1)).toEqual({ x: 100, y: 200 })
  })
})

describe('captureSelection', () => {
  function makePageEl(left: number, top: number, right: number, bottom: number): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
      makeBoundingRect(left, top, right, bottom)
    )
    return el
  }

  function stubSelection(
    startContainer: Node,
    rects: { left: number; top: number; right: number; bottom: number }[],
    text = 'selected'
  ): void {
    const domRects = rects.map(({ left, top, right, bottom }) =>
      makeBoundingRect(left, top, right, bottom)
    )
    vi.stubGlobal('getSelection', () => ({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({
        startContainer,
        getClientRects: () => domRects
      }),
      toString: () => text
    }))
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns null when selection is null', () => {
    vi.stubGlobal('getSelection', () => null)
    const pageEl = makePageEl(0, 0, 400, 600)
    expect(captureSelection(new Map([[1, pageEl]]), 1)).toBeNull()
  })

  it('returns null when selection is collapsed', () => {
    vi.stubGlobal('getSelection', () => ({ isCollapsed: true }))
    const pageEl = makePageEl(0, 0, 400, 600)
    expect(captureSelection(new Map([[1, pageEl]]), 1)).toBeNull()
  })

  it('returns null when the selection is outside all page refs', () => {
    const pageEl = makePageEl(100, 50, 400, 250)
    const outsideNode = document.createElement('div')
    stubSelection(outsideNode, [{ left: 110, top: 60, right: 160, bottom: 70 }])
    expect(captureSelection(new Map([[1, pageEl]]), 1)).toBeNull()
  })

  it('computes unscaled rects relative to page origin', () => {
    const pageEl = makePageEl(100, 50, 400, 250)
    const textNode = document.createTextNode('hello')
    pageEl.appendChild(textNode)
    stubSelection(textNode, [{ left: 110, top: 60, right: 160, bottom: 70 }], 'hello')

    const result = captureSelection(new Map([[1, pageEl]]), 2)
    expect(result).not.toBeNull()
    expect(result!.pageNumber).toBe(1)
    expect(result!.text).toBe('hello')
    expect(result!.rects).toHaveLength(1)
    // left=max(110,100)=110, top=max(60,50)=60, right=min(160,400)=160, bottom=min(70,250)=70
    // x=(110-100)/2=5, y=(60-50)/2=5, w=50/2=25, h=10/2=5
    expect(result!.rects[0]).toEqual({ x: 5, y: 5, w: 25, h: 5 })
  })

  it('clips rects that extend beyond the page edge', () => {
    const pageEl = makePageEl(100, 50, 300, 250)
    const textNode = document.createTextNode('hello')
    pageEl.appendChild(textNode)
    // rect extends 50px past page right edge (300)
    stubSelection(textNode, [{ left: 250, top: 60, right: 350, bottom: 70 }], 'hello')

    const result = captureSelection(new Map([[1, pageEl]]), 1)!
    // right clipped to 300: w = 300 - 250 = 50
    expect(result.rects[0].w).toBe(50)
  })

  it('discards rects with no overlap with the page', () => {
    const pageEl = makePageEl(100, 50, 300, 250)
    const textNode = document.createTextNode('hello')
    pageEl.appendChild(textNode)
    // rect entirely above the page (bottom < pageRect.top)
    stubSelection(textNode, [{ left: 110, top: 10, right: 160, bottom: 40 }], 'hello')

    expect(captureSelection(new Map([[1, pageEl]]), 1)).toBeNull()
  })

  it('skips zero-area rects', () => {
    const pageEl = makePageEl(100, 50, 300, 250)
    const textNode = document.createTextNode('hello')
    pageEl.appendChild(textNode)
    stubSelection(textNode, [{ left: 110, top: 60, right: 110, bottom: 70 }], 'hello')

    expect(captureSelection(new Map([[1, pageEl]]), 1)).toBeNull()
  })
})
