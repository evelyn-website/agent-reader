import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectScan } from '../../../../main/project'
import PaletteHost from './PaletteHost'
import {
  CommandRegistryProvider,
  createCommandStore,
  useRegisterCommand,
  type CommandStore
} from '../../commands'

function Wrap({
  store,
  project,
  onOpenFile = vi.fn()
}: {
  store: CommandStore
  project: ProjectScan | null
  onOpenFile?: (path: string) => void | Promise<void>
}): React.JSX.Element {
  return (
    <CommandRegistryProvider store={store}>
      <PaletteHost project={project} onOpenFile={onOpenFile} />
    </CommandRegistryProvider>
  )
}

function RegistrarInner({ cmdId, run }: { cmdId: string; run: () => void }): null {
  useRegisterCommand({ id: cmdId, title: 'Show Demo', section: 'File', run }, [cmdId, run])
  return null
}

function Registrar({
  store,
  cmdId = 'demo',
  run
}: {
  store: CommandStore
  cmdId?: string
  run: () => void
}): React.JSX.Element {
  return (
    <CommandRegistryProvider store={store}>
      <RegistrarInner cmdId={cmdId} run={run} />
    </CommandRegistryProvider>
  )
}

function dispatch(opts: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', opts))
}

const sampleProject: ProjectScan = {
  path: '/proj',
  name: 'Proj',
  tree: [
    { kind: 'file', name: 'alpha.pdf', path: '/proj/alpha.pdf' },
    {
      kind: 'dir',
      name: 'sub',
      path: '/proj/sub',
      children: [{ kind: 'file', name: 'beta.pdf', path: '/proj/sub/beta.pdf' }]
    }
  ]
}

describe('PaletteHost', () => {
  it('renders nothing when no palette is open', () => {
    const store = createCommandStore()
    render(<Wrap store={store} project={null} />)
    expect(screen.queryByTestId('palette-backdrop')).toBeNull()
  })

  it('opens the command palette on Cmd+Shift+P and lists registered commands', () => {
    const store = createCommandStore()
    const run = vi.fn()
    render(
      <>
        <Registrar store={store} run={run} />
        <Wrap store={store} project={null} />
      </>
    )

    act(() => dispatch({ key: 'p', metaKey: true, shiftKey: true }))

    expect(screen.getByPlaceholderText('Type a command…')).toBeInTheDocument()
    expect(screen.getByText('Show Demo')).toBeInTheDocument()
  })

  it('opens Quick Open on Cmd+P and shows project files', () => {
    const store = createCommandStore()
    render(<Wrap store={store} project={sampleProject} />)

    act(() => dispatch({ key: 'p', metaKey: true }))

    expect(screen.getByPlaceholderText('Open file by name…')).toBeInTheDocument()
    expect(screen.getByText('alpha.pdf')).toBeInTheDocument()
    expect(screen.getByText('beta.pdf')).toBeInTheDocument()
  })

  it('shows the "no project" empty state in Quick Open when there is no project', () => {
    const store = createCommandStore()
    render(<Wrap store={store} project={null} />)

    act(() => dispatch({ key: 'p', metaKey: true }))

    expect(screen.getByText('No project — open one with ⌘⇧O')).toBeInTheDocument()
  })

  it('pivots from the command palette to Quick Open when Backspace is pressed on empty input', () => {
    const store = createCommandStore()
    render(<Wrap store={store} project={sampleProject} />)

    act(() => dispatch({ key: 'p', metaKey: true, shiftKey: true }))
    expect(screen.getByPlaceholderText('Type a command…')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByPlaceholderText('Type a command…'), { key: 'Backspace' })

    expect(screen.queryByPlaceholderText('Type a command…')).toBeNull()
    expect(screen.getByPlaceholderText('Open file by name…')).toBeInTheDocument()
  })

  it('does not pivot when the command palette input has text', () => {
    const store = createCommandStore()
    render(<Wrap store={store} project={sampleProject} />)

    act(() => dispatch({ key: 'p', metaKey: true, shiftKey: true }))
    const input = screen.getByPlaceholderText('Type a command…')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.keyDown(input, { key: 'Backspace' })

    expect(screen.getByPlaceholderText('Type a command…')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Open file by name…')).toBeNull()
  })

  it('Escape closes the palette', () => {
    const store = createCommandStore()
    render(<Wrap store={store} project={sampleProject} />)
    act(() => dispatch({ key: 'p', metaKey: true }))
    fireEvent.keyDown(screen.getByPlaceholderText('Open file by name…'), { key: 'Escape' })
    expect(screen.queryByTestId('palette-backdrop')).toBeNull()
  })

  it('selecting a Quick Open file calls onOpenFile and closes the palette', () => {
    const store = createCommandStore()
    const onOpenFile = vi.fn()
    render(<Wrap store={store} project={sampleProject} onOpenFile={onOpenFile} />)

    act(() => dispatch({ key: 'p', metaKey: true }))
    fireEvent.keyDown(screen.getByPlaceholderText('Open file by name…'), { key: 'Enter' })

    expect(onOpenFile).toHaveBeenCalledWith('/proj/alpha.pdf')
    expect(screen.queryByTestId('palette-backdrop')).toBeNull()
  })

  it('selecting a command runs it and closes the palette', () => {
    const store = createCommandStore()
    const run = vi.fn()
    render(
      <>
        <Registrar store={store} run={run} />
        <Wrap store={store} project={null} />
      </>
    )

    act(() => dispatch({ key: 'p', metaKey: true, shiftKey: true }))
    fireEvent.keyDown(screen.getByPlaceholderText('Type a command…'), { key: 'Enter' })

    expect(run).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('palette-backdrop')).toBeNull()
  })
})
