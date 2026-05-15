import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const termInstances: Array<{
  open: ReturnType<typeof vi.fn>
  loadAddon: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  onData: (cb: (d: string) => void) => { dispose: () => void }
  unicode: { activeVersion: string }
  cols: number
  rows: number
}> = []

vi.mock('@xterm/xterm', () => {
  return {
    Terminal: vi.fn().mockImplementation(() => {
      const instance = {
        cols: 80,
        rows: 24,
        unicode: { activeVersion: '6' },
        open: vi.fn(),
        loadAddon: vi.fn(),
        focus: vi.fn(),
        dispose: vi.fn(),
        write: vi.fn(),
        onData: vi.fn(() => ({ dispose: vi.fn() }))
      }
      termInstances.push(instance)
      return instance
    })
  }
})

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() }))
}))
vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    onContextLoss: vi.fn(),
    dispose: vi.fn()
  }))
}))
vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: vi.fn().mockImplementation(() => ({ serialize: vi.fn(() => '') }))
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

class ResizeObserverStub {
  observe(): void {
    return
  }
  disconnect(): void {
    return
  }
}
;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub

import ChatTerminal from './ChatTerminal'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SerializeAddon } from '@xterm/addon-serialize'

describe('ChatTerminal', () => {
  beforeEach(() => {
    termInstances.length = 0
    vi.mocked(Terminal).mockImplementation(() => {
      const instance = {
        cols: 80,
        rows: 24,
        unicode: { activeVersion: '6' },
        open: vi.fn(),
        loadAddon: vi.fn(),
        focus: vi.fn(),
        dispose: vi.fn(),
        write: vi.fn(),
        onData: vi.fn(() => ({ dispose: vi.fn() }))
      }
      termInstances.push(instance)
      return instance as never
    })
    vi.mocked(FitAddon).mockImplementation(() => ({ fit: vi.fn() }) as never)
    vi.mocked(Unicode11Addon).mockImplementation(() => ({}) as never)
    vi.mocked(WebglAddon).mockImplementation(
      () => ({ onContextLoss: vi.fn(), dispose: vi.fn() }) as never
    )
    vi.mocked(SerializeAddon).mockImplementation(() => ({ serialize: vi.fn(() => '') }) as never)
  })

  it('attaches to the pty with terminal dimensions and writes pty data into the terminal', async () => {
    const attach = vi.mocked(window.api.chat.pty.attach)
    type DataHandler = (event: { sessionId: string; data: string }) => void
    const handlerRef: { current: DataHandler | null } = { current: null }
    vi.mocked(window.api.chat.pty.onData).mockImplementation((cb) => {
      handlerRef.current = cb as DataHandler
      return () => {}
    })

    render(<ChatTerminal sessionId="abc" />)

    await waitFor(() => {
      expect(attach).toHaveBeenCalledWith('abc', 80, 24)
    })

    handlerRef.current?.({ sessionId: 'abc', data: 'hello' })
    expect(termInstances[termInstances.length - 1].write).toHaveBeenCalledWith('hello')
  })

  it('detaches when the session changes', async () => {
    const detach = vi.mocked(window.api.chat.pty.detach)
    const { rerender } = render(<ChatTerminal sessionId="abc" />)
    await waitFor(() => {
      expect(window.api.chat.pty.attach).toHaveBeenCalled()
    })
    rerender(<ChatTerminal sessionId="def" />)
    await waitFor(() => {
      expect(detach).toHaveBeenCalledWith('abc')
    })
  })
})
