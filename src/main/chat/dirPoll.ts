import { readdirSync } from 'fs'

export interface DirPollOptions {
  dir: string
  /** File suffix to match (e.g. ".jsonl", ".id"). */
  suffix: string
  /** Pre-existing entries to ignore. The caller owns the snapshot. */
  baseline: Set<string>
  /** Called once per newly observed entry. */
  onNew: (filename: string) => void
  /** Poll interval in ms. Defaults to 250ms to match the transcript watcher. */
  intervalMs?: number
}

/**
 * Polls a directory for newly appearing entries with a given suffix.
 *
 * We poll instead of using `fs.watch` because on macOS the kqueue/FSEvents
 * subscription is established asynchronously, so a file created immediately
 * after `watch(dir, …)` can be missed entirely. The transcript and
 * sessions-index watchers in this package work around the same issue by
 * using `watchFile` polling.
 *
 * Returns a stop function that clears the interval.
 */
export function pollDirForNewEntries(opts: DirPollOptions): () => void {
  const { dir, suffix, baseline, onNew, intervalMs = 250 } = opts
  const seen = new Set(baseline)
  const timer = setInterval(() => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (!name.endsWith(suffix)) continue
      if (seen.has(name)) continue
      seen.add(name)
      onNew(name)
    }
  }, intervalMs)
  // Don't keep the event loop alive just for this poller.
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}
