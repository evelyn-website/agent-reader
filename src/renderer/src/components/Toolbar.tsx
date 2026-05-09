import { useEffect, useState } from 'react'
import { HIGHLIGHT_COLORS, type HighlightColor } from './useAnnotations'

interface ToolbarProps {
  filename: string | null
  scale: number
  atMin: boolean
  atMax: boolean
  onOpen: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  currentPage: number
  numPages: number
  onJumpToPage: (n: number) => void
  showSidebarToggle: boolean
  sidebarOpen: boolean
  onToggleSidebar: () => void
  showAnnotationControls: boolean
  onHighlightSelection: (color: HighlightColor) => void
  noteMode: boolean
  onToggleNoteMode: () => void
}

export default function Toolbar({
  filename,
  scale,
  atMin,
  atMax,
  onOpen,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  currentPage,
  numPages,
  onJumpToPage,
  showSidebarToggle,
  sidebarOpen,
  onToggleSidebar,
  showAnnotationControls,
  onHighlightSelection,
  noteMode,
  onToggleNoteMode
}: ToolbarProps): React.JSX.Element {
  const [pageInput, setPageInput] = useState(String(currentPage))
  const [hasSelection, setHasSelection] = useState(false)

  useEffect(() => {
    if (!showAnnotationControls) return
    const onSelectionChange = (): void => {
      const sel = window.getSelection()
      setHasSelection(!!sel && !sel.isCollapsed && sel.toString().trim().length > 0)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [showAnnotationControls])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  return (
    <div className="toolbar">
      {showSidebarToggle && (
        <button
          className={`sidebar-toggle${sidebarOpen ? ' sidebar-toggle--active' : ''}`}
          onClick={onToggleSidebar}
          title="Toggle sidebar (⌘\\)"
          aria-label="Toggle sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <line x1="6" y1="2.5" x2="6" y2="13.5" />
          </svg>
        </button>
      )}
      <button
        onClick={(e) => {
          ;(e.currentTarget as HTMLButtonElement).blur()
          onOpen()
        }}
        title="Open PDF"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5z" />
        </svg>
        Open PDF
      </button>
      {filename && <span className="pdf-filename">{filename}</span>}
      {showAnnotationControls && (
        <div className="annotation-controls" role="group" aria-label="Annotations">
          {HIGHLIGHT_COLORS.map((c, i) => (
            <button
              key={c}
              className={`annotation-swatch annotation-swatch--${c}`}
              onClick={() => onHighlightSelection(c)}
              disabled={!hasSelection}
              title={`Highlight ${c} (${i + 1})`}
              aria-label={`Highlight ${c}`}
              data-shortcut={i + 1}
            />
          ))}
          <button
            className={`note-toggle${noteMode ? ' note-toggle--active' : ''}`}
            onClick={onToggleNoteMode}
            title="Add note (N)"
            aria-label="Add note"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 3v-3H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
            </svg>
          </button>
          <div className="annotation-controls__shortcuts" aria-hidden="true">
            {HIGHLIGHT_COLORS.map((_, i) => (
              <span key={i} className="annotation-controls__shortcut">
                {i + 1}
              </span>
            ))}
            <span className="annotation-controls__shortcut">N</span>
          </div>
        </div>
      )}
      <div className="toolbar-spacer" />
      {numPages > 0 && (
        <div className="page-indicator">
          <input
            type="text"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = parseInt(pageInput, 10)
                if (Number.isFinite(n) && n >= 1 && n <= numPages) {
                  onJumpToPage(n)
                  ;(e.target as HTMLInputElement).blur()
                } else {
                  setPageInput(String(currentPage))
                }
              }
            }}
            onBlur={() => setPageInput(String(currentPage))}
          />
          <span>/ {numPages}</span>
        </div>
      )}
      <div className="zoom-controls">
        <button onClick={onZoomOut} disabled={atMin}>
          −
        </button>
        <button className="zoom-label" onClick={onZoomReset}>
          {Math.round(scale * 100)}%
        </button>
        <button onClick={onZoomIn} disabled={atMax}>
          +
        </button>
      </div>
    </div>
  )
}
