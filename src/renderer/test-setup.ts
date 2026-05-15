import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    openPdf: vi.fn(),
    readPdf: vi.fn(),
    annotations: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    chat: {
      sessions: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        updateTitle: vi.fn(),
        delete: vi.fn(),
        onChanged: vi.fn(() => () => {})
      },
      messages: {
        list: vi.fn().mockResolvedValue([])
      },
      pty: {
        attach: vi.fn().mockResolvedValue({
          ok: true,
          pid: 1,
          cols: 80,
          rows: 24,
          resumed: false
        }),
        detach: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue(null),
        resize: vi.fn().mockResolvedValue(null),
        interrupt: vi.fn().mockResolvedValue(null),
        onData: vi.fn(() => () => {}),
        onExit: vi.fn(() => () => {})
      }
    },
    project: {
      open: vi.fn(),
      scan: vi.fn(),
      dashboard: vi.fn().mockResolvedValue({
        documents: [],
        resumeDocument: null,
        recentMarks: [],
        recentSessions: []
      }),
      listRecent: vi.fn().mockResolvedValue([])
    },
    searchIndex: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(null)
    }
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
