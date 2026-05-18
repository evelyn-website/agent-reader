import { useCallback, useMemo, useState } from 'react'
import {
  COMMAND_SECTION_ORDER,
  formatShortcutChips,
  useCommandRegistry,
  type Command,
  type CommandSection
} from '../../commands'
import Palette, { type PaletteSection } from './Palette'
import { fuzzyMatch, highlightSegments } from './fuzzy'

interface CommandPaletteContentProps {
  onClose: () => void
  onPivotToQuickOpen: () => void
}

interface ScoredCommand {
  cmd: Command
  score: number
  titleIndexes: number[]
}

const COMMAND_HINT_CHIPS = ['⌘', '⇧', 'P']

export default function CommandPaletteContent({
  onClose,
  onPivotToQuickOpen
}: CommandPaletteContentProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const allCommands = useCommandRegistry()

  const sections: PaletteSection<ScoredCommand>[] = useMemo(() => {
    const available = allCommands.filter((c) => (c.isAvailable ? c.isAvailable() : true))

    const scored: ScoredCommand[] = []
    for (const cmd of available) {
      if (query.trim().length === 0) {
        scored.push({ cmd, score: 0, titleIndexes: [] })
        continue
      }
      const titleMatch = fuzzyMatch(query, cmd.title)
      if (titleMatch) {
        scored.push({ cmd, score: titleMatch.score, titleIndexes: titleMatch.indexes })
        continue
      }
      // Try section name then keywords as a fallback (no highlight).
      const sectionMatch = fuzzyMatch(query, cmd.section)
      if (sectionMatch) {
        scored.push({ cmd, score: sectionMatch.score - 5, titleIndexes: [] })
        continue
      }
      const kwHit = cmd.keywords?.some((kw) => fuzzyMatch(query, kw) !== null) ?? false
      if (kwHit) {
        scored.push({ cmd, score: 1, titleIndexes: [] })
      }
    }

    if (query.trim().length > 0) {
      // Single flat list ordered by score when filtering.
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.cmd.title.length - b.cmd.title.length
      })
      return [{ label: null, items: scored }]
    }

    // Unfiltered: group by section, in canonical order.
    const bySection = new Map<CommandSection, ScoredCommand[]>()
    for (const entry of scored) {
      const existing = bySection.get(entry.cmd.section) ?? []
      existing.push(entry)
      bySection.set(entry.cmd.section, existing)
    }
    const result: PaletteSection<ScoredCommand>[] = []
    for (const section of COMMAND_SECTION_ORDER) {
      const items = bySection.get(section)
      if (!items || items.length === 0) continue
      items.sort((a, b) => a.cmd.title.localeCompare(b.cmd.title))
      result.push({ label: section, items })
    }
    return result
  }, [allCommands, query])

  const handleSelect = useCallback(
    (entry: ScoredCommand) => {
      onClose()
      void entry.cmd.run()
    },
    [onClose]
  )

  const handleInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && query.length === 0) {
        e.preventDefault()
        onPivotToQuickOpen()
      }
    },
    [onPivotToQuickOpen, query.length]
  )

  return (
    <Palette<ScoredCommand>
      query={query}
      onQueryChange={setQuery}
      sections={sections}
      itemKey={(entry) => entry.cmd.id}
      renderItem={({ cmd, titleIndexes }) => (
        <CommandRow command={cmd} titleIndexes={titleIndexes} />
      )}
      onSelect={handleSelect}
      onClose={onClose}
      onInputKeyDown={handleInputKey}
      placeholder="Type a command…"
      hintChips={COMMAND_HINT_CHIPS}
      emptyMessage="No matching commands"
    />
  )
}

function CommandRow({
  command,
  titleIndexes
}: {
  command: Command
  titleIndexes: number[]
}): React.JSX.Element {
  const segments = highlightSegments(command.title, titleIndexes)
  const chips = command.shortcut ? formatShortcutChips(command.shortcut) : null
  return (
    <>
      <span className="palette__item-title">
        {segments.map((seg, i) =>
          seg.match ? (
            <mark key={i} className="palette__match">
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </span>
      {chips && (
        <span className="palette__item-shortcut" aria-hidden="true">
          {chips.map((c, i) => (
            <kbd key={i} className="palette__kbd">
              {c}
            </kbd>
          ))}
        </span>
      )}
    </>
  )
}
