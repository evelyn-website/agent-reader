import { useState, useEffect, useCallback, useRef } from 'react'
import PDFViewer, { type PDFViewerHandle } from './components/PDFViewer'
import Toolbar from './components/Toolbar'
import SidePanel, { type SidePanelTab } from './components/SidePanel'
import OutlineTabContent from './components/OutlineTabContent'
import FilesTabContent from './components/FilesTabContent'
import ChatTabContent from './components/ChatTabContent'
import MarksTabContent from './components/MarksTabContent'
import EmptyLauncher from './components/EmptyLauncher'
import ProjectDashboard from './components/ProjectDashboard'
import { useZoom } from './components/useZoom'
import { useWindowedPages } from './components/useWindowedPages'
import { useSearch } from './components/useSearch'
import { useAnnotations, type HighlightColor } from './components/useAnnotations'
import { createDebug } from './lib/debug'
import type { OutlineNode } from './components/loadToc'

const dPerf = createDebug('pdf:perf')
import type { SearchIndex } from './components/buildSearchIndex'
import type { ProjectDashboard as ProjectDashboardData, ProjectMarkSummary, ProjectRow } from '../../main/db'
import type { ProjectScan } from '../../main/project'
import './assets/main.css'

interface PdfFile {
  path: string
  data: Buffer
  documentId: string
}

type LeftTabId = 'files' | 'toc'
type RightTabId = 'chat' | 'marks'

// US Letter at scale=1 is 612px; add page padding + scrollbar headroom so
// a 100%-zoom PDF fits without horizontal scroll.
const MIN_CONTENT_WIDTH = 660
const PANEL_DEFAULT_WIDTH = 280

function readPanelWidth(side: 'left' | 'right'): number {
  const stored = window.localStorage.getItem(`agent-reader.sidePanel.${side}.width`)
  const n = stored ? Number(stored) : NaN
  return Number.isFinite(n) ? n : PANEL_DEFAULT_WIDTH
}

