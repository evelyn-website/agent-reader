import { useCallback, useEffect, useState, type ReactNode } from 'react'

export interface SidePanelTab {
  id: string
  label: string
  content: ReactNode
}

interface SidePanelProps {
  side: 'left' | 'right'
  tabs: SidePanelTab[]
  activeTabId: string
  onTabChange: (id: string) => void
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
}

export default function SidePanel({
  side,
  tabs,
  activeTabId,
  onTabChange,
  defaultWidth = 280,
  minWidth = 200,
  maxWidth = 600
}: SidePanelProps): React.JSX.Element {
  const storageKey = `agent-reader.sidePanel.${side}.width`
  const [width, setWidth] = useState<number>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null
    const n = stored ? Number(stored) : NaN
    return Number.isFinite(n) ? Math.max(minWidth, Math.min(maxWidth, n)) : defaultWidth
  })

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(width))
  }, [storageKey, width])

  const onResizerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width
      const direction = side === 'left' ? 1 : -1
      const prevCursor = document.body.style.cursor
      const prevSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      const onMove = (ev: MouseEvent): void => {
        const next = startWidth + direction * (ev.clientX - startX)
        setWidth(Math.max(minWidth, Math.min(maxWidth, next)))
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevSelect
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [width, side, minWidth, maxWidth]
  )

  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  return (
    <aside className={`side-panel side-panel--${side}`} style={{ width }}>
      <div className="side-panel-tabs" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === active.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`side-panel-tab${isActive ? ' side-panel-tab--active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      <div className="side-panel-body">{active.content}</div>
      <div
        className={`side-panel-resizer side-panel-resizer--${side}`}
        onMouseDown={onResizerMouseDown}
      />
    </aside>
  )
}
