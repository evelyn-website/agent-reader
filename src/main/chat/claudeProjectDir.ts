import { homedir } from 'os'
import { join } from 'path'

/**
 * Claude Code derives its per-cwd transcript dir name by replacing `/` with
 * `-` in the absolute cwd. The leading slash becomes a leading dash.
 *   /Users/evelyn/dev/foo  →  -Users-evelyn-dev-foo
 *
 * Verified empirically against ~/.claude/projects/ entries on 2026-05-15.
 */
export function claudeProjectDirName(absoluteCwd: string): string {
  return absoluteCwd.replace(/\//g, '-')
}

export function claudeProjectDir(absoluteCwd: string): string {
  return join(homedir(), '.claude', 'projects', claudeProjectDirName(absoluteCwd))
}

export function claudeTranscriptPath(absoluteCwd: string, claudeSessionId: string): string {
  return join(claudeProjectDir(absoluteCwd), `${claudeSessionId}.jsonl`)
}
