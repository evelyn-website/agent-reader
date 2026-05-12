import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AnnotationRow,
  CreateAnnotationInput,
  DocumentRow,
  ProjectDashboard,
  ProjectRow,
  UpdateAnnotationInput
} from '../main/db'
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
