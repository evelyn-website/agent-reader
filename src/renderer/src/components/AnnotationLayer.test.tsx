import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import AnnotationLayer from './AnnotationLayer'
import type { Annotation } from './useAnnotations'

function makeNote(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'note-1',
    documentId: 'doc-1',
    pageNumber: 1,
    kind: 'note',
    color: null,
    rects: null,
    anchor: { x: 100, y: 200 },
    textExcerpt: null,
    comment: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides
  }
}

function makeProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    annotations: [makeNote()],
    scale: 1,
    openId: null,
    openIsNew: false,
    onOpenChange: vi.fn(),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onMove: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

function mockLayerRect(pin: HTMLElement, rect: Partial<DOMRect> = {}): void {
  const layer = pin.closest('.annotation-layer') as HTMLElement
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 500,
    bottom: 1000,
    width: 500,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect
  } as DOMRect)
}

// Each act() call flushes React state so refs reflect the latest render.
// Splitting mousedown, mousemove, and mouseup into separate act() calls ensures
// dragRef.current is up-to-date when the mouseup handler reads it.
async function drag(
  pin: HTMLElement,
  move: { clientX: number; clientY: number },
  up: { clientX: number; clientY: number } = move
): Promise<void> {
  await act(async () => {
    fireEvent.mouseDown(pin, { button: 2 })
  })
  await act(async () => {
    fireEvent.mouseMove(window, move)
  })
  await act(async () => {
    fireEvent.mouseUp(window, up)
  })
}

afterEach(() => vi.restoreAllMocks())

describe('AnnotationLayer — note pin drag', () => {
  it('calls onMove with coordinates converted from client position', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined)
    const { getByRole } = render(<AnnotationLayer {...makeProps({ onMove })} />)
    const pin = getByRole('button', { name: 'Note' })
    mockLayerRect(pin, { left: 50, top: 50 })

    await drag(pin, { clientX: 250, clientY: 350 })

    // x = (250 - 50) / scale(1) = 200, y = (350 - 50) / scale(1) = 300
    expect(onMove).toHaveBeenCalledWith('note-1', 200, 300)
  })

  it('divides by scale when converting drag coordinates', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined)
    const { getByRole } = render(<AnnotationLayer {...makeProps({ onMove, scale: 2 })} />)
    const pin = getByRole('button', { name: 'Note' })
    mockLayerRect(pin)

    await drag(pin, { clientX: 200, clientY: 400 })

    // x = 200 / 2 = 100, y = 400 / 2 = 200
    expect(onMove).toHaveBeenCalledWith('note-1', 100, 200)
  })

  it('updates pin visual position during drag', async () => {
    const { getByRole } = render(<AnnotationLayer {...makeProps()} />)
    const pin = getByRole('button', { name: 'Note' })
    mockLayerRect(pin)

    await act(async () => {
      fireEvent.mouseDown(pin, { button: 2 })
    })
    await act(async () => {
      fireEvent.mouseMove(window, { clientX: 300, clientY: 400 })
    })

    expect(pin.style.left).toBe('300px')
    expect(pin.style.top).toBe('400px')

    await act(async () => {
      fireEvent.mouseUp(window)
    })
  })

  it('pin stays at drag position while onMove is pending (no flash)', async () => {
    let resolveMove!: () => void
    const onMove = vi.fn().mockReturnValue(
      new Promise<void>((r) => {
        resolveMove = r
      })
    )
    const { getByRole } = render(<AnnotationLayer {...makeProps({ onMove })} />)
    const pin = getByRole('button', { name: 'Note' })
    mockLayerRect(pin)

    await act(async () => {
      fireEvent.mouseDown(pin, { button: 2 })
    })
    await act(async () => {
      fireEvent.mouseMove(window, { clientX: 300, clientY: 400 })
    })
    await act(async () => {
      fireEvent.mouseUp(window)
    })

    // onMove in flight — pin must not snap back to anchor
    expect(pin.style.left).toBe('300px')
    expect(pin.style.top).toBe('400px')

    await act(async () => {
      resolveMove()
    })

    // Drag state cleared; pin reverts to annotation anchor coords
    expect(pin.style.left).toBe('100px')
    expect(pin.style.top).toBe('200px')
  })

  it('does not call onMove when left mouse button is pressed', async () => {
    const onMove = vi.fn()
    const { getByRole } = render(<AnnotationLayer {...makeProps({ onMove })} />)
    const pin = getByRole('button', { name: 'Note' })

    await act(async () => {
      fireEvent.mouseDown(pin, { button: 0 })
      fireEvent.mouseMove(window, { clientX: 300, clientY: 400 })
      fireEvent.mouseUp(window)
    })

    expect(onMove).not.toHaveBeenCalled()
  })

  it('left-click still calls onOpenChange', () => {
    const onOpenChange = vi.fn()
    const { getByRole } = render(<AnnotationLayer {...makeProps({ onOpenChange })} />)
    const pin = getByRole('button', { name: 'Note' })

    fireEvent.click(pin)

    expect(onOpenChange).toHaveBeenCalledWith('note-1')
  })

  it('right-click suppresses the browser context menu', () => {
    const { getByRole } = render(<AnnotationLayer {...makeProps()} />)
    const pin = getByRole('button', { name: 'Note' })

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    pin.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('applies annotation-pin--dragging class during drag and removes it after', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined)
    const { getByRole } = render(<AnnotationLayer {...makeProps({ onMove })} />)
    const pin = getByRole('button', { name: 'Note' })
    mockLayerRect(pin)

    await act(async () => {
      fireEvent.mouseDown(pin, { button: 2 })
    })
    expect(pin.classList.contains('annotation-pin--dragging')).toBe(true)

    await act(async () => {
      fireEvent.mouseUp(window)
    })
    expect(pin.classList.contains('annotation-pin--dragging')).toBe(false)
  })
})
