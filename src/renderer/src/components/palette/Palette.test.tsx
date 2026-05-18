import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import Palette, { type PaletteSection } from './Palette'

interface Item {
  id: string
  label: string
}

const ITEMS: Item[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie' }
]

interface HarnessProps {
  onSelect?: (item: Item) => void
  onClose?: () => void
  onInputKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  initialQuery?: string
  sections?: PaletteSection<Item>[]
}

function Harness({
  onSelect = () => {},
  onClose = () => {},
  onInputKeyDown,
  initialQuery = '',
  sections
}: HarnessProps): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery)
  const effectiveSections: PaletteSection<Item>[] = sections ?? [{ label: null, items: ITEMS }]
  return (
    <Palette<Item>
      query={query}
      onQueryChange={setQuery}
      sections={effectiveSections}
      itemKey={(item) => item.id}
      renderItem={(item, ctx) => (
        <span data-testid={`row-${item.id}`} data-active={ctx.active}>
          {item.label}
        </span>
      )}
      onSelect={onSelect}
      onClose={onClose}
      onInputKeyDown={onInputKeyDown}
      placeholder="Type something…"
    />
  )
}

describe('Palette', () => {
  it('renders items and selects the first row by default', () => {
    render(<Harness />)
    expect(screen.getByTestId('row-a')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('row-b')).toHaveAttribute('data-active', 'false')
  })

  it('moves selection with arrow keys and wraps at edges', () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText('Type something…')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByTestId('row-b')).toHaveAttribute('data-active', 'true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByTestId('row-a')).toHaveAttribute('data-active', 'true')

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getByTestId('row-c')).toHaveAttribute('data-active', 'true')
  })

  it('Enter invokes onSelect for the active item', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const input = screen.getByPlaceholderText('Type something…')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith({ id: 'b', label: 'Bravo' })
  })

  it('Escape invokes onClose', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.keyDown(screen.getByPlaceholderText('Type something…'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking the backdrop invokes onClose', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.mouseDown(screen.getByTestId('palette-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking inside the dialog does not close', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('forwards unhandled key events to onInputKeyDown', () => {
    const onInputKeyDown = vi.fn()
    render(<Harness onInputKeyDown={onInputKeyDown} />)
    fireEvent.keyDown(screen.getByPlaceholderText('Type something…'), { key: 'Backspace' })
    expect(onInputKeyDown).toHaveBeenCalledTimes(1)
  })

  it('shows the empty message when there are no items', () => {
    render(<Harness sections={[{ label: null, items: [] }]} />)
    expect(screen.getByText('No results')).toBeInTheDocument()
  })

  it('renders section headers when sections have labels', () => {
    render(
      <Harness
        sections={[
          { label: 'Group One', items: [ITEMS[0]] },
          { label: 'Group Two', items: [ITEMS[1], ITEMS[2]] }
        ]}
      />
    )
    expect(screen.getByText('Group One')).toBeInTheDocument()
    expect(screen.getByText('Group Two')).toBeInTheDocument()
  })

  it('resets selection back to the first item when the query changes', () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText('Type something…')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByTestId('row-c')).toHaveAttribute('data-active', 'true')

    fireEvent.change(input, { target: { value: 'a' } })
    expect(screen.getByTestId('row-a')).toHaveAttribute('data-active', 'true')
  })
})
