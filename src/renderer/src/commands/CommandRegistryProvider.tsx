import { useState, type ReactNode } from 'react'
import { CommandRegistryContext, createCommandStore, type CommandStore } from './registry'

export default function CommandRegistryProvider({
  children,
  store
}: {
  children: ReactNode
  store?: CommandStore
}): React.JSX.Element {
  const [internal] = useState(() => store ?? createCommandStore())
  const value = store ?? internal
  return <CommandRegistryContext.Provider value={value}>{children}</CommandRegistryContext.Provider>
}
