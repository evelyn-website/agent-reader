/**
 * Subsequence fuzzy matcher. Returns `null` if `query` is not a subsequence
 * of `target`. Higher score = better match.
 *
 * Scoring (per character):
 * - +10 if the character matches the next char in `target` AND the previous
 *   char also matched (consecutive run bonus).
 * - +5 if the matched character sits at a word boundary (start of string, or
 *   preceded by whitespace, `/`, `_`, `-`, `.`).
 * - +1 base for any match.
 * - -1 per skipped character in `target` between matches.
 *
 * Tie-break callers should prefer shorter `target.length`.
 */
export interface FuzzyMatch {
  score: number
  indexes: number[]
}

const BOUNDARY = /[\s/_\-.\\]/

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, indexes: [] }
  if (query.length > target.length) return null

  const q = query.toLowerCase()
  const t = target.toLowerCase()

  const indexes: number[] = []
  let score = 0
  let qi = 0
  let lastMatchIdx = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue
    indexes.push(ti)

    let charScore = 1
    if (ti === 0) charScore += 5
    else if (BOUNDARY.test(t[ti - 1])) charScore += 5
    if (lastMatchIdx === ti - 1) charScore += 10

    const gap = lastMatchIdx === -1 ? 0 : ti - lastMatchIdx - 1
    score += charScore - gap

    lastMatchIdx = ti
    qi++
  }

  if (qi < q.length) return null
  return { score, indexes }
}

/**
 * Highlight matched character indexes inside `target` by splitting it into
 * runs of plain and matched substrings, suitable for rendering with `<mark>`.
 */
export interface HighlightSegment {
  text: string
  match: boolean
}

export function highlightSegments(target: string, indexes: number[]): HighlightSegment[] {
  if (indexes.length === 0) return [{ text: target, match: false }]
  const segments: HighlightSegment[] = []
  let cursor = 0
  for (let i = 0; i < indexes.length; ) {
    const start = indexes[i]
    let end = start
    while (i + 1 < indexes.length && indexes[i + 1] === end + 1) {
      end = indexes[i + 1]
      i++
    }
    if (cursor < start) segments.push({ text: target.slice(cursor, start), match: false })
    segments.push({ text: target.slice(start, end + 1), match: true })
    cursor = end + 1
    i++
  }
  if (cursor < target.length) segments.push({ text: target.slice(cursor), match: false })
  return segments
}
