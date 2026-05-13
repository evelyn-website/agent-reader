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
        delete: vi.fn()
      },
      messages: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn()
      }
    },
    project: {
      open: vi.fn(),
      scan: vi.fn(),
      dashboard: vi
        .fn()
        .mockResolvedValue({ documents: [], resumeDocument: null, recentMarks: [] }),
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
