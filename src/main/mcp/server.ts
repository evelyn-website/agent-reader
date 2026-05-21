// Agent Reader MCP server. Speaks newline-delimited JSON-RPC 2.0 over stdio
// (the MCP stdio transport). Reads from the same SQLite file the Electron
// app writes to (better-sqlite3 in WAL mode handles cross-process access)
// and writes Marks via the `annotations` table.
//
// Invoked by claude per-session. The Electron main process passes:
//   AR_DB_PATH                  absolute path to the SQLite file
//   AR_ACTIVE_LOCATION_FILE     JSON file the main process keeps current
//   AR_SESSION_ORIGIN_DOC_ID    document id where the session was created (may be empty)
//   AR_SESSION_ORIGIN_PAGE      page number where the session was created (may be empty)
//
// Bundled via `scripts/build-mcp-server.mjs` to `resources/mcp-server/index.js`
// and invoked under ELECTRON_RUN_AS_NODE=true so `require('better-sqlite3')`
// resolves the already-rebuilt Electron-Node binding instead of needing its
// own ABI.

import { existsSync, readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'

export const PROTOCOL_VERSION = '2024-11-05'

export interface ActiveLocation {
  documentId: string | null
  page: number | null
  docPath: string | null
}

export type AnchorInput = 'origin' | 'current' | { document_id: string; page: number }

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

export interface CreateServerOptions {
  db: Database.Database
  activeLocationPath: string | null
  originDocId: string | null
  originPage: number | null
  projectPath: string | null
}

export interface Server {
  handleMessage: (msg: unknown) => JsonRpcResponse | null
  handleToolCall: (name: string, args: unknown) => ToolResult
  TOOLS: typeof TOOLS
  PROTOCOL_VERSION: typeof PROTOCOL_VERSION
}

export const TOOLS = [
  {
    name: 'get_page',
    description:
      'Return the extracted text and marks of a single page from the active PDF. If page is omitted, returns the page the user is currently viewing. If document_id is omitted, uses the currently-focused document. Page numbers are 1-based. Returns { text, marks } where marks is an array of { id, kind, color, text_excerpt, comment }.',
    inputSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          description: '1-based page number; defaults to the page the user is currently viewing.'
        },
        document_id: {
          type: 'string',
          description: 'Optional document id; defaults to the currently-focused document.'
        }
      },
      required: []
    }
  },
  {
    name: 'get_pages',
    description:
      'Return the extracted text and marks of several pages. Each entry in the result has { page, text, marks } where marks is an array of { id, kind, color, text_excerpt, comment }. Pages with no text-layer index return null text.',
    inputSchema: {
      type: 'object',
      properties: {
        pages: { type: 'array', items: { type: 'integer' } },
        document_id: { type: 'string' }
      },
      required: ['pages']
    }
  },
  {
    name: 'search_text',
    description:
      'Case-insensitive substring search across the indexed pages of a document. Returns up to 50 matches with page numbers and short surrounding text snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        document_id: { type: 'string' }
      },
      required: ['query']
    }
  },
  {
    name: 'save_note',
    description:
      'Save a free-text note as a Mark on the underlying PDF. The note appears in the user\'s Marks panel. The anchor decides which page it lands on: "origin" pins it to the page the chat session began on, "current" pins it to whatever page the user is on right now, or pass an explicit { document_id, page }.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        anchor: {
          oneOf: [
            { type: 'string', enum: ['origin', 'current'] },
            {
              type: 'object',
              properties: {
                document_id: { type: 'string' },
                page: { type: 'integer' }
              },
              required: ['document_id', 'page']
            }
          ]
        }
      },
      required: ['content', 'anchor']
    }
  },
  {
    name: 'get_outline',
    description:
      'Return the table of contents / outline of a document as a nested tree of { title, page_number, children } entries. page_number is 1-based and may be null for entries whose destination could not be resolved. Returns an empty array if no outline is available.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Optional document id; defaults to the currently-focused document.'
        }
      },
      required: []
    }
  },
  {
    name: 'list_documents',
    description:
      'Return all documents that have been opened in the project. Each entry has { id, filename, last_path, open_count }. Use the id to reference a document in get_page, search_text, get_outline, etc.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'save_highlight',
    description:
      'Save a highlight as a Mark on the underlying PDF. Provide the highlighted text and choose an anchor ("origin", "current", or an explicit { document_id, page }). Optional color and note are stored on the highlight.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        anchor: {
          oneOf: [
            { type: 'string', enum: ['origin', 'current'] },
            {
              type: 'object',
              properties: {
                document_id: { type: 'string' },
                page: { type: 'integer' }
              },
              required: ['document_id', 'page']
            }
          ]
        },
        color: { type: 'string' },
        note: { type: 'string' }
      },
      required: ['text', 'anchor']
    }
  }
] as const

