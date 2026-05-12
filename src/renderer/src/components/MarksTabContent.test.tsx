import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MarksTabContent, { formatRelativeTime, emptyMessage } from './MarksTabContent'
import type { Annotation, UseAnnotationsResult } from './useAnnotations'
import type { ProjectMarkSummary } from '../../../main/db'

const NOW = 1_700_000_000_000

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    documentId: 'doc-1',
    pageNumber: 1,
    kind: 'highlight',
    color: 'yellow',
    rects: null,
    anchor: null,
    textExcerpt: 'selected text',
    comment: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function makeAnnotationsResult(all: Annotation[]): UseAnnotationsResult {
  return {
    all,
    byPage: new Map(),
    createHighlight: vi.fn(),
    createNote: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn()
  }
}

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => vi.useRealTimers())

  it('returns "now" for less than 1 minute ago', () => {
    expect(formatRelativeTime(NOW - 30_000)).toBe('now')
  })

  it('returns Xm for minutes ago', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000)).toBe('5m')
  })

  it('returns Xh for hours ago', () => {
    expect(formatRelativeTime(NOW - 2 * 3_600_000)).toBe('2h')
  })

  it('returns "Yesterday" for 1 day ago', () => {
    expect(formatRelativeTime(NOW - 24 * 3_600_000)).toBe('Yesterday')
  })

  it('returns Xd for 2–6 days ago', () => {
    expect(formatRelativeTime(NOW - 3 * 24 * 3_600_000)).toBe('3d')
  })

  it('returns a localized date for 7+ days ago', () => {
    const ts = NOW - 7 * 24 * 3_600_000
    const expected = new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    expect(formatRelativeTime(ts)).toBe(expected)
  })
})

describe('emptyMessage', () => {
  it('returns "No marks yet" when kind is all and no color', () => {
    expect(emptyMessage('all', null)).toBe('No marks yet')
  })

  it('returns "No highlights yet" when kind is highlight', () => {
    expect(emptyMessage('highlight', null)).toBe('No highlights yet')
  })

  it('returns "No notes yet" when kind is note', () => {
    expect(emptyMessage('note', null)).toBe('No notes yet')
  })

  it('returns "No {color} highlights" when color is set', () => {
    expect(emptyMessage('all', 'yellow')).toBe('No yellow highlights')
    expect(emptyMessage('highlight', 'blue')).toBe('No blue highlights')
  })
})

