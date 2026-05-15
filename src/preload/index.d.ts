import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AnnotationRow,
  ChatMessageRow,
  ChatSessionRow,
  ChatSessionSummary,
  CreateChatSessionInput,
  CreateAnnotationInput,
  DocumentRow,
  ProjectDashboard,
  ProjectRow,
  UpdateAnnotationInput
} from '../shared/dbTypes'
import type { ProjectScan } from '../main/project'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openPdf: () => Promise<string | null>
      readPdf: (filePath: string) => Promise<{ data: Buffer; document: DocumentRow }>
      annotations: {
        list: (documentId: string) => Promise<AnnotationRow[]>
        create: (input: CreateAnnotationInput) => Promise<AnnotationRow>
        update: (id: string, patch: UpdateAnnotationInput) => Promise<AnnotationRow | null>
        delete: (id: string) => Promise<null>
      }
      chat: {
        sessions: {
          list: (scopeKey: string) => Promise<ChatSessionSummary[]>
          create: (input: CreateChatSessionInput) => Promise<ChatSessionRow>
          updateTitle: (id: string, title: string) => Promise<ChatSessionRow | null>
          delete: (id: string) => Promise<null>
        }
        messages: {
          list: (sessionId: string) => Promise<ChatMessageRow[]>
        }
        pty: {
          attach: (
            sessionId: string,
            cols: number,
            rows: number
          ) => Promise<
            { ok: true; pid: number; cols: number; rows: number } | { ok: false; error: string }
          >
          detach: (sessionId: string) => Promise<null>
          write: (sessionId: string, data: string) => Promise<null>
          resize: (sessionId: string, cols: number, rows: number) => Promise<null>
          interrupt: (sessionId: string) => Promise<null>
          onData: (handler: (event: { sessionId: string; data: string }) => void) => () => void
          onExit: (
            handler: (event: { sessionId: string; exitCode: number; signal?: number }) => void
          ) => () => void
        }
      }
      project: {
        open: () => Promise<string | null>
        scan: (path: string) => Promise<ProjectScan>
        dashboard: (scan: ProjectScan) => Promise<ProjectDashboard>
        listRecent: () => Promise<ProjectRow[]>
      }
      searchIndex: {
        get: (documentId: string) => Promise<string[] | null>
        put: (documentId: string, pageTexts: string[]) => Promise<null>
      }
    }
  }
}
