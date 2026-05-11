import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import {
  recordOpen,
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  type CreateAnnotationInput,
  type UpdateAnnotationInput
} from './db'

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
}
