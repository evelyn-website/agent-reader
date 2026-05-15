import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('../db', () => ({
  getChatSession: vi.fn(),
  getDocument: vi.fn(),
  setChatSessionClaudeId: vi.fn(() => null)
}))

vi.mock('../chat/cwd', () => ({
  resolveSessionCwd: vi.fn(() => '/tmp')
}))

vi.mock('../chat/sessionIdChannel', () => ({
  reserveSessionId: vi.fn((sessionId: string) => ({
    filePath: `/tmp/agent-reader-test-${sessionId}.id`,
    release: vi.fn()
  }))
}))

vi.mock('../chat/jsonlHydrator', () => ({
  startJsonlHydrator: vi.fn(),
  stopJsonlHydrator: vi.fn(),
  adoptClaudeSessionId: vi.fn(),
  stopAllJsonlHydrators: vi.fn()
}))

vi.mock('../chat/broadcast', () => ({
  broadcastSessionsChanged: vi.fn()
}))

vi.mock('../chat/hookScript', () => ({
  getHookNodePath: vi.fn(() => 'node'),
  getHookScriptPath: vi.fn(() => '/tmp/hook.js')
}))

import { ChatPtyManager } from './manager'
import * as db from '../db'

interface FakePty {
  pid: number
  cols: number
  rows: number
  emitData: (data: string) => void
  emitExit: (exitCode: number) => void
  writes: string[]
  resized: Array<{ cols: number; rows: number }>
  killSignal: string | null
}

interface SpawnCall {
  file: string
  args: string[]
  opts: { cols?: number; rows?: number; env?: Record<string, string> }
}

function makeFakeSpawn(): {
  spawn: (file: string, args: string[], opts: { cols?: number; rows?: number }) => unknown
  ptys: FakePty[]
  calls: SpawnCall[]
} {
  const ptys: FakePty[] = []
  const calls: SpawnCall[] = []
  const spawn = (
    file: string,
    args: string[],
    opts: { cols?: number; rows?: number; env?: Record<string, string> }
  ): unknown => {
    calls.push({ file, args: [...args], opts })
    const dataEmitter = new EventEmitter()
    const exitEmitter = new EventEmitter()
    const fake: FakePty = {
      pid: 1000 + ptys.length,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      writes: [],
      resized: [],
      killSignal: null,
      emitData: (data: string) => dataEmitter.emit('data', data),
      emitExit: (exitCode: number) => exitEmitter.emit('exit', { exitCode })
    }
    const pty = {
      get pid() {
        return fake.pid
      },
      get cols() {
        return fake.cols
      },
      get rows() {
        return fake.rows
      },
      onData: (listener: (d: string) => void) => {
        dataEmitter.on('data', listener)
        return { dispose: () => dataEmitter.off('data', listener) }
      },
      onExit: (listener: (e: { exitCode: number }) => void) => {
        exitEmitter.on('exit', listener)
        return { dispose: () => exitEmitter.off('exit', listener) }
      },
      resize: (cols: number, rows: number) => {
        fake.cols = cols
        fake.rows = rows
        fake.resized.push({ cols, rows })
      },
      write: (data: string) => fake.writes.push(data),
      kill: (signal?: string) => {
        fake.killSignal = signal ?? 'SIGHUP'
      },
      clear: () => {},
      pause: () => {},
      resume: () => {}
    }
    ptys.push(fake)
    return pty
  }
  return { spawn: spawn as never, ptys, calls }
}

function makeWebContents(): {
  send: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  once: ReturnType<typeof vi.fn>
  events: Record<string, ((...args: unknown[]) => void)[]>
} {
  const events: Record<string, ((...args: unknown[]) => void)[]> = {}
  return {
    send: vi.fn(),
    isDestroyed: () => false,
    once: vi.fn((evt: string, cb: (...args: unknown[]) => void) => {
      events[evt] = events[evt] ?? []
      events[evt].push(cb)
    }),
    events
  }
}

