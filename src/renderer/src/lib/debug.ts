type LogFn = (...args: unknown[]) => void

function readEnabled(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem('debug') ?? ''
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  } catch {
    return new Set()
  }
}

function isEnabled(namespace: string): boolean {
  const enabled = readEnabled()
  return enabled.has('*') || enabled.has(namespace)
}

export function createDebug(namespace: string): LogFn {
  const prefix = `[${namespace}]`
  return (...args: unknown[]): void => {
    if (isEnabled(namespace)) console.log(prefix, ...args)
  }
}
