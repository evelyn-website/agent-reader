import { useState, useMemo, useCallback, useRef } from 'react'
import OutlineItem from './OutlineItem'
import type { OutlineNode } from './loadToc'

interface OutlineTabContentProps {
  outline: OutlineNode[]
  currentPage: number
  onJumpToPage: (n: number) => void
}

interface FlatEntry {
  path: string
  pageNumber: number
}

function flatten(nodes: OutlineNode[], parentPath: string, out: FlatEntry[]): void {
  nodes.forEach((node, i) => {
    const path = parentPath === '' ? String(i) : `${parentPath}.${i}`
    if (node.pageNumber !== null) out.push({ path, pageNumber: node.pageNumber })
    flatten(node.children, path, out)
  })
}

export default function OutlineTabContent({
  outline,
  currentPage,
  onJumpToPage
}: OutlineTabContentProps): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(outline.map((_, i) => String(i)))
  )
  const [stickyClick, setStickyClick] = useState<{
    path: string
    pageNumber: number
    locked: boolean
  } | null>(null)
  const stickyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flat = useMemo(() => {
    const out: FlatEntry[] = []
    flatten(outline, '', out)
    out.sort((a, b) => a.pageNumber - b.pageNumber)
    return out
  }, [outline])

  const activePath = useMemo(() => {
    if (stickyClick?.locked) return stickyClick.path
    if (stickyClick && stickyClick.pageNumber === currentPage) return stickyClick.path
    let active: string | null = null
    for (const entry of flat) {
      if (entry.pageNumber <= currentPage) active = entry.path
      else break
    }
    return active
  }, [flat, currentPage, stickyClick])

  const handleJump = useCallback(
    (path: string, pageNumber: number) => {
      setStickyClick({ path, pageNumber, locked: true })
      if (stickyTimer.current) clearTimeout(stickyTimer.current)
      stickyTimer.current = setTimeout(() => {
        setStickyClick((prev) =>
          prev && prev.path === path ? { ...prev, locked: false } : prev
        )
      }, 1000)
      onJumpToPage(pageNumber)
    },
    [onJumpToPage]
  )

  const onToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  if (outline.length === 0) {
    return <div className="tab-empty-state">No outline available</div>
  }

  return (
    <ul className="outline-root">
      {outline.map((node, i) => (
        <OutlineItem
          key={i}
          node={node}
          path={String(i)}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          activePath={activePath}
          onJump={handleJump}
        />
      ))}
    </ul>
  )
}
