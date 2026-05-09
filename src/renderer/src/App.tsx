import { useState, useEffect, useCallback, useRef } from 'react'
import PDFViewer, { type PDFViewerHandle } from './components/PDFViewer'
import Toolbar from './components/Toolbar'
import SidePanel, { type SidePanelTab } from './components/SidePanel'
import OutlineTabContent from './components/OutlineTabContent'
import FilesTabContent from './components/FilesTabContent'
import ChatTabContent from './components/ChatTabContent'
import MarksTabContent from './components/MarksTabContent'
import { useZoom } from './components/useZoom'
import { useWindowedPages } from './components/useWindowedPages'
import { useSearch } from './components/useSearch'
import { useAnnotations, type HighlightColor } from './components/useAnnotations'
import type { OutlineNode } from './components/loadToc'
import type { SearchIndex } from './components/buildSearchIndex'
import './assets/main.css'

interface PdfFile {
  path: string
  data: Buffer
  documentId: string
}

type LeftTabId = 'files' | 'toc'
type RightTabId = 'chat' | 'marks'

export default function App(): React.JSX.Element {
  const [pdf, setPdf] = useState<PdfFile | null>(null)
  const [numPages, setNumPages] = useState<number>(0)
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [leftTab, setLeftTab] = useState<LeftTabId>('toc')
  const [rightTab, setRightTab] = useState<RightTabId>('chat')
  const focusModeSnapshot = useRef<{ left: boolean; right: boolean } | null>(null)
  const [noteMode, setNoteMode] = useState(false)
  const pdfRef = useRef<PDFViewerHandle>(null)

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

  const { scale, zoomIn, zoomOut, zoomReset, zoomTo, atMin, atMax } = useZoom()
  const windowed = useWindowedPages(numPages, scale)
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(null)
  const search = useSearch(searchIndex, windowed.scrollToPage)
  const annotations = useAnnotations(pdf?.documentId ?? null)

  const handleOpen = async (): Promise<void> => {
    const path = await window.api.openPdf()
    if (!path) return
    const { data, document } = await window.api.readPdf(path)
    setOutline([])
    setSearchIndex(null)
    setNoteMode(false)
    setPdf({ path, data, documentId: document.id })
  }

  const handleHighlightSelection = useCallback((color: HighlightColor) => {
    pdfRef.current?.triggerHighlight(color)
  }, [])

  const leftTabs: SidePanelTab[] = [
    { id: 'files', label: 'Files', content: <FilesTabContent /> },
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
    { id: 'marks', label: 'Marks', content: <MarksTabContent /> }
  ]

  return (
    <div className="app-layout">
      <Toolbar
        filename={pdf?.path.split('/').pop() ?? null}
        scale={scale}
        atMin={atMin}
        atMax={atMax}
        onOpen={handleOpen}
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
            <PDFViewer
              ref={pdfRef}
              data={pdf.data}
              scale={scale}
              setNumPages={setNumPages}
              layout={windowed.layout}
              setPageRef={windowed.setPageRef}
              getPlaceholderHeight={windowed.getPlaceholderHeight}
              onPageRenderSuccess={windowed.onPageRenderSuccess}
              onItemClick={windowed.scrollToPage}
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
            <div className="empty-state">
              <p>Open a PDF to get started</p>
            </div>
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
