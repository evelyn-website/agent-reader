import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

let cached: string | null = null

/** Absolute path to the MCP server JS, in dev or asar-unpacked prod. */
export function getMcpServerScriptPath(): string {
  if (cached) return cached
  const rel = 'resources/mcp-server/index.js'

  const candidates: string[] = []
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'app.asar.unpacked', rel))
    candidates.push(join(process.resourcesPath, rel))
  }
  candidates.push(join(app.getAppPath(), rel))

  for (const c of candidates) {
    if (existsSync(c)) {
      cached = c
      return c
    }
  }
  cached = candidates[candidates.length - 1]
  return cached
}

/** Test-only reset of the path cache. */
export function clearMcpServerScriptPathCacheForTesting(): void {
  cached = null
}
