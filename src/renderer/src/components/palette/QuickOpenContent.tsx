import { useCallback, useMemo, useState } from 'react'
import type { FileNode, ProjectScan } from '../../../../main/project'
import Palette, { type PaletteSection } from './Palette'
import { fuzzyMatch, highlightSegments } from './fuzzy'

interface QuickOpenContentProps {
  project: ProjectScan | null
  onOpenFile: (path: string) => void | Promise<void>
  onClose: () => void
}

interface FileEntry {
  absPath: string
  basename: string
  relPath: string
}

interface ScoredFile {
  entry: FileEntry
  score: number
  basenameIndexes: number[]
  relPathIndexes: number[]
}

const QUICK_OPEN_HINT_CHIPS = ['⌘', 'P']
const MAX_RESULTS = 100

function flattenTree(nodes: FileNode[], rootPath: string): FileEntry[] {
  const out: FileEntry[] = []
  const stack: FileNode[] = [...nodes]
  const prefixLen = rootPath.endsWith('/') ? rootPath.length : rootPath.length + 1
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.kind === 'dir') {
      for (const child of node.children) stack.push(child)
      continue
    }
    out.push({
      absPath: node.path,
      basename: node.name,
      relPath: node.path.startsWith(rootPath) ? node.path.slice(prefixLen) : node.path
    })
  }
  out.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return out
}

export default function QuickOpenContent({
  project,
  onOpenFile,
  onClose
}: QuickOpenContentProps): React.JSX.Element {
  const [query, setQuery] = useState('')

  const entries = useMemo<FileEntry[]>(() => {
    if (!project) return []
    return flattenTree(project.tree, project.path)
  }, [project])

  const sections: PaletteSection<ScoredFile>[] = useMemo(() => {
    if (entries.length === 0) return [{ label: null, items: [] }]
    const q = query.trim()
    if (q.length === 0) {
      const items: ScoredFile[] = entries
        .slice(0, MAX_RESULTS)
        .map((entry) => ({ entry, score: 0, basenameIndexes: [], relPathIndexes: [] }))
      return [{ label: null, items }]
    }

    const scored: ScoredFile[] = []
    for (const entry of entries) {
      const basenameMatch = fuzzyMatch(q, entry.basename)
      const relPathMatch = fuzzyMatch(q, entry.relPath)
      if (!basenameMatch && !relPathMatch) continue
      // Prefer basename hits; weight basename score double.
      const score = (basenameMatch?.score ?? 0) * 2 + (relPathMatch?.score ?? 0)
      scored.push({
        entry,
        score,
        basenameIndexes: basenameMatch?.indexes ?? [],
        relPathIndexes: relPathMatch?.indexes ?? []
      })
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.entry.relPath.length - b.entry.relPath.length
    })
    return [{ label: null, items: scored.slice(0, MAX_RESULTS) }]
  }, [entries, query])

  const handleSelect = useCallback(
    (item: ScoredFile) => {
      onClose()
      void onOpenFile(item.entry.absPath)
    },
    [onClose, onOpenFile]
  )

  const placeholder = project ? 'Open file by name…' : 'No project open'
  const emptyMessage = project ? 'No matching files' : 'No project — open one with ⌘⇧O'

  return (
    <Palette<ScoredFile>
      query={query}
      onQueryChange={setQuery}
      sections={sections}
      itemKey={(item) => item.entry.absPath}
      renderItem={(item) => <FileRow item={item} />}
      onSelect={handleSelect}
      onClose={onClose}
      placeholder={placeholder}
      hintChips={QUICK_OPEN_HINT_CHIPS}
      emptyMessage={emptyMessage}
    />
  )
}

function FileRow({ item }: { item: ScoredFile }): React.JSX.Element {
  const { entry, basenameIndexes, relPathIndexes } = item
  // The relPath includes the basename at the end; render dir prefix separately
  // so the basename can be highlighted using its own indexes.
  const dirPart =
    entry.relPath.length > entry.basename.length
      ? entry.relPath.slice(0, entry.relPath.length - entry.basename.length)
      : ''
  // If the basename has no specific hits but the relPath does, fall back to
  // showing the relPath highlight on the visible substring.
  const baseSegments =
    basenameIndexes.length > 0
      ? highlightSegments(entry.basename, basenameIndexes)
      : [{ text: entry.basename, match: false }]

  const dirSegments =
    dirPart.length > 0 && relPathIndexes.length > 0
      ? highlightSegments(
          dirPart,
          relPathIndexes.filter((i) => i < dirPart.length)
        )
      : dirPart.length > 0
        ? [{ text: dirPart, match: false }]
        : []

  return (
    <>
      <span className="palette__item-title">
        {baseSegments.map((seg, i) =>
          seg.match ? (
            <mark key={i} className="palette__match">
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </span>
      {dirSegments.length > 0 && (
        <span className="palette__item-meta">
          {dirSegments.map((seg, i) =>
            seg.match ? (
              <mark key={i} className="palette__match">
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )}
        </span>
      )}
    </>
  )
}
