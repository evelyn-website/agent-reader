import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SearchIndex } from './buildSearchIndex'

export interface SearchMatch {
  page: number
  start: number
  end: number
}

const MAX_MATCHES = 5000
const WORD_CHAR = /\w/

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isWordChar(s: string, idx: number): boolean {
  if (idx < 0 || idx >= s.length) return false
  return WORD_CHAR.test(s[idx])
}

export interface UseSearchResult {
  open: boolean
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  matches: SearchMatch[]
  currentMatchIndex: number
  matchesTruncated: boolean
  openSearch: () => void
  closeSearch: () => void
  setQuery: (q: string) => void
  toggleCaseSensitive: () => void
  toggleWholeWord: () => void
  next: () => void
  prev: () => void
  /** Per-page regex used by the customTextRenderer; null when no active query. */
  highlightRegex: RegExp | null
}

export function useSearch(
  index: SearchIndex | null,
  scrollToPage: (n: number) => void
): UseSearchResult {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  // Cursor is tagged with the matches key it was set against. When the key
  // doesn't match (matches just recomputed), currentMatchIndex falls back to
  // 0 — this avoids needing a setState-in-effect to reset on query changes.
  const [cursor, setCursor] = useState<{ key: string; index: number }>({ key: '', index: 0 })

  const matchesKey = `${query}|${caseSensitive}|${wholeWord}|${index?.numPages ?? 0}`
  const currentMatchIndex = cursor.key === matchesKey ? cursor.index : 0

  const matchesResult = useMemo<{ matches: SearchMatch[]; truncated: boolean }>(() => {
    if (!index || query.length === 0) return { matches: [], truncated: false }
    const needle = caseSensitive ? query : query.toLowerCase()
    const haystackArr = caseSensitive ? index.pageTexts : index.pageTextsLower
    // For whole-word boundary checks we must consult the un-lowered text — but
    // word-character classification is the same in either, so use lowered.
    const matches: SearchMatch[] = []
    let truncated = false
    outer: for (let p = 1; p <= index.numPages; p++) {
      const hay = haystackArr[p]
      if (!hay) continue
      let from = 0
      while (true) {
        const i = hay.indexOf(needle, from)
        if (i === -1) break
        const end = i + needle.length
        if (wholeWord) {
          const before = isWordChar(hay, i - 1)
          const after = isWordChar(hay, end)
          if (before || after) {
            from = i + 1
            continue
          }
        }
        matches.push({ page: p, start: i, end })
        if (matches.length >= MAX_MATCHES) {
          truncated = true
          break outer
        }
        from = end > i ? end : i + 1
      }
    }
    return { matches, truncated }
  }, [index, query, caseSensitive, wholeWord])

  const matches = matchesResult.matches

  // Auto-jump to the first match whenever a non-empty query produces matches.
  // We jump exactly when (query, flags, index) change; not on every arrow press
  // (those handle their own scrolling).
  const jumpedKeyRef = useRef<string>('')
  useEffect(() => {
    if (matches.length === 0) return
    if (jumpedKeyRef.current === matchesKey) return
    jumpedKeyRef.current = matchesKey
    scrollToPage(matches[0].page)
  }, [matches, matchesKey, scrollToPage])

  const openSearch = useCallback(() => setOpen(true), [])
  const closeSearch = useCallback(() => setOpen(false), [])
  const toggleCaseSensitive = useCallback(() => setCaseSensitive((v) => !v), [])
  const toggleWholeWord = useCallback(() => setWholeWord((v) => !v), [])

  const next = useCallback(() => {
    if (matches.length === 0) return
    const ni = (currentMatchIndex + 1) % matches.length
    setCursor({ key: matchesKey, index: ni })
    scrollToPage(matches[ni].page)
  }, [matches, currentMatchIndex, matchesKey, scrollToPage])

  const prev = useCallback(() => {
    if (matches.length === 0) return
    const ni = (currentMatchIndex - 1 + matches.length) % matches.length
    setCursor({ key: matchesKey, index: ni })
    scrollToPage(matches[ni].page)
  }, [matches, currentMatchIndex, matchesKey, scrollToPage])

  // Cmd+F to open. Esc handled inside the input (so it doesn't fire when bar is
  // closed and user is typing elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === 'f') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const highlightRegex = useMemo<RegExp | null>(() => {
    if (!open || query.length === 0) return null
    const flags = caseSensitive ? 'g' : 'gi'
    const body = wholeWord ? `\\b${escapeRegex(query)}\\b` : escapeRegex(query)
    try {
      return new RegExp(body, flags)
    } catch {
      return null
    }
  }, [open, query, caseSensitive, wholeWord])

  return {
    open,
    query,
    caseSensitive,
    wholeWord,
    matches,
    currentMatchIndex,
    matchesTruncated: matchesResult.truncated,
    openSearch,
    closeSearch,
    setQuery,
    toggleCaseSensitive,
    toggleWholeWord,
    next,
    prev,
    highlightRegex
  }
}
