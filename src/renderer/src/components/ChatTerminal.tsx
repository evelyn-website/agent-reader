import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'

// Detached-but-still-running sessions snapshot their visible buffer here so a
// later remount can restore the TUI without waiting for claude to repaint.
const bufferCache = new Map<string, string>()

const DEBUG = import.meta.env.VITE_DEBUG_CHAT_PTY === '1'
const debug = (...args: unknown[]): void => {
  if (DEBUG) console.log('[chat-terminal]', ...args)
}

export interface ChatTerminalHandle {
  focus: () => void
}

interface Props {
  sessionId: string
}

const TERMINAL_THEME = {
  background: '#161618',
  foreground: '#e6e6e9',
  cursor: '#e6e6e9',
  cursorAccent: '#161618',
  selectionBackground: 'rgba(59, 130, 246, 0.35)'
}

const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

function ChatTerminalInner(
  { sessionId }: Props,
  ref: React.Ref<ChatTerminalHandle>
): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [error, setError] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    focus: () => termRef.current?.focus()
  }))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const term = new Terminal({
      allowProposedApi: true,
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      scrollback: 50_000,
      theme: TERMINAL_THEME,
      cursorBlink: true
    })
    termRef.current = term

    const unicode11 = new Unicode11Addon()
    term.loadAddon(unicode11)
    term.unicode.activeVersion = '11'

    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)

    const serialize = new SerializeAddon()
    term.loadAddon(serialize)

    term.open(container)
    queueMicrotask(() => term.focus())

    const cached = bufferCache.get(sessionId)
    if (cached) term.write(cached)

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // fall back to DOM renderer silently
    }

    try {
      fit.fit()
    } catch {
      // container may not have layout yet; ResizeObserver will catch up
    }

    const writeBanner = (msg: string): void => {
      term.write(`\r\n\x1b[33m${msg}\x1b[0m\r\n`)
    }

    let attached = false
    let exited = false
    const init = async (): Promise<void> => {
      debug('attaching', sessionId, term.cols, term.rows)
      const result = await window.api.chat.pty.attach(sessionId, term.cols, term.rows)
      debug('attach result', result)
      if (disposed) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      attached = true
    }
    void init()

    const onDataSub = term.onData((data) => {
      if (!attached) {
        debug('dropping keystroke (not yet attached)', data)
        return
      }
      void window.api.chat.pty.write(sessionId, data)
    })

    const offData = window.api.chat.pty.onData((event) => {
      if (event.sessionId !== sessionId) return
      debug('data', event.data.length, 'bytes')
      term.write(event.data)
    })
    const offExit = window.api.chat.pty.onExit((event) => {
      if (event.sessionId !== sessionId) return
      writeBanner(`[claude exited (code ${event.exitCode})]`)
      attached = false
      exited = true
      bufferCache.delete(sessionId)
    })

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        try {
          fit.fit()
          if (attached) {
            void window.api.chat.pty.resize(sessionId, term.cols, term.rows)
          }
        } catch {
          // ignore
        }
      }, 50)
    })
    observer.observe(container)

    return () => {
      disposed = true
      observer.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
      offData()
      offExit()
      onDataSub.dispose()
      if (!exited) {
        try {
          const snapshot = serialize.serialize({ scrollback: 1000 })
          if (snapshot) bufferCache.set(sessionId, snapshot)
        } catch {
          bufferCache.delete(sessionId)
        }
      }
      void window.api.chat.pty.detach(sessionId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  return (
    <div className="chat-terminal">
      {error && <div className="chat-tab__error">{error}</div>}
      <div className="chat-terminal__surface" ref={containerRef} />
    </div>
  )
}

export default forwardRef<ChatTerminalHandle, Props>(ChatTerminalInner)
