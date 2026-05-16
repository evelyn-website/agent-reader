import { useRef, useState, type Ref } from 'react'
import { act } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('./ChatTerminal', () => ({
  default: (props: { sessionId: string }) => (
    <div data-testid="chat-terminal-stub">terminal:{props.sessionId}</div>
  )
}))

import ChatTabContent, { type ChatTabContentHandle } from './ChatTabContent'
import type { ChatSessionRow, ChatSessionSummary } from '../../../shared/dbTypes'

function makeSession(overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary {
  return {
    id: 'session-1',
    scope_key: '/project',
    title: 'Reading notes',
    origin_document_id: 'doc-1',
    origin_page_number: 4,
    origin_text_excerpt: null,
    claude_session_id: null,
    created_at: 1000,
    updated_at: 1000,
    last_message_at: null,
    message_count: 0,
    last_message_preview: null,
    ...overrides
  }
}

function makeSessionRow(overrides: Partial<ChatSessionRow> = {}): ChatSessionRow {
  const summary = makeSession(overrides)
  return {
    id: summary.id,
    scope_key: summary.scope_key,
    title: summary.title,
    origin_document_id: summary.origin_document_id,
    origin_page_number: summary.origin_page_number,
    origin_text_excerpt: summary.origin_text_excerpt,
    claude_session_id: summary.claude_session_id,
    created_at: summary.created_at,
    updated_at: summary.updated_at,
    last_message_at: summary.last_message_at
  }
}

interface HarnessProps {
  projectPath: string | null
  documentId: string | null
  currentPage: number | null
  tabRef?: Ref<ChatTabContentHandle>
}

function Harness({
  projectPath,
  documentId,
  currentPage,
  tabRef
}: HarnessProps): React.JSX.Element {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  return (
    <ChatTabContent
      ref={tabRef}
      projectPath={projectPath}
      documentId={documentId}
      currentPage={currentPage}
      selectedSessionId={selectedSessionId}
      onSelectSession={setSelectedSessionId}
    />
  )
}

describe('ChatTabContent', () => {
  it('shows no-scope empty state and disables New when nothing is open', async () => {
    render(<Harness projectPath={null} documentId={null} currentPage={null} />)

    expect(
      await screen.findByText('Open a document or project to start a session.')
    ).toBeInTheDocument()
    expect(window.api.chat.sessions.list).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'New' })).toBeDisabled()
  })

  it('loads sessions and auto-selects the newest one', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([makeSession()])

    render(<Harness projectPath="/project" documentId="doc-1" currentPage={4} />)

    expect(await screen.findByDisplayValue('Reading notes')).toBeInTheDocument()
    expect(window.api.chat.sessions.list).toHaveBeenCalledWith('/project')
  })

  it('creates a session with project/document/page origin context', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([])
    vi.mocked(window.api.chat.sessions.create).mockResolvedValue(makeSessionRow())

    render(<Harness projectPath="/project" documentId="doc-1" currentPage={4} />)

    fireEvent.click(screen.getByRole('button', { name: 'New' }))

    await waitFor(() => {
      expect(window.api.chat.sessions.create).toHaveBeenCalledWith({
        scope_key: '/project',
        origin_document_id: 'doc-1',
        origin_page_number: 4
      })
    })
    expect(await screen.findByDisplayValue('Reading notes')).toBeInTheDocument()
  })

  it('creates a session when createSession() is called on the imperative ref', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([])
    vi.mocked(window.api.chat.sessions.create).mockResolvedValue(makeSessionRow())

    function RefHarness(): React.JSX.Element {
      const ref = useRef<ChatTabContentHandle>(null)
      return (
        <>
          <button type="button" onClick={() => void ref.current?.createSession()}>
            external-create
          </button>
          <Harness projectPath="/project" documentId="doc-1" currentPage={4} tabRef={ref} />
        </>
      )
    }

    render(<RefHarness />)

    await screen.findByText('No sessions yet.')
    expect(window.api.chat.sessions.create).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'external-create' }))

    await waitFor(() => {
      expect(window.api.chat.sessions.create).toHaveBeenCalledWith({
        scope_key: '/project',
        origin_document_id: 'doc-1',
        origin_page_number: 4
      })
    })
  })

  it('ignores createSession() on the imperative ref when no project or document is open', async () => {
    const ref = { current: null as ChatTabContentHandle | null }

    function CaptureRef(): React.JSX.Element {
      return <Harness projectPath={null} documentId={null} currentPage={null} tabRef={ref} />
    }

    render(<CaptureRef />)

    await screen.findByText('Open a document or project to start a session.')

    await act(async () => {
      await ref.current?.createSession()
    })

    expect(window.api.chat.sessions.create).not.toHaveBeenCalled()
  })

  it('renames and deletes the selected session', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([makeSession()])
    vi.mocked(window.api.chat.sessions.updateTitle).mockResolvedValue(
      makeSessionRow({ title: 'Renamed session', updated_at: 3000 })
    )
    vi.mocked(window.api.chat.sessions.delete).mockResolvedValue(null)

    render(<Harness projectPath="/project" documentId="doc-1" currentPage={4} />)

    const title = await screen.findByLabelText('Session title')
    fireEvent.change(title, { target: { value: 'Renamed session' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(window.api.chat.sessions.updateTitle).toHaveBeenCalledWith(
        'session-1',
        'Renamed session'
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(window.api.chat.sessions.delete).toHaveBeenCalledWith('session-1')
    })
    expect(screen.getByText('Create or select a session to begin.')).toBeInTheDocument()
  })

  it('switches the selected session when a different row is clicked', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([
      makeSession({ id: 'session-new', title: 'Newer thread' }),
      makeSession({ id: 'session-old', title: 'Older thread' })
    ])

    render(<Harness projectPath="/project" documentId="doc-1" currentPage={4} />)

    expect(await screen.findByDisplayValue('Newer thread')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Older thread/ }))

    expect(await screen.findByDisplayValue('Older thread')).toBeInTheDocument()
  })

  it('shows an error when loading sessions fails', async () => {
    vi.mocked(window.api.chat.sessions.list).mockRejectedValue(new Error('Sessions unavailable'))

    render(<Harness projectPath="/project" documentId={null} currentPage={null} />)

    expect(await screen.findByText('Sessions unavailable')).toBeInTheDocument()
  })

  it('does not clear the title editor when updateTitle resolves to null', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([makeSession()])
    vi.mocked(window.api.chat.sessions.updateTitle).mockResolvedValue(null)

    render(<Harness projectPath="/project" documentId="doc-1" currentPage={4} />)

    const title = await screen.findByLabelText('Session title')
    fireEvent.change(title, { target: { value: 'My draft title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(window.api.chat.sessions.updateTitle).toHaveBeenCalledWith(
        'session-1',
        'My draft title'
      )
    })

    expect(title).toHaveDisplayValue('My draft title')
    const tray = screen.getByLabelText('Recent sessions')
    expect(within(tray).getByText('Reading notes')).toBeInTheDocument()
  })

  it('resizes the recent sessions tray by dragging its handle', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([makeSession()])

    render(<Harness projectPath="/project" documentId="doc-1" currentPage={4} />)

    expect(await screen.findByText('Recent sessions')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Reading notes')).toBeInTheDocument()
    const tray = screen.getByLabelText('Recent sessions')
    expect(tray).toHaveStyle({ height: '188px' })

    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Resize recent sessions' }), {
      clientY: 300
    })
    fireEvent.pointerMove(window, { clientY: 240 })
    fireEvent.pointerUp(window)

    expect(tray).toHaveStyle({ height: '248px' })
  })
})
