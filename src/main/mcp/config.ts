import type { ChatSessionRow } from '../../shared/dbTypes'
import { getActiveLocationFilePath } from './activeLocation'
import { getMcpServerScriptPath } from './serverScript'

export interface BuildMcpConfigInput {
  session: ChatSessionRow
  dbPath: string
  electronExecPath: string
  scriptPath?: string
  activeLocationFilePath?: string
  projectPath?: string | null
}

/**
 * Build the JSON blob passed to claude via `--mcp-config '<json>'`.
 * The server is invoked through Electron in Node mode so the bundled
 * better-sqlite3 binding is reused (no separate ABI to maintain).
 */
export function buildMcpConfig(input: BuildMcpConfigInput): string {
  const script = input.scriptPath ?? getMcpServerScriptPath()
  const activeLoc = input.activeLocationFilePath ?? getActiveLocationFilePath()
  return JSON.stringify({
    mcpServers: {
      'agent-reader': {
        type: 'stdio',
        command: input.electronExecPath,
        args: [script],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          AR_DB_PATH: input.dbPath,
          AR_ACTIVE_LOCATION_FILE: activeLoc,
          AR_SESSION_ORIGIN_DOC_ID: input.session.origin_document_id ?? '',
          AR_SESSION_ORIGIN_PAGE:
            input.session.origin_page_number !== null
              ? String(input.session.origin_page_number)
              : '',
          AR_PROJECT_PATH: input.projectPath ?? ''
        }
      }
    }
  })
}
