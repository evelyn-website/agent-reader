import { spawn as spawnPty, type IPty } from '@lydell/node-pty'
import { existsSync, statSync } from 'fs'
import { delimiter, join } from 'path'
import type { WebContents } from 'electron'
import { getChatSession, setChatSessionClaudeId, getDocument, getSearchIndex, listAnnotations, getOutline } from '../db'
import { resolveSessionCwd } from '../chat/cwd'
import { reserveSessionId, type SessionIdReservation } from '../chat/sessionIdChannel'
import { adoptClaudeSessionId, startJsonlHydrator, stopJsonlHydrator } from '../chat/jsonlHydrator'
import { broadcastSessionsChanged } from '../chat/broadcast'
import { getHookNodePath, getHookScriptPath } from '../chat/hookScript'
import { buildMcpConfig } from '../mcp/config'
import { getDbPath } from '../db'

const DEBUG = process.env.DEBUG_CHAT_PTY === '1'
const debug = (...args: unknown[]): void => {
  if (DEBUG) console.log('[chat:pty]', ...args)
}

const IDLE_TIMEOUT_MS = 10 * 60_000
const REAPER_INTERVAL_MS = 60_000
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

interface PtyEntry {
  pty: IPty
  cwd: string
  subscribers: Set<WebContents>
  lastActivityAt: number
  cols: number
  rows: number
  sessionIdReservation: SessionIdReservation | null
}

export interface AttachResult {
  ok: true
  pid: number
  cols: number
  rows: number
  resumed: boolean
}

export interface AttachError {
  ok: false
  error: string
}

class ChatPtyManager {
  private entries = new Map<string, PtyEntry>()
  private reaperHandle: NodeJS.Timeout | null = null
  private spawnImpl: typeof spawnPty = spawnPty
  private claudeResolver: () => string | null = defaultResolveClaudeBinary

  // Hooks for tests
  setSpawnForTesting(impl: typeof spawnPty | null): void {
    this.spawnImpl = impl ?? spawnPty
  }
  setBinaryResolverForTesting(resolver: (() => string | null) | null): void {
    this.claudeResolver = resolver ?? defaultResolveClaudeBinary
  }

