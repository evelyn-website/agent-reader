import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'

const PERF = process.env.DEBUG_PDF_PERF === '1'
const perfLog = (msg: string): void => {
  if (PERF) console.log(`[pdf:perf:main] ${msg}`)
}
import {
  recordOpen,
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  recordProjectOpen,
  listRecentProjects,
  deleteProject,
  getProjectDashboard,
  getSearchIndex,
  putSearchIndex,
  type CreateAnnotationInput,
  type ProjectDashboard,
  type ProjectRow,
  type UpdateAnnotationInput
} from './db'
import { scanProjectPdfs, folderExists, flattenProjectFiles, type ProjectScan } from './project'

export function registerIpcHandlers(): void {
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('pdf:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('pdf:read', (_event, filePath: string) => {
    const t0 = performance.now()
    const data = readFileSync(filePath)
    const t1 = performance.now()
    const document = recordOpen({ path: filePath, data })
    const t2 = performance.now()
    perfLog(
      `pdf:read readFileSync=${(t1 - t0).toFixed(1)}ms ` +
        `recordOpen=${(t2 - t1).toFixed(1)}ms ` +
        `total=${(t2 - t0).toFixed(1)}ms bytes=${data.length}`
    )
    return { data, document }
  })

  ipcMain.handle('annotations:list', (_event, documentId: string) => {
    return listAnnotations(documentId)
  })

  ipcMain.handle('annotations:create', (_event, input: CreateAnnotationInput) => {
    return createAnnotation(input)
  })

  ipcMain.handle('annotations:update', (_event, id: string, patch: UpdateAnnotationInput) => {
    return updateAnnotation(id, patch)
  })

  ipcMain.handle('annotations:delete', (_event, id: string) => {
    deleteAnnotation(id)
    return null
  })

  ipcMain.handle('project:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('project:scan', (_event, path: string): ProjectScan => {
    const scan = scanProjectPdfs(path)
    recordProjectOpen({ path: scan.path, name: scan.name })
    return scan
  })

  ipcMain.handle('project:dashboard', (_event, scan: ProjectScan): ProjectDashboard => {
    return getProjectDashboard(flattenProjectFiles(scan.tree))
  })

  ipcMain.handle('searchIndex:get', (_event, documentId: string) => {
    return getSearchIndex(documentId)
  })

  ipcMain.handle('searchIndex:put', (_event, documentId: string, pageTexts: string[]) => {
    putSearchIndex(documentId, pageTexts)
    return null
  })

  ipcMain.handle('project:listRecent', (): ProjectRow[] => {
    const rows = listRecentProjects()
    const alive: ProjectRow[] = []
    for (const row of rows) {
      if (folderExists(row.path)) alive.push(row)
      else deleteProject(row.path)
    }
    return alive
  })
}
