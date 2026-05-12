import { useState, useEffect, useCallback } from 'react'

const ZOOM_STEP = 0.1
const MIN_SCALE = 0.25
const MAX_SCALE = 4.0

export function useZoom(): {
  scale: number
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  zoomTo: (target: number) => void
  atMin: boolean
  atMax: boolean
} {
  const [scale, setScale] = useState(1.0)

  const zoomIn = useCallback(
    () => setScale((s) => Math.min(MAX_SCALE, parseFloat((s + ZOOM_STEP).toFixed(2)))),
    []
  )
  const zoomOut = useCallback(
    () => setScale((s) => Math.max(MIN_SCALE, parseFloat((s - ZOOM_STEP).toFixed(2)))),
    []
  )
  const zoomReset = useCallback(() => setScale(1.0), [])
  const zoomTo = useCallback(
    (target: number) =>
      setScale(parseFloat(Math.max(MIN_SCALE, Math.min(MAX_SCALE, target)).toFixed(2))),
    []
  )

  useEffect(() => {
    const handler = (_: unknown, code: string): void => {
      if (code === 'Equal') zoomIn()
      else if (code === 'Minus') zoomOut()
      else if (code === 'Digit0') zoomReset()
    }
    window.electron.ipcRenderer.on('zoom', handler)
    return () => {
      window.electron.ipcRenderer.removeListener('zoom', handler)
    }
  }, [zoomIn, zoomOut, zoomReset])

  return {
    scale,
    zoomIn,
    zoomOut,
    zoomReset,
    zoomTo,
    atMin: scale <= MIN_SCALE,
    atMax: scale >= MAX_SCALE
  }
}
