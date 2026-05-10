import { useMemo, useState } from 'react'
import {
  HIGHLIGHT_COLORS,
  type Annotation,
  type HighlightColor,
  type UseAnnotationsResult
} from './useAnnotations'

type KindFilter = 'all' | 'highlight' | 'note'

interface Props {
  annotations: UseAnnotationsResult
  onJumpToPage: (page: number) => void
  hasDocument: boolean
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d}d`
  const date = new Date(ts)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function emptyMessage(kind: KindFilter, color: HighlightColor | null): string {
  if (color) return `No ${color} highlights`
  if (kind === 'highlight') return 'No highlights yet'
  if (kind === 'note') return 'No notes yet'
  return 'No marks yet'
}

export default function MarksTabContent({
  annotations,
  onJumpToPage,
  hasDocument
}: Props): React.JSX.Element {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [colorFilter, setColorFilter] = useState<HighlightColor | null>(null)

  const showColorRow = kindFilter !== 'note'

  const filtered = useMemo(() => {
    return annotations.all.filter((a) => {
      if (kindFilter === 'highlight' && a.kind !== 'highlight') return false
      if (kindFilter === 'note' && a.kind !== 'note') return false
      if (showColorRow && colorFilter) {
        if (a.kind !== 'highlight' || a.color !== colorFilter) return false
      }
      return true
    })
  }, [annotations.all, kindFilter, colorFilter, showColorRow])

  const grouped = useMemo(() => {
    const m = new Map<number, Annotation[]>()
    for (const a of filtered) {
      const arr = m.get(a.pageNumber)
      if (arr) arr.push(a)
      else m.set(a.pageNumber, [a])
    }
    for (const arr of m.values()) arr.sort((a, b) => a.createdAt - b.createdAt)
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0])
  }, [filtered])

  if (!hasDocument) {
    return <div className="tab-empty-state">Open a PDF to see marks</div>
  }

  return (
    <div className="marks-tab">
      <div className="marks-toolbar" role="toolbar" aria-label="Filter marks">
        <button
          className={`marks-toolbar__chip${kindFilter === 'all' ? ' marks-toolbar__chip--active' : ''}`}
          onClick={() => setKindFilter('all')}
        >
          All
        </button>
        <button
          className={`marks-toolbar__chip${kindFilter === 'highlight' ? ' marks-toolbar__chip--active' : ''}`}
          onClick={() => setKindFilter('highlight')}
        >
          Highlights
        </button>
        <button
          className={`marks-toolbar__chip${kindFilter === 'note' ? ' marks-toolbar__chip--active' : ''}`}
          onClick={() => setKindFilter('note')}
        >
          Notes
        </button>
        {showColorRow && (
          <>
            <span className="marks-toolbar__divider" aria-hidden />
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                className={`annotation-popover__color annotation-popover__color--${c} marks-toolbar__color${
                  colorFilter === c ? ' annotation-popover__color--active' : ''
                }`}
                onClick={() => setColorFilter((cur) => (cur === c ? null : c))}
                title={c}
                aria-label={`Filter ${c} highlights`}
                aria-pressed={colorFilter === c}
              />
            ))}
          </>
        )}
      </div>

      {grouped.length === 0 ? (
        <div className="tab-empty-state">{emptyMessage(kindFilter, colorFilter)}</div>
      ) : (
        <div className="marks-list">
          {grouped.map(([page, items]) => (
            <div key={page} className="marks-page-group">
              <div className="marks-page-header">Page {page}</div>
              {items.map((a) => (
                <MarkRow
                  key={a.id}
                  annotation={a}
                  onJump={() => onJumpToPage(a.pageNumber)}
                  onDelete={() => void annotations.deleteAnnotation(a.id)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface RowProps {
  annotation: Annotation
  onJump: () => void
  onDelete: () => void
}

function MarkRow({ annotation, onJump, onDelete }: RowProps): React.JSX.Element {
  const isHighlight = annotation.kind === 'highlight'
  const hasComment = !!annotation.comment && annotation.comment.trim() !== ''
  const primary = isHighlight
    ? (annotation.textExcerpt ?? '')
    : hasComment
      ? annotation.comment!
      : ''
  const secondary = isHighlight && hasComment ? annotation.comment! : null

  return (
    <div
      className="marks-row"
      role="button"
      tabIndex={0}
      onClick={onJump}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onJump()
        }
      }}
    >
      <div className="marks-row__icon" aria-hidden>
        {isHighlight ? (
          <span
            className={`marks-swatch-dot annotation-popover__color--${annotation.color ?? 'yellow'}${
              hasComment ? ' marks-swatch-dot--has-comment' : ''
            }`}
          />
        ) : (
          <NoteGlyph />
        )}
      </div>
      <div className="marks-row__body">
        <div
          className={`marks-row__primary${
            !isHighlight && !hasComment ? ' marks-row__primary--placeholder' : ''
          }`}
        >
          {primary || '(empty note)'}
        </div>
        {secondary && <div className="marks-row__secondary">{secondary}</div>}
      </div>
      <span className="marks-row__time" title={new Date(annotation.updatedAt).toLocaleString()}>
        {formatRelativeTime(annotation.updatedAt)}
      </span>
      <button
        className="marks-row__delete"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        aria-label="Delete mark"
        title="Delete"
      >
        <TrashGlyph />
      </button>
    </div>
  )
}

function NoteGlyph(): React.JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 3.5A1.5 1.5 0 0 1 4.5 2h7A1.5 1.5 0 0 1 13 3.5V10l-3 3H4.5A1.5 1.5 0 0 1 3 11.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TrashGlyph(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 4h10M6.5 4V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M5 4l.7 8.1a1 1 0 0 0 1 .9h2.6a1 1 0 0 0 1-.9L11 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
