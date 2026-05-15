import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'fs'
import type Database from 'better-sqlite3'

import {
  createDb,
  setDbForTesting,
  createChatSession,
  listChatMessages,
  getChatSession
} from '../db'
import {
  startJsonlHydrator,
  stopJsonlHydrator,
  adoptClaudeSessionId,
  stopAllJsonlHydrators
} from './jsonlHydrator'
import { claudeProjectDir, claudeTranscriptPath } from './claudeProjectDir'

// Per-test sandbox cwd so each spec gets a fresh claudeProjectDir.
let sandboxCounter = 0
function freshSandboxCwd(): string {
  sandboxCounter += 1
  return `/tmp/agent-reader-hydrator-test-${process.pid}-${Date.now()}-${sandboxCounter}`
}

function transcriptLine(args: {
  uuid: string
  type: 'user' | 'assistant' | 'system'
  role?: string
  text?: string
  contentArray?: unknown
  ts?: string
}): string {
  const message =
    args.contentArray !== undefined
      ? { role: args.role ?? args.type, content: args.contentArray }
      : { role: args.role ?? args.type, content: args.text ?? '' }
  return (
    JSON.stringify({
      type: args.type,
      uuid: args.uuid,
      timestamp: args.ts ?? '2026-05-15T00:00:00.000Z',
      message
    }) + '\n'
  )
}

async function waitFor<T>(check: () => T | undefined | null | false, timeoutMs = 3000): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = check()
    if (v) return v as T
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('waitFor timed out')
}

