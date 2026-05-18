import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import type { Command } from './types'

export interface CommandStore {
  register: (cmd: Command) => void
  unregister: (id: string) => void
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => Command[]
  /** Look up a command by id without subscribing. */
  get: (id: string) => Command | undefined
}

export function createCommandStore(): CommandStore {
  const commands = new Map<string, Command>()
  const listeners = new Set<() => void>()
  let snapshot: Command[] = []

  function refresh(): void {
    snapshot = Array.from(commands.values())
    listeners.forEach((l) => l())
  }

  return {
    register(cmd: Command): void {
      const prev = commands.get(cmd.id)
      if (prev === cmd) return
      commands.set(cmd.id, cmd)
      refresh()
    },
    unregister(id: string): void {
      if (!commands.delete(id)) return
      refresh()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot(): Command[] {
      return snapshot
    },
    get(id: string): Command | undefined {
      return commands.get(id)
    }
  }
}

export const CommandRegistryContext = createContext<CommandStore | null>(null)

function useStore(): CommandStore {
  const store = useContext(CommandRegistryContext)
  if (!store) {
    throw new Error('Command registry hook used outside of <CommandRegistryProvider>')
  }
  return store
}

/**
 * Register a command for the lifetime of the calling component. Re-registers
 * (with fresh closures over `run`/`isAvailable`) whenever any item in `deps`
 * changes, mirroring `useEffect`.
 */
export function useRegisterCommand(cmd: Command, deps: React.DependencyList): void {
  const store = useStore()
  useEffect(
    () => {
      store.register(cmd)
      return () => store.unregister(cmd.id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, ...deps]
  )
}

export function useCommandRegistry(): Command[] {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function useCommandStore(): CommandStore {
  return useStore()
}
