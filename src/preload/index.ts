import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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

export type ReadPdfResult = { data: Buffer; document: DocumentRow }

export type PtyAttachResult =
  | { ok: true; pid: number; cols: number; rows: number }
  | { ok: false; error: string }

export type PtyDataEvent = { sessionId: string; data: string }
export type PtyExitEvent = { sessionId: string; exitCode: number; signal?: number }

const api = {
  openPdf: (): Promise<string | null> => ipcRenderer.invoke('pdf:open'),
  readPdf: (filePath: string): Promise<ReadPdfResult> => ipcRenderer.invoke('pdf:read', filePath),
  annotations: {
    list: (documentId: string): Promise<AnnotationRow[]> =>
      ipcRenderer.invoke('annotations:list', documentId),
    create: (input: CreateAnnotationInput): Promise<AnnotationRow> =>
      ipcRenderer.invoke('annotations:create', input),
    update: (id: string, patch: UpdateAnnotationInput): Promise<AnnotationRow | null> =>
      ipcRenderer.invoke('annotations:update', id, patch),
    delete: (id: string): Promise<null> => ipcRenderer.invoke('annotations:delete', id)
  },
  chat: {
    sessions: {
      list: (scopeKey: string): Promise<ChatSessionSummary[]> =>
        ipcRenderer.invoke('chat:sessions:list', scopeKey),
      create: (input: CreateChatSessionInput): Promise<ChatSessionRow> =>
        ipcRenderer.invoke('chat:sessions:create', input),
      updateTitle: (id: string, title: string): Promise<ChatSessionRow | null> =>
        ipcRenderer.invoke('chat:sessions:updateTitle', id, title),
      delete: (id: string): Promise<null> => ipcRenderer.invoke('chat:sessions:delete', id)
    },
    messages: {
      list: (sessionId: string): Promise<ChatMessageRow[]> =>
        ipcRenderer.invoke('chat:messages:list', sessionId)
    },
    pty: {
      attach: (sessionId: string, cols: number, rows: number): Promise<PtyAttachResult> =>
        ipcRenderer.invoke('chat:pty:attach', sessionId, cols, rows),
      detach: (sessionId: string): Promise<null> =>
        ipcRenderer.invoke('chat:pty:detach', sessionId),
      write: (sessionId: string, data: string): Promise<null> =>
        ipcRenderer.invoke('chat:pty:write', sessionId, data),
      resize: (sessionId: string, cols: number, rows: number): Promise<null> =>
        ipcRenderer.invoke('chat:pty:resize', sessionId, cols, rows),
      interrupt: (sessionId: string): Promise<null> =>
        ipcRenderer.invoke('chat:pty:interrupt', sessionId),
      onData: (handler: (event: PtyDataEvent) => void): (() => void) => {
        const listener = (_e: Electron.IpcRendererEvent, payload: PtyDataEvent): void =>
          handler(payload)
        ipcRenderer.on('chat:pty:data', listener)
        return () => ipcRenderer.removeListener('chat:pty:data', listener)
      },
      onExit: (handler: (event: PtyExitEvent) => void): (() => void) => {
        const listener = (_e: Electron.IpcRendererEvent, payload: PtyExitEvent): void =>
          handler(payload)
        ipcRenderer.on('chat:pty:exit', listener)
        return () => ipcRenderer.removeListener('chat:pty:exit', listener)
      }
    }
  },
  project: {
    open: (): Promise<string | null> => ipcRenderer.invoke('project:open'),
    scan: (path: string): Promise<ProjectScan> => ipcRenderer.invoke('project:scan', path),
    dashboard: (scan: ProjectScan): Promise<ProjectDashboard> =>
      ipcRenderer.invoke('project:dashboard', scan),
    listRecent: (): Promise<ProjectRow[]> => ipcRenderer.invoke('project:listRecent')
  },
  searchIndex: {
    get: (documentId: string): Promise<string[] | null> =>
      ipcRenderer.invoke('searchIndex:get', documentId),
    put: (documentId: string, pageTexts: string[]): Promise<null> =>
      ipcRenderer.invoke('searchIndex:put', documentId, pageTexts)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
