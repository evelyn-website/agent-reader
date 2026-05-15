import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'
import { claudeProjectDirName, claudeProjectDir, claudeTranscriptPath } from './claudeProjectDir'

describe('claudeProjectDirName', () => {
  it('replaces every slash with a dash, preserving the leading separator', () => {
    expect(claudeProjectDirName('/Users/evelyn/dev/agent-reader')).toBe(
      '-Users-evelyn-dev-agent-reader'
    )
  })

  it('handles a bare root cwd', () => {
    expect(claudeProjectDirName('/')).toBe('-')
  })
})

describe('claudeProjectDir', () => {
  it('resolves under ~/.claude/projects/', () => {
    expect(claudeProjectDir('/a/b')).toBe(join(homedir(), '.claude', 'projects', '-a-b'))
  })
})

describe('claudeTranscriptPath', () => {
  it('joins the project dir with <uuid>.jsonl', () => {
    expect(claudeTranscriptPath('/a/b', 'abc-123')).toBe(
      join(homedir(), '.claude', 'projects', '-a-b', 'abc-123.jsonl')
    )
  })
})
