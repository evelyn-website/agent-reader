import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn()
  }
}))

vi.mock('fs', () => ({
  readFileSync: vi.fn()
}))

vi.mock('./db', () => ({
  recordOpen: vi.fn(),
  listAnnotations: vi.fn(),
  createAnnotation: vi.fn(),
  updateAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
  recordProjectOpen: vi.fn(),
  listRecentProjects: vi.fn(),
  deleteProject: vi.fn(),
  getProjectDashboard: vi.fn(),
  getSearchIndex: vi.fn(),
  putSearchIndex: vi.fn()
}))

vi.mock('./project', () => ({
  scanProjectPdfs: vi.fn(),
  folderExists: vi.fn(),
  flattenProjectFiles: vi.fn()
}))

import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import * as db from './db'
import * as project from './project'
import { registerIpcHandlers } from './ipc'

type HandlerFn = (_event: unknown, ...args: unknown[]) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`No handler registered for channel: ${channel}`)
  return call[1] as HandlerFn
}

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerIpcHandlers()
  })

  it('registers all expected channel names', () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch)
    expect(channels).toContain('pdf:open')
    expect(channels).toContain('pdf:read')
    expect(channels).toContain('annotations:list')
    expect(channels).toContain('annotations:create')
    expect(channels).toContain('annotations:update')
    expect(channels).toContain('annotations:delete')
    expect(channels).toContain('project:open')
    expect(channels).toContain('project:scan')
    expect(channels).toContain('project:dashboard')
    expect(channels).toContain('project:listRecent')
    expect(channels).toContain('searchIndex:get')
    expect(channels).toContain('searchIndex:put')
  })

  describe('pdf:open', () => {
    it('returns null when dialog is canceled', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })
      const result = await getHandler('pdf:open')({})
      expect(result).toBeNull()
    })

    it('returns the selected file path', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/path/to/file.pdf']
      })
      const result = await getHandler('pdf:open')({})
      expect(result).toBe('/path/to/file.pdf')
    })
  })

  describe('pdf:read', () => {
    it('reads file, records open, and returns data + document', () => {
      const fakeData = Buffer.from('pdf-bytes')
      const fakeDoc = { id: 'doc-1' }
      vi.mocked(readFileSync).mockReturnValue(fakeData)
      vi.mocked(db.recordOpen).mockReturnValue(fakeDoc as ReturnType<typeof db.recordOpen>)

      const result = getHandler('pdf:read')({}, '/file.pdf') as {
        data: Buffer
        document: unknown
      }
      expect(readFileSync).toHaveBeenCalledWith('/file.pdf')
      expect(db.recordOpen).toHaveBeenCalledWith({ path: '/file.pdf', data: fakeData })
      expect(result.data).toBe(fakeData)
      expect(result.document).toBe(fakeDoc)
    })
  })

  describe('annotations:list', () => {
    it('delegates to listAnnotations', () => {
      const fakeList = [{ id: 'ann-1' }]
      vi.mocked(db.listAnnotations).mockReturnValue(
        fakeList as ReturnType<typeof db.listAnnotations>
      )
      const result = getHandler('annotations:list')({}, 'doc-1')
      expect(db.listAnnotations).toHaveBeenCalledWith('doc-1')
      expect(result).toBe(fakeList)
    })
  })

  describe('annotations:create', () => {
    it('delegates to createAnnotation', () => {
      const input = { document_id: 'doc-1', page_number: 1, kind: 'highlight' as const }
      const fakeRow = { id: 'ann-1' }
      vi.mocked(db.createAnnotation).mockReturnValue(
        fakeRow as ReturnType<typeof db.createAnnotation>
      )
      const result = getHandler('annotations:create')({}, input)
      expect(db.createAnnotation).toHaveBeenCalledWith(input)
      expect(result).toBe(fakeRow)
    })
  })

  describe('annotations:update', () => {
    it('delegates to updateAnnotation', () => {
      const fakeRow = { id: 'ann-1', color: 'blue' }
      vi.mocked(db.updateAnnotation).mockReturnValue(
        fakeRow as ReturnType<typeof db.updateAnnotation>
      )
      const result = getHandler('annotations:update')({}, 'ann-1', { color: 'blue' })
      expect(db.updateAnnotation).toHaveBeenCalledWith('ann-1', { color: 'blue' })
      expect(result).toBe(fakeRow)
    })
  })

  describe('annotations:delete', () => {
    it('calls deleteAnnotation and returns null', () => {
      const result = getHandler('annotations:delete')({}, 'ann-1')
      expect(db.deleteAnnotation).toHaveBeenCalledWith('ann-1')
      expect(result).toBeNull()
    })
  })

  describe('project:open', () => {
    it('returns null when dialog is canceled', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })
      const result = await getHandler('project:open')({})
      expect(result).toBeNull()
    })

    it('returns the selected directory path', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/project']
      })
      const result = await getHandler('project:open')({})
      expect(dialog.showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] })
      expect(result).toBe('/project')
    })
  })

  describe('project:scan', () => {
    it('scans the project and records it as opened', () => {
      const scan = { path: '/project', name: 'project', tree: [] }
      vi.mocked(project.scanProjectPdfs).mockReturnValue(scan)
      const result = getHandler('project:scan')({}, '/project')
      expect(project.scanProjectPdfs).toHaveBeenCalledWith('/project')
      expect(db.recordProjectOpen).toHaveBeenCalledWith({ path: '/project', name: 'project' })
      expect(result).toBe(scan)
    })
  })

  describe('project:dashboard', () => {
    it('flattens project files and delegates to getProjectDashboard', () => {
      const scan = { path: '/project', name: 'project', tree: [] }
      const dashboard = { documents: [], resumeDocument: null, recentMarks: [] }
      vi.mocked(project.flattenProjectFiles).mockReturnValue(['/project/a.pdf'])
      vi.mocked(db.getProjectDashboard).mockReturnValue(dashboard)
      const result = getHandler('project:dashboard')({}, scan)
      expect(project.flattenProjectFiles).toHaveBeenCalledWith(scan.tree)
      expect(db.getProjectDashboard).toHaveBeenCalledWith(['/project/a.pdf'])
      expect(result).toBe(dashboard)
    })
  })

  describe('project:listRecent', () => {
    it('filters missing paths and deletes stale rows', () => {
      const rows = [
        { path: '/alive', name: 'alive', first_opened_at: 1, last_opened_at: 2, open_count: 1 },
        { path: '/missing', name: 'missing', first_opened_at: 1, last_opened_at: 2, open_count: 1 }
      ]
      vi.mocked(db.listRecentProjects).mockReturnValue(rows)
      vi.mocked(project.folderExists).mockImplementation((path) => path === '/alive')
      const result = getHandler('project:listRecent')({})
      expect(result).toEqual([rows[0]])
      expect(db.deleteProject).toHaveBeenCalledWith('/missing')
    })
  })

  describe('searchIndex:get', () => {
    it('delegates to getSearchIndex', () => {
      vi.mocked(db.getSearchIndex).mockReturnValue(['page'])
      const result = getHandler('searchIndex:get')({}, 'doc-1')
      expect(db.getSearchIndex).toHaveBeenCalledWith('doc-1')
      expect(result).toEqual(['page'])
    })
  })

  describe('searchIndex:put', () => {
    it('stores pages and returns null', () => {
      const result = getHandler('searchIndex:put')({}, 'doc-1', ['page'])
      expect(db.putSearchIndex).toHaveBeenCalledWith('doc-1', ['page'])
      expect(result).toBeNull()
    })
  })
})
