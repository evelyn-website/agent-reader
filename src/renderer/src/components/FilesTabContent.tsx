import type { ProjectScan } from '../../../main/project'
import FileTree from './FileTree'

interface Props {
  project: ProjectScan | null
  activePath: string | null
  onOpenFile: (path: string) => void
}

export default function FilesTabContent({
  project,
  activePath,
  onOpenFile
}: Props): React.JSX.Element {
  if (!project) {
    return <div className="tab-empty-state">No project open</div>
  }
  return (
    <div className="files-tab">
      <div className="files-tab__header" title={project.path}>
        {project.name}
      </div>
      {project.tree.length === 0 ? (
        <div className="tab-empty-state">No PDFs in this folder</div>
      ) : (
        <FileTree nodes={project.tree} activePath={activePath} onOpenFile={onOpenFile} />
      )}
    </div>
  )
}
