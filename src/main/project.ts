import { readdirSync, statSync, type Dirent } from 'fs'
import { basename, join } from 'path'

export type FileNode =
  | { kind: 'dir'; name: string; path: string; children: FileNode[] }
  | { kind: 'file'; name: string; path: string }

export interface ProjectScan {
  path: string
  name: string
  tree: FileNode[]
}

const MAX_DEPTH = 8
const MAX_ENTRIES = 5000

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf')
}

function compareNodes(a: FileNode, b: FileNode): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

interface ScanState {
  entries: number
  truncated: boolean
}

function walk(dir: string, depth: number, state: ScanState): FileNode[] {
  if (depth > MAX_DEPTH) {
    state.truncated = true
    return []
  }
  let dirents: Dirent[]
  try {
    dirents = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' }) as Dirent[]
  } catch {
    return []
  }

  const nodes: FileNode[] = []
  for (const ent of dirents) {
    if (state.entries >= MAX_ENTRIES) {
      state.truncated = true
      break
    }
    const name = ent.name
    if (name.startsWith('.') || name === 'node_modules') continue
    const full = join(dir, name)
    state.entries++
    if (ent.isDirectory()) {
      const children = walk(full, depth + 1, state)
      if (children.length > 0) {
        nodes.push({ kind: 'dir', name, path: full, children })
      }
    } else if (ent.isFile() && isPdf(name)) {
      nodes.push({ kind: 'file', name, path: full })
    }
  }
  nodes.sort(compareNodes)
  return nodes
}

export function scanProjectPdfs(rootPath: string): ProjectScan {
  const state: ScanState = { entries: 0, truncated: false }
  const tree = walk(rootPath, 0, state)
  if (state.truncated) {
    console.warn(
      `scanProjectPdfs: truncated at ${state.entries} entries / depth ${MAX_DEPTH} for ${rootPath}`
    )
  }
  return { path: rootPath, name: basename(rootPath), tree }
}

export function flattenProjectFiles(nodes: FileNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind === 'file') paths.push(node.path)
    else paths.push(...flattenProjectFiles(node.children))
  }
  return paths
}

export function folderExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
