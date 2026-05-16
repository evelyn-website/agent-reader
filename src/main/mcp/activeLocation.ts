import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export interface ActiveLocation {
  documentId: string | null
  page: number | null
  docPath: string | null
}

const FILENAME = 'active-location.json'

let cachedPath: string | null = null

export function getActiveLocationFilePath(): string {
  if (cachedPath) return cachedPath
  cachedPath = join(app.getPath('userData'), FILENAME)
  return cachedPath
}

/** Test-only override for the userData-derived path. */
export function setActiveLocationFilePathForTesting(path: string | null): void {
  cachedPath = path
}

export function writeActiveLocation(loc: ActiveLocation, filePath?: string): void {
  const path = filePath ?? getActiveLocationFilePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(loc), 'utf8')
}

export function readActiveLocation(filePath?: string): ActiveLocation | null {
  const path = filePath ?? getActiveLocationFilePath()
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ActiveLocation>
    return {
      documentId: typeof parsed.documentId === 'string' ? parsed.documentId : null,
      page: typeof parsed.page === 'number' ? parsed.page : null,
      docPath: typeof parsed.docPath === 'string' ? parsed.docPath : null
    }
  } catch {
    return null
  }
}
