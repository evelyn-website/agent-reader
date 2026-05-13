import { useMemo, useState } from 'react'
import {
  HIGHLIGHT_COLORS,
  type Annotation,
  type HighlightColor,
  type UseAnnotationsResult
} from './useAnnotations'
import { AllIcon, ClockIcon, HighlightIcon, NoteIcon, PageIcon, TrashIcon } from './icons'
import type { ProjectMarkSummary } from '../../../shared/dbTypes'
import { emptyMessage, formatRelativeTime } from './marksTabUtils'

type KindFilter = 'all' | 'highlight' | 'note'
type SortMode = 'page' | 'recent'

interface Props {
  annotations?: UseAnnotationsResult
  projectMarks?: ProjectMarkSummary[]
  onJumpToPage: (page: number) => void
  onOpenProjectMark?: (mark: ProjectMarkSummary) => void
  hasDocument: boolean
}

interface MarkListItem {
  id: string
  pageNumber: number
  kind: Annotation['kind']
  color: HighlightColor | null
  textExcerpt: string | null
  comment: string | null
  createdAt: number
  updatedAt: number
  documentName?: string
  source?: ProjectMarkSummary
}

export default function MarksTabContent({
  annotations,
  projectMarks,
  onJumpToPage,
  onOpenProjectMark,
  hasDocument
}: Props): React.JSX.Element {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [colorFilter, setColorFilter] = useState<HighlightColor | null>(null)
  const [sort, setSort] = useState<SortMode>('page')

  const showColorRow = kindFilter !== 'note'

  const allMarks = useMemo<MarkListItem[]>(() => {
    if (hasDocument) {
      return (annotations?.all ?? []).map((a) => ({
        id: a.id,
        pageNumber: a.pageNumber,
        kind: a.kind,
        color: a.color,
        textExcerpt: a.textExcerpt,
        comment: a.comment,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt
      }))
    }
    return (projectMarks ?? []).map((m) => ({
      id: m.id,
      pageNumber: m.page_number,
      kind: m.kind,
      color: (m.color as HighlightColor | null) ?? null,
      textExcerpt: m.text_excerpt,
      comment: m.comment,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      documentName: m.document_name,
      source: m
    }))
  }, [annotations?.all, hasDocument, projectMarks])

  const filtered = useMemo(() => {
    return allMarks.filter((a) => {
      if (kindFilter === 'highlight' && a.kind !== 'highlight') return false
      if (kindFilter === 'note' && a.kind !== 'note') return false
      if (showColorRow && colorFilter) {
        if (a.kind !== 'highlight' || a.color !== colorFilter) return false
      }
      return true
    })
  }, [allMarks, kindFilter, colorFilter, showColorRow])

  const grouped = useMemo(() => {
    if (sort !== 'page') return []
    const m = new Map<string, { label: string; sortKey: string | number; items: MarkListItem[] }>()
    for (const a of filtered) {
      const key = hasDocument ? `page-${a.pageNumber}` : `doc-${a.documentName ?? ''}`
      const label = hasDocument ? `Page ${a.pageNumber}` : (a.documentName ?? 'Unknown document')
      const existing = m.get(key)
      if (existing) existing.items.push(a)
      else m.set(key, { label, sortKey: hasDocument ? a.pageNumber : label, items: [a] })
    }
    for (const group of m.values()) {
      group.items.sort((a, b) => a.pageNumber - b.pageNumber || a.createdAt - b.createdAt)
    }
    return Array.from(m.values()).sort((a, b) => {
      if (typeof a.sortKey === 'number' && typeof b.sortKey === 'number')
        return a.sortKey - b.sortKey
      return String(a.sortKey).localeCompare(String(b.sortKey), undefined, { sensitivity: 'base' })
    })
  }, [filtered, hasDocument, sort])

  const recent = useMemo(() => {
    if (sort !== 'recent') return []
    return [...filtered].sort((a, b) => b.createdAt - a.createdAt)
  }, [filtered, sort])

  const isEmpty = sort === 'page' ? grouped.length === 0 : recent.length === 0

  if (!hasDocument && projectMarks === undefined) {
    return <div className="tab-empty-state">Open a PDF to see marks</div>
  }

  return (
    <div className="marks-tab">
      <div className="marks-toolbar" role="toolbar" aria-label="Filter marks">
        <button
          className={`marks-toolbar__chip marks-toolbar__chip--icon${kindFilter === 'all' ? ' marks-toolbar__chip--active' : ''}`}
          onClick={() => setKindFilter('all')}
          title="All marks"
          aria-label="All marks"
          aria-pressed={kindFilter === 'all'}
        >
          <AllIcon />
        </button>
        <button
          className={`marks-toolbar__chip marks-toolbar__chip--icon${kindFilter === 'highlight' ? ' marks-toolbar__chip--active' : ''}`}
          onClick={() => setKindFilter('highlight')}
          title="Highlights"
          aria-label="Highlights"
          aria-pressed={kindFilter === 'highlight'}
        >
          <HighlightIcon />
        </button>
        <button
          className={`marks-toolbar__chip marks-toolbar__chip--icon${kindFilter === 'note' ? ' marks-toolbar__chip--active' : ''}`}
          onClick={() => setKindFilter('note')}
          title="Notes"
          aria-label="Notes"
          aria-pressed={kindFilter === 'note'}
        >
          <NoteIcon />
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
        <span className="marks-toolbar__divider" aria-hidden />
        <button
          className={`marks-toolbar__chip marks-toolbar__chip--icon${sort === 'page' ? ' marks-toolbar__chip--active' : ''}`}
          onClick={() => setSort('page')}
          title="Group by page"
          aria-label="Sort by page"
          aria-pressed={sort === 'page'}
        >
          <PageIcon />
        </button>
        <button
          className={`marks-toolbar__chip marks-toolbar__chip--icon${sort === 'recent' ? ' marks-toolbar__chip--active' : ''}`}
          onClick={() => setSort('recent')}
          title="Sort by most recent"
          aria-label="Sort by most recent"
          aria-pressed={sort === 'recent'}
        >
          <ClockIcon />
        </button>
      </div>

      {isEmpty ? (
        <div className="tab-empty-state">
          {hasDocument ? emptyMessage(kindFilter, colorFilter) : 'No project marks yet'}
        </div>
      ) : sort === 'page' ? (
        <div className="marks-list">
          {grouped.map((group) => (
            <div key={group.label} className="marks-page-group">
              <div className="marks-page-header">{group.label}</div>
              {group.items.map((a) => (
                <MarkRow
                  key={a.id}
                  annotation={a}
                  pageLabel={hasDocument ? undefined : `p.${a.pageNumber}`}
                  onJump={() =>
                    a.source && onOpenProjectMark
                      ? onOpenProjectMark(a.source)
                      : onJumpToPage(a.pageNumber)
                  }
                  onDelete={
                    annotations && hasDocument
                      ? () => void annotations.deleteAnnotation(a.id)
                      : undefined
                  }
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="marks-list">
          {recent.map((a) => (
            <MarkRow
              key={a.id}
              annotation={a}
              pageLabel={
                a.documentName ? `${a.documentName} · p.${a.pageNumber}` : `p.${a.pageNumber}`
              }
              onJump={() =>
                a.source && onOpenProjectMark
                  ? onOpenProjectMark(a.source)
                  : onJumpToPage(a.pageNumber)
              }
              onDelete={
                annotations && hasDocument
                  ? () => void annotations.deleteAnnotation(a.id)
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface RowProps {
  annotation: MarkListItem
  onJump: () => void
  onDelete?: () => void
  pageLabel?: string
}

function MarkRow({ annotation, onJump, onDelete, pageLabel }: RowProps): React.JSX.Element {
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
          <NoteIcon />
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
      {pageLabel && <span className="marks-row__page">{pageLabel}</span>}
      <span className="marks-row__time" title={new Date(annotation.updatedAt).toLocaleString()}>
        {formatRelativeTime(annotation.updatedAt)}
      </span>
      {onDelete && (
        <button
          className="marks-row__delete"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          aria-label="Delete mark"
          title="Delete"
        >
          <TrashIcon />
        </button>
      )}
    </div>
  )
}
