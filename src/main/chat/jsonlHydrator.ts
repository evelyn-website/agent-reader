import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  watch,
  watchFile,
  unwatchFile,
  type FSWatcher
} from 'fs'
import { statSync } from 'fs'
import { upsertChatMessageFromJsonl, getChatSession } from '../db'
import { claudeProjectDir, claudeTranscriptPath } from './claudeProjectDir'

const DEBUG = process.env.DEBUG_CHAT_PTY === '1'
const debug = (...args: unknown[]): void => {
  if (DEBUG) console.log('[chat:jsonl]', ...args)
}

const SNAPSHOT_DISCOVERY_TIMEOUT_MS = 15_000

interface HydratorEntry {
  ourSessionId: string
  cwd: string
  claudeId: string | null
  byteOffset: number
  lineBuffer: string
  watchedPath: string | null
  dirWatcher: FSWatcher | null
  discoverySnapshot: Set<string> | null
  discoveryTimer: NodeJS.Timeout | null
  onSessionChanged: () => void
}

const entries = new Map<string, HydratorEntry>()

export interface StartHydratorArgs {
  ourSessionId: string
  cwd: string
  /** Set if known up front (resume path). Otherwise discovered via hook/snapshot. */
  claudeSessionId: string | null
  onClaudeIdDiscovered?: (claudeId: string) => void
  onSessionChanged: () => void
}

export function startJsonlHydrator(args: StartHydratorArgs): void {
  const existing = entries.get(args.ourSessionId)
  if (existing) {
    debug('hydrator already running for', args.ourSessionId)
    return
  }
  const entry: HydratorEntry = {
    ourSessionId: args.ourSessionId,
    cwd: args.cwd,
    claudeId: args.claudeSessionId,
    byteOffset: 0,
    lineBuffer: '',
    watchedPath: null,
    dirWatcher: null,
    discoverySnapshot: null,
    discoveryTimer: null,
    onSessionChanged: args.onSessionChanged
  }
  entries.set(args.ourSessionId, entry)

  if (args.claudeSessionId) {
    attachTranscriptWatcher(entry)
  } else {
    startSnapshotDiscovery(entry, args.onClaudeIdDiscovered)
  }
}

/** Called when the hook channel discovers the id first. */
export function adoptClaudeSessionId(ourSessionId: string, claudeId: string): void {
  const entry = entries.get(ourSessionId)
  if (!entry) return
  if (entry.claudeId) return
  entry.claudeId = claudeId
  stopSnapshotDiscovery(entry)
  attachTranscriptWatcher(entry)
}

export function stopJsonlHydrator(ourSessionId: string): void {
  const entry = entries.get(ourSessionId)
  if (!entry) return
  stopSnapshotDiscovery(entry)
  if (entry.watchedPath) {
    try {
      unwatchFile(entry.watchedPath)
    } catch {
      // ignore
    }
    entry.watchedPath = null
  }
  entries.delete(ourSessionId)
}

export function stopAllJsonlHydrators(): void {
  for (const id of [...entries.keys()]) stopJsonlHydrator(id)
}

function startSnapshotDiscovery(
  entry: HydratorEntry,
  onClaudeIdDiscovered?: (claudeId: string) => void
): void {
  const dir = claudeProjectDir(entry.cwd)
  let baseline: Set<string>
  try {
    baseline = new Set(readdirSync(dir).filter((n) => n.endsWith('.jsonl')))
  } catch {
    baseline = new Set()
  }
  entry.discoverySnapshot = baseline
  debug(`snapshot baseline size=${baseline.size} dir=${dir}`)

  try {
    entry.dirWatcher = watch(dir, (_event, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return
      const baselineSet = entry.discoverySnapshot
      if (!baselineSet || baselineSet.has(filename)) return
      const uuid = filename.slice(0, -'.jsonl'.length)
      if (entry.claudeId) return
      debug(`captured claude session id ${uuid} via snapshot for ${entry.ourSessionId}`)
      entry.claudeId = uuid
      stopSnapshotDiscovery(entry)
      onClaudeIdDiscovered?.(uuid)
      attachTranscriptWatcher(entry)
    })
  } catch (err) {
    debug('snapshot watcher failed', err)
  }

  entry.discoveryTimer = setTimeout(() => {
    if (entry.claudeId) return
    debug(`snapshot discovery timeout for ${entry.ourSessionId}`)
    stopSnapshotDiscovery(entry)
  }, SNAPSHOT_DISCOVERY_TIMEOUT_MS)
}

function stopSnapshotDiscovery(entry: HydratorEntry): void {
  if (entry.dirWatcher) {
    try {
      entry.dirWatcher.close()
    } catch {
      // ignore
    }
    entry.dirWatcher = null
  }
  if (entry.discoveryTimer) {
    clearTimeout(entry.discoveryTimer)
    entry.discoveryTimer = null
  }
  entry.discoverySnapshot = null
}

function attachTranscriptWatcher(entry: HydratorEntry): void {
  const { claudeId } = entry
  if (!claudeId) return
  const path = claudeTranscriptPath(entry.cwd, claudeId)
  debug(`watching transcript ${path}`)
  // Backfill anything already on disk (covers --resume and the gap between
  // claude creating the file and our watcher attaching).
  tail(entry, path)
  // fs.watch on a single file is unreliable on macOS; poll with watchFile
  // instead. 250ms interval is more than fast enough for a chat dashboard.
  watchFile(path, { interval: 250, persistent: false }, (curr, prev) => {
    if (curr.size === prev.size && curr.mtimeMs === prev.mtimeMs) return
    tail(entry, path)
  })
  entry.watchedPath = path
}

function tail(entry: HydratorEntry, path: string): void {
  if (!existsSync(path)) return
  let size: number
  try {
    size = statSync(path).size
  } catch {
    return
  }
  if (size <= entry.byteOffset) return
  const fd = openSync(path, 'r')
  try {
    const len = size - entry.byteOffset
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, entry.byteOffset)
    entry.byteOffset = size
    entry.lineBuffer += buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
  const lines = entry.lineBuffer.split('\n')
  entry.lineBuffer = lines.pop() ?? ''
  let mutated = false
  for (const raw of lines) {
    if (!raw.trim()) continue
    if (processLine(entry, raw)) mutated = true
  }
  if (mutated) entry.onSessionChanged()
}

interface JsonlEntry {
  type?: string
  uuid?: string
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
  }
}

function processLine(entry: HydratorEntry, raw: string): boolean {
  let parsed: JsonlEntry
  try {
    parsed = JSON.parse(raw) as JsonlEntry
  } catch {
    return false
  }
  if (parsed.type !== 'user' && parsed.type !== 'assistant') return false
  if (!parsed.uuid) return false
  if (!parsed.message) return false
  const role: 'user' | 'assistant' = parsed.type
  const content = extractText(parsed.message.content)
  if (!content) return false
  // Don't trust the session existing — it may have been deleted out from under us.
  if (!getChatSession(entry.ourSessionId)) return false
  const ts = parsed.timestamp ? Date.parse(parsed.timestamp) : Date.now()
  const createdAt = Number.isFinite(ts) ? ts : Date.now()
  const result = upsertChatMessageFromJsonl({
    session_id: entry.ourSessionId,
    jsonl_uuid: parsed.uuid,
    role,
    content,
    created_at: createdAt
  })
  return result.inserted
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content as Array<{ type?: string; text?: string }>) {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

export function __testing__getEntry(ourSessionId: string): unknown {
  return entries.get(ourSessionId)
}
