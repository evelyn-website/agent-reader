import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

let cached: string | null = null

/** Absolute path to the SessionStart hook JS, in dev or asar-unpacked prod. */
export function getHookScriptPath(): string {
  if (cached) return cached
  const rel = 'resources/claude-hooks/session-start.js'

  const candidates: string[] = []
  // electron-builder asarUnpack: resources/** ends up at
  //   <resourcesPath>/app.asar.unpacked/resources/...
  // and process.resourcesPath itself contains the unpacked tree on some builds.
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'app.asar.unpacked', rel))
    candidates.push(join(process.resourcesPath, rel))
  }
  // electron-vite dev: app.getAppPath() is the project root.
  candidates.push(join(app.getAppPath(), rel))

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cached = candidate
      return candidate
    }
  }
  // Fall back to the most likely path; spawn will fail loudly if it's wrong.
  cached = candidates[candidates.length - 1]
  return cached
}

/** Path of the node interpreter we'll ask claude to run the hook with. */
export function getHookNodePath(): string {
  // Prefer the same node `claude` would use. If the binary lookup ever changes,
  // an explicit override via env still wins.
  return process.env.AGENT_READER_HOOK_NODE || 'node'
}
