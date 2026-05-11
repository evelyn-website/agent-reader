import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanProjectPdfs, folderExists, type FileNode } from './project'

function flatten(nodes: FileNode[]): { kind: string; name: string }[] {
  const out: { kind: string; name: string }[] = []
  for (const n of nodes) {
    out.push({ kind: n.kind, name: n.name })
    if (n.kind === 'dir') out.push(...flatten(n.children))
  }
  return out
}

describe('scanProjectPdfs', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-reader-scan-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps only PDFs, ignores other files', () => {
    writeFileSync(join(root, 'a.pdf'), '')
    writeFileSync(join(root, 'notes.md'), '')
    writeFileSync(join(root, 'image.png'), '')
    const { tree } = scanProjectPdfs(root)
    expect(tree.map((n) => n.name)).toEqual(['a.pdf'])
  })

  it('matches .pdf case-insensitively', () => {
    writeFileSync(join(root, 'Upper.PDF'), '')
    const { tree } = scanProjectPdfs(root)
    expect(tree).toHaveLength(1)
  })

  it('skips dotfile entries and node_modules', () => {
    mkdirSync(join(root, '.agent-reader'))
    writeFileSync(join(root, '.agent-reader', 'hidden.pdf'), '')
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'lib.pdf'), '')
    writeFileSync(join(root, 'real.pdf'), '')
    const { tree } = scanProjectPdfs(root)
    expect(tree.map((n) => n.name)).toEqual(['real.pdf'])
  })

  it('prunes directories with no PDFs anywhere in their subtree', () => {
    mkdirSync(join(root, 'empty'))
    writeFileSync(join(root, 'empty', 'note.md'), '')
    mkdirSync(join(root, 'with-pdf'))
    writeFileSync(join(root, 'with-pdf', 'a.pdf'), '')
    const { tree } = scanProjectPdfs(root)
    expect(tree.map((n) => n.name)).toEqual(['with-pdf'])
  })

  it('recurses into nested folders and sorts dirs before files', () => {
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'b.pdf'), '')
    writeFileSync(join(root, 'a.pdf'), '')
    const { tree } = scanProjectPdfs(root)
    expect(flatten(tree)).toEqual([
      { kind: 'dir', name: 'sub' },
      { kind: 'file', name: 'b.pdf' },
      { kind: 'file', name: 'a.pdf' }
    ])
  })

  it('reports the folder name as basename of the path', () => {
    const { name, path } = scanProjectPdfs(root)
    expect(path).toBe(root)
    expect(name).toBe(root.split('/').pop())
  })
})

describe('folderExists', () => {
  it('returns true for an existing directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-reader-fe-'))
    try {
      expect(folderExists(dir)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns false for a missing path', () => {
    expect(folderExists(join(tmpdir(), 'definitely-not-here-' + Date.now()))).toBe(false)
  })
})
