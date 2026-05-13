import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { ChatMessageRow, ChatSessionRow, ChatSessionSummary } from '../../../shared/dbTypes'
import { SendIcon } from './icons'
import { formatRelativeTime } from './marksTabUtils'

interface Props {
  projectPath: string | null
  documentId: string | null
  currentPage: number | null
}

function sessionToSummary(session: ChatSessionRow): ChatSessionSummary {
  return {
    ...session,
    message_count: 0,
    last_message_preview: null
  }
}

function messagePreview(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  return compact.length > 90 ? `${compact.slice(0, 87)}...` : compact
}

const DEFAULT_SESSIONS_HEIGHT = 188
const MIN_SESSIONS_HEIGHT = 140
const MAX_SESSIONS_HEIGHT_RATIO = 0.45

export default function ChatTabContent({
  projectPath,
  documentId,
  currentPage
}: Props): React.JSX.Element {
  const scopeKey = useMemo(() => {
    if (projectPath) return projectPath
    if (documentId) return `document:${documentId}`
    return null
  }, [documentId, projectPath])
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageRow[]>([])
  const [titleEdit, setTitleEdit] = useState<{ sessionId: string; value: string } | null>(null)
  const [composerText, setComposerText] = useState('')
  const [sessionsHeight, setSessionsHeight] = useState(DEFAULT_SESSIONS_HEIGHT)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null
  const hasContext = scopeKey !== null
  const titleValue =
    selectedSession && titleEdit?.sessionId === selectedSession.id
      ? titleEdit.value
      : (selectedSession?.title ?? '')

  const refreshSessions = useCallback(
    async (preferredSessionId?: string | null): Promise<void> => {
      if (!scopeKey) {
        setSessions([])
        setSelectedSessionId(null)
        return
      }
      const rows = await window.api.chat.sessions.list(scopeKey)
      setSessions(rows)
      setSelectedSessionId((current) => {
        const preferred = preferredSessionId === undefined ? current : preferredSessionId
        if (preferred && rows.some((session) => session.id === preferred)) return preferred
        return rows[0]?.id ?? null
      })
    },
    [scopeKey]
  )

  const createSession = useCallback(async (): Promise<ChatSessionRow | null> => {
    if (!scopeKey) return null
    const session = await window.api.chat.sessions.create({
      scope_key: scopeKey,
      origin_document_id: documentId,
      origin_page_number: currentPage
    })
    setSessions((current) => [sessionToSummary(session), ...current])
    setSelectedSessionId(session.id)
    setMessages([])
    return session
  }, [currentPage, documentId, scopeKey])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        await refreshSessions()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load sessions')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [refreshSessions])

  useEffect(() => {
    if (!selectedSessionId) return
    let cancelled = false
    window.api.chat.messages
      .list(selectedSessionId)
      .then((rows) => {
        if (!cancelled) setMessages(rows)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load messages')
      })
    return () => {
      cancelled = true
    }
  }, [selectedSessionId])

  const handleCreateSession = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      await createSession()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create session')
    }
  }, [createSession])

  const handleSaveTitle = useCallback(async (): Promise<void> => {
    if (!selectedSession) return
    setError(null)
    try {
      const updated = await window.api.chat.sessions.updateTitle(selectedSession.id, titleValue)
      if (!updated) return
      setTitleEdit(null)
      setSessions((current) =>
        current.map((session) =>
          session.id === updated.id
            ? {
                ...session,
                title: updated.title,
                updated_at: updated.updated_at
              }
            : session
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename session')
    }
  }, [selectedSession, titleValue])

  const handleDeleteSession = useCallback(async (): Promise<void> => {
    if (!selectedSession) return
    setError(null)
    try {
      await window.api.chat.sessions.delete(selectedSession.id)
      const remaining = sessions.filter((session) => session.id !== selectedSession.id)
      setSessions(remaining)
      setSelectedSessionId(remaining[0]?.id ?? null)
      setMessages([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete session')
    }
  }, [selectedSession, sessions])

  const handleSendMessage = useCallback(async (): Promise<void> => {
    const content = composerText.trim()
    if (!content || !scopeKey) return
    setError(null)
    try {
      const session = selectedSession ?? (await createSession())
      if (!session) return
      const message = await window.api.chat.messages.create({
        session_id: session.id,
        role: 'user',
        content,
        status: 'complete'
      })
      setMessages((current) => [...current, message])
      setComposerText('')
      await refreshSessions(session.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save message')
    }
  }, [composerText, createSession, refreshSessions, scopeKey, selectedSession])

  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void handleSendMessage()
      }
    },
    [handleSendMessage]
  )

  const handleSessionsResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight = sessionsHeight
      const maxHeight = Math.max(
        DEFAULT_SESSIONS_HEIGHT,
        Math.floor(window.innerHeight * MAX_SESSIONS_HEIGHT_RATIO)
      )

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const nextHeight = startHeight + startY - moveEvent.clientY
        setSessionsHeight(Math.min(maxHeight, Math.max(MIN_SESSIONS_HEIGHT, nextHeight)))
      }

      const handlePointerUp = (): void => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [sessionsHeight]
  )

  const titleChanged = Boolean(selectedSession && titleValue.trim() !== selectedSession.title)

  return (
    <div className="chat-tab">
      <div className="chat-tab__session">
        {selectedSession ? (
          <input
            className="chat-tab__title-input"
            value={titleValue}
            aria-label="Session title"
            onChange={(event) =>
              selectedSession &&
              setTitleEdit({ sessionId: selectedSession.id, value: event.target.value })
            }
          />
        ) : (
          <div className="chat-tab__session-title">Chat sessions</div>
        )}
        <button
          type="button"
          className="chat-tab__session-action"
          onClick={handleSaveTitle}
          disabled={!titleChanged}
        >
          Save
        </button>
        <button
          type="button"
          className="chat-tab__session-action"
          onClick={handleCreateSession}
          disabled={!hasContext}
        >
          New
        </button>
        <button
          type="button"
          className="chat-tab__session-action chat-tab__session-action--danger"
          onClick={handleDeleteSession}
          disabled={!selectedSession}
        >
          Delete
        </button>
      </div>
      <div className="chat-tab__body">
        <div className="chat-tab__scroll">
          {error && <div className="chat-tab__error">{error}</div>}
          {!selectedSession ? (
            <div className="tab-empty-state">
              Create a session or send a message to begin a persistent chat thread.
            </div>
          ) : messages.length === 0 ? (
            <div className="tab-empty-state">No messages in this session yet.</div>
          ) : (
            <div className="chat-tab__messages">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`chat-tab__message chat-tab__message--${message.role}`}
                >
                  <div className="chat-tab__message-meta">
                    <span>{message.role}</span>
                    <span>{formatRelativeTime(message.created_at)}</span>
                  </div>
                  <div className="chat-tab__message-content">{message.content}</div>
                  {message.error_text && (
                    <div className="chat-tab__error">{message.error_text}</div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="chat-tab__composer">
        <div
          className={
            hasContext
              ? 'chat-tab__composer-shell'
              : 'chat-tab__composer-shell chat-tab__composer-shell--disabled'
          }
        >
          <textarea
            className="chat-tab__composer-input"
            placeholder="Ask about this document…"
            rows={2}
            value={composerText}
            disabled={!hasContext}
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          <div className="chat-tab__composer-toolbar">
            <div className="chat-tab__composer-toolbar-start" />
            <div className="chat-tab__composer-toolbar-end">
              <button
                type="button"
                className="chat-tab__composer-send"
                aria-label="Send"
                disabled={!hasContext || composerText.trim().length === 0}
                onClick={handleSendMessage}
              >
                <SendIcon size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div
        className="chat-tab__sessions"
        aria-label="Recent sessions"
        style={{ height: sessionsHeight }}
      >
        <div
          className="chat-tab__sessions-resizer"
          role="separator"
          aria-label="Resize recent sessions"
          aria-orientation="horizontal"
          aria-valuemin={MIN_SESSIONS_HEIGHT}
          aria-valuenow={Math.round(sessionsHeight)}
          onPointerDown={handleSessionsResizePointerDown}
        >
          <span />
        </div>
        <div className="chat-tab__sessions-header">
          <span>Recent sessions</span>
        </div>
        {!hasContext ? (
          <div className="tab-empty-state">Open a document or project to start a session.</div>
        ) : loading ? (
          <div className="tab-empty-state">Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <div className="tab-empty-state">No sessions yet.</div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={
                session.id === selectedSessionId
                  ? 'chat-tab__session-row chat-tab__session-row--active'
                  : 'chat-tab__session-row'
              }
              onClick={() => setSelectedSessionId(session.id)}
            >
              <span className="chat-tab__session-row-title">{session.title}</span>
              <span className="chat-tab__session-row-meta">
                {session.message_count} messages
                {session.last_message_at ? ` · ${formatRelativeTime(session.last_message_at)}` : ''}
              </span>
              {session.last_message_preview && (
                <span className="chat-tab__session-row-preview">
                  {messagePreview(session.last_message_preview)}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
