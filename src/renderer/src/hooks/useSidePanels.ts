import { useCallback, useEffect, useRef, useState } from 'react'

export type LeftTabId = 'files' | 'toc'
export type RightTabId = 'chat' | 'marks'

// US Letter at scale=1 is 612px; add page padding + scrollbar headroom so
// a 100%-zoom PDF fits without horizontal scroll.
const MIN_CONTENT_WIDTH = 660
const PANEL_DEFAULT_WIDTH = 280

function readPanelWidth(side: 'left' | 'right'): number {
  const stored = window.localStorage.getItem(`agent-reader.sidePanel.${side}.width`)
  const n = stored ? Number(stored) : NaN
  return Number.isFinite(n) ? n : PANEL_DEFAULT_WIDTH
}

function getInitialPanelOpenState(): { left: boolean; right: boolean } {
  if (typeof window === 'undefined') return { left: true, right: true }
  const leftW = readPanelWidth('left')
  const rightW = readPanelWidth('right')
  const w = window.innerWidth
  if (w - leftW - rightW >= MIN_CONTENT_WIDTH) return { left: true, right: true }
  if (w - leftW >= MIN_CONTENT_WIDTH) return { left: true, right: false }
  return { left: false, right: false }
}

export function useSidePanels(): {
  leftOpen: boolean
  rightOpen: boolean
  leftTab: LeftTabId
  rightTab: RightTabId
  setLeftTab: (id: LeftTabId) => void
  setRightTab: (id: RightTabId) => void
  toggleLeft: () => void
  toggleRight: () => void
  toggleFocusMode: () => void
  focusLeftTab: (id: LeftTabId) => void
  focusRightTab: (id: RightTabId) => void
} {
  const [initialOpenState] = useState(getInitialPanelOpenState)
  const [leftOpen, setLeftOpen] = useState(initialOpenState.left)
  const [rightOpen, setRightOpen] = useState(initialOpenState.right)
  const [leftTab, setLeftTab] = useState<LeftTabId>('toc')
  const [rightTab, setRightTab] = useState<RightTabId>('chat')
  const focusModeSnapshot = useRef<{ left: boolean; right: boolean } | null>(null)
  const leftOpenRef = useRef(leftOpen)
  const rightOpenRef = useRef(rightOpen)

  useEffect(() => {
    leftOpenRef.current = leftOpen
    rightOpenRef.current = rightOpen
  }, [leftOpen, rightOpen])

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

    window.addEventListener('resize', check)
    return () => {
      window.removeEventListener('resize', check)
    }
  }, [])

  return {
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
  }
}
