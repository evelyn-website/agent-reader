export interface ParsedShortcut {
  meta: boolean
  shift: boolean
  alt: boolean
  ctrl: boolean
  key: string
}

const SHIFTED_DIGITS: Record<string, string> = {
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0'
}

export function parseShortcut(spec: string): ParsedShortcut {
  const parts = spec
    .toLowerCase()
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  const key = parts.pop()
  if (!key) {
    throw new Error(`Invalid shortcut: ${spec}`)
  }
  return {
    meta: parts.includes('mod') || parts.includes('cmd') || parts.includes('meta'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('opt') || parts.includes('option'),
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    key
  }
}

export function matchEvent(spec: ParsedShortcut, e: KeyboardEvent): boolean {
  if (spec.meta !== e.metaKey) return false
  if (spec.shift !== e.shiftKey) return false
  if (spec.alt !== e.altKey) return false
  if (spec.ctrl !== e.ctrlKey) return false
  const k = e.key.toLowerCase()
  if (k === spec.key) return true
  if (SHIFTED_DIGITS[k] === spec.key) return true
  return false
}

/** Returns chip strings like ['⌘', '⇧', 'P'] suitable for `<kbd>` rendering. */
export function formatShortcutChips(spec: string): string[] {
  const parts = spec
    .toLowerCase()
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.map((p) => {
    switch (p) {
      case 'mod':
      case 'cmd':
      case 'meta':
        return '⌘'
      case 'shift':
        return '⇧'
      case 'alt':
      case 'opt':
      case 'option':
        return '⌥'
      case 'ctrl':
      case 'control':
        return '⌃'
      case 'enter':
      case 'return':
        return '↵'
      case 'backspace':
        return '⌫'
      case 'delete':
        return '⌦'
      case 'esc':
      case 'escape':
        return '⎋'
      case 'tab':
        return '⇥'
      case 'up':
        return '↑'
      case 'down':
        return '↓'
      case 'left':
        return '←'
      case 'right':
        return '→'
      case '\\':
        return '\\'
      default:
        return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)
    }
  })
}
