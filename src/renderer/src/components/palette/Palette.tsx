import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'

export interface PaletteSection<Item> {
  /** Section label; pass `null` for an ungrouped list (e.g. Quick Open). */
  label: string | null
  items: Item[]
}

export interface PaletteProps<Item> {
  query: string
  onQueryChange: (next: string) => void
  sections: PaletteSection<Item>[]
  renderItem: (item: Item, ctx: { active: boolean; index: number }) => ReactNode
  itemKey: (item: Item) => string
  onSelect: (item: Item) => void
  onClose: () => void
  /**
   * Called for any key not handled internally (Enter/Arrows/Esc). Lets the
   * host implement mode pivots like Backspace-on-empty.
   */
  onInputKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  placeholder: string
  /** Chip strings to render as `<kbd>` elements on the right of the input. */
  hintChips?: string[]
  emptyMessage?: string
  inputRef?: RefObject<HTMLInputElement | null>
}

export default function Palette<Item>({
  query,
  onQueryChange,
  sections,
  renderItem,
  itemKey,
  onSelect,
  onClose,
  onInputKeyDown,
  placeholder,
  hintChips,
  emptyMessage = 'No results',
  inputRef
}: PaletteProps<Item>): React.JSX.Element {
  const internalInputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections])
  const [selectedIndex, setSelectedIndex] = useState(0)
  // React docs pattern for "reset state when an input changes": compare during
  // render and call setState — React will re-render without committing.
  const [prevQuery, setPrevQuery] = useState(query)
  const [prevLength, setPrevLength] = useState(flatItems.length)
  if (prevQuery !== query || prevLength !== flatItems.length) {
    setPrevQuery(query)
    setPrevLength(flatItems.length)
    setSelectedIndex(0)
  }

  // Focus input on mount.
  useEffect(() => {
    const input = inputRef?.current ?? internalInputRef.current
    input?.focus()
    input?.select()
  }, [inputRef])

  // Scroll the active row into view as the user navigates.
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-palette-index="${selectedIndex}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIndex])

  const handleKey = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (flatItems.length === 0) return
        setSelectedIndex((i) => (i + 1) % flatItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (flatItems.length === 0) return
        setSelectedIndex((i) => (i - 1 + flatItems.length) % flatItems.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = flatItems[selectedIndex]
        if (item) onSelect(item)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      onInputKeyDown?.(e)
    },
    [flatItems, onClose, onInputKeyDown, onSelect, selectedIndex]
  )

  // Close on backdrop click (mousedown on backdrop, not container).
  const handleBackdropMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose]
  )

  let runningIndex = 0
  const body =
    flatItems.length === 0 ? (
      <div className="palette__empty">{emptyMessage}</div>
    ) : (
      <div className="palette__list" ref={listRef} role="listbox">
        {sections.map((section, sectionIdx) => (
          <div className="palette__section" key={section.label ?? `__nogroup-${sectionIdx}`}>
            {section.label !== null && (
              <div className="palette__section-header">{section.label}</div>
            )}
            {section.items.map((item) => {
              const index = runningIndex++
              const active = index === selectedIndex
              return (
                <div
                  key={itemKey(item)}
                  className={`palette__item${active ? ' palette__item--active' : ''}`}
                  data-palette-index={index}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onMouseDown={(e) => {
                    // mousedown (not click) so the input doesn't lose focus and
                    // dispatch the wrong key behaviour mid-blur.
                    e.preventDefault()
                    onSelect(item)
                  }}
                >
                  {renderItem(item, { active, index })}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )

  return createPortal(
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
      data-testid="palette-backdrop"
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={placeholder}
        ref={containerRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette__input-row">
          <input
            ref={(node) => {
              internalInputRef.current = node
              if (inputRef) {
                ;(inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node
              }
            }}
            type="text"
            className="palette__input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKey}
            spellCheck={false}
            autoComplete="off"
            aria-autocomplete="list"
          />
          {hintChips && hintChips.length > 0 && (
            <span className="palette__hint" aria-hidden="true">
              {hintChips.map((chip, i) => (
                <kbd key={i} className="palette__kbd">
                  {chip}
                </kbd>
              ))}
            </span>
          )}
        </div>
        <div className="palette__divider" />
        {body}
      </div>
    </div>,
    document.body
  )
}