describe('MarksTabContent', () => {
  it('shows "Open a PDF" when hasDocument is false', () => {
    render(
      <MarksTabContent
        annotations={makeAnnotationsResult([])}
        onJumpToPage={vi.fn()}
        hasDocument={false}
      />
    )
    expect(screen.getByText('Open a PDF to see marks')).toBeTruthy()
  })

  it('shows empty state message when there are no annotations', () => {
    render(
      <MarksTabContent
        annotations={makeAnnotationsResult([])}
        onJumpToPage={vi.fn()}
        hasDocument={true}
      />
    )
    expect(screen.getByText('No marks yet')).toBeTruthy()
  })

  it('filters to highlights only when highlight button is pressed', () => {
    const all = [
      makeAnnotation({ id: 'h1', kind: 'highlight', textExcerpt: 'highlight text' }),
      makeAnnotation({ id: 'n1', kind: 'note', comment: 'note comment' })
    ]
    render(
      <MarksTabContent
        annotations={makeAnnotationsResult(all)}
        onJumpToPage={vi.fn()}
        hasDocument={true}
      />
    )
    fireEvent.click(screen.getByLabelText('Highlights'))
    expect(screen.getByText('highlight text')).toBeTruthy()
    expect(screen.queryByText('note comment')).toBeNull()
  })

  it('filters to notes only when note button is pressed', () => {
    const all = [
      makeAnnotation({ id: 'h1', kind: 'highlight', textExcerpt: 'highlight text' }),
      makeAnnotation({ id: 'n1', kind: 'note', comment: 'note text' })
    ]
    render(
      <MarksTabContent
        annotations={makeAnnotationsResult(all)}
        onJumpToPage={vi.fn()}
        hasDocument={true}
      />
    )
    fireEvent.click(screen.getByLabelText('Notes'))
    expect(screen.queryByText('highlight text')).toBeNull()
    expect(screen.getByText('note text')).toBeTruthy()
  })

  it('filters by color', () => {
    const all = [
      makeAnnotation({ id: 'y', kind: 'highlight', color: 'yellow', textExcerpt: 'yellow hit' }),
      makeAnnotation({ id: 'b', kind: 'highlight', color: 'blue', textExcerpt: 'blue hit' })
    ]
    render(
      <MarksTabContent
        annotations={makeAnnotationsResult(all)}
        onJumpToPage={vi.fn()}
        hasDocument={true}
      />
    )
    fireEvent.click(screen.getByLabelText('Filter yellow highlights'))
    expect(screen.getByText('yellow hit')).toBeTruthy()
    expect(screen.queryByText('blue hit')).toBeNull()
  })

  it('groups by page in page sort mode', () => {
    const all = [
      makeAnnotation({ id: 'a', pageNumber: 3, textExcerpt: 'on page 3' }),
      makeAnnotation({ id: 'b', pageNumber: 1, textExcerpt: 'on page 1' })
    ]
    render(
      <MarksTabContent
        annotations={makeAnnotationsResult(all)}
        onJumpToPage={vi.fn()}
        hasDocument={true}
      />
    )
    const headers = screen.getAllByText(/^Page \d+$/)
    expect(headers[0].textContent).toBe('Page 1')
    expect(headers[1].textContent).toBe('Page 3')
  })

  it('sorts by most recent when recent mode is active', () => {
    const all = [
      makeAnnotation({ id: 'old', textExcerpt: 'older', createdAt: 1000, updatedAt: 1000 }),
      makeAnnotation({ id: 'new', textExcerpt: 'newer', createdAt: 2000, updatedAt: 2000 })
    ]
    render(
      <MarksTabContent
        annotations={makeAnnotationsResult(all)}
        onJumpToPage={vi.fn()}
        hasDocument={true}
      />
    )
    fireEvent.click(screen.getByLabelText('Sort by most recent'))
    const items = screen.getAllByText(/older|newer/)
    expect(items[0].textContent).toBe('newer')
    expect(items[1].textContent).toBe('older')
  })

  it('calls deleteAnnotation when delete button is clicked', () => {
    const deleteAnnotation = vi.fn()
    const ann = makeAnnotation({ textExcerpt: 'to delete' })
    const annotations: UseAnnotationsResult = {
      ...makeAnnotationsResult([ann]),
      deleteAnnotation
    }
    render(
      <MarksTabContent annotations={annotations} onJumpToPage={vi.fn()} hasDocument={true} />
    )
    fireEvent.click(screen.getByLabelText('Delete mark'))
    expect(deleteAnnotation).toHaveBeenCalledWith('ann-1')
  })

  it('shows project marks when no document is focused', () => {
    const mark: ProjectMarkSummary = {
      id: 'pm-1',
      document_id: 'doc-1',
      path: '/project/a.pdf',
      document_name: 'a.pdf',
      page_number: 7,
      kind: 'highlight',
      color: 'yellow',
      text_excerpt: 'project-wide text',
      comment: null,
      created_at: NOW,
      updated_at: NOW
    }
    const onOpenProjectMark = vi.fn()
    render(
      <MarksTabContent
        projectMarks={[mark]}
        onJumpToPage={vi.fn()}
        onOpenProjectMark={onOpenProjectMark}
        hasDocument={false}
      />
    )
    expect(screen.getByText('a.pdf')).toBeTruthy()
    fireEvent.click(screen.getByText('project-wide text'))
    expect(onOpenProjectMark).toHaveBeenCalledWith(mark)
    expect(screen.queryByLabelText('Delete mark')).toBeNull()
  })
})
