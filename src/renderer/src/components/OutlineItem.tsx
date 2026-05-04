import type { OutlineNode } from './loadToc'

interface OutlineItemProps {
  node: OutlineNode
  path: string
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  activePath: string | null
  onJump: (path: string, pageNumber: number) => void
}

export default function OutlineItem({
  node,
  path,
  depth,
  expanded,
  onToggle,
  activePath,
  onJump
}: OutlineItemProps): React.JSX.Element {
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(path)
  const isActive = activePath === path

  return (
    <li className="outline-item">
      <div
        className={`outline-row${isActive ? ' outline-row--active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {hasChildren ? (
          <button
            className="outline-chevron"
            onClick={() => onToggle(path)}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="outline-chevron outline-chevron--placeholder" />
        )}
        <button
          className="outline-title"
          disabled={node.pageNumber === null}
          onClick={() => {
            if (node.pageNumber !== null) onJump(path, node.pageNumber)
          }}
          title={node.title}
        >
          {node.title}
        </button>
      </div>
      {hasChildren && isExpanded && (
        <ul className="outline-children">
          {node.children.map((child, i) => (
            <OutlineItem
              key={i}
              node={child}
              path={`${path}.${i}`}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              activePath={activePath}
              onJump={onJump}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
