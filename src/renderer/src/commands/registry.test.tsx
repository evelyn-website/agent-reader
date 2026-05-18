import { act, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import {
  CommandRegistryProvider,
  createCommandStore,
  useCommandRegistry,
  useRegisterCommand,
  type CommandStore
} from './index'
import type { Command } from './types'

function wrapper(store: CommandStore) {
  return function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <CommandRegistryProvider store={store}>{children}</CommandRegistryProvider>
  }
}

const baseCmd = (overrides: Partial<Command> = {}): Command => ({
  id: 'sample',
  title: 'Sample',
  section: 'File',
  run: vi.fn(),
  ...overrides
})

describe('CommandRegistry store', () => {
  it('registers, replaces, and unregisters commands', () => {
    const store = createCommandStore()
    expect(store.getSnapshot()).toEqual([])

    const a = baseCmd({ id: 'a', title: 'A' })
    const b = baseCmd({ id: 'b', title: 'B' })

    store.register(a)
    expect(store.getSnapshot().map((c) => c.id)).toEqual(['a'])

    store.register(b)
    expect(store.getSnapshot().map((c) => c.id)).toEqual(['a', 'b'])

    const replacement = baseCmd({ id: 'a', title: 'A v2' })
    store.register(replacement)
    expect(store.getSnapshot().find((c) => c.id === 'a')?.title).toBe('A v2')

    store.unregister('a')
    expect(store.getSnapshot().map((c) => c.id)).toEqual(['b'])
  })

  it('produces a new snapshot reference on change and reuses it otherwise', () => {
    const store = createCommandStore()
    const a = baseCmd({ id: 'a' })

    const beforeRegister = store.getSnapshot()
    store.register(a)
    const afterRegister = store.getSnapshot()
    expect(afterRegister).not.toBe(beforeRegister)

    // Identity-equal registration is a no-op and the snapshot stays stable.
    store.register(a)
    expect(store.getSnapshot()).toBe(afterRegister)
  })

  it('notifies subscribers on register/unregister only', () => {
    const store = createCommandStore()
    const listener = vi.fn()
    const off = store.subscribe(listener)

    store.register(baseCmd({ id: 'a' }))
    expect(listener).toHaveBeenCalledTimes(1)

    store.unregister('a')
    expect(listener).toHaveBeenCalledTimes(2)

    store.unregister('missing')
    expect(listener).toHaveBeenCalledTimes(2)

    off()
    store.register(baseCmd({ id: 'b' }))
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('useRegisterCommand / useCommandRegistry', () => {
  it('registers on mount, unregisters on unmount, re-registers on deps change', () => {
    const store = createCommandStore()

    function Subject({ title }: { title: string }): null {
      useRegisterCommand(
        {
          id: 'subject',
          title,
          section: 'File',
          run: () => {}
        },
        [title]
      )
      return null
    }

    const { rerender, unmount } = render(
      <CommandRegistryProvider store={store}>
        <Subject title="One" />
      </CommandRegistryProvider>
    )
    expect(store.getSnapshot().find((c) => c.id === 'subject')?.title).toBe('One')

    rerender(
      <CommandRegistryProvider store={store}>
        <Subject title="Two" />
      </CommandRegistryProvider>
    )
    expect(store.getSnapshot().find((c) => c.id === 'subject')?.title).toBe('Two')

    unmount()
    expect(store.getSnapshot().find((c) => c.id === 'subject')).toBeUndefined()
  })

  it('useCommandRegistry returns the live snapshot and re-renders on change', () => {
    const store = createCommandStore()
    const { result, rerender } = renderHook(() => useCommandRegistry(), {
      wrapper: wrapper(store)
    })
    expect(result.current).toEqual([])

    act(() => {
      store.register(baseCmd({ id: 'new', title: 'Hello' }))
    })
    rerender()
    expect(result.current.map((c) => c.id)).toEqual(['new'])
  })

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useCommandRegistry())).toThrow(
      /outside of <CommandRegistryProvider>/
    )
  })

  it('keeps run() closures fresh across re-renders even when deps are stable', () => {
    const store = createCommandStore()
    const runOne = vi.fn()
    const runTwo = vi.fn()

    function Subject(): React.JSX.Element {
      const [run, setRun] = useState<() => void>(() => runOne)
      useRegisterCommand(
        {
          id: 'subject',
          title: 'Subject',
          section: 'File',
          run
        },
        [run]
      )
      return (
        <button type="button" onClick={() => setRun(() => runTwo)}>
          swap
        </button>
      )
    }

    render(
      <CommandRegistryProvider store={store}>
        <Subject />
      </CommandRegistryProvider>
    )

    store.get('subject')?.run()
    expect(runOne).toHaveBeenCalledTimes(1)

    act(() => {
      document.querySelector('button')!.click()
    })

    store.get('subject')?.run()
    expect(runTwo).toHaveBeenCalledTimes(1)
    expect(runOne).toHaveBeenCalledTimes(1)
  })
})