describe('ChatPtyManager', () => {
  let manager: ChatPtyManager
  let spawnHarness: ReturnType<typeof makeFakeSpawn>

  beforeEach(() => {
    vi.useFakeTimers()
    spawnHarness = makeFakeSpawn()
    vi.mocked(db.getChatSession).mockReturnValue({
      id: 's1',
      scope_key: '/project',
      title: 't',
      origin_document_id: null,
      origin_page_number: null,
      origin_text_excerpt: null,
      claude_session_id: null,
      created_at: 0,
      updated_at: 0,
      last_message_at: null
    } as never)
    manager = new ChatPtyManager()
    manager.setSpawnForTesting(spawnHarness.spawn as never)
    manager.setBinaryResolverForTesting(() => '/usr/bin/claude')
  })

  afterEach(() => {
    manager.killAll()
    vi.useRealTimers()
  })

  it('spawns a pty on first attach and reuses it on subsequent attaches', () => {
    const wc1 = makeWebContents()
    const r1 = manager.attach('s1', wc1 as never, 100, 30)
    expect(r1.ok).toBe(true)
    expect(spawnHarness.ptys).toHaveLength(1)

    const wc2 = makeWebContents()
    manager.attach('s1', wc2 as never, 120, 32)
    expect(spawnHarness.ptys).toHaveLength(1)
    // resize should fire because dims changed
    expect(spawnHarness.ptys[0].resized).toContainEqual({ cols: 120, rows: 32 })
  })

  it('returns an error when claude binary cannot be found', () => {
    manager.setBinaryResolverForTesting(() => null)
    const wc = makeWebContents()
    const result = manager.attach('s1', wc as never, 80, 24)
    expect(result.ok).toBe(false)
  })

  it('forwards pty output to attached webContents and stops after detach', () => {
    const wc = makeWebContents()
    manager.attach('s1', wc as never, 80, 24)
    spawnHarness.ptys[0].emitData('hello')
    expect(wc.send).toHaveBeenCalledWith(
      'chat:pty:data',
      expect.objectContaining({ sessionId: 's1', data: 'hello' })
    )
    manager.detach('s1', wc as never)
    wc.send.mockClear()
    spawnHarness.ptys[0].emitData('after')
    expect(wc.send).not.toHaveBeenCalled()
  })

  it('write passes data through to the pty', () => {
    const wc = makeWebContents()
    manager.attach('s1', wc as never, 80, 24)
    manager.write('s1', 'abc')
    expect(spawnHarness.ptys[0].writes).toContain('abc')
  })

  it('interrupt writes 0x03', () => {
    const wc = makeWebContents()
    manager.attach('s1', wc as never, 80, 24)
    manager.interrupt('s1')
    expect(spawnHarness.ptys[0].writes).toContain('\x03')
  })

  it('kill removes the entry and signals the pty', () => {
    const wc = makeWebContents()
    manager.attach('s1', wc as never, 80, 24)
    manager.kill('s1')
    expect(spawnHarness.ptys[0].killSignal).toBe('SIGTERM')
    expect(manager.isActive('s1')).toBe(false)
  })

  it('reaps idle ptys with no subscribers past the timeout', () => {
    const wc = makeWebContents()
    manager.attach('s1', wc as never, 80, 24)
    manager.detach('s1', wc as never)
    const future = Date.now() + 11 * 60_000
    manager.reapIdle(future)
    expect(manager.isActive('s1')).toBe(false)
    expect(spawnHarness.ptys[0].killSignal).toBe('SIGTERM')
  })

  it('does not reap a pty that still has subscribers', () => {
    const wc = makeWebContents()
    manager.attach('s1', wc as never, 80, 24)
    const future = Date.now() + 11 * 60_000
    manager.reapIdle(future)
    expect(manager.isActive('s1')).toBe(true)
  })

  it('passes --settings JSON with a SessionStart hook and AGENT_READER_SESSION_ID_FILE env on first spawn', () => {
    const wc = makeWebContents()
    const result = manager.attach('s1', wc as never, 80, 24)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.resumed).toBe(false)

    const call = spawnHarness.calls[0]
    const settingsIdx = call.args.indexOf('--settings')
    expect(settingsIdx).toBeGreaterThanOrEqual(0)
    const settings = JSON.parse(call.args[settingsIdx + 1])
    expect(settings.hooks.SessionStart[0].hooks[0].type).toBe('command')
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('hook.js')

    expect(call.opts.env?.AGENT_READER_SESSION_ID_FILE).toMatch(/agent-reader-test-s1\.id$/)
    // No --resume on a fresh session.
    expect(call.args).not.toContain('--resume')
  })

  it('adds --resume <claudeId> when the session row already has a claude_session_id', () => {
    vi.mocked(db.getChatSession).mockReturnValueOnce({
      id: 's1',
      scope_key: '/project',
      title: 't',
      origin_document_id: null,
      origin_page_number: null,
      origin_text_excerpt: null,
      claude_session_id: 'resumed-uuid-7',
      created_at: 0,
      updated_at: 0,
      last_message_at: null
    } as never)
    const wc = makeWebContents()
    const result = manager.attach('s1', wc as never, 80, 24)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.resumed).toBe(true)

    const args = spawnHarness.calls[0].args
    const resumeIdx = args.indexOf('--resume')
    expect(resumeIdx).toBeGreaterThanOrEqual(0)
    expect(args[resumeIdx + 1]).toBe('resumed-uuid-7')
  })

  it('cleans up the entry when the pty exits on its own', () => {
    const wc = makeWebContents()
    manager.attach('s1', wc as never, 80, 24)
    spawnHarness.ptys[0].emitExit(0)
    expect(wc.send).toHaveBeenCalledWith(
      'chat:pty:exit',
      expect.objectContaining({ sessionId: 's1', exitCode: 0 })
    )
    expect(manager.isActive('s1')).toBe(false)
  })
})
