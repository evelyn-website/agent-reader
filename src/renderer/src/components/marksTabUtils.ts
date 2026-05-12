import type { HighlightColor } from './useAnnotations'

type KindFilter = 'all' | 'highlight' | 'note'

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d}d`
  const date = new Date(ts)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function emptyMessage(kind: KindFilter, color: HighlightColor | null): string {
  if (color) return `No ${color} highlights`
  if (kind === 'highlight') return 'No highlights yet'
  if (kind === 'note') return 'No notes yet'
  return 'No marks yet'
}
