import { describe, expect, it } from 'vitest'
import { formatShortcutChips, matchEvent, parseShortcut } from './shortcut'

function keyEvent(opts: Partial<KeyboardEventInit>): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: '', ...opts })
}

describe('parseShortcut', () => {
  it('parses modifiers and the final key', () => {
    expect(parseShortcut('mod+shift+n')).toEqual({
      meta: true,
      shift: true,
      alt: false,
      ctrl: false,
      key: 'n'
    })
    expect(parseShortcut('mod+\\')).toMatchObject({ meta: true, key: '\\' })
    expect(parseShortcut('mod+.')).toMatchObject({ meta: true, key: '.' })
    expect(parseShortcut('ctrl+alt+enter')).toEqual({
      meta: false,
      shift: false,
      alt: true,
      ctrl: true,
      key: 'enter'
    })
  })

  it('throws on an empty spec', () => {
    expect(() => parseShortcut('')).toThrow()
  })
})

describe('matchEvent', () => {
  it('matches the literal key with required modifiers', () => {
    const spec = parseShortcut('mod+shift+n')
    expect(matchEvent(spec, keyEvent({ key: 'n', metaKey: true, shiftKey: true }))).toBe(true)
    expect(matchEvent(spec, keyEvent({ key: 'N', metaKey: true, shiftKey: true }))).toBe(true)
    expect(matchEvent(spec, keyEvent({ key: 'n', metaKey: true }))).toBe(false)
    expect(
      matchEvent(spec, keyEvent({ key: 'n', metaKey: true, shiftKey: true, altKey: true }))
    ).toBe(false)
  })

  it('treats shift+digit keys (! @ # …) as their digit equivalents', () => {
    const spec = parseShortcut('mod+shift+1')
    expect(matchEvent(spec, keyEvent({ key: '!', metaKey: true, shiftKey: true }))).toBe(true)
    expect(matchEvent(spec, keyEvent({ key: '1', metaKey: true, shiftKey: true }))).toBe(true)
  })

  it('rejects when modifiers do not exactly match', () => {
    const spec = parseShortcut('mod+o')
    expect(matchEvent(spec, keyEvent({ key: 'o', metaKey: true }))).toBe(true)
    expect(matchEvent(spec, keyEvent({ key: 'o' }))).toBe(false)
    expect(matchEvent(spec, keyEvent({ key: 'o', metaKey: true, ctrlKey: true }))).toBe(false)
  })
})

describe('formatShortcutChips', () => {
  it('renders glyphs for modifiers and uppercases letters', () => {
    expect(formatShortcutChips('mod+shift+p')).toEqual(['⌘', '⇧', 'P'])
    expect(formatShortcutChips('mod+\\')).toEqual(['⌘', '\\'])
    expect(formatShortcutChips('mod+shift+n')).toEqual(['⌘', '⇧', 'N'])
    expect(formatShortcutChips('mod+.')).toEqual(['⌘', '.'])
  })
})
