import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ProjectDashboard as ProjectDashboardData,
  ProjectMarkSummary,
  ProjectRow
} from '../../../shared/dbTypes'
import type { ProjectScan } from '../../../main/project'
import type { PdfFile } from './useDocumentSession'

interface UseProjectSessionOptions {
  pdf: PdfFile | null
  numPages: number
  viewerReady: boolean
  currentPage: number
  scrollToPage: (page: number) => void
  loadPdfPath: (path: string) => Promise<void>
  clearDocument: () => void
  focusFilesTab: () => void
}

export function useProjectSession({
  pdf,
  numPages,
  viewerReady,
  currentPage,
  scrollToPage,
  loadPdfPath,
  clearDocument,
  focusFilesTab
}: UseProjectSessionOptions): {
  project: ProjectScan | null
  projectDashboard: ProjectDashboardData | null
  projectDashboardLoading: boolean
  recentProjects: ProjectRow[]
  handleOpenProject: () => Promise<void>
  openProjectByPath: (path: string) => Promise<void>
  openProjectDocument: (path: string) => Promise<void>
  openProjectMark: (mark: ProjectMarkSummary) => Promise<void>
  dismissProjectDocument: () => void
  closeProject: () => void
} {
  const [project, setProject] = useState<ProjectScan | null>(null)
  const [projectDashboard, setProjectDashboard] = useState<ProjectDashboardData | null>(null)
  const [projectDashboardLoading, setProjectDashboardLoading] = useState(false)
  const [recentProjects, setRecentProjects] = useState<ProjectRow[]>([])
  const pendingProjectJumpRef = useRef<number | null>(null)
  const projectPageCacheRef = useRef<Map<string, number>>(new Map())

  const rememberCurrentProjectPage = useCallback(() => {
    if (!project || !pdf) return
    projectPageCacheRef.current.set(pdf.path, currentPage)
  }, [currentPage, pdf, project])

  const openProjectByPath = useCallback(
    async (path: string): Promise<void> => {
      const scan = await window.api.project.scan(path)
      pendingProjectJumpRef.current = null
      clearDocument()
      setProjectDashboard(null)
      setProjectDashboardLoading(true)
      projectPageCacheRef.current.clear()
      setProject(scan)
      focusFilesTab()
    },
    [clearDocument, focusFilesTab]
  )

  const handleOpenProject = useCallback(async (): Promise<void> => {
    const path = await window.api.project.open()
    if (!path) return
    await openProjectByPath(path)
  }, [openProjectByPath])

  useEffect(() => {
    if (!project || pdf) return
    let cancelled = false
    const load = (): void => {
      window.api.project
        .dashboard(project)
        .then((dashboard) => {
          if (!cancelled) setProjectDashboard(dashboard)
        })
        .catch((err) => console.error('project dashboard failed:', err))
        .finally(() => {
          if (!cancelled) setProjectDashboardLoading(false)
        })
    }
    load()
    const off = window.api.chat.sessions.onChanged((event) => {
      if (event.scopeKey !== project.path) return
      load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [pdf, project])

  useEffect(() => {
    if (!viewerReady || numPages === 0 || pendingProjectJumpRef.current === null) return
    const page = pendingProjectJumpRef.current
    pendingProjectJumpRef.current = null
    scrollToPage(page)
  }, [numPages, scrollToPage, viewerReady])

  useEffect(() => {
    if (pdf || project) return
    let cancelled = false
    window.api.project.listRecent().then((rows) => {
      if (!cancelled) setRecentProjects(rows)
    })
    return () => {
      cancelled = true
    }
  }, [pdf, project])

  const openProjectMark = useCallback(
    async (mark: ProjectMarkSummary): Promise<void> => {
      rememberCurrentProjectPage()
      pendingProjectJumpRef.current = mark.page_number
      await loadPdfPath(mark.path)
    },
    [loadPdfPath, rememberCurrentProjectPage]
  )

  const openProjectDocument = useCallback(
    async (path: string): Promise<void> => {
      rememberCurrentProjectPage()
      pendingProjectJumpRef.current = projectPageCacheRef.current.get(path) ?? null
      await loadPdfPath(path)
    },
    [loadPdfPath, rememberCurrentProjectPage]
  )

  const dismissProjectDocument = useCallback(() => {
    pendingProjectJumpRef.current = null
    setProjectDashboardLoading(true)
    clearDocument()
  }, [clearDocument])

  const closeProject = useCallback((): void => {
    pendingProjectJumpRef.current = null
    projectPageCacheRef.current.clear()
    clearDocument()
    setProject(null)
    setProjectDashboard(null)
    setProjectDashboardLoading(false)
  }, [clearDocument])

  return {
    project,
    projectDashboard,
    projectDashboardLoading,
    recentProjects,
    handleOpenProject,
    openProjectByPath,
    openProjectDocument,
    openProjectMark,
    dismissProjectDocument,
    closeProject
  }
}
