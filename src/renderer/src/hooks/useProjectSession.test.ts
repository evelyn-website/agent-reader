import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectDashboard, ProjectMarkSummary } from '../../../main/db'
import type { ProjectScan } from '../../../main/project'
import type { PdfFile } from './useDocumentSession'
import { useProjectSession } from './useProjectSession'

const projectScan: ProjectScan = {
  path: '/project',
  name: 'Project',
  tree: [{ kind: 'file', name: 'one.pdf', path: '/project/one.pdf' }]
}

const dashboard: ProjectDashboard = {
  documents: [
    {
      path: '/project/one.pdf',
      name: 'one.pdf',
      document_id: 'doc-1',
      last_opened_at: 1000,
      open_count: 1,
      mark_count: 0,
      highlight_count: 0,
      note_count: 0
    }
  ],
  resumeDocument: null,
  recentMarks: []
}

function pdf(path: string, documentId: string): PdfFile {
  return { path, documentId, data: Buffer.from(documentId) }
}

function mark(path: string, pageNumber: number): ProjectMarkSummary {
  return {
    id: `mark-${pageNumber}`,
    document_id: 'doc-1',
    path,
    document_name: path.split('/').pop() ?? path,
    page_number: pageNumber,
    kind: 'highlight',
    color: 'yellow',
    text_excerpt: 'marked text',
    comment: null,
    created_at: 1000,
    updated_at: 1000
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface ProjectDocumentSwitchProps {
  pdf: PdfFile | null
  currentPage: number
  numPages: number
  viewerReady: boolean
}

interface ProjectMarkOpenProps {
  pdf: PdfFile | null
  numPages: number
  viewerReady: boolean
}

describe('useProjectSession', () => {
  beforeEach(() => {
    window.api.project.dashboard = vi.fn().mockResolvedValue(dashboard)
  })

  it('opens a project, focuses the file tab, and loads its dashboard', async () => {
    vi.mocked(window.api.project.scan).mockResolvedValueOnce(projectScan)
    const dashboardLoad = deferred<ProjectDashboard>()
    vi.mocked(window.api.project.dashboard).mockReturnValueOnce(dashboardLoad.promise)
    const clearDocument = vi.fn()
    const focusFilesTab = vi.fn()
    const { result } = renderHook(() =>
      useProjectSession({
        pdf: null,
        numPages: 0,
        viewerReady: false,
        currentPage: 1,
        scrollToPage: vi.fn(),
        loadPdfPath: vi.fn(),
        clearDocument,
        focusFilesTab
      })
    )

    await act(async () => {
      await result.current.openProjectByPath('/project')
    })

    expect(window.api.project.scan).toHaveBeenCalledWith('/project')
    expect(clearDocument).toHaveBeenCalled()
    expect(focusFilesTab).toHaveBeenCalled()
    expect(result.current.project).toEqual(projectScan)
    expect(result.current.projectDashboardLoading).toBe(true)

    await act(async () => {
      dashboardLoad.resolve(dashboard)
      await dashboardLoad.promise
    })
    await waitFor(() => expect(result.current.projectDashboard).toEqual(dashboard))
    expect(result.current.projectDashboardLoading).toBe(false)
  })

  it('loads recent projects while no project or document is open', async () => {
    vi.mocked(window.api.project.listRecent).mockResolvedValueOnce([
      {
        path: '/recent',
        name: 'Recent',
        first_opened_at: 1000,
        last_opened_at: 2000,
        open_count: 2
      }
    ])

    const { result } = renderHook(() =>
      useProjectSession({
        pdf: null,
        numPages: 0,
        viewerReady: false,
        currentPage: 1,
        scrollToPage: vi.fn(),
        loadPdfPath: vi.fn(),
        clearDocument: vi.fn(),
        focusFilesTab: vi.fn()
      })
    )

    await waitFor(() => expect(result.current.recentProjects).toHaveLength(1))
    expect(result.current.recentProjects[0].path).toBe('/recent')
  })

  it('remembers the current page when switching between project documents', async () => {
    vi.mocked(window.api.project.scan).mockResolvedValueOnce(projectScan)
    const loadPdfPath = vi.fn().mockResolvedValue(undefined)
    const scrollToPage = vi.fn()
    const initialProps: ProjectDocumentSwitchProps = {
      pdf: null,
      currentPage: 1,
      numPages: 0,
      viewerReady: false
    }
    const { result, rerender } = renderHook(
      (props: ProjectDocumentSwitchProps) =>
        useProjectSession({
          ...props,
          scrollToPage,
          loadPdfPath,
          clearDocument: vi.fn(),
          focusFilesTab: vi.fn()
        }),
      {
        initialProps
      }
    )

    await act(async () => {
      await result.current.openProjectByPath('/project')
    })

    rerender({
      pdf: pdf('/project/one.pdf', 'doc-1'),
      currentPage: 7,
      numPages: 12,
      viewerReady: true
    })
    await act(async () => {
      await result.current.openProjectDocument('/project/two.pdf')
    })
    expect(loadPdfPath).toHaveBeenLastCalledWith('/project/two.pdf')

    rerender({
      pdf: pdf('/project/two.pdf', 'doc-2'),
      currentPage: 2,
      numPages: 3,
      viewerReady: true
    })
    await act(async () => {
      await result.current.openProjectDocument('/project/one.pdf')
    })
    expect(loadPdfPath).toHaveBeenLastCalledWith('/project/one.pdf')

    rerender({
      pdf: pdf('/project/one.pdf', 'doc-1'),
      currentPage: 1,
      numPages: 12,
      viewerReady: true
    })
    await waitFor(() => expect(scrollToPage).toHaveBeenCalledWith(7))
  })

  it('opens project marks and jumps once the document is ready', async () => {
    const loadPdfPath = vi.fn().mockResolvedValue(undefined)
    const scrollToPage = vi.fn()
    const initialProps: ProjectMarkOpenProps = {
      pdf: null,
      numPages: 0,
      viewerReady: false
    }
    const { result, rerender } = renderHook(
      (props: ProjectMarkOpenProps) =>
        useProjectSession({
          ...props,
          currentPage: 1,
          scrollToPage,
          loadPdfPath,
          clearDocument: vi.fn(),
          focusFilesTab: vi.fn()
        }),
      {
        initialProps
      }
    )

    await act(async () => {
      await result.current.openProjectMark(mark('/project/one.pdf', 5))
    })
    expect(loadPdfPath).toHaveBeenCalledWith('/project/one.pdf')
    expect(scrollToPage).not.toHaveBeenCalled()

    rerender({
      pdf: pdf('/project/one.pdf', 'doc-1'),
      numPages: 12,
      viewerReady: true
    })
    await waitFor(() => expect(scrollToPage).toHaveBeenCalledWith(5))
  })
})
