import { useCallback, useEffect, useState } from 'react'
import type { ProjectScan } from '../../../../main/project'
import CommandPaletteContent from './CommandPaletteContent'
import QuickOpenContent from './QuickOpenContent'

type Mode = 'command' | 'quickOpen' | null

interface PaletteHostProps {
  project: ProjectScan | null
  onOpenFile: (path: string) => void | Promise<void>
}

export default function PaletteHost({
  project,
  onOpenFile
}: PaletteHostProps): React.JSX.Element | null {
  const [mode, setMode] = useState<Mode>(null)

  const close = useCallback(() => setMode(null), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      if (e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        setMode('command')
        return
      }
      if (!e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        setMode('quickOpen')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (mode === 'command') {
    return <CommandPaletteContent onClose={close} onPivotToQuickOpen={() => setMode('quickOpen')} />
  }
  if (mode === 'quickOpen') {
    return <QuickOpenContent project={project} onOpenFile={onOpenFile} onClose={close} />
  }
  return null
}
