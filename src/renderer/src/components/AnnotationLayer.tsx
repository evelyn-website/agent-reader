import { useEffect, useMemo, useRef, useState } from 'react'
import type { Annotation, HighlightColor } from './useAnnotations'
import type { UnscaledRect } from './captureSelection'
import CommentPopover from './CommentPopover'

const DEBUG = import.meta.env.VITE_DEBUG_HIGHLIGHT_MATCH === '1'

interface AnnotationLayerProps {
  annotations: Annotation[]
  scale: number
  openId: string | null
  openIsNew: boolean
  onOpenChange: (id: string | null) => void
  onUpdate: (
    id: string,
    patch: { color?: HighlightColor; comment?: string | null }
  ) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export default function AnnotationLayer({
  annotations,
  scale,
  openId,
  openIsNew,
  onOpenChange,
  onUpdate,
  onDelete
}: AnnotationLayerProps): React.JSX.Element | null {
  const rootRef = useRef<HTMLDivElement>(null)
  const derivedRects = useRectlessHighlightRects(rootRef, annotations, scale)

  if (annotations.length === 0) return null

  const open = openId ? (annotations.find((a) => a.id === openId) ?? null) : null

  const handleOpenChange = (id: string | null): void => {
    if (id === null && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    onOpenChange(id)
  }

  return (
    <div ref={rootRef} className="annotation-layer">
      {annotations.map((a) => {
        if (a.kind === 'highlight') {
          const rects = a.rects ?? derivedRects.get(a.id) ?? null
          if (rects && rects.length > 0) {
            return (
              <div key={a.id}>
                {rects.map((r, i) => (
                  <button
                    key={i}
                    className={`annotation-highlight annotation-highlight--${a.color ?? 'yellow'}`}
                    style={{
                      left: r.x * scale,
                      top: r.y * scale,
                      width: r.w * scale,
                      height: r.h * scale
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenChange(a.id)
                    }}
                    aria-label={a.comment ? `Highlight: ${a.comment}` : 'Highlight'}
                  >
                    {i === 0 && a.comment ? (
                      <span className="annotation-highlight__dot" aria-hidden="true" />
                    ) : null}
                  </button>
                ))}
              </div>
            )
          }
          // Rectless highlight with no DOM match yet — fall back to a corner marker.
          return (
            <button
              key={a.id}
              className="annotation-highlight-fallback"
              title={(a.textExcerpt ?? '').slice(0, 200)}
              onClick={(e) => {
                e.stopPropagation()
                handleOpenChange(a.id)
              }}
              aria-label={a.textExcerpt ? `Highlight: ${a.textExcerpt}` : 'Highlight'}
            />
          )
        }
        if (a.kind === 'note' && a.anchor) {
          return (
            <button
              key={a.id}
              className={`annotation-pin${a.comment ? ' annotation-pin--has-comment' : ''}`}
              style={{
                left: a.anchor.x * scale,
                top: a.anchor.y * scale
              }}
              onClick={(e) => {
                e.stopPropagation()
                onOpenChange(a.id)
              }}
              aria-label={a.comment ?? 'Note'}
            />
          )
        }
        return null
      })}
      {open && (
        <div
          className="annotation-popover-anchor"
          style={popoverPosition(open, scale, derivedRects)}
        >
          <CommentPopover
            key={open.id}
            annotation={open}
            isNew={openIsNew}
            onUpdate={(patch) => onUpdate(open.id, patch)}
            onDelete={() => onDelete(open.id)}
            onClose={() => handleOpenChange(null)}
          />
        </div>
      )}
    </div>
  )
}

function popoverPosition(
  a: Annotation,
  scale: number,
  derivedRects: Map<string, UnscaledRect[]>
): React.CSSProperties {
  if (a.kind === 'highlight') {
    const rects = a.rects ?? derivedRects.get(a.id) ?? null
    if (rects && rects.length > 0) {
      const last = rects[rects.length - 1]
      return { left: last.x * scale, top: (last.y + last.h) * scale + 4 }
    }
  }
  if (a.kind === 'note' && a.anchor) {
    return { left: a.anchor.x * scale + 18, top: a.anchor.y * scale }
  }
  return { left: 0, top: 0 }
}

/**
 * MCP-saved highlights have a `text_excerpt` but no geometric rects.
 * Match that excerpt against the live PDF.js text layer DOM to derive rects
 * at render time. Results live only in renderer state — nothing is written
 * back to the DB.
 */
function useRectlessHighlightRects(
  rootRef: React.RefObject<HTMLDivElement | null>,
  annotations: Annotation[],
  scale: number
): Map<string, UnscaledRect[]> {
  const rectless = useMemo(
    () =>
      annotations.filter(
        (a) => a.kind === 'highlight' && !a.rects && (a.textExcerpt ?? '').trim().length > 0
      ),
    [annotations]
  )
  const [derived, setDerived] = useState<Map<string, UnscaledRect[]>>(new Map())

  useEffect(() => {
    const root = rootRef.current
    let cancelled = false
    let observer: MutationObserver | null = null
    let timeoutId: number | null = null
    const startTime = performance.now()

    const compute = (): boolean => {
      if (cancelled) return true
      if (rectless.length === 0) {
        setDerived((prev) => (prev.size === 0 ? prev : new Map()))
        return true
      }
      if (!root) return false
      const textLayer = findVisibleTextLayer(root)
      if (!textLayer) return false
      const layerRect = textLayer.getBoundingClientRect()
      if (layerRect.width === 0 || layerRect.height === 0) return false
      const layerText = textLayer.textContent ?? ''
      if (layerText.trim().length === 0) return false
      const next = new Map<string, UnscaledRect[]>()
      for (const a of rectless) {
        const rects = findTextRects(textLayer, a.textExcerpt!, layerRect, scale)
        if (rects.length > 0) next.set(a.id, rects)
      }
      setDerived((prev) => {
        if (prev.size === 0 && next.size === 0) return prev
        return next
      })
      const elapsed = performance.now() - startTime
      const done = next.size === rectless.length || elapsed > 3000
      if (DEBUG && done) {
        console.log(
          `[hl-match] ${next.size}/${rectless.length} matched in ${elapsed.toFixed(0)}ms` +
            (next.size < rectless.length ? ' (timeout)' : '')
        )
      }
      return done
    }

    queueMicrotask(() => {
      if (compute()) return
      const pageWrapper = root?.closest('.pdf-page-wrapper') ?? null
      if (!pageWrapper) return
      observer = new MutationObserver(() => {
        if (compute()) {
          observer?.disconnect()
          if (timeoutId !== null) clearTimeout(timeoutId)
        }
      })
      observer.observe(pageWrapper, { childList: true, subtree: true })
      timeoutId = window.setTimeout(() => {
        compute()
        observer?.disconnect()
      }, 3000)
    })

    return () => {
      cancelled = true
      observer?.disconnect()
      if (timeoutId !== null) clearTimeout(timeoutId)
    }
  }, [rectless, scale, rootRef])

  return derived
}

function findVisibleTextLayer(annotationRoot: HTMLElement): HTMLElement | null {
  const overlayHost = annotationRoot.closest('.annotation-overlay-host')
  if (!overlayHost) return null
  const swappable = overlayHost.parentElement
  if (!swappable) return null
  for (const child of Array.from(swappable.children)) {
    if (child === overlayHost) continue
    const el = child as HTMLElement
    // The hidden slot is offset to top: -99999 (see HIDDEN_STYLE in PDFViewer).
    if (el.style.top === '-99999px') continue
    const tl = el.querySelector('.textLayer')
    if (tl) return tl as HTMLElement
  }
  return null
}

function findTextRects(
  textLayer: HTMLElement,
  query: string,
  layerRect: DOMRect,
  scale: number
): UnscaledRect[] {
  const needle = query.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!needle) return []

  // Build a whitespace-normalized lowercase haystack while recording, for each
  // output character, which DOM (node, offset) it came from. Synthetic spaces
  // injected at text-node boundaries map to null and can't anchor a Range edge.
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
  const srcNode: (Text | null)[] = []
  const srcOffset: number[] = []
  let combined = ''
  let lastWasSpace = true
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    const data = t.data
    if (data.length === 0) continue
    if (!lastWasSpace && !/^\s/.test(data)) {
      combined += ' '
      srcNode.push(null)
      srcOffset.push(0)
      lastWasSpace = true
    }
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]
      if (/\s/.test(ch)) {
        if (!lastWasSpace) {
          combined += ' '
          srcNode.push(t)
          srcOffset.push(i)
          lastWasSpace = true
        }
      } else {
        combined += ch.toLowerCase()
        srcNode.push(t)
        srcOffset.push(i)
        lastWasSpace = false
      }
    }
  }
  if (combined.length === 0) return []
  const idx = combined.indexOf(needle)
  if (idx < 0) return []
  const endIdx = idx + needle.length - 1

  let s = idx
  while (s <= endIdx && srcNode[s] === null) s++
  let e = endIdx
  while (e >= s && srcNode[e] === null) e--
  if (s > e) return []

  const range = document.createRange()
  try {
    range.setStart(srcNode[s]!, srcOffset[s])
    range.setEnd(srcNode[e]!, Math.min(srcOffset[e] + 1, srcNode[e]!.data.length))
  } catch {
    return []
  }
  const clientRects = range.getClientRects()
  const out: UnscaledRect[] = []
  for (const r of Array.from(clientRects)) {
    if (r.width <= 0 || r.height <= 0) continue
    out.push({
      x: (r.left - layerRect.left) / scale,
      y: (r.top - layerRect.top) / scale,
      w: r.width / scale,
      h: r.height / scale
    })
  }
  return out
}
