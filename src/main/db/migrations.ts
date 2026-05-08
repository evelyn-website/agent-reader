import type Database from 'better-sqlite3'

type Migration = (db: Database.Database) => void

const migrations: Migration[] = [
  (db) => {
    db.exec(`
      CREATE TABLE documents (
        id              TEXT PRIMARY KEY,
        filename        TEXT NOT NULL,
        last_path       TEXT NOT NULL,
        size_bytes      INTEGER NOT NULL,
        first_opened_at INTEGER NOT NULL,
        last_opened_at  INTEGER NOT NULL,
        open_count      INTEGER NOT NULL DEFAULT 0
      );
    `)
  }
]

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);`)
  const row = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get() as
    | { version: number }
    | undefined
  let current = row?.version ?? 0
  if (row === undefined) {
    db.prepare(`INSERT INTO schema_version (version) VALUES (0)`).run()
  }
  const setVersion = db.prepare(`UPDATE schema_version SET version = ?`)
  for (let i = current; i < migrations.length; i++) {
    const tx = db.transaction(() => {
      migrations[i](db)
      setVersion.run(i + 1)
    })
    tx()
    current = i + 1
  }
}
