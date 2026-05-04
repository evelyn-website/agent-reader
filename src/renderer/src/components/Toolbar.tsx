import { useEffect, useState } from 'react'

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
  onJumpToPage
}: ToolbarProps): React.JSX.Element {
  const [pageInput, setPageInput] = useState(String(currentPage))

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  return (
    <div className="toolbar">
      <button onClick={onOpen}>Open PDF</button>
      {filename && <span className="pdf-filename">{filename}</span>}
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
