import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import ChatTabContent from './ChatTabContent'
import type { ChatMessageRow, ChatSessionRow, ChatSessionSummary } from '../../../shared/dbTypes'

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

function makeMessage(overrides: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: 'message-1',
    session_id: 'session-1',
    role: 'user',
    content: 'What does this section mean?',
    status: 'complete',
    created_at: 2000,
    updated_at: 2000,
    error_text: null,
    ...overrides
  }
}

describe('ChatTabContent', () => {
  it('shows no-scope empty state and disables New, composer, and Send when nothing is open', async () => {
    render(<ChatTabContent projectPath={null} documentId={null} currentPage={null} />)

    expect(
      await screen.findByText('Open a document or project to start a session.')
    ).toBeInTheDocument()
    expect(window.api.chat.sessions.list).not.toHaveBeenCalled()

    expect(screen.getByRole('button', { name: 'New' })).toBeDisabled()
    expect(screen.getByPlaceholderText('Ask about this document…')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('loads sessions, selects the newest session, and renders its messages', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([makeSession()])
    vi.mocked(window.api.chat.messages.list).mockResolvedValue([makeMessage()])

    render(<ChatTabContent projectPath="/project" documentId="doc-1" currentPage={4} />)

    expect(await screen.findByDisplayValue('Reading notes')).toBeInTheDocument()
    expect(await screen.findByText('What does this section mean?')).toBeInTheDocument()
    expect(window.api.chat.sessions.list).toHaveBeenCalledWith('/project')
    expect(window.api.chat.messages.list).toHaveBeenCalledWith('session-1')
  })

  it('creates a session with project/document/page origin context', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([])
    vi.mocked(window.api.chat.sessions.create).mockResolvedValue(makeSessionRow())

    render(<ChatTabContent projectPath="/project" documentId="doc-1" currentPage={4} />)

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

  it('renames and deletes the selected session', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([makeSession()])
    vi.mocked(window.api.chat.messages.list).mockResolvedValue([])
    vi.mocked(window.api.chat.sessions.updateTitle).mockResolvedValue(
      makeSessionRow({ title: 'Renamed session', updated_at: 3000 })
    )
    vi.mocked(window.api.chat.sessions.delete).mockResolvedValue(null)

    render(<ChatTabContent projectPath="/project" documentId="doc-1" currentPage={4} />)

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
    expect(
      screen.getByText('Create a session or send a message to begin a persistent chat thread.')
    ).toBeInTheDocument()
  })

  it('creates a session on first message and persists the manual user message', async () => {
    vi.mocked(window.api.chat.sessions.list)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeSession({
          message_count: 1,
          last_message_at: 2000,
          last_message_preview: 'Hello chat'
        })
      ])
    vi.mocked(window.api.chat.sessions.create).mockResolvedValue(makeSessionRow())
    vi.mocked(window.api.chat.messages.create).mockResolvedValue(
      makeMessage({ content: 'Hello chat' })
    )
    vi.mocked(window.api.chat.messages.list).mockResolvedValue([])

    render(<ChatTabContent projectPath={null} documentId="doc-1" currentPage={2} />)

    fireEvent.change(screen.getByPlaceholderText('Ask about this document…'), {
      target: { value: 'Hello chat' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(window.api.chat.sessions.create).toHaveBeenCalledWith({
        scope_key: 'document:doc-1',
        origin_document_id: 'doc-1',
        origin_page_number: 2
      })
    })
    expect(window.api.chat.messages.create).toHaveBeenCalledWith({
      session_id: 'session-1',
      role: 'user',
      content: 'Hello chat',
      status: 'complete'
    })
    expect(await screen.findByText('Hello chat')).toBeInTheDocument()
  })

  it('submits with Enter and keeps Shift+Enter for multiline input', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([makeSession()])
    vi.mocked(window.api.chat.messages.list).mockResolvedValue([])
    vi.mocked(window.api.chat.messages.create).mockResolvedValue(makeMessage({ content: 'Hello' }))

    render(<ChatTabContent projectPath="/project" documentId="doc-1" currentPage={4} />)

    const input = await screen.findByPlaceholderText('Ask about this document…')
    fireEvent.change(input, { target: { value: 'Hello' } })

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(window.api.chat.messages.create).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(window.api.chat.messages.create).toHaveBeenCalledWith({
        session_id: 'session-1',
        role: 'user',
        content: 'Hello',
        status: 'complete'
      })
    })
  })

  it('reloads messages when selecting a different session from the list', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([
      makeSession({ id: 'session-new', title: 'Newer thread' }),
      makeSession({ id: 'session-old', title: 'Older thread' })
    ])
    vi.mocked(window.api.chat.messages.list).mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session-new') {
        return [
          makeMessage({ id: 'm-new', session_id: 'session-new', content: 'Message in newer' })
        ]
      }
      return [makeMessage({ id: 'm-old', session_id: 'session-old', content: 'Message in older' })]
    })

    render(<ChatTabContent projectPath="/project" documentId="doc-1" currentPage={4} />)

    expect(await screen.findByText('Message in newer')).toBeInTheDocument()
    expect(window.api.chat.messages.list).toHaveBeenCalledWith('session-new')

    vi.mocked(window.api.chat.messages.list).mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Older thread/ }))

    await waitFor(() => {
      expect(window.api.chat.messages.list).toHaveBeenCalledWith('session-old')
    })
    expect(await screen.findByText('Message in older')).toBeInTheDocument()
  })

  it('shows an error when loading sessions fails', async () => {
    vi.mocked(window.api.chat.sessions.list).mockRejectedValue(new Error('Sessions unavailable'))

    render(<ChatTabContent projectPath="/project" documentId={null} currentPage={null} />)

    expect(await screen.findByText('Sessions unavailable')).toBeInTheDocument()
  })

  it('shows an error when loading messages for the selected session fails', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([makeSession()])
    vi.mocked(window.api.chat.messages.list).mockRejectedValue(new Error('Messages unavailable'))

    render(<ChatTabContent projectPath="/project" documentId="doc-1" currentPage={4} />)

    expect(await screen.findByText('Messages unavailable')).toBeInTheDocument()
  })

  it('does not clear the title editor when updateTitle resolves to null', async () => {
    vi.mocked(window.api.chat.sessions.list).mockResolvedValue([makeSession()])
    vi.mocked(window.api.chat.messages.list).mockResolvedValue([])
    vi.mocked(window.api.chat.sessions.updateTitle).mockResolvedValue(null)

    render(<ChatTabContent projectPath="/project" documentId="doc-1" currentPage={4} />)

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
    vi.mocked(window.api.chat.messages.list).mockResolvedValue([])

    render(<ChatTabContent projectPath="/project" documentId="doc-1" currentPage={4} />)

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
