export interface UnscaledRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CapturedHighlight {
  pageNumber: number
  rects: UnscaledRect[]
  text: string
}

function findPageForNode(
  node: Node | null,
  pageRefs: Map<number, HTMLElement>
): { pageNumber: number; el: HTMLElement } | null {
  let cur: Node | null = node
  while (cur) {
    if (cur instanceof HTMLElement) {
      for (const [n, el] of pageRefs) {
        if (el === cur || el.contains(cur)) return { pageNumber: n, el }
      }
    }
    cur = cur.parentNode
  }
  return null
}

export function captureSelection(
  pageRefs: Map<number, HTMLElement>,
  scale: number
): CapturedHighlight | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const found = findPageForNode(range.startContainer, pageRefs)
  if (!found) return null
  const { pageNumber, el } = found
  const pageRect = el.getBoundingClientRect()
  const clientRects = Array.from(range.getClientRects())
  const rects: UnscaledRect[] = []
  for (const r of clientRects) {
    if (r.width === 0 || r.height === 0) continue
    // Clip to page bounds (for selections that span pages, keep only this page's portion).
    const left = Math.max(r.left, pageRect.left)
    const top = Math.max(r.top, pageRect.top)
    const right = Math.min(r.right, pageRect.right)
    const bottom = Math.min(r.bottom, pageRect.bottom)
    const w = right - left
    const h = bottom - top
    if (w <= 0 || h <= 0) continue
    rects.push({
      x: (left - pageRect.left) / scale,
      y: (top - pageRect.top) / scale,
      w: w / scale,
      h: h / scale
    })
  }
  if (rects.length === 0) return null
  return { pageNumber, rects, text: sel.toString() }
}

export function pointToPageCoord(
  clientX: number,
  clientY: number,
  pageEl: HTMLElement,
  scale: number
): { x: number; y: number } {
  const rect = pageEl.getBoundingClientRect()
  return {
    x: (clientX - rect.left) / scale,
    y: (clientY - rect.top) / scale
  }
}