  attach(
    sessionId: string,
    webContents: WebContents,
    cols: number,
    rows: number
  ): AttachResult | AttachError {
    let entry = this.entries.get(sessionId)
    let resumed = false
    if (!entry) {
      const session = getChatSession(sessionId)
      if (!session) return { ok: false, error: `Session ${sessionId} not found` }
      const binary = this.claudeResolver()
      if (!binary) {
        return {
          ok: false,
          error: 'claude binary not found on PATH. Install with: npm i -g @anthropic-ai/claude-code'
        }
      }
      const cwd = resolveSessionCwd(session)
      const safeCols = sanitizeDim(cols, DEFAULT_COLS)
      const safeRows = sanitizeDim(rows, DEFAULT_ROWS)

      const reservation = reserveSessionId(sessionId, (claudeId) => {
        const updated = setChatSessionClaudeId(sessionId, claudeId)
        adoptClaudeSessionId(sessionId, claudeId)
        if (updated) broadcastSessionsChanged({ sessionId, scopeKey: updated.scope_key })
      })

      const env = buildSpawnEnv()
      env.AGENT_READER_SESSION_ID_FILE = reservation.filePath

      const settingsJson = buildSettingsJson()
      const args: string[] = ['--settings', settingsJson]
      const dbPath = getDbPath()
      if (dbPath) {
        const mcpConfig = buildMcpConfig({
          session,
          dbPath,
          electronExecPath: process.execPath
        })
        args.push('--mcp-config', mcpConfig)
      } else {
        debug('skipping --mcp-config: db path unknown (likely test harness)')
      }
      if (!session.claude_session_id) {
        args.push('--append-system-prompt', buildSystemPrompt(session))
      }
      if (session.claude_session_id) {
        args.unshift('--resume', session.claude_session_id)
        resumed = true
      }

      let pty: IPty
      debug(
        `spawning ${binary} cwd=${cwd} cols=${safeCols} rows=${safeRows} ` +
          `sessionId=${sessionId} resumed=${resumed} claudeId=${session.claude_session_id ?? '-'}`
      )
      try {
        pty = this.spawnImpl(binary, args, {
          name: 'xterm-256color',
          cols: safeCols,
          rows: safeRows,
          cwd,
          env
        })
      } catch (err) {
        console.error('[chat:pty] spawn failed', err)
        // always log spawn failures regardless of DEBUG flag
        reservation.release()
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to spawn claude'
        }
      }
      entry = {
        pty,
        cwd,
        subscribers: new Set(),
        lastActivityAt: Date.now(),
        cols: safeCols,
        rows: safeRows,
        sessionIdReservation: reservation
      }
      this.entries.set(sessionId, entry)

      startJsonlHydrator({
        ourSessionId: sessionId,
        cwd,
        claudeSessionId: session.claude_session_id,
        onClaudeIdDiscovered: (claudeId) => {
          const updated = setChatSessionClaudeId(sessionId, claudeId)
          if (updated) broadcastSessionsChanged({ sessionId, scopeKey: updated.scope_key })
        },
        onSessionChanged: () => {
          const live = getChatSession(sessionId)
          if (live) broadcastSessionsChanged({ sessionId, scopeKey: live.scope_key })
        }
      })

      debug(`spawned pid=${pty.pid} sessionId=${sessionId}`)
      let firstData = true
      pty.onData((data) => {
        if (firstData) {
          firstData = false
          debug(
            `first data sessionId=${sessionId} bytes=${data.length} subscribers=${
              this.entries.get(sessionId)?.subscribers.size ?? 0
            }`
          )
        }
        const live = this.entries.get(sessionId)
        if (!live) return
        live.lastActivityAt = Date.now()
        for (const wc of live.subscribers) {
          if (!wc.isDestroyed()) wc.send('chat:pty:data', { sessionId, data })
        }
      })
      pty.onExit(({ exitCode, signal }) => {
        debug(`exit sessionId=${sessionId} code=${exitCode} signal=${signal}`)
        const live = this.entries.get(sessionId)
        if (live) {
          for (const wc of live.subscribers) {
            if (!wc.isDestroyed()) wc.send('chat:pty:exit', { sessionId, exitCode, signal })
          }
          live.sessionIdReservation?.release()
          this.entries.delete(sessionId)
        }
        stopJsonlHydrator(sessionId)
      })
      this.startReaperIfNeeded()
    } else {
      const safeCols = sanitizeDim(cols, entry.cols)
      const safeRows = sanitizeDim(rows, entry.rows)
      if (safeCols !== entry.cols || safeRows !== entry.rows) {
        try {
          entry.pty.resize(safeCols, safeRows)
        } catch {
          // ignore
        }
        entry.cols = safeCols
        entry.rows = safeRows
      }
    }

    entry.subscribers.add(webContents)
    const onDestroyed = (): void => {
      const live = this.entries.get(sessionId)
      if (live) live.subscribers.delete(webContents)
    }
    webContents.once('destroyed', onDestroyed)

    return { ok: true, pid: entry.pty.pid, cols: entry.cols, rows: entry.rows, resumed }
  }

  detach(sessionId: string, webContents: WebContents): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    entry.subscribers.delete(webContents)
  }

  write(sessionId: string, data: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    entry.lastActivityAt = Date.now()
    entry.pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    const safeCols = sanitizeDim(cols, entry.cols)
    const safeRows = sanitizeDim(rows, entry.rows)
    if (safeCols === entry.cols && safeRows === entry.rows) return
    try {
      entry.pty.resize(safeCols, safeRows)
      entry.cols = safeCols
      entry.rows = safeRows
    } catch {
      // ignore transient resize failure (e.g. process exited)
    }
  }

  interrupt(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    entry.lastActivityAt = Date.now()
    entry.pty.write('\x03')
  }

  kill(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    this.entries.delete(sessionId)
    entry.sessionIdReservation?.release()
    stopJsonlHydrator(sessionId)
    forceKill(entry.pty)
  }

  killAll(): void {
    for (const [id, entry] of this.entries) {
      this.entries.delete(id)
      entry.sessionIdReservation?.release()
      stopJsonlHydrator(id)
      forceKill(entry.pty)
    }
    if (this.reaperHandle) {
      clearInterval(this.reaperHandle)
      this.reaperHandle = null
    }
  }

  isActive(sessionId: string): boolean {
    return this.entries.has(sessionId)
  }

  reapIdle(now = Date.now()): void {
    for (const [id, entry] of this.entries) {
      if (entry.subscribers.size > 0) continue
      if (now - entry.lastActivityAt < IDLE_TIMEOUT_MS) continue
      this.entries.delete(id)
      entry.sessionIdReservation?.release()
      stopJsonlHydrator(id)
      forceKill(entry.pty)
    }
  }

  private startReaperIfNeeded(): void {
    if (this.reaperHandle) return
    this.reaperHandle = setInterval(() => this.reapIdle(), REAPER_INTERVAL_MS)
    // Don't keep the event loop alive for the reaper
    if (typeof this.reaperHandle.unref === 'function') this.reaperHandle.unref()
  }
}

