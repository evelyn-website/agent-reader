import { ElectronAPI } from '@electron-toolkit/preload'
import type { DocumentRow } from '../main/db'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openPdf: () => Promise<string | null>
      readPdf: (filePath: string) => Promise<{ data: Buffer; document: DocumentRow }>
    }
  }
}
