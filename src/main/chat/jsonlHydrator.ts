import { existsSync, openSync, readSync, closeSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { upsertChatMessageFromJsonl, getChatSession, updateChatSessionTitleIfDefault } from '../db'
import { claudeProjectDir, claudeTranscriptPath } from './claudeProjectDir'
import { pollDirForNewEntries } from './dirPoll'

const DEBUG = process.env.DEBUG_CHAT_PTY === '1'
const debug = (...args: unknown[]): void => {
  if (DEBUG) console.log('[chat:jsonl]', ...args)
}

const SNAPSHOT_DISCOVERY_TIMEOUT_MS = 15_000
const SESSIONS_INDEX_FILENAME = 'sessions-index.json'
const TRANSCRIPT_POLL_INTERVAL_MS = 250
const SESSIONS_INDEX_POLL_INTERVAL_MS = 500

interface HydratorEntry {
  ourSessionId: string
  cwd: string
  claudeId: string | null
  byteOffset: number
  lineBuffer: string
  watchedPath: string | null
  /** Periodic tail() driver for the transcript file. */
  transcriptPollTimer: NodeJS.Timeout | null
  /** Stops the snapshot-discovery readdir poll. */
  stopDiscoveryPoll: (() => void) | null
  discoveryTimer: NodeJS.Timeout | null
  sessionsIndexPath: string | null
  /** Periodic poll for sessions-index.json title updates. */
  sessionsIndexPollTimer: NodeJS.Timeout | null
  sessionsIndexLastSize: number
  sessionsIndexLastMtimeMs: number
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
    transcriptPollTimer: null,
    stopDiscoveryPoll: null,
    discoveryTimer: null,
    sessionsIndexPath: null,
    sessionsIndexPollTimer: null,
    sessionsIndexLastSize: -1,
    sessionsIndexLastMtimeMs: -1,
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
  if (entry.transcriptPollTimer) {
    clearInterval(entry.transcriptPollTimer)
    entry.transcriptPollTimer = null
  }
  entry.watchedPath = null
  if (entry.sessionsIndexPollTimer) {
    clearInterval(entry.sessionsIndexPollTimer)
    entry.sessionsIndexPollTimer = null
  }
  entry.sessionsIndexPath = null
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
  debug(`snapshot baseline size=${baseline.size} dir=${dir}`)

  // fs.watch on a directory is unreliable on macOS — kqueue/FSEvents wires up
  // asynchronously, so a file created right after watch() can be missed.
  // Poll readdir instead, matching the watchFile callsites below.
  entry.stopDiscoveryPoll = pollDirForNewEntries({
    dir,
    suffix: '.jsonl',
    baseline,
    onNew: (filename) => {
      if (entry.claudeId) return
      const uuid = filename.slice(0, -'.jsonl'.length)
      debug(`captured claude session id ${uuid} via snapshot for ${entry.ourSessionId}`)
      entry.claudeId = uuid
      stopSnapshotDiscovery(entry)
      onClaudeIdDiscovered?.(uuid)
      attachTranscriptWatcher(entry)
    }
  })

  entry.discoveryTimer = setTimeout(() => {
    if (entry.claudeId) return
    debug(`snapshot discovery timeout for ${entry.ourSessionId}`)
    stopSnapshotDiscovery(entry)
  }, SNAPSHOT_DISCOVERY_TIMEOUT_MS)
}

function stopSnapshotDiscovery(entry: HydratorEntry): void {
  if (entry.stopDiscoveryPoll) {
    try {
      entry.stopDiscoveryPoll()
    } catch {
      // ignore
    }
    entry.stopDiscoveryPoll = null
  }
  if (entry.discoveryTimer) {
    clearTimeout(entry.discoveryTimer)
    entry.discoveryTimer = null
  }
}

function attachTranscriptWatcher(entry: HydratorEntry): void {
  const { claudeId } = entry
  if (!claudeId) return
  const path = claudeTranscriptPath(entry.cwd, claudeId)
  debug(`watching transcript ${path}`)
  // Backfill anything already on disk (covers --resume and the gap between
  // claude creating the file and our watcher attaching).
  tail(entry, path)
  // We drive the poll ourselves with setInterval rather than fs.watch /
  // watchFile, because both of those mechanisms take their baseline lazily
  // on macOS: an append landing between our synchronous tail() and the
  // watcher's first stat snapshot can be folded into the baseline and the
  // change event is then never delivered. tail() does its own statSync and
  // bails when size <= byteOffset, so always invoking it is correct.
  const timer = setInterval(() => tail(entry, path), TRANSCRIPT_POLL_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  entry.transcriptPollTimer = timer
  entry.watchedPath = path

  attachSessionsIndexWatcher(entry)
}

/**
 * Watch the per-project `sessions-index.json` that claude code maintains.
 * It contains a `summary` field for each session that claude has auto-titled
 * (e.g. "Fix message ordering via centralized sequence counter"). We adopt
 * that summary as the chat session title whenever the title is still the
 * default placeholder, so the Recent Sessions tray and dashboard pick up a
 * meaningful name automatically without any UI work from the user.
 */
function attachSessionsIndexWatcher(entry: HydratorEntry): void {
  const path = join(claudeProjectDir(entry.cwd), SESSIONS_INDEX_FILENAME)
  entry.sessionsIndexPath = path
  // Capture an initial size/mtime baseline so we can cheaply skip JSON parse
  // on poll cycles where nothing changed.
  recordSessionsIndexStat(entry, path)
  // Initial read covers the common case where claude already wrote the entry
  // before our watcher attached (e.g. --resume path, or a delayed mount).
  applySummaryFromSessionsIndex(entry)
  // Same reasoning as the transcript watcher: drive the poll ourselves to
  // avoid watchFile's lazy-baseline race window.
  const timer = setInterval(() => {
    if (sessionsIndexStatChanged(entry, path)) {
      applySummaryFromSessionsIndex(entry)
    }
  }, SESSIONS_INDEX_POLL_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  entry.sessionsIndexPollTimer = timer
}

function recordSessionsIndexStat(entry: HydratorEntry, path: string): void {
  try {
    const s = statSync(path)
    entry.sessionsIndexLastSize = s.size
    entry.sessionsIndexLastMtimeMs = s.mtimeMs
  } catch {
    entry.sessionsIndexLastSize = -1
    entry.sessionsIndexLastMtimeMs = -1
  }
}

function sessionsIndexStatChanged(entry: HydratorEntry, path: string): boolean {
  let size: number
  let mtimeMs: number
  try {
    const s = statSync(path)
    size = s.size
    mtimeMs = s.mtimeMs
  } catch {
    // File missing — treat as no change; we'll pick it up when it appears.
    if (entry.sessionsIndexLastSize === -1 && entry.sessionsIndexLastMtimeMs === -1) {
      return false
    }
    entry.sessionsIndexLastSize = -1
    entry.sessionsIndexLastMtimeMs = -1
    return false
  }
  if (size === entry.sessionsIndexLastSize && mtimeMs === entry.sessionsIndexLastMtimeMs) {
    return false
  }
  entry.sessionsIndexLastSize = size
  entry.sessionsIndexLastMtimeMs = mtimeMs
  return true
}

interface SessionsIndexEntry {
  sessionId?: string
  summary?: string
}
interface SessionsIndexFile {
  version?: number
  entries?: SessionsIndexEntry[]
}

function applySummaryFromSessionsIndex(entry: HydratorEntry): void {
  const { claudeId, sessionsIndexPath } = entry
  if (!claudeId || !sessionsIndexPath) return
  if (!existsSync(sessionsIndexPath)) return
  let parsed: SessionsIndexFile
  try {
    const raw = readFileSync(sessionsIndexPath, 'utf8')
    if (!raw.trim()) return
    parsed = JSON.parse(raw) as SessionsIndexFile
  } catch {
    // File may be mid-write; we'll see the next change event.
    return
  }
  const list = Array.isArray(parsed.entries) ? parsed.entries : []
  const match = list.find((e) => e?.sessionId === claudeId)
  const summary = match?.summary
  if (typeof summary !== 'string' || !summary.trim()) return
  if (applySummaryTitle(entry, summary)) entry.onSessionChanged()
}

/** Returns true if the title was actually changed in the DB. */
function applySummaryTitle(entry: HydratorEntry, summary: string): boolean {
  if (!getChatSession(entry.ourSessionId)) return false
  const result = updateChatSessionTitleIfDefault(entry.ourSessionId, summary)
  return !!result?.updated
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
  summary?: string
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
  // Older / alternate claude-code transcripts inline summaries as
  // {"type":"summary","summary":"...", ...} lines. Current versions instead
  // put the summary in sessions-index.json (see attachSessionsIndexWatcher),
  // but handling both keeps us robust to format changes either direction.
  if (parsed.type === 'summary') {
    if (typeof parsed.summary !== 'string') return false
    return applySummaryTitle(entry, parsed.summary)
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