describe('jsonlHydrator', () => {
  let db: Database.Database
  let projectDir: string
  let sandboxCwd: string

  beforeEach(() => {
    db = createDb(':memory:')
    setDbForTesting(db)
    sandboxCwd = freshSandboxCwd()
    projectDir = claudeProjectDir(sandboxCwd)
    mkdirSync(projectDir, { recursive: true })
  })

  afterEach(() => {
    stopAllJsonlHydrators()
    setDbForTesting(null)
    db.close()
    try {
      rmSync(projectDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('snapshot discovery: a new <uuid>.jsonl after start fires onClaudeIdDiscovered', async () => {
    const session = createChatSession({ scope_key: '/p' })
    const discovered = vi.fn()
    const changed = vi.fn()

    startJsonlHydrator({
      ourSessionId: session.id,
      cwd: sandboxCwd,
      claudeSessionId: null,
      onClaudeIdDiscovered: discovered,
      onSessionChanged: changed
    })

    // Create a transcript that didn't exist before start.
    const claudeId = 'claude-uuid-A'
    writeFileSync(
      claudeTranscriptPath(sandboxCwd, claudeId),
      transcriptLine({ uuid: 'm1', type: 'user', text: 'hi' })
    )

    await waitFor(() => discovered.mock.calls.length > 0)
    expect(discovered).toHaveBeenCalledWith(claudeId)
    await waitFor(() => changed.mock.calls.length > 0)

    const rows = listChatMessages(session.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ role: 'user', content: 'hi', jsonl_uuid: 'm1' })
  })

  it('snapshot ignores transcripts that existed before start (baseline)', async () => {
    const claudeId = 'claude-uuid-pre'
    writeFileSync(
      claudeTranscriptPath(sandboxCwd, claudeId),
      transcriptLine({ uuid: 'old', type: 'user', text: 'preexisting' })
    )
    const session = createChatSession({ scope_key: '/p' })
    const discovered = vi.fn()
    const changed = vi.fn()

    startJsonlHydrator({
      ourSessionId: session.id,
      cwd: sandboxCwd,
      claudeSessionId: null,
      onClaudeIdDiscovered: discovered,
      onSessionChanged: changed
    })

    // Trigger a watch event on the existing file by touching it (rewriting).
    appendFileSync(
      claudeTranscriptPath(sandboxCwd, claudeId),
      transcriptLine({ uuid: 'old-2', type: 'assistant', text: 'late append' })
    )
    await new Promise((r) => setTimeout(r, 150))

    expect(discovered).not.toHaveBeenCalled()
    expect(listChatMessages(session.id)).toHaveLength(0)
  })

  it('resume path: known claudeSessionId starts tailing immediately', async () => {
    const session = createChatSession({ scope_key: '/p' })
    const claudeId = 'claude-uuid-resume'
    const path = claudeTranscriptPath(sandboxCwd, claudeId)
    writeFileSync(
      path,
      transcriptLine({
        uuid: 'mA',
        type: 'user',
        text: 'first',
        ts: '2026-05-15T00:00:00.000Z'
      })
    )

    const changed = vi.fn()
    startJsonlHydrator({
      ourSessionId: session.id,
      cwd: sandboxCwd,
      claudeSessionId: claudeId,
      onSessionChanged: changed
    })

    await waitFor(() => listChatMessages(session.id).length > 0)
    expect(listChatMessages(session.id)[0].content).toBe('first')

    appendFileSync(
      path,
      transcriptLine({
        uuid: 'mB',
        type: 'assistant',
        contentArray: [{ type: 'text', text: 'second' }],
        ts: '2026-05-15T00:00:01.000Z'
      })
    )
    await waitFor(() => listChatMessages(session.id).length > 1)
    const rows = listChatMessages(session.id)
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ['user', 'first'],
      ['assistant', 'second']
    ])
  })

  it('ignores non-user/assistant entries and assistant entries with no text content', async () => {
    const session = createChatSession({ scope_key: '/p' })
    const claudeId = 'claude-uuid-skip'
    const path = claudeTranscriptPath(sandboxCwd, claudeId)
    writeFileSync(
      path,
      transcriptLine({ uuid: 's1', type: 'system', text: 'sys' }) +
        transcriptLine({
          uuid: 's2',
          type: 'assistant',
          contentArray: [{ type: 'thinking', thinking: '...' }]
        }) +
        transcriptLine({
          uuid: 's3',
          type: 'assistant',
          contentArray: [{ type: 'tool_use', name: 'bash' }]
        }) +
        transcriptLine({ uuid: 's4', type: 'user', text: 'kept' })
    )

    const changed = vi.fn()
    startJsonlHydrator({
      ourSessionId: session.id,
      cwd: sandboxCwd,
      claudeSessionId: claudeId,
      onSessionChanged: changed
    })

    await waitFor(() => listChatMessages(session.id).length > 0)
    const rows = listChatMessages(session.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ role: 'user', content: 'kept', jsonl_uuid: 's4' })
  })

  it('dedupes appended lines across multiple watcher fires', async () => {
    const session = createChatSession({ scope_key: '/p' })
    const claudeId = 'claude-uuid-dup'
    const path = claudeTranscriptPath(sandboxCwd, claudeId)
    writeFileSync(
      path,
      transcriptLine({ uuid: 'd1', type: 'user', text: 'one', ts: '2026-05-15T00:00:00.000Z' })
    )

    const changed = vi.fn()
    startJsonlHydrator({
      ourSessionId: session.id,
      cwd: sandboxCwd,
      claudeSessionId: claudeId,
      onSessionChanged: changed
    })
    await waitFor(() => listChatMessages(session.id).length > 0)

    // Restart hydrator (simulating an app restart on the same on-disk file).
    stopJsonlHydrator(session.id)
    startJsonlHydrator({
      ourSessionId: session.id,
      cwd: sandboxCwd,
      claudeSessionId: claudeId,
      onSessionChanged: changed
    })
    // Give watchFile a moment to capture its initial stat baseline before
    // appending; otherwise the append can race with watcher registration.
    await new Promise((r) => setTimeout(r, 350))
    appendFileSync(
      path,
      transcriptLine({
        uuid: 'd2',
        type: 'assistant',
        text: 'two',
        ts: '2026-05-15T00:00:01.000Z'
      })
    )
    await waitFor(() => listChatMessages(session.id).length > 1)

    expect(listChatMessages(session.id).map((r) => r.jsonl_uuid)).toEqual(['d1', 'd2'])
  })

  it('adoptClaudeSessionId switches the entry from snapshot discovery to direct tail', async () => {
    const session = createChatSession({ scope_key: '/p' })
    const changed = vi.fn()
    startJsonlHydrator({
      ourSessionId: session.id,
      cwd: sandboxCwd,
      claudeSessionId: null,
      onSessionChanged: changed
    })

    const claudeId = 'claude-uuid-hook'
    // hook channel "wins" — main calls adoptClaudeSessionId before snapshot fires.
    writeFileSync(
      claudeTranscriptPath(sandboxCwd, claudeId),
      transcriptLine({ uuid: 'h1', type: 'user', text: 'via hook' })
    )
    adoptClaudeSessionId(session.id, claudeId)

    await waitFor(() => listChatMessages(session.id).length > 0)
    expect(getChatSession(session.id)).not.toBeNull()
    expect(listChatMessages(session.id)[0].content).toBe('via hook')
  })
})
