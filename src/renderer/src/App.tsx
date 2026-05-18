import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import PaletteHost from './components/palette/PaletteHost'
import { useZoom } from './components/useZoom'
import { useAnnotations, type HighlightColor } from './components/useAnnotations'
import { useDocumentSession } from './hooks/useDocumentSession'
import { useProjectSession } from './hooks/useProjectSession'
import { useSidePanels, type LeftTabId, type RightTabId } from './hooks/useSidePanels'
import { CommandRegistryProvider, useGlobalHotkeys, useRegisterCommand } from './commands'
import './assets/main.css'

export default function App(): React.JSX.Element {
  return (
    <CommandRegistryProvider>
      <AppInner />
    </CommandRegistryProvider>
  )
}

function AppInner(): React.JSX.Element {
  useGlobalHotkeys()

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
    toggleRight,
    toggleFocusMode,
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
    dismissProjectDocument,
    closeProject
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

  const handleNewChatSession = useCallback(async (): Promise<void> => {
    focusRightTab('chat')
    await chatTabRef.current?.createSession()
  }, [focusRightTab])

  const handleFocusChatInput = useCallback(() => {
    focusRightTab('chat')
    chatTerminalRef.current?.focus()
  }, [focusRightTab])

  const handleInterruptChat = useCallback(() => {
    const id = selectedChatSessionIdRef.current
    if (!id) return
    void window.api.chat.pty.interrupt(id)
  }, [])

  const handleAskAboutSelection = useCallback(async (): Promise<void> => {
    const sessionId = selectedChatSessionIdRef.current
    if (!sessionId) return

    const sel = window.getSelection()
    const selectedText = sel && !sel.isCollapsed ? sel.toString().trim() : ''

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
  }, [focusRightTab])

  const handleSaveAsNote = useCallback(async (): Promise<void> => {
    const sessionId = selectedChatSessionIdRef.current
    if (!sessionId) return

    const selectedText = chatTerminalRef.current?.getSelection().trim() ?? ''
    let content = selectedText
    if (!content) {
      const msg = await window.api.chat.messages.lastAssistant(sessionId)
      if (!msg) return
      content = msg.content
    }
    const session = await window.api.chat.sessions.get(sessionId)
    if (!session?.origin_document_id || !session.origin_page_number) return
    await window.api.annotations.create({
      document_id: session.origin_document_id,
      page_number: session.origin_page_number,
      kind: 'note',
      anchor_x: 20,
      anchor_y: 20,
      comment: content
    })
  }, [])

  // ── Command registrations ──────────────────────────────────────────────
  const hasDoc = pdf !== null
  const hasProject = project !== null
  const hasSession = selectedChatSessionId !== null

  // File / project
  useRegisterCommand(
    {
      id: 'file.openPdf',
      title: 'Open File…',
      section: 'File',
      shortcut: 'mod+o',
      keywords: ['document', 'pdf'],
      run: handleOpen
    },
    [handleOpen]
  )
  useRegisterCommand(
    {
      id: 'project.open',
      title: 'Open Project…',
      section: 'Project',
      shortcut: 'mod+shift+o',
      keywords: ['folder', 'workspace'],
      run: handleOpenProject
    },
    [handleOpenProject]
  )
  useRegisterCommand(
    {
      id: 'project.close',
      title: 'Close Project',
      section: 'Project',
      keywords: ['exit', 'leave'],
      isAvailable: () => hasProject,
      run: closeProject
    },
    [closeProject, hasProject]
  )
  useRegisterCommand(
    {
      id: 'doc.close',
      title: 'Close Document',
      section: 'File',
      keywords: ['dismiss', 'back'],
      isAvailable: () => hasDoc,
      run: () => {
        if (hasProject) dismissProjectDocument()
        else clearDocument()
      }
    },
    [clearDocument, dismissProjectDocument, hasDoc, hasProject]
  )

  // Panels
  useRegisterCommand(
    {
      id: 'panels.toggleLeft',
      title: 'Toggle Left Panel',
      section: 'Panels',
      shortcut: 'mod+\\',
      run: toggleLeft
    },
    [toggleLeft]
  )
  useRegisterCommand(
    {
      id: 'panels.toggleRight',
      title: 'Toggle Right Panel',
      section: 'Panels',
      shortcut: 'mod+shift+\\',
      run: toggleRight
    },
    [toggleRight]
  )
  useRegisterCommand(
    {
      id: 'panels.focusMode',
      title: 'Toggle Focus Mode',
      section: 'Panels',
      shortcut: 'mod+b',
      keywords: ['hide panels', 'zen'],
      run: toggleFocusMode
    },
    [toggleFocusMode]
  )
  useRegisterCommand(
    {
      id: 'panels.left.files',
      title: 'Show Files Panel',
      section: 'Panels',
      shortcut: 'mod+1',
      run: () => focusLeftTab('files')
    },
    [focusLeftTab]
  )
  useRegisterCommand(
    {
      id: 'panels.left.toc',
      title: 'Show Outline Panel',
      section: 'Panels',
      shortcut: 'mod+2',
      keywords: ['toc', 'table of contents'],
      run: () => focusLeftTab('toc')
    },
    [focusLeftTab]
  )
  useRegisterCommand(
    {
      id: 'panels.right.chat',
      title: 'Show Chat Panel',
      section: 'Panels',
      shortcut: 'mod+shift+1',
      run: () => focusRightTab('chat')
    },
    [focusRightTab]
  )
  useRegisterCommand(
    {
      id: 'panels.right.marks',
      title: 'Show Marks Panel',
      section: 'Panels',
      shortcut: 'mod+shift+2',
      keywords: ['highlights', 'notes', 'bookmarks'],
      run: () => focusRightTab('marks')
    },
    [focusRightTab]
  )

  // View / zoom
  useRegisterCommand(
    {
      id: 'view.zoomIn',
      title: 'Zoom In',
      section: 'View',
      isAvailable: () => hasDoc && !atMax,
      run: zoomIn
    },
    [atMax, hasDoc, zoomIn]
  )
  useRegisterCommand(
    {
      id: 'view.zoomOut',
      title: 'Zoom Out',
      section: 'View',
      isAvailable: () => hasDoc && !atMin,
      run: zoomOut
    },
    [atMin, hasDoc, zoomOut]
  )
  useRegisterCommand(
    {
      id: 'view.zoomReset',
      title: 'Reset Zoom',
      section: 'View',
      keywords: ['fit width', '100%'],
      isAvailable: () => hasDoc,
      run: zoomReset
    },
    [hasDoc, zoomReset]
  )

  // Annotation
  useRegisterCommand(
    {
      id: 'annotation.highlight',
      title: 'Highlight Selection (Yellow)',
      section: 'Annotation',
      keywords: ['mark', 'underline'],
      isAvailable: () => hasDoc,
      run: () => handleHighlightSelection('yellow')
    },
    [handleHighlightSelection, hasDoc]
  )
  useRegisterCommand(
    {
      id: 'annotation.toggleNoteMode',
      title: noteMode ? 'Exit Note Mode' : 'Place Note…',
      section: 'Annotation',
      keywords: ['pin', 'comment'],
      isAvailable: () => hasDoc,
      run: () => setNoteMode((v) => !v)
    },
    [hasDoc, noteMode, setNoteMode]
  )

  // Chat
  useRegisterCommand(
    {
      id: 'chat.newSession',
      title: 'New Chat Session',
      section: 'Chat',
      shortcut: 'mod+shift+n',
      isAvailable: () => hasProject || hasDoc,
      run: handleNewChatSession
    },
    [handleNewChatSession, hasDoc, hasProject]
  )
  useRegisterCommand(
    {
      id: 'chat.focusInput',
      title: 'Focus Chat Input',
      section: 'Chat',
      shortcut: 'mod+l',
      run: handleFocusChatInput
    },
    [handleFocusChatInput]
  )
  useRegisterCommand(
    {
      id: 'chat.interrupt',
      title: 'Interrupt Chat Response',
      section: 'Chat',
      shortcut: 'mod+.',
      keywords: ['stop', 'cancel'],
      isAvailable: () => hasSession,
      run: handleInterruptChat
    },
    [handleInterruptChat, hasSession]
  )
  useRegisterCommand(
    {
      id: 'chat.askAboutSelection',
      title: 'Ask Chat About Selection or Page',
      section: 'Chat',
      shortcut: 'mod+shift+a',
      keywords: ['agent', 'question'],
      isAvailable: () => hasSession,
      run: handleAskAboutSelection
    },
    [handleAskAboutSelection, hasSession]
  )
  useRegisterCommand(
    {
      id: 'chat.saveAsNote',
      title: 'Save Chat Selection as Note',
      section: 'Chat',
      shortcut: 'mod+shift+s',
      keywords: ['mark', 'capture'],
      isAvailable: () => hasSession,
      run: handleSaveAsNote
    },
    [handleSaveAsNote, hasSession]
  )

  const openFileFromQuickOpen = useMemo(
    () => (hasProject ? openProjectDocument : loadPdfPath),
    [hasProject, loadPdfPath, openProjectDocument]
  )

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
        onCloseProject={project && !pdf ? closeProject : undefined}
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
      <PaletteHost project={project} onOpenFile={openFileFromQuickOpen} />
    </div>
  )
}
