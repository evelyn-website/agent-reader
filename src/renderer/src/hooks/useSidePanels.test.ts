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

function pressMetaKey(key: string, shiftKey = false): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, shiftKey }))
}

describe('useSidePanels', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setViewportWidth(1300)
  })

  it('handles keyboard shortcuts for tabs, panel toggles, and focus mode', () => {
    const { result } = renderHook(() => useSidePanels())

    expect(result.current.leftOpen).toBe(true)
    expect(result.current.rightOpen).toBe(true)
    expect(result.current.leftTab).toBe('toc')
    expect(result.current.rightTab).toBe('chat')

    act(() => pressMetaKey('1'))
    expect(result.current.leftTab).toBe('files')
    expect(result.current.leftOpen).toBe(true)

    act(() => pressMetaKey('@', true))
    expect(result.current.rightTab).toBe('marks')
    expect(result.current.rightOpen).toBe(true)

    act(() => pressMetaKey('\\'))
    expect(result.current.leftOpen).toBe(false)

    act(() => pressMetaKey('\\', true))
    expect(result.current.rightOpen).toBe(false)

    act(() => pressMetaKey('b'))
    expect(result.current.leftOpen).toBe(false)
    expect(result.current.rightOpen).toBe(false)

    act(() => pressMetaKey('b'))
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
