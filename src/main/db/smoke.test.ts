import { describe, it, expect } from 'vitest'
import { createDb } from './index'

describe('smoke: createDb', () => {
  it('creates an in-memory db with documents and annotations tables', () => {
    const db = createDb(':memory:')
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('documents')
    expect(names).toContain('annotations')
    expect(names).toContain('schema_version')
    db.close()
  })
})