interface ResolvedAnchor {
  documentId: string
  page: number
}

interface InsertAnnotationInput {
  documentId: string
  page: number
  kind: 'note' | 'highlight'
  color?: string | null
  text_excerpt?: string | null
  comment?: string | null
  anchor_x?: number | null
  anchor_y?: number | null
}

// Default position for MCP-saved notes (PDF-point space, top-left corner area).
// User-placed notes set their own anchor via click; agent-placed notes get this.
const DEFAULT_NOTE_ANCHOR_X = 20
const DEFAULT_NOTE_ANCHOR_Y = 20

interface SearchIndexRow {
  pages_json: string
}

interface OutlineRow {
  outline_json: string
}

interface AnnotationRow {
  id: string
}

interface MarkRow {
  id: string
  kind: string
  color: string | null
  text_excerpt: string | null
  comment: string | null
}

interface DocumentRow {
  id: string
  filename: string
  last_path: string
  open_count: number
}

export function createServer(opts: CreateServerOptions): Server {
  const { db, activeLocationPath, originDocId, originPage, projectPath } = opts

  function readActiveLocation(): ActiveLocation | null {
    if (!activeLocationPath || !existsSync(activeLocationPath)) return null
    try {
      const raw = readFileSync(activeLocationPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ActiveLocation>
      return {
        documentId: typeof parsed.documentId === 'string' ? parsed.documentId : null,
        page: typeof parsed.page === 'number' ? parsed.page : null,
        docPath: typeof parsed.docPath === 'string' ? parsed.docPath : null
      }
    } catch {
      return null
    }
  }

  function resolveAnchor(anchor: unknown): ResolvedAnchor {
    if (anchor === 'origin') {
      if (!originDocId || !originPage) {
        throw new Error('No origin document/page is associated with this session.')
      }
      return { documentId: originDocId, page: originPage }
    }
    if (anchor === 'current') {
      const loc = readActiveLocation()
      if (!loc || !loc.documentId || !loc.page) {
        throw new Error('No document is currently open. Use "origin" or an explicit anchor.')
      }
      return { documentId: loc.documentId, page: loc.page }
    }
    if (anchor && typeof anchor === 'object') {
      const a = anchor as { document_id?: unknown; page?: unknown }
      if (typeof a.document_id !== 'string' || typeof a.page !== 'number') {
        throw new Error('Explicit anchor requires { document_id: string, page: integer }.')
      }
      return { documentId: a.document_id, page: a.page }
    }
    throw new Error('anchor must be "origin", "current", or { document_id, page }.')
  }

  function resolveDocumentId(explicit: unknown): string {
    if (typeof explicit === 'string' && explicit) return explicit
    const loc = readActiveLocation()
    if (loc && loc.documentId) return loc.documentId
    throw new Error('No document_id provided and no document is currently open.')
  }

  function getDocumentOutline(documentId: string): unknown[] {
    const row = db
      .prepare<[string], OutlineRow>(
        'SELECT outline_json FROM document_outlines WHERE document_id = ?'
      )
      .get(documentId)
    if (!row) return []
    try {
      const parsed = JSON.parse(row.outline_json) as unknown
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  function getSearchIndex(documentId: string): string[] | null {
    const row = db
      .prepare<
        [string],
        SearchIndexRow
      >('SELECT pages_json FROM search_indexes WHERE document_id = ?')
      .get(documentId)
    if (!row) return null
    try {
      const parsed = JSON.parse(row.pages_json) as unknown
      return Array.isArray(parsed) ? (parsed as string[]) : null
    } catch {
      return null
    }
  }

  function getPageMarks(documentId: string, page: number): MarkRow[] {
    return db
      .prepare<[string, number], MarkRow>(
        `SELECT id, kind, color, text_excerpt, comment
         FROM annotations
         WHERE document_id = ? AND page_number = ?
         ORDER BY created_at`
      )
      .all(documentId, page)
  }

  function insertAnnotation(input: InsertAnnotationInput): AnnotationRow {
    const id = randomUUID()
    const now = Date.now()
    const insertAnn = db.prepare(
      `INSERT INTO annotations
         (id, document_id, page_number, kind, color, rects_json,
          anchor_x, anchor_y, text_excerpt, comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    )
    const enqueue = db.prepare(
      `INSERT INTO mark_event_queue (id, document_id, created_at) VALUES (?, ?, ?)`
    )
    const tx = db.transaction(() => {
      insertAnn.run(
        id,
        input.documentId,
        input.page,
        input.kind,
        input.color ?? null,
        input.anchor_x ?? null,
        input.anchor_y ?? null,
        input.text_excerpt ?? null,
        input.comment ?? null,
        now,
        now
      )
      enqueue.run(id, input.documentId, now)
    })
    tx()
    return { id }
  }

  function textResult(text: string): ToolResult {
    return { content: [{ type: 'text', text }] }
  }

  function runTool(name: string, args: Record<string, unknown>): ToolResult {
    switch (name) {
      case 'get_page': {
        const docId = resolveDocumentId(args.document_id)
        const pages = getSearchIndex(docId)
        if (!pages) return textResult(`No text index available for document ${docId}.`)
        // pages_json is 1-indexed: pages[0] === '', pages[N] === text of PDF page N.
        const numPages = Math.max(0, pages.length - 1)
        let page: number
        if (args.page !== undefined && args.page !== null) {
          page = Number(args.page)
        } else {
          const loc = readActiveLocation()
          if (!loc?.page) {
            return textResult('No page specified and no document is currently open.')
          }
          page = loc.page
        }
        if (page < 1 || page > numPages) {
          return textResult(`Page ${page} is out of range (document has ${numPages} pages).`)
        }
        const marks = getPageMarks(docId, page)
        return textResult(JSON.stringify({ text: pages[page] || '', marks }))
      }
      case 'get_pages': {
        const docId = resolveDocumentId(args.document_id)
        const pages = getSearchIndex(docId)
        if (!pages) return textResult(`No text index available for document ${docId}.`)
        const numPages = Math.max(0, pages.length - 1)
        const requested = Array.isArray(args.pages) ? args.pages : []
        const out = requested.map((p) => {
          const n = Number(p)
          if (n < 1 || n > numPages) return { page: n, text: null, marks: [] }
          return { page: n, text: pages[n] || '', marks: getPageMarks(docId, n) }
        })
        return textResult(JSON.stringify(out))
      }
      case 'get_outline': {
        const docId = resolveDocumentId(args.document_id)
        const outline = getDocumentOutline(docId)
        return textResult(JSON.stringify(outline))
      }
      case 'search_text': {
        const docId = resolveDocumentId(args.document_id)
        const pages = getSearchIndex(docId)
        if (!pages) return textResult(`No text index available for document ${docId}.`)
        const q = String(args.query || '').toLowerCase()
        if (!q) return textResult('[]')
        const matches: Array<{ page: number; snippet: string }> = []
        for (let i = 1; i < pages.length && matches.length < 50; i++) {
          const page = pages[i] || ''
          const lower = page.toLowerCase()
          let pos = lower.indexOf(q)
          while (pos !== -1 && matches.length < 50) {
            const start = Math.max(0, pos - 40)
            const end = Math.min(page.length, pos + q.length + 40)
            matches.push({ page: i, snippet: page.slice(start, end) })
            pos = lower.indexOf(q, pos + q.length)
          }
        }
        return textResult(JSON.stringify(matches))
      }
      case 'list_documents': {
        const rows = projectPath
          ? db
              .prepare<[string, string], DocumentRow>(
                `SELECT id, filename, last_path, open_count
                 FROM documents
                 WHERE last_path = ? OR last_path LIKE ? ESCAPE '\\'
                 ORDER BY last_opened_at DESC`
              )
              .all(projectPath, projectPath.replace(/[%_\\]/g, '\\$&') + '/%')
          : db
              .prepare<[], DocumentRow>(
                `SELECT id, filename, last_path, open_count
                 FROM documents
                 ORDER BY last_opened_at DESC`
              )
              .all()
        return textResult(JSON.stringify(rows))
      }
      case 'save_note': {
        const { documentId, page } = resolveAnchor(args.anchor)
        const row = insertAnnotation({
          documentId,
          page,
          kind: 'note',
          comment: String(args.content || ''),
          anchor_x: DEFAULT_NOTE_ANCHOR_X,
          anchor_y: DEFAULT_NOTE_ANCHOR_Y
        })
        return textResult(`Saved note on page ${page} (id ${row.id}).`)
      }
      case 'save_highlight': {
        const { documentId, page } = resolveAnchor(args.anchor)
        const row = insertAnnotation({
          documentId,
          page,
          kind: 'highlight',
          color: typeof args.color === 'string' ? args.color : null,
          text_excerpt: String(args.text || ''),
          comment: typeof args.note === 'string' ? args.note : null
        })
        return textResult(`Saved highlight on page ${page} (id ${row.id}).`)
      }
      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  function handleToolCall(name: string, args: unknown): ToolResult {
    try {
      return runTool(name, (args as Record<string, unknown>) ?? {})
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text', text: 'Error: ' + message }],
        isError: true
      }
    }
  }

  function handleMessage(msg: unknown): JsonRpcResponse | null {
    if (!msg || typeof msg !== 'object') return null
    const m = msg as JsonRpcRequest
    if (m.jsonrpc !== '2.0') return null
    // Notifications have no id; we never respond.
    if (m.id === undefined) return null
    const id = m.id
    try {
      switch (m.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: 'agent-reader', version: '1.0.0' }
            }
          }
        case 'tools/list':
          return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
        case 'tools/call': {
          const params = (m.params as { name?: string; arguments?: unknown }) ?? {}
          return {
            jsonrpc: '2.0',
            id,
            result: handleToolCall(params.name ?? '', params.arguments)
          }
        }
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} }
        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: 'Method not found: ' + m.method }
          }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'Internal error: ' + message }
      }
    }
  }

  return { handleMessage, handleToolCall, TOOLS, PROTOCOL_VERSION }
}

// ---------- stdio entrypoint ----------
// When bundled by esbuild (CJS) and invoked directly, `require.main === module`.
// When imported as a library (e.g. from tests), the entrypoint block is skipped.

declare const require: NodeRequire
declare const module: NodeModule

if (require.main === module) {
  if (!process.env.AR_DB_PATH) {
    process.stderr.write('[agent-reader-mcp] AR_DB_PATH not set\n')
    process.exit(1)
  }
  let BetterSqlite3Ctor: typeof import('better-sqlite3')
  try {
    BetterSqlite3Ctor = require('better-sqlite3')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write('[agent-reader-mcp] failed to load better-sqlite3: ' + message + '\n')
    process.exit(1)
  }
  const db = new BetterSqlite3Ctor(process.env.AR_DB_PATH, { readonly: false })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const originPageRaw = process.env.AR_SESSION_ORIGIN_PAGE || ''
  const server = createServer({
    db,
    activeLocationPath: process.env.AR_ACTIVE_LOCATION_FILE || null,
    originDocId: process.env.AR_SESSION_ORIGIN_DOC_ID || null,
    originPage: originPageRaw ? Number(originPageRaw) : null,
    projectPath: process.env.AR_PROJECT_PATH || null
  })

  function send(msg: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(msg) + '\n')
  }

  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      const response = server.handleMessage(parsed)
      if (response) send(response)
    }
  })
  process.stdin.on('end', () => process.exit(0))
}
