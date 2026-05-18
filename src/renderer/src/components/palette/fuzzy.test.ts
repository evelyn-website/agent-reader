import { describe, expect, it } from 'vitest'
import { fuzzyMatch, highlightSegments } from './fuzzy'

describe('fuzzyMatch', () => {
  it('returns the empty match when the query is empty', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indexes: [] })
  })

  it('returns null when no subsequence exists', () => {
    expect(fuzzyMatch('xyz', 'hello world')).toBeNull()
    expect(fuzzyMatch('longerquery', 'short')).toBeNull()
  })

  it('matches consecutive characters with the highest score', () => {
    const fast = fuzzyMatch('open', 'Open File')
    const slow = fuzzyMatch('open', 'Outline Pinned Examples Now')
    expect(fast).not.toBeNull()
    expect(slow).not.toBeNull()
    expect(fast!.score).toBeGreaterThan(slow!.score)
  })

  it('boosts matches that start at word boundaries', () => {
    const boundary = fuzzyMatch('p', 'Toggle Panel')!
    const midword = fuzzyMatch('p', 'Help')!
    expect(boundary.score).toBeGreaterThan(midword.score)
  })

  it('returns indexes into the target string', () => {
    const m = fuzzyMatch('hl', 'Highlight')
    expect(m?.indexes).toEqual([0, 4])
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('OPEN', 'open file')).not.toBeNull()
    expect(fuzzyMatch('open', 'OPEN FILE')).not.toBeNull()
  })
})

describe('highlightSegments', () => {
  it('returns a single non-match segment when there are no indexes', () => {
    expect(highlightSegments('hello', [])).toEqual([{ text: 'hello', match: false }])
  })

  it('coalesces consecutive index runs', () => {
    expect(highlightSegments('Highlight', [0, 4])).toEqual([
      { text: 'H', match: true },
      { text: 'igh', match: false },
      { text: 'l', match: true },
      { text: 'ight', match: false }
    ])
    expect(highlightSegments('Open File', [0, 1, 2, 3])).toEqual([
      { text: 'Open', match: true },
      { text: ' File', match: false }
    ])
  })
})
