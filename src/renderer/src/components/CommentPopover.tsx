import { useState, useEffect, useRef } from 'react'
import { HIGHLIGHT_COLORS, type Annotation, type HighlightColor } from './useAnnotations'

interface CommentPopoverProps {
  annotation: Annotation
  isNew: boolean
  onUpdate: (patch: { color?: HighlightColor; comment?: string | null }) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 30) return 'just now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(mo / 12)}y`
}

function initialMode(annotation: Annotation, isNew: boolean): 'view' | 'edit' {
  if (isNew) return 'edit'
  if (!annotation.comment || annotation.comment.trim() === '') return 'edit'
  return 'view'
}

export default function CommentPopover({
  annotation,
  isNew,
  onUpdate,
  onDelete,
  onClose
}: CommentPopoverProps): React.JSX.Element {
  const [mode, setMode] = useState<'view' | 'edit'>(() => initialMode(annotation, isNew))
  const [text, setText] = useState(annotation.comment ?? '')
  const ref = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setText(annotation.comment ?? '')
    setMode(initialMode(annotation, isNew))
  }, [annotation.id])

  useEffect(() => {
    if (mode === 'edit') {
      taRef.current?.focus()
      const ta = taRef.current
      if (ta) ta.setSelectionRange(ta.value.length, ta.value.length)
    }
  }, [mode])

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const commitComment = (): void => {
    const next = text.trim() === '' ? null : text
    if (next !== annotation.comment) {
      void onUpdate({ comment: next })
    }
  }

  const handleSave = (): void => {
    commitComment()
    if (isNew) {
      onClose()
    } else {
      setMode('view')
    }
  }

  return (
    <div
      ref={ref}
      className="annotation-popover"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="annotation-popover__header">
        <span className="annotation-popover__kind">
          {annotation.kind === 'highlight' ? 'HIGHLIGHT' : 'NOTE'}
        </span>
        <span className="annotation-popover__time">
          {formatRelativeTime(annotation.updatedAt)}
        </span>
      </div>
      {annotation.kind === 'highlight' && (
        <div className="annotation-popover__colors">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              className={`annotation-popover__color annotation-popover__color--${c}${
                annotation.color === c ? ' annotation-popover__color--active' : ''
              }`}
              onClick={() => void onUpdate({ color: c })}
              title={c}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      )}
      {mode === 'edit' ? (
        <textarea
          ref={taRef}
          className="annotation-popover__textarea"
          value={text}
          placeholder="Add a comment…"
          onChange={(e) => setText(e.target.value)}
          onBlur={commitComment}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleSave()
            }
          }}
        />
      ) : (
        <div
          className="annotation-popover__body"
          onClick={() => setMode('edit')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              setMode('edit')
            }
          }}
        >
          {annotation.comment}
        </div>
      )}
      <div className="annotation-popover__actions">
        <button
          className="annotation-popover__delete"
          onClick={() => {
            void onDelete()
            onClose()
          }}
        >
          Delete
        </button>
        {mode === 'edit' ? (
          <button className="annotation-popover__save" onClick={handleSave}>
            Save
            <kbd className="annotation-popover__kbd">⌘↵</kbd>
          </button>
        ) : (
          <button
            className="annotation-popover__edit"
            onClick={() => setMode('edit')}
          >
            Edit
          </button>
        )}
      </div>
    </div>
  )
}
