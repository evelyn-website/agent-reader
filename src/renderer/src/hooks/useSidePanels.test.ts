import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSidePanels } from './useSidePanels'

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width
  })
}

describe('useSidePanels', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setViewportWidth(1300)
  })

  it('exposes imperative panel/tab/focus-mode controls', () => {
    // Keyboard dispatch lives in the command registry now; this hook is a
    // pure state container surfaced as imperative methods that the App
    // registers as commands.
    const { result } = renderHook(() => useSidePanels())

    expect(result.current.leftOpen).toBe(true)
    expect(result.current.rightOpen).toBe(true)
    expect(result.current.leftTab).toBe('toc')
    expect(result.current.rightTab).toBe('chat')

    act(() => result.current.focusLeftTab('files'))
    expect(result.current.leftTab).toBe('files')
    expect(result.current.leftOpen).toBe(true)

    act(() => result.current.focusRightTab('marks'))
    expect(result.current.rightTab).toBe('marks')
    expect(result.current.rightOpen).toBe(true)

    act(() => result.current.toggleLeft())
    expect(result.current.leftOpen).toBe(false)

    act(() => result.current.toggleRight())
    expect(result.current.rightOpen).toBe(false)

    act(() => result.current.toggleFocusMode())
    expect(result.current.leftOpen).toBe(false)
    expect(result.current.rightOpen).toBe(false)

    // Second toggle restores the snapshot captured before entering focus mode.
    act(() => result.current.toggleFocusMode())
    expect(result.current.leftOpen).toBe(false)
    expect(result.current.rightOpen).toBe(false)
  })

  it('starts with the right panel collapsed when the viewport only fits one panel', () => {
    window.localStorage.setItem('agent-reader.sidePanel.left.width', '280')
    window.localStorage.setItem('agent-reader.sidePanel.right.width', '280')
    setViewportWidth(960)

    const { result } = renderHook(() => useSidePanels())

    expect(result.current.leftOpen).toBe(true)
    expect(result.current.rightOpen).toBe(false)
  })

  it('collapses open panels on resize when the document area would be too narrow', () => {
    window.localStorage.setItem('agent-reader.sidePanel.left.width', '280')
    window.localStorage.setItem('agent-reader.sidePanel.right.width', '280')
    const { result } = renderHook(() => useSidePanels())

    setViewportWidth(960)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(result.current.leftOpen).toBe(true)
    expect(result.current.rightOpen).toBe(false)

    setViewportWidth(700)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(result.current.leftOpen).toBe(false)
    expect(result.current.rightOpen).toBe(false)
  })
})
