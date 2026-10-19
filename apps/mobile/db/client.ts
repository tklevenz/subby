import { openDatabaseSync } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from './schema';

const sqlite = openDatabaseSync('kindred-log.db');

// No migration runner yet, so bootstrap the schema idempotently on open.
// Keep in sync with ./schema.ts.
sqlite.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY NOT NULL,
    child_id TEXT NOT NULL,
    log_type TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS child_started_idx ON logs (child_id, started_at);
  CREATE INDEX IF NOT EXISTS sync_status_idx ON logs (sync_status);
`);

const dbInstance = drizzle(sqlite, { schema });

export { dbInstance as db, schema };
