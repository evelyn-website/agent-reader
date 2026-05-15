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
