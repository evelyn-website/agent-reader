import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSearch } from './useSearch'
import type { SearchIndex } from './buildSearchIndex'

function makeIndex(pages: Record<number, string>): SearchIndex {
  const numPages = Math.max(...Object.keys(pages).map(Number))
  const pageTexts: string[] = new Array(numPages + 1).fill('')
  const pageTextsLower: string[] = new Array(numPages + 1).fill('')
  for (const [p, text] of Object.entries(pages)) {
    pageTexts[Number(p)] = text
    pageTextsLower[Number(p)] = text.toLowerCase()
  }
  return { numPages, pageTexts, pageTextsLower }
}

const noop = vi.fn()

describe('useSearch — match finding', () => {
  it('returns empty matches when query is empty', () => {
    const index = makeIndex({ 1: 'hello world' })
    const { result } = renderHook(() => useSearch(index, noop))
    expect(result.current.matches).toHaveLength(0)
  })

  it('finds a simple case-insensitive match', async () => {
    const index = makeIndex({ 1: 'Hello World' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.setQuery('hello')
    })
    expect(result.current.matches).toHaveLength(1)
    expect(result.current.matches[0]).toEqual({ page: 1, start: 0, end: 5 })
  })

  it('respects case-sensitive flag', async () => {
    const index = makeIndex({ 1: 'Hello hello HELLO' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.setQuery('hello')
      result.current.toggleCaseSensitive()
    })
    expect(result.current.matches).toHaveLength(1)
    expect(result.current.matches[0].start).toBe(6)
  })

  it('finds matches across multiple pages', async () => {
    const index = makeIndex({ 1: 'foo bar', 2: 'baz foo', 3: 'nothing' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.setQuery('foo')
    })
    expect(result.current.matches).toHaveLength(2)
    expect(result.current.matches[0].page).toBe(1)
    expect(result.current.matches[1].page).toBe(2)
  })

  it('whole-word match skips substring hits', async () => {
    const index = makeIndex({ 1: 'foobar foo foo_bar' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.setQuery('foo')
      result.current.toggleWholeWord()
    })
    // 'foobar' — after: wordchar; 'foo' at index 7 — both sides non-word; 'foo_bar' — after: '_' is \w
    expect(result.current.matches).toHaveLength(1)
    expect(result.current.matches[0].start).toBe(7)
  })
})

describe('useSearch — navigation', () => {
  it('next advances the current match index', async () => {
    const index = makeIndex({ 1: 'a a a' })
    const scrollTo = vi.fn()
    const { result } = renderHook(() => useSearch(index, scrollTo))
    await act(async () => {
      result.current.setQuery('a')
    })
    expect(result.current.currentMatchIndex).toBe(0)
    await act(async () => {
      result.current.next()
    })
    expect(result.current.currentMatchIndex).toBe(1)
  })

  it('next wraps from last to first', async () => {
    const index = makeIndex({ 1: 'x x' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.setQuery('x')
    })
    await act(async () => {
      result.current.next()
    })
    await act(async () => {
      result.current.next()
    })
    expect(result.current.currentMatchIndex).toBe(0)
  })

  it('prev wraps from first to last', async () => {
    const index = makeIndex({ 1: 'y y y' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.setQuery('y')
    })
    await act(async () => {
      result.current.prev()
    })
    expect(result.current.currentMatchIndex).toBe(result.current.matches.length - 1)
  })

  it('resets cursor to 0 when query changes', async () => {
    const index = makeIndex({ 1: 'a a a b b' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.setQuery('a')
    })
    await act(async () => {
      result.current.next()
    })
    expect(result.current.currentMatchIndex).toBe(1)
    await act(async () => {
      result.current.setQuery('b')
    })
    expect(result.current.currentMatchIndex).toBe(0)
  })

  it('auto-scrolls to first match page on new query', async () => {
    const index = makeIndex({ 1: 'nothing', 2: 'target' })
    const scrollTo = vi.fn()
    const { result } = renderHook(() => useSearch(index, scrollTo))
    await act(async () => {
      result.current.setQuery('target')
    })
    expect(scrollTo).toHaveBeenCalledWith(2)
  })
})

describe('useSearch — highlightRegex', () => {
  it('returns null when search is closed', async () => {
    const index = makeIndex({ 1: 'hello' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.setQuery('hello')
    })
    expect(result.current.highlightRegex).toBeNull()
  })

  it('returns a regex when search is open with a non-empty query', async () => {
    const index = makeIndex({ 1: 'hello' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.openSearch()
      result.current.setQuery('hello')
    })
    expect(result.current.highlightRegex).toBeInstanceOf(RegExp)
    expect(result.current.highlightRegex!.test('hello')).toBe(true)
  })

  it('escapes regex special characters', async () => {
    const index = makeIndex({ 1: 'a.b' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.openSearch()
      result.current.setQuery('a.b')
    })
    const re = result.current.highlightRegex!
    expect(re.source).toContain('a\\.b')
    expect(re.test('axb')).toBe(false)
    expect(re.test('a.b')).toBe(true)
  })

  it('uses gi flags by default (case-insensitive, global)', async () => {
    const index = makeIndex({ 1: 'Hello' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.openSearch()
      result.current.setQuery('hello')
    })
    expect(result.current.highlightRegex!.flags).toContain('i')
    expect(result.current.highlightRegex!.flags).toContain('g')
  })

  it('uses g flag only when case-sensitive', async () => {
    const index = makeIndex({ 1: 'Hello' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.openSearch()
      result.current.setQuery('hello')
      result.current.toggleCaseSensitive()
    })
    const flags = result.current.highlightRegex!.flags
    expect(flags).toContain('g')
    expect(flags).not.toContain('i')
  })

  it('adds word boundary anchors when whole-word is on', async () => {
    const index = makeIndex({ 1: 'hello' })
    const { result } = renderHook(() => useSearch(index, noop))
    await act(async () => {
      result.current.openSearch()
      result.current.setQuery('hello')
      result.current.toggleWholeWord()
    })
    expect(result.current.highlightRegex!.source).toMatch(/\\b.*\\b/)
  })
})
