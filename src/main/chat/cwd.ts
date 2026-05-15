import { existsSync, statSync } from 'fs'
import { dirname } from 'path'
import { homedir } from 'os'
import { getDocument } from '../db'
import type { ChatSessionRow } from '../../shared/dbTypes'

const DOCUMENT_SCOPE_PREFIX = 'document:'

export function resolveSessionCwd(session: ChatSessionRow): string {
  const candidate = candidateForScope(session.scope_key)
  if (candidate && isDirectory(candidate)) return candidate
  console.warn(
    `[chat:pty] cwd for session ${session.id} not resolvable (scope=${session.scope_key}); falling back to home`
  )
  return homedir()
}

function candidateForScope(scopeKey: string): string | null {
  if (scopeKey.startsWith(DOCUMENT_SCOPE_PREFIX)) {
    const documentId = scopeKey.slice(DOCUMENT_SCOPE_PREFIX.length)
    const doc = getDocument(documentId)
    if (!doc) return null
    return dirname(doc.last_path)
  }
  return scopeKey
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}
