import { useState, useCallback } from 'react'
import type { FileNode } from '../../../main/project'
import { ChevronRightIcon, PageIcon } from './icons'

interface Props {
  nodes: FileNode[]
  activePath: string | null
  onOpenFile: (path: string) => void
}

export default function FileTree({ nodes, activePath, onOpenFile }: Props): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => initCollapsed(nodes))

  const toggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  return (
    <ul className="file-tree" role="tree">
      {nodes.map((n) => (
        <TreeRow
          key={n.path}
          node={n}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          activePath={activePath}
          onOpenFile={onOpenFile}
        />
      ))}
    </ul>
  )
}

interface RowProps {
  node: FileNode
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  activePath: string | null
  onOpenFile: (path: string) => void
}

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  activePath,
  onOpenFile
}: RowProps): React.JSX.Element {
  const indent = { paddingLeft: 8 + depth * 12 } as const
  if (node.kind === 'dir') {
    const isCollapsed = collapsed.has(node.path)
    return (
      <li role="treeitem" aria-expanded={!isCollapsed}>
        <button
          type="button"
          className="file-tree__row file-tree__row--dir"
          style={indent}
          onClick={() => onToggle(node.path)}
        >
          <span className={`file-tree__chevron${isCollapsed ? '' : ' file-tree__chevron--open'}`}>
            <ChevronRightIcon size={10} />
          </span>
          <span className="file-tree__name">{node.name}</span>
        </button>
        {!isCollapsed && node.children.length > 0 && (
          <ul className="file-tree__children" role="group">
            {node.children.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                activePath={activePath}
                onOpenFile={onOpenFile}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }
  const isActive = activePath === node.path
  return (
    <li role="treeitem">
      <button
        type="button"
        className={`file-tree__row file-tree__row--file${isActive ? ' file-tree__row--active' : ''}`}
        style={indent}
        onClick={() => onOpenFile(node.path)}
        title={node.name}
      >
        <span className="file-tree__chevron file-tree__chevron--leaf" aria-hidden />
        <span className="file-tree__icon">
          <PageIcon size={12} />
        </span>
        <span className="file-tree__name">{node.name}</span>
      </button>
    </li>
  )
}

function initCollapsed(nodes: FileNode[]): Set<string> {
  // Top level expanded; any nested directories start collapsed.
  const set = new Set<string>()
  for (const n of nodes) {
    if (n.kind === 'dir') collectNestedDirs(n.children, set)
  }
  return set
}

function collectNestedDirs(nodes: FileNode[], set: Set<string>): void {
  for (const n of nodes) {
    if (n.kind === 'dir') {
      set.add(n.path)
      collectNestedDirs(n.children, set)
    }
  }
}
