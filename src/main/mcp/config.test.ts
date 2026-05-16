import { describe, expect, it } from 'vitest'
import type { ChatSessionRow } from '../../shared/dbTypes'
import { buildMcpConfig } from './config'

function makeSession(overrides: Partial<ChatSessionRow> = {}): ChatSessionRow {
  return {
    id: 's1',
    scope_key: '/proj',
    title: 'New session',
    origin_document_id: null,
    origin_page_number: null,
    origin_text_excerpt: null,
    claude_session_id: null,
    created_at: 0,
    updated_at: 0,
    last_message_at: null,
    ...overrides
  }
}

describe('buildMcpConfig', () => {
  const base = {
    dbPath: '/tmp/db.sqlite',
    electronExecPath: '/path/to/electron',
    scriptPath: '/path/to/mcp-server/index.js',
    activeLocationFilePath: '/tmp/active-location.json'
  }

  it('produces an mcpServers block with the agent-reader stdio server', () => {
    const json = buildMcpConfig({ session: makeSession(), ...base })
    const parsed = JSON.parse(json)
    expect(parsed.mcpServers['agent-reader']).toMatchObject({
      type: 'stdio',
      command: '/path/to/electron',
      args: ['/path/to/mcp-server/index.js']
    })
  })

  it('passes ELECTRON_RUN_AS_NODE so better-sqlite3 binding resolves', () => {
    const json = buildMcpConfig({ session: makeSession(), ...base })
    const env = JSON.parse(json).mcpServers['agent-reader'].env
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('sets origin env vars when the session has an origin', () => {
    const json = buildMcpConfig({
      session: makeSession({ origin_document_id: 'doc-1', origin_page_number: 7 }),
      ...base
    })
    const env = JSON.parse(json).mcpServers['agent-reader'].env
    expect(env.AR_SESSION_ORIGIN_DOC_ID).toBe('doc-1')
    expect(env.AR_SESSION_ORIGIN_PAGE).toBe('7')
  })

  it('passes empty origin env vars when the session has no origin', () => {
    const json = buildMcpConfig({ session: makeSession(), ...base })
    const env = JSON.parse(json).mcpServers['agent-reader'].env
    expect(env.AR_SESSION_ORIGIN_DOC_ID).toBe('')
    expect(env.AR_SESSION_ORIGIN_PAGE).toBe('')
  })

  it('passes the active-location and db paths through env', () => {
    const json = buildMcpConfig({ session: makeSession(), ...base })
    const env = JSON.parse(json).mcpServers['agent-reader'].env
    expect(env.AR_DB_PATH).toBe('/tmp/db.sqlite')
    expect(env.AR_ACTIVE_LOCATION_FILE).toBe('/tmp/active-location.json')
  })
})
