import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ProjectDashboard from './ProjectDashboard'
import type {
  ProjectDashboard as ProjectDashboardData,
  ProjectMarkSummary
} from '../../../shared/dbTypes'
import type { ProjectScan } from '../../../main/project'

const project: ProjectScan = {
  path: '/project',
  name: 'Project',
  tree: [
    { kind: 'file', name: 'unread.pdf', path: '/project/unread.pdf' },
    { kind: 'file', name: 'opened.pdf', path: '/project/opened.pdf' }
  ]
}

function makeDashboard(overrides: Partial<ProjectDashboardData> = {}): ProjectDashboardData {
  const mark: ProjectMarkSummary = {
    id: 'mark-1',
    document_id: 'doc-1',
    path: '/project/opened.pdf',
    document_name: 'opened.pdf',
    page_number: 4,
    kind: 'highlight',
    color: 'yellow',
    text_excerpt: 'important passage',
    comment: null,
    created_at: Date.now(),
    updated_at: Date.now()
  }
  const data: ProjectDashboardData = {
    documents: [
      {
        path: '/project/opened.pdf',
        name: 'opened.pdf',
        document_id: 'doc-1',
        last_opened_at: Date.now(),
        open_count: 2,
        mark_count: 1,
        highlight_count: 1,
        note_count: 0
      },
      {
        path: '/project/unread.pdf',
        name: 'unread.pdf',
        document_id: null,
        last_opened_at: null,
        open_count: 0,
        mark_count: 0,
        highlight_count: 0,
        note_count: 0
      }
    ],
    resumeDocument: null,
    recentMarks: [mark],
    recentSessions: []
  }
  return { ...data, ...overrides }
}

describe('ProjectDashboard', () => {
  it('renders documents and opens a selected document', () => {
    const onOpenDocument = vi.fn()
    render(
      <ProjectDashboard
        project={project}
        dashboard={makeDashboard()}
        loading={false}
        onOpenDocument={onOpenDocument}
        onOpenMark={vi.fn()}
        onOpenSession={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTitle('/project/opened.pdf'))
    expect(onOpenDocument).toHaveBeenCalledWith('/project/opened.pdf')
    expect(screen.getByText('unread.pdf')).toBeInTheDocument()
    expect(screen.getByText('1 highlight')).toBeInTheDocument()
  })

  it('renders a resume card only when resume data exists', () => {
    render(
      <ProjectDashboard
        project={project}
        dashboard={makeDashboard({ resumeDocument: makeDashboard().documents[0] })}
        loading={false}
        onOpenDocument={vi.fn()}
        onOpenMark={vi.fn()}
        onOpenSession={vi.fn()}
      />
    )

    expect(screen.getByText('Resume')).toBeInTheDocument()
    expect(screen.getByText('Last document')).toBeInTheDocument()
  })

  it('hides recent marks when there are none', () => {
    render(
      <ProjectDashboard
        project={project}
        dashboard={makeDashboard({ recentMarks: [] })}
        loading={false}
        onOpenDocument={vi.fn()}
        onOpenMark={vi.fn()}
        onOpenSession={vi.fn()}
      />
    )

    expect(screen.queryByText('Recent Marks')).toBeNull()
  })

  it('opens project marks', () => {
    const onOpenMark = vi.fn()
    render(
      <ProjectDashboard
        project={project}
        dashboard={makeDashboard()}
        loading={false}
        onOpenDocument={vi.fn()}
        onOpenMark={onOpenMark}
        onOpenSession={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /important passage/i }))
    expect(onOpenMark).toHaveBeenCalledWith(expect.objectContaining({ id: 'mark-1' }))
  })
})
