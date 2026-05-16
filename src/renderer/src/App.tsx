import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatSessionSummary } from '../../shared/dbTypes'
import PDFViewer, { type PDFViewerHandle } from './components/PDFViewer'
import Toolbar from './components/Toolbar'
import SidePanel, { type SidePanelTab } from './components/SidePanel'
import OutlineTabContent from './components/OutlineTabContent'
import FilesTabContent from './components/FilesTabContent'
import ChatTabContent, { type ChatTabContentHandle } from './components/ChatTabContent'
import type { ChatTerminalHandle } from './components/ChatTerminal'
import MarksTabContent from './components/MarksTabContent'
import EmptyLauncher from './components/EmptyLauncher'
import ProjectDashboard from './components/ProjectDashboard'
import { useZoom } from './components/useZoom'
import { useAnnotations, type HighlightColor } from './components/useAnnotations'
import { useDocumentSession } from './hooks/useDocumentSession'
import { useProjectSession } from './hooks/useProjectSession'
import { useSidePanels, type LeftTabId, type RightTabId } from './hooks/useSidePanels'
import './assets/main.css'

export default function App(): React.JSX.Element {
  const pdfRef = useRef<PDFViewerHandle>(null)
  const { scale, zoomIn, zoomOut, zoomReset, zoomTo, atMin, atMax } = useZoom()
  const {
    leftOpen,
    rightOpen,
    leftTab,
    rightTab,
    setLeftTab,
    setRightTab,
    toggleLeft,
    focusLeftTab,
    focusRightTab
  } = useSidePanels()
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<string | null>(null)
  const chatTabRef = useRef<ChatTabContentHandle | null>(null)
  const chatTerminalRef = useRef<ChatTerminalHandle | null>(null)
  const selectedChatSessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    selectedChatSessionIdRef.current = selectedChatSessionId
  }, [selectedChatSessionId])
  const {
    pdf,
    viewerReady,
    numPages,
    outline,
    searchIndex,
    search,
    windowed,
    noteMode,
    setNumPages,
    setOutline,
    setSearchIndex,
    setNoteMode,
    loadPdfPath,
    clearDocument
  } = useDocumentSession(scale)
  const annotations = useAnnotations(pdf?.documentId ?? null)

  const handleOpen = useCallback(async (): Promise<void> => {
    const path = await window.api.openPdf()
    if (!path) return
    await loadPdfPath(path)
  }, [loadPdfPath])
  const focusFilesTab = useCallback(() => focusLeftTab('files'), [focusLeftTab])
  const {
    project,
    projectDashboard,
    projectDashboardLoading,
    recentProjects,
    handleOpenProject,
    openProjectByPath,
    openProjectDocument,
    openProjectMark,
    dismissProjectDocument
  } = useProjectSession({
    pdf,
    numPages,
    viewerReady,
    currentPage: windowed.currentPage,
    scrollToPage: windowed.scrollToPage,
    loadPdfPath,
    clearDocument,
    focusFilesTab
  })

  const handleHighlightSelection = useCallback((color: HighlightColor) => {
    pdfRef.current?.triggerHighlight(color)
  }, [])

  const handleOpenSession = useCallback(
    (session: ChatSessionSummary) => {
      setSelectedChatSessionId(session.id)
      focusRightTab('chat')
    },
    [focusRightTab]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey || e.altKey || e.ctrlKey || !e.shiftKey) return
      if (e.key !== 'n' && e.key !== 'N') return
      e.preventDefault()
      focusRightTab('chat')
      void chatTabRef.current?.createSession()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusRightTab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        focusRightTab('chat')
        chatTerminalRef.current?.focus()
        return
      }
      if (e.key === '.') {
        const id = selectedChatSessionIdRef.current
        if (!id) return
        e.preventDefault()
        void window.api.chat.pty.interrupt(id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusRightTab])

  useEffect(() => {
    void window.api.chat.activeLocation.update({
      documentId: pdf?.documentId ?? null,
      page: pdf ? windowed.currentPage : null,
      docPath: pdf?.path ?? null
    })
  }, [pdf?.documentId, pdf?.path, windowed.currentPage, pdf])

  const documentIdRef = useRef<string | null>(null)
  const currentPageRef = useRef<number | null>(null)
  useEffect(() => {
    documentIdRef.current = pdf?.documentId ?? null
    currentPageRef.current = pdf ? windowed.currentPage : null
  }, [pdf, windowed.currentPage])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey || e.altKey || e.ctrlKey || !e.shiftKey) return
      if (e.key !== 'a' && e.key !== 'A') return
      const sessionId = selectedChatSessionIdRef.current
      if (!sessionId) return
      e.preventDefault()

      const sel = window.getSelection()
      const selectedText = sel && !sel.isCollapsed ? sel.toString().trim() : ''

      void (async (): Promise<void> => {
        let body = selectedText
        let label = 'Selection'
        if (!body) {
          const docId = documentIdRef.current
          const page = currentPageRef.current
          if (!docId || !page) return
          const pageText = await window.api.db.getPageText(docId, page)
          if (!pageText) return
          body = pageText
          label = `Page ${page}`
        }
        focusRightTab('chat')
        chatTerminalRef.current?.focus()
        const prompt = `[${label}]\n${body}\n\n`
        await window.api.chat.pty.write(sessionId, `\x1b[200~${prompt}\x1b[201~`)
      })()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusRightTab])

  const leftTabs: SidePanelTab[] = [
    {
      id: 'files',
      label: 'Files',
      content: (
        <FilesTabContent
          project={project}
          activePath={pdf?.path ?? null}
          onOpenFile={openProjectDocument}
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
    {
      id: 'chat',
      label: 'Chat',
      content: (
        <ChatTabContent
          ref={chatTabRef}
          projectPath={project?.path ?? null}
          documentId={pdf?.documentId ?? null}
          currentPage={pdf ? windowed.currentPage : null}
          selectedSessionId={selectedChatSessionId}
          onSelectSession={setSelectedChatSessionId}
          terminalRef={chatTerminalRef}
        />
      )
    },
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
        onDismissDocument={project && pdf ? dismissProjectDocument : undefined}
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
              onOpenDocument={openProjectDocument}
              onOpenMark={openProjectMark}
              onOpenSession={handleOpenSession}
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
