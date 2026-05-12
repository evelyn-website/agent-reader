import type { Annotation, HighlightColor } from './useAnnotations'
import CommentPopover from './CommentPopover'

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
  if (annotations.length === 0) return null

  const open = openId ? (annotations.find((a) => a.id === openId) ?? null) : null

  const handleOpenChange = (id: string | null): void => {
    if (id === null && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    onOpenChange(id)
  }

  return (
    <div className="annotation-layer">
      {annotations.map((a) => {
        if (a.kind === 'highlight' && a.rects) {
          return (
            <div key={a.id}>
              {a.rects.map((r, i) => (
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
        <div className="annotation-popover-anchor" style={popoverPosition(open, scale)}>
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

function popoverPosition(a: Annotation, scale: number): React.CSSProperties {
  if (a.kind === 'highlight' && a.rects && a.rects.length > 0) {
    const last = a.rects[a.rects.length - 1]
    return { left: last.x * scale, top: (last.y + last.h) * scale + 4 }
  }
  if (a.kind === 'note' && a.anchor) {
    return { left: a.anchor.x * scale + 18, top: a.anchor.y * scale }
  }
  return { left: 0, top: 0 }
}
