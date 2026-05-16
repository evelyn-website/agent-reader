import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readActiveLocation, writeActiveLocation } from './activeLocation'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'active-loc-test-'))
}

describe('activeLocation', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  it('roundtrips through write/read', () => {
    const dir = makeTmpDir()
    dirs.push(dir)
    const path = join(dir, 'active.json')
    writeActiveLocation({ documentId: 'doc-1', page: 7, docPath: '/tmp/a.pdf' }, path)
    expect(readActiveLocation(path)).toEqual({
      documentId: 'doc-1',
      page: 7,
      docPath: '/tmp/a.pdf'
    })
  })

  it('returns null when the file does not exist', () => {
    const dir = makeTmpDir()
    dirs.push(dir)
    const path = join(dir, 'missing.json')
    expect(readActiveLocation(path)).toBeNull()
  })

  it('returns null when the file is malformed JSON', () => {
    const dir = makeTmpDir()
    dirs.push(dir)
    const path = join(dir, 'bad.json')
    writeFileSync(path, 'not json', 'utf8')
    expect(readActiveLocation(path)).toBeNull()
  })

  it('coerces missing/wrong-type fields to null without throwing', () => {
    const dir = makeTmpDir()
    dirs.push(dir)
    const path = join(dir, 'partial.json')
    writeFileSync(path, JSON.stringify({ documentId: 42, page: 'one' }), 'utf8')
    expect(readActiveLocation(path)).toEqual({
      documentId: null,
      page: null,
      docPath: null
    })
  })

  it('writeActiveLocation creates parent dirs', () => {
    const dir = makeTmpDir()
    dirs.push(dir)
    const path = join(dir, 'nested', 'deeper', 'active.json')
    writeActiveLocation({ documentId: null, page: null, docPath: null }, path)
    expect(readActiveLocation(path)).toEqual({
      documentId: null,
      page: null,
      docPath: null
    })
  })
})
