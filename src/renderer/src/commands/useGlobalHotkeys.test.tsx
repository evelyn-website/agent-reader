import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CommandRegistryProvider,
  createCommandStore,
  useGlobalHotkeys,
  useRegisterCommand
} from './index'

function dispatch(opts: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', opts))
}

function Harness({ children }: { children?: React.ReactNode }): React.JSX.Element {
  useGlobalHotkeys()
  return <>{children}</>
}

describe('useGlobalHotkeys', () => {
  it('runs the matching command when a registered shortcut fires', () => {
    const store = createCommandStore()
    const run = vi.fn()
    function Registrar(): null {
      useRegisterCommand(
        { id: 'demo', title: 'Demo', section: 'File', shortcut: 'mod+shift+n', run },
        [run]
      )
      return null
    }

    render(
      <CommandRegistryProvider store={store}>
        <Harness>
          <Registrar />
        </Harness>
      </CommandRegistryProvider>
    )

    act(() => dispatch({ key: 'n', metaKey: true, shiftKey: true }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('skips unavailable commands and lets the event through', () => {
    const store = createCommandStore()
    const run = vi.fn()
    function Registrar(): null {
      useRegisterCommand(
        {
          id: 'demo',
          title: 'Demo',
          section: 'File',
          shortcut: 'mod+o',
          isAvailable: () => false,
          run
        },
        [run]
      )
      return null
    }

    render(
      <CommandRegistryProvider store={store}>
        <Harness>
          <Registrar />
        </Harness>
      </CommandRegistryProvider>
    )

    act(() => dispatch({ key: 'o', metaKey: true }))
    expect(run).not.toHaveBeenCalled()
  })

  it('ignores commands without a shortcut', () => {
    const store = createCommandStore()
    const run = vi.fn()
    function Registrar(): null {
      useRegisterCommand({ id: 'no-key', title: 'No Key', section: 'File', run }, [run])
      return null
    }

    render(
      <CommandRegistryProvider store={store}>
        <Harness>
          <Registrar />
        </Harness>
      </CommandRegistryProvider>
    )

    act(() => dispatch({ key: 'n', metaKey: true, shiftKey: true }))
    expect(run).not.toHaveBeenCalled()
  })
})
