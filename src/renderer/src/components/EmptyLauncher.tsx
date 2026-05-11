import type { ProjectRow } from '../../../main/db'
import { FolderIcon, PageIcon } from './icons'

interface Props {
  onOpenPdf: () => void
  onOpenProject: () => void
  recentProjects: ProjectRow[]
  onOpenRecent: (path: string) => void
}

export default function EmptyLauncher({
  onOpenPdf,
  onOpenProject,
  recentProjects,
  onOpenRecent
}: Props): React.JSX.Element {
  return (
    <div className="empty-launcher">
      <div className="empty-launcher__card">
        <div className="empty-launcher__title">Agent Reader</div>
        <div className="empty-launcher__subtitle">Start by opening a document or a project.</div>
        <div className="empty-launcher__actions">
          <button className="empty-launcher__action" onClick={onOpenPdf}>
            <span className="empty-launcher__action-icon">
              <PageIcon size={18} />
            </span>
            <span className="empty-launcher__action-label">Open PDF…</span>
            <span className="empty-launcher__action-caption">A single document</span>
          </button>
          <button className="empty-launcher__action" onClick={onOpenProject}>
            <span className="empty-launcher__action-icon">
              <FolderIcon size={18} />
            </span>
            <span className="empty-launcher__action-label">Open project folder…</span>
            <span className="empty-launcher__action-caption">A folder of PDFs</span>
          </button>
        </div>
        {recentProjects.length > 0 && (
          <div className="empty-launcher__recents">
            <div className="empty-launcher__recents-label">Recent projects</div>
            <ul className="empty-launcher__recents-list">
              {recentProjects.map((p) => (
                <li key={p.path}>
                  <button
                    type="button"
                    className="empty-launcher__recent"
                    onClick={() => onOpenRecent(p.path)}
                    title={p.path}
                  >
                    <span className="empty-launcher__recent-icon">
                      <FolderIcon size={12} />
                    </span>
                    <span className="empty-launcher__recent-name">{p.name}</span>
                    <span className="empty-launcher__recent-path">{p.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