function sanitizeDim(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.max(1, Math.min(1000, Math.floor(value)))
}

function buildSettingsJson(): string {
  const command = `${shellEscape(getHookNodePath())} ${shellEscape(getHookScriptPath())}`
  return JSON.stringify({
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: 'command', command }]
        }
      ]
    }
  })
}

function buildSystemPrompt(session: {
  origin_document_id: string | null
  origin_page_number: number | null
}): string {
  const lines: string[] = [
    'You are running inside agent-reader, a PDF reading app.',
    'You have MCP tools for the open document:',
    '  • get_page / get_pages — read page text (call get_page({}) for the current page)',
    '  • search_text — search across all pages',
    '  • get_outline — table of contents with page numbers',
    '  • save_note / save_highlight — save findings as marks on the page',
    'When the user asks about document content, use these tools first rather than relying on general knowledge.',
  ]

  const docId = session.origin_document_id
  if (docId) {
    const doc = getDocument(docId)
    const pageTexts = getSearchIndex(docId)
    const annotations = listAnnotations(docId)
    const outline = getOutline(docId)

    const parts: string[] = []
    if (doc?.filename) parts.push(`Document: "${doc.filename}"`)
    if (pageTexts) parts.push(`${pageTexts.length} pages`)
    if (session.origin_page_number) parts.push(`current page: ${session.origin_page_number}`)

    const highlights = annotations.filter((a) => a.kind === 'highlight').length
    const notes = annotations.filter((a) => a.kind === 'note').length
    const markParts = [
      highlights > 0 ? `${highlights} highlight${highlights !== 1 ? 's' : ''}` : null,
      notes > 0 ? `${notes} note${notes !== 1 ? 's' : ''}` : null,
    ].filter(Boolean)
    parts.push(markParts.length > 0 ? markParts.join(', ') : 'no marks yet')

    lines.push(parts.join(' | '))

    if (outline && outline.length > 0) {
      const top = outline.slice(0, 8)
      const summary = top
        .map((n) => (n.pageNumber ? `${n.title} (p.${n.pageNumber})` : n.title))
        .join(' · ')
      lines.push(`Outline: ${summary}${outline.length > 8 ? ` … +${outline.length - 8} more` : ''}`)
    }
  }

  return lines.join('\n')
}

function shellEscape(arg: string): string {
  if (/^[A-Za-z0-9_\-./]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

function buildSpawnEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue
    if (key === 'ELECTRON_RUN_AS_NODE') continue
    out[key] = val
  }
  out.TERM = 'xterm-256color'
  out.COLORTERM = 'truecolor'
  out.FORCE_COLOR = '1'
  return out
}

function defaultResolveClaudeBinary(): string | null {
  const override = process.env.CLAUDE_BINARY_PATH
  if (override && isExecutable(override)) return override

  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  // Prepend common user-local install dirs that GUI Electron apps may miss
  const extras = [
    join(process.env.HOME ?? '', '.local/bin'),
    join(process.env.HOME ?? '', '.npm-global/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ].filter(Boolean)
  for (const dir of [...extras, ...pathEntries]) {
    const candidate = join(dir, 'claude')
    if (isExecutable(candidate)) return candidate
  }
  return null
}

function isExecutable(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

function forceKill(pty: IPty): void {
  try {
    pty.kill('SIGTERM')
  } catch {
    // ignore
  }
  const pid = pty.pid
  setTimeout(() => {
    try {
      process.kill(pid, 0)
      pty.kill('SIGKILL')
    } catch {
      // already gone
    }
  }, 2000).unref?.()
}

export const chatPtyManager = new ChatPtyManager()
export { ChatPtyManager }