export default function App(): React.JSX.Element {
  const [pdf, setPdf] = useState<PdfFile | null>(null)
  const [project, setProject] = useState<ProjectScan | null>(null)
  const [projectDashboard, setProjectDashboard] = useState<ProjectDashboardData | null>(null)
  const [projectDashboardLoading, setProjectDashboardLoading] = useState(false)
  const [recentProjects, setRecentProjects] = useState<ProjectRow[]>([])
  const [numPages, setNumPages] = useState<number>(0)
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [leftTab, setLeftTab] = useState<LeftTabId>('toc')
  const [rightTab, setRightTab] = useState<RightTabId>('chat')
  const focusModeSnapshot = useRef<{ left: boolean; right: boolean } | null>(null)
  const [noteMode, setNoteMode] = useState(false)
  const [viewerReady, setViewerReady] = useState(false)
  const switchTokenRef = useRef(0)
  const pendingProjectJumpRef = useRef<number | null>(null)
  const pdfRef = useRef<PDFViewerHandle>(null)
  const leftOpenRef = useRef(leftOpen)
  const rightOpenRef = useRef(rightOpen)
  leftOpenRef.current = leftOpen
  rightOpenRef.current = rightOpen

  const toggleLeft = useCallback(() => setLeftOpen((v) => !v), [])
  const toggleRight = useCallback(() => setRightOpen((v) => !v), [])

  const focusLeftTab = useCallback((id: LeftTabId) => {
    setLeftTab(id)
    setLeftOpen(true)
  }, [])
  const focusRightTab = useCallback((id: RightTabId) => {
    setRightTab(id)
    setRightOpen(true)
  }, [])

  const toggleFocusMode = useCallback(() => {
    if (focusModeSnapshot.current) {
      const snap = focusModeSnapshot.current
      focusModeSnapshot.current = null
      setLeftOpen(snap.left)
      setRightOpen(snap.right)
    } else {
      focusModeSnapshot.current = { left: leftOpen, right: rightOpen }
      setLeftOpen(false)
      setRightOpen(false)
    }
  }, [leftOpen, rightOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      const shift = e.shiftKey
      const k = e.key

      if (k === '\\') {
        e.preventDefault()
        if (shift) toggleRight()
        else toggleLeft()
        return
      }
      if (!shift && k === 'b') {
        e.preventDefault()
        toggleFocusMode()
        return
      }
      if (!shift && (k === '1' || k === '2')) {
        e.preventDefault()
        focusLeftTab(k === '1' ? 'files' : 'toc')
        return
      }
      if (shift && (k === '1' || k === '!' || k === '2' || k === '@')) {
        e.preventDefault()
        const isOne = k === '1' || k === '!'
        focusRightTab(isOne ? 'chat' : 'marks')
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleLeft, toggleRight, toggleFocusMode, focusLeftTab, focusRightTab])

  // Auto-collapse panels when the window is too narrow to fit a usable
  // document area. Right collapses before left (left = orienting nav).
  // Only fires on initial mount and window resize — never reacts to user
  // toggles, so explicit opens are respected even on a narrow window.
  useEffect(() => {
    const check = (): void => {
      const w = window.innerWidth
      const leftW = leftOpenRef.current ? readPanelWidth('left') : 0
      const rightW = rightOpenRef.current ? readPanelWidth('right') : 0
      if (w - leftW - rightW >= MIN_CONTENT_WIDTH) return
      if (rightOpenRef.current && w - leftW >= MIN_CONTENT_WIDTH) {
        setRightOpen(false)
        return
      }
      if (leftOpenRef.current) setLeftOpen(false)
      if (rightOpenRef.current) setRightOpen(false)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const { scale, zoomIn, zoomOut, zoomReset, zoomTo, atMin, atMax } = useZoom()
  const windowed = useWindowedPages(numPages, scale)
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(null)
  const search = useSearch(searchIndex, windowed.scrollToPage)
  const annotations = useAnnotations(pdf?.documentId ?? null)

  const loadPdfPath = useCallback(async (path: string): Promise<void> => {
    const switchToken = ++switchTokenRef.current
    const t0 = performance.now()
    dPerf(`click→loadPdfPath START ${path.split('/').pop()}`)
    setViewerReady(false)
    const { data, document } = await window.api.readPdf(path)
    if (switchToken !== switchTokenRef.current) return
    const t1 = performance.now()
    dPerf(
      `  loadPdfPath readPdf IPC ${(t1 - t0).toFixed(1)}ms ` +
        `bytes=${data.length} docId=${document.id.slice(0, 8)}`
    )
    setOutline([])
    setSearchIndex(null)
    setNumPages(0)
    windowed.setPageDimensions(new Map())
    setNoteMode(false)
    setPdf({ path, data, documentId: document.id })
    requestAnimationFrame(() => {
      if (switchToken === switchTokenRef.current) setViewerReady(true)
    })
    dPerf(`  loadPdfPath setPdf ${(performance.now() - t1).toFixed(1)}ms`)
  }, [windowed.setPageDimensions])

  const dismissDocument = useCallback(() => {
    switchTokenRef.current++
    pendingProjectJumpRef.current = null
    setViewerReady(false)
    setPdf(null)
    setOutline([])
    setSearchIndex(null)
    setNumPages(0)
    windowed.setPageDimensions(new Map())
    setNoteMode(false)
  }, [windowed.setPageDimensions])

  const handleOpen = useCallback(async (): Promise<void> => {
    const path = await window.api.openPdf()
    if (!path) return
    await loadPdfPath(path)
  }, [loadPdfPath])

  const openProjectByPath = useCallback(async (path: string): Promise<void> => {
    const scan = await window.api.project.scan(path)
    switchTokenRef.current++
    setViewerReady(false)
    setPdf(null)
    setProjectDashboard(null)
    setProject(scan)
    setLeftTab('files')
    setLeftOpen(true)
  }, [])

  useEffect(() => {
    if (!project || pdf) return
    let cancelled = false
    setProjectDashboardLoading(true)
    window.api.project
      .dashboard(project)
      .then((dashboard) => {
        if (!cancelled) setProjectDashboard(dashboard)
      })
      .catch((err) => console.error('project dashboard failed:', err))
      .finally(() => {
        if (!cancelled) setProjectDashboardLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pdf, project])

  useEffect(() => {
    if (!viewerReady || numPages === 0 || pendingProjectJumpRef.current === null) return
    const page = pendingProjectJumpRef.current
    pendingProjectJumpRef.current = null
    windowed.scrollToPage(page)
  }, [numPages, viewerReady, windowed.scrollToPage])

  const handleOpenProject = useCallback(async (): Promise<void> => {
    const path = await window.api.project.open()
    if (!path) return
    await openProjectByPath(path)
  }, [openProjectByPath])

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

  const handleHighlightSelection = useCallback((color: HighlightColor) => {
    pdfRef.current?.triggerHighlight(color)
  }, [])

  const openProjectMark = useCallback(
    async (mark: ProjectMarkSummary): Promise<void> => {
      pendingProjectJumpRef.current = mark.page_number
      await loadPdfPath(mark.path)
    },
    [loadPdfPath]
  )

  const leftTabs: SidePanelTab[] = [
    {
      id: 'files',
      label: 'Files',
      content: (
        <FilesTabContent
          project={project}
          activePath={pdf?.path ?? null}
          onOpenFile={loadPdfPath}
        />
      )
    },
    {
      id: 'toc',
      label: 'Outline',
      content: (
        <OutlineTabContent
          outline={outline}
          currentPage={windowed.currentPage}
          onJumpToPage={windowed.scrollToPage}
        />
      )
    }
  ]
  const rightTabs: SidePanelTab[] = [
    { id: 'chat', label: 'Chat', content: <ChatTabContent /> },
    {
      id: 'marks',
      label: 'Marks',
      content: (
        <MarksTabContent
          annotations={pdf ? annotations : undefined}
          projectMarks={!pdf ? (projectDashboard?.recentMarks ?? []) : undefined}
          onJumpToPage={windowed.scrollToPage}
          onOpenProjectMark={openProjectMark}
          hasDocument={pdf !== null}
        />
      )
    }
  ]

  return (
    <div className="app-layout">
      <Toolbar
        filename={pdf?.path.split('/').pop() ?? null}
        scale={scale}
        atMin={atMin}
        atMax={atMax}
        onOpen={handleOpen}
        showOpenButton={project === null}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        currentPage={windowed.currentPage}
        numPages={numPages}
        onJumpToPage={windowed.scrollToPage}
        showSidebarToggle
        sidebarOpen={leftOpen}
        onToggleSidebar={toggleLeft}
        showAnnotationControls={pdf !== null}
        onHighlightSelection={handleHighlightSelection}
        noteMode={noteMode}
        onToggleNoteMode={() => setNoteMode((v) => !v)}
        onDismissDocument={project && pdf ? dismissDocument : undefined}
        projectName={project?.name ?? null}
      />
      <div className="main-area">
        {leftOpen && (
          <SidePanel
            side="left"
            tabs={leftTabs}
            activeTabId={leftTab}
            onTabChange={(id) => setLeftTab(id as LeftTabId)}
          />
        )}
        <div className="center-pane">
          {pdf ? (
            viewerReady ? (
              <PDFViewer
                ref={pdfRef}
                data={pdf.data}
                documentId={pdf.documentId}
                scale={scale}
                setNumPages={setNumPages}
                layout={windowed.layout}
                setPageRef={windowed.setPageRef}
                getPlaceholderHeight={windowed.getPlaceholderHeight}
                onPageRenderSuccess={windowed.onPageRenderSuccess}
                setPageDimensions={windowed.setPageDimensions}
                setOutline={setOutline}
                setSearchIndex={setSearchIndex}
                onZoomTo={zoomTo}
                search={search}
                searchIndexReady={searchIndex !== null}
                annotations={annotations}
                noteMode={noteMode}
                setNoteMode={setNoteMode}
              />
            ) : (
              <div className="pdf-viewer" />
            )
          ) : project ? (
            <ProjectDashboard
              project={project}
              dashboard={projectDashboard}
              loading={projectDashboardLoading}
              onOpenDocument={loadPdfPath}
              onOpenMark={openProjectMark}
            />
          ) : (
            <EmptyLauncher
              onOpenPdf={handleOpen}
              onOpenProject={handleOpenProject}
              recentProjects={recentProjects}
              onOpenRecent={openProjectByPath}
            />
          )}
        </div>
        {rightOpen && (
          <SidePanel
            side="right"
            tabs={rightTabs}
            activeTabId={rightTab}
            onTabChange={(id) => setRightTab(id as RightTabId)}
          />
        )}
      </div>
    </div>
  )
}
