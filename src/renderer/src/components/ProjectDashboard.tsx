import type {
  ChatSessionSummary,
  ProjectDashboard as ProjectDashboardData,
  ProjectDocumentSummary,
  ProjectMarkSummary
} from '../../../shared/dbTypes'
import type { ProjectScan } from '../../../main/project'
import { FolderIcon, NoteIcon, PageIcon } from './icons'
import { formatRelativeTime } from './marksTabUtils'

interface Props {
  project: ProjectScan
  dashboard: ProjectDashboardData | null
  loading: boolean
  onOpenDocument: (path: string) => void
  onOpenMark: (mark: ProjectMarkSummary) => void
  onOpenSession: (session: ChatSessionSummary) => void
}

export default function ProjectDashboard({
  project,
  dashboard,
  loading,
  onOpenDocument,
  onOpenMark,
  onOpenSession
}: Props): React.JSX.Element {
  const documents = dashboard?.documents ?? flattenProjectDocs(project)
  const recentMarks = dashboard?.recentMarks ?? []
  const recentSessions = dashboard?.recentSessions ?? []
  const resumeDocument = dashboard?.resumeDocument ?? null

  return (
    <div className="project-dashboard">
      <header className="project-dashboard__header">
        <div className="project-dashboard__kicker">
          <FolderIcon size={12} />
          Project
        </div>
        <h1>{project.name}</h1>
        <p title={project.path}>{project.path}</p>
      </header>

      {loading && <div className="project-dashboard__loading">Reading project context…</div>}

      {resumeDocument && (
        <section className="project-dashboard__section project-dashboard__section--resume">
          <div className="project-dashboard__section-heading">Resume</div>
          <button
            type="button"
            className="project-resume-card"
            onClick={() => onOpenDocument(resumeDocument.path)}
            title={resumeDocument.path}
          >
            <span className="project-resume-card__icon">
              <PageIcon size={18} />
            </span>
            <span className="project-resume-card__body">
              <span className="project-resume-card__label">Last document</span>
              <span className="project-resume-card__title">{resumeDocument.name}</span>
              <span className="project-resume-card__meta">
                {resumeDocument.last_opened_at
                  ? formatOpenedTime(resumeDocument.last_opened_at)
                  : 'Not opened yet'}
                {resumeDocument.mark_count > 0 ? ` · ${formatMarkCount(resumeDocument)}` : ''}
              </span>
            </span>
          </button>
        </section>
      )}

      {recentSessions.length > 0 && (
        <section className="project-dashboard__section">
          <div className="project-dashboard__section-heading">Recent Sessions</div>
          <div className="project-session-list">
            {recentSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className="project-session-row"
                onClick={() => onOpenSession(session)}
                title={session.title}
              >
                <span className="project-session-row__body">
                  <span className="project-session-row__title">{session.title}</span>
                  <span className="project-session-row__meta">
                    {session.message_count} message{session.message_count === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="project-session-row__time">
                  {formatRelativeTime(session.last_message_at ?? session.updated_at)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {documents.length > 0 && (
        <section className="project-dashboard__section">
          <div className="project-dashboard__section-heading">Documents</div>
          <div className="project-doc-grid">
            {documents.map((doc) => (
              <button
                key={doc.path}
                type="button"
                className="project-doc-card"
                onClick={() => onOpenDocument(doc.path)}
                title={doc.path}
              >
                <span className="project-doc-card__thumb">
                  <PageIcon size={20} />
                </span>
                <span className="project-doc-card__body">
                  <span className="project-doc-card__title">{doc.name}</span>
                  <span className="project-doc-card__meta">
                    {doc.last_opened_at ? formatOpenedTime(doc.last_opened_at) : 'Unread'}
                  </span>
                  {doc.mark_count > 0 && (
                    <span className="project-doc-card__marks">{formatMarkCount(doc)}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {recentMarks.length > 0 && (
        <section className="project-dashboard__section">
          <div className="project-dashboard__section-heading">Recent Marks</div>
          <div className="project-mark-list">
            {recentMarks.slice(0, 8).map((mark) => (
              <button
                key={mark.id}
                type="button"
                className="project-mark-row"
                onClick={() => onOpenMark(mark)}
                title={`${mark.document_name}, page ${mark.page_number}`}
              >
                <span className="project-mark-row__icon">
                  {mark.kind === 'highlight' ? (
                    <span
                      className={`marks-swatch-dot annotation-popover__color--${mark.color ?? 'yellow'}`}
                    />
                  ) : (
                    <NoteIcon />
                  )}
                </span>
                <span className="project-mark-row__body">
                  <span className="project-mark-row__text">
                    {mark.text_excerpt || mark.comment || '(empty note)'}
                  </span>
                  <span className="project-mark-row__meta">
                    {mark.document_name} · p.{mark.page_number}
                  </span>
                </span>
                <span className="project-mark-row__time">
                  {formatRelativeTime(mark.updated_at)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && documents.length === 0 && (
        <div className="project-dashboard__empty">No PDFs found in this project.</div>
      )}
    </div>
  )
}

function formatMarkCount(
  doc: Pick<ProjectDocumentSummary, 'highlight_count' | 'note_count' | 'mark_count'>
): string {
  const parts: string[] = []
  if (doc.highlight_count)
    parts.push(`${doc.highlight_count} highlight${doc.highlight_count === 1 ? '' : 's'}`)
  if (doc.note_count) parts.push(`${doc.note_count} note${doc.note_count === 1 ? '' : 's'}`)
  return parts.length > 0
    ? parts.join(', ')
    : `${doc.mark_count} mark${doc.mark_count === 1 ? '' : 's'}`
}

function formatOpenedTime(ts: number): string {
  const relative = formatRelativeTime(ts)
  if (relative === 'now') return 'Opened now'
  return relative === 'Yesterday' || relative.includes(' ')
    ? `Opened ${relative}`
    : `Opened ${relative} ago`
}

function flattenProjectDocs(project: ProjectScan): ProjectDocumentSummary[] {
  const docs: ProjectDocumentSummary[] = []
  const walk = (nodes: ProjectScan['tree']): void => {
    for (const node of nodes) {
      if (node.kind === 'file') {
        docs.push({
          path: node.path,
          name: node.name,
          document_id: null,
          last_opened_at: null,
          open_count: 0,
          mark_count: 0,
          highlight_count: 0,
          note_count: 0
        })
      } else {
        walk(node.children)
      }
    }
  }
  walk(project.tree)
  return docs
}
