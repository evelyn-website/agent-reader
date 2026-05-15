import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { pollDirForNewEntries } from './dirPoll'

const DEBUG = process.env.DEBUG_CHAT_PTY === '1'
const debug = (...args: unknown[]): void => {
  if (DEBUG) console.log('[chat:sessionId]', ...args)
}

const SUBDIR = 'chat-session-ids'

let baseDir: string | null = null
let stopDirPoll: (() => void) | null = null
let initialized = false
const pending = new Map<string, (claudeId: string) => void>()

function getBaseDir(): string {
  if (baseDir) return baseDir
  baseDir = join(app.getPath('userData'), SUBDIR)
  return baseDir
}

function ensureInitialized(): void {
  if (initialized) return
  initialized = true
  const dir = getBaseDir()
  mkdirSync(dir, { recursive: true })
  // Best-effort cleanup of stale id files from a previous app run.
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.id')) {
        try {
          rmSync(join(dir, name), { force: true })
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore — dir was just created
  }
  // fs.watch on a directory is unreliable on macOS — the kqueue/FSEvents
  // subscription wires up asynchronously, so the hook script writing the
  // .id file fast can race ahead of the watcher. Poll instead.
  // Baseline is empty because we just swept the dir clean above; any .id
  // file we observe from here on is a new hook write.
  stopDirPoll = pollDirForNewEntries({
    dir,
    suffix: '.id',
    baseline: new Set(),
    onNew: (filename) => {
      const ourSessionId = filename.slice(0, -3)
      const handler = pending.get(ourSessionId)
      if (!handler) return
      let raw: string
      try {
        raw = readFileSync(join(dir, filename), 'utf8').trim()
      } catch {
        return
      }
      if (!raw) return
      debug(`captured claude session id ${raw} for ${ourSessionId} via hook`)
      pending.delete(ourSessionId)
      handler(raw)
    }
  })
}

export interface SessionIdReservation {
  /** Absolute path passed to the hook via AGENT_READER_SESSION_ID_FILE. */
  filePath: string
  /** Releases the reservation (removes the file + pending handler). */
  release: () => void
}

/**
 * Reserve a destination file for the SessionStart hook to write claude's UUID
 * into. The handler fires at most once when the file appears.
 */
export function reserveSessionId(
  sessionId: string,
  onClaudeId: (claudeId: string) => void
): SessionIdReservation {
  ensureInitialized()
  const dir = getBaseDir()
  const filePath = join(dir, `${sessionId}.id`)
  // Clear any stale residue from a prior spawn of the same session id.
  try {
    rmSync(filePath, { force: true })
  } catch {
    // ignore
  }
  pending.set(sessionId, onClaudeId)
  return {
    filePath,
    release: () => {
      pending.delete(sessionId)
      try {
        rmSync(filePath, { force: true })
      } catch {
        // ignore
      }
    }
  }
}

export function shutdownSessionIdChannel(): void {
  pending.clear()
  if (stopDirPoll) {
    try {
      stopDirPoll()
    } catch {
      // ignore
    }
    stopDirPoll = null
  }
  initialized = false
  if (baseDir && existsSync(baseDir)) {
    try {
      for (const name of readdirSync(baseDir)) {
        if (name.endsWith('.id')) {
          try {
            rmSync(join(baseDir, name), { force: true })
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }
}
