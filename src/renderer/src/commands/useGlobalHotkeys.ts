import { useEffect } from 'react'
import { useCommandStore } from './registry'
import { matchEvent, parseShortcut, type ParsedShortcut } from './shortcut'

/**
 * Single window-level keydown listener that dispatches to registered commands
 * with a `shortcut`. Commands without a shortcut are palette-only.
 *
 * Commands whose `isAvailable()` returns false are skipped (event is not
 * prevented), so the underlying key reaches its default handler.
 */
export function useGlobalHotkeys(): void {
  const store = useCommandStore()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const commands = store.getSnapshot()
      for (const cmd of commands) {
        if (!cmd.shortcut) continue
        let parsed: ParsedShortcut
        try {
          parsed = parseShortcut(cmd.shortcut)
        } catch {
          continue
        }
        if (!matchEvent(parsed, e)) continue
        if (cmd.isAvailable && !cmd.isAvailable()) continue
        e.preventDefault()
        void cmd.run()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}
