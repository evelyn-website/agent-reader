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
  },
  (db) => {
    db.exec(`
      CREATE TABLE annotations (
        id           TEXT PRIMARY KEY,
        document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page_number  INTEGER NOT NULL,
        kind         TEXT NOT NULL CHECK (kind IN ('highlight', 'note')),
        color        TEXT,
        rects_json   TEXT,
        anchor_x     REAL,
        anchor_y     REAL,
        text_excerpt TEXT,
        comment      TEXT,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX idx_annotations_doc_page ON annotations(document_id, page_number);
    `)
  },
  (db) => {
    db.exec(`
      CREATE TABLE app_state (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `)
  },
  (db) => {
    db.exec(`
      DROP TABLE IF EXISTS app_state;
      CREATE TABLE projects (
        path            TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        first_opened_at INTEGER NOT NULL,
        last_opened_at  INTEGER NOT NULL,
        open_count      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_projects_last_opened ON projects(last_opened_at DESC);
    `)
  },
  (db) => {
    db.exec(`
      CREATE TABLE search_indexes (
        document_id  TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        pages_json   TEXT NOT NULL,
        schema_v     INTEGER NOT NULL,
        built_at     INTEGER NOT NULL
      );
    `)
  },
  (db) => {
    db.exec(`
      CREATE TABLE chat_sessions (
        id                  TEXT PRIMARY KEY,
        scope_key           TEXT NOT NULL,
        title               TEXT NOT NULL,
        origin_document_id  TEXT REFERENCES documents(id) ON DELETE SET NULL,
        origin_page_number  INTEGER,
        origin_text_excerpt TEXT,
        claude_session_id   TEXT,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        last_message_at     INTEGER
      );
      CREATE INDEX idx_chat_sessions_scope_updated
        ON chat_sessions(scope_key, COALESCE(last_message_at, updated_at) DESC);

      CREATE TABLE chat_messages (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content     TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('complete', 'pending', 'error')),
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        error_text  TEXT
      );
      CREATE INDEX idx_chat_messages_session_created
        ON chat_messages(session_id, created_at);
    `)
  },
  (db) => {
    db.exec(`
      ALTER TABLE chat_messages ADD COLUMN jsonl_uuid TEXT;
      CREATE UNIQUE INDEX idx_chat_messages_jsonl_uuid
        ON chat_messages(session_id, jsonl_uuid)
        WHERE jsonl_uuid IS NOT NULL;
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
