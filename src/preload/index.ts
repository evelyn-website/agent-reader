import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { DocumentRow } from '../main/db'

export type ReadPdfResult = { data: Buffer; document: DocumentRow }

const api = {
  openPdf: (): Promise<string | null> => ipcRenderer.invoke('pdf:open'),
  readPdf: (filePath: string): Promise<ReadPdfResult> => ipcRenderer.invoke('pdf:read', filePath)
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
