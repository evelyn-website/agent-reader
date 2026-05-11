import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import {
  recordOpen,
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  recordProjectOpen,
  listRecentProjects,
  deleteProject,
  type CreateAnnotationInput,
  type ProjectRow,
  type UpdateAnnotationInput
} from './db'
import { scanProjectPdfs, folderExists, type ProjectScan } from './project'

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
    const data = readFileSync(filePath)
    const document = recordOpen({ path: filePath, data })
    return { data, document }
  })

  ipcMain.handle('annotations:list', (_event, documentId: string) => {
    return listAnnotations(documentId)
  })

  ipcMain.handle('annotations:create', (_event, input: CreateAnnotationInput) => {
    return createAnnotation(input)
  })

  ipcMain.handle(
    'annotations:update',
    (_event, id: string, patch: UpdateAnnotationInput) => {
      return updateAnnotation(id, patch)
    }
  )

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
