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
    }
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
