import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AnnotationRow,
  CreateAnnotationInput,
  DocumentRow,
  UpdateAnnotationInput
} from '../main/db'

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
    }
  }
}
