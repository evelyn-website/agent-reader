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
  deleteAnnotation: vi.fn()
}))

import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import * as db from './db'
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
})
