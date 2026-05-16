import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import { chatPtyManager } from './pty/manager'

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
  listChatSessions,
  createChatSession,
  updateChatSessionTitle,
  deleteChatSession,
  listChatMessages,
  recordProjectOpen,
  listRecentProjects,
  deleteProject,
  getProjectDashboard,
  getSearchIndex,
  putSearchIndex,
  getPageText,
  type CreateChatSessionInput,
  type CreateAnnotationInput,
  type ProjectDashboard,
  type ProjectRow,
  type UpdateAnnotationInput
} from './db'
import { scanProjectPdfs, folderExists, flattenProjectFiles, type ProjectScan } from './project'
import { writeActiveLocation, type ActiveLocation } from './mcp/activeLocation'

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

  ipcMain.handle('chat:sessions:list', (_event, scopeKey: string) => {
    return listChatSessions(scopeKey)
  })

  ipcMain.handle('chat:sessions:create', (_event, input: CreateChatSessionInput) => {
    return createChatSession(input)
  })

  ipcMain.handle('chat:sessions:updateTitle', (_event, id: string, title: string) => {
    return updateChatSessionTitle(id, title)
  })

  ipcMain.handle('chat:sessions:delete', (_event, id: string) => {
    chatPtyManager.kill(id)
    deleteChatSession(id)
    return null
  })

  ipcMain.handle('chat:messages:list', (_event, sessionId: string) => {
    return listChatMessages(sessionId)
  })

  ipcMain.handle('chat:pty:attach', (event, sessionId: string, cols: number, rows: number) => {
    return chatPtyManager.attach(sessionId, event.sender, cols, rows)
  })

  ipcMain.handle('chat:pty:detach', (event, sessionId: string) => {
    chatPtyManager.detach(sessionId, event.sender)
    return null
  })

  ipcMain.handle('chat:pty:write', (_event, sessionId: string, data: string) => {
    chatPtyManager.write(sessionId, data)
    return null
  })

  ipcMain.handle('chat:pty:resize', (_event, sessionId: string, cols: number, rows: number) => {
    chatPtyManager.resize(sessionId, cols, rows)
    return null
  })

  ipcMain.handle('chat:pty:interrupt', (_event, sessionId: string) => {
    chatPtyManager.interrupt(sessionId)
    return null
  })

  ipcMain.handle('chat:activeLocation:update', (_event, loc: ActiveLocation) => {
    writeActiveLocation(loc)
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
    return getProjectDashboard(scan.path, flattenProjectFiles(scan.tree))
  })

  ipcMain.handle('searchIndex:get', (_event, documentId: string) => {
    return getSearchIndex(documentId)
  })

  ipcMain.handle('searchIndex:put', (_event, documentId: string, pageTexts: string[]) => {
    putSearchIndex(documentId, pageTexts)
    return null
  })

  ipcMain.handle('db:getPageText', (_event, documentId: string, page: number) => {
    return getPageText(documentId, page)
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
