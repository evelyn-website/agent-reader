import { useEffect, useRef } from 'react'
import type { UseSearchResult } from './useSearch'

interface SearchBarProps {
  search: UseSearchResult
  indexReady: boolean
}

export default function SearchBar({
  search,
  indexReady
}: SearchBarProps): React.JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (search.open) {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }
  }, [search.open])

  if (!search.open) return null

  const { query, matches, currentMatchIndex, matchesTruncated, caseSensitive, wholeWord } = search

  let status: string
  if (!indexReady) status = 'Indexing…'
  else if (query.length === 0) status = ''
  else if (matches.length === 0) status = 'No results'
  else status = `${currentMatchIndex + 1} / ${matches.length}${matchesTruncated ? '+' : ''}`

  return (
    <div className="search-bar" role="search">
      <input
        ref={inputRef}
        className="search-bar__input"
        type="text"
        placeholder="Find in document"
        value={query}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            search.closeSearch()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) search.prev()
            else search.next()
          }
        }}
      />
      <span className="search-bar__count">{status}</span>
      <button
        className="search-bar__btn"
        onClick={search.prev}
        disabled={matches.length === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        ↑
      </button>
      <button
        className="search-bar__btn"
        onClick={search.next}
        disabled={matches.length === 0}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        ↓
      </button>
      <button
        className={`search-bar__btn search-bar__toggle${caseSensitive ? ' search-bar__toggle--active' : ''}`}
        onClick={search.toggleCaseSensitive}
        title="Match case"
        aria-label="Match case"
        aria-pressed={caseSensitive}
      >
        Aa
      </button>
      <button
        className={`search-bar__btn search-bar__toggle${wholeWord ? ' search-bar__toggle--active' : ''}`}
        onClick={search.toggleWholeWord}
        title="Whole word"
        aria-label="Whole word"
        aria-pressed={wholeWord}
      >
        ab|
      </button>
      <button
        className="search-bar__btn search-bar__close"
        onClick={search.closeSearch}
        title="Close (Esc)"
        aria-label="Close search"
      >
        ×
      </button>
    </div>
  )
}
