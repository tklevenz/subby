import { openDatabaseSync } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import * as schema from './schema';
import migrations from './migrations/migrations';
import { upgradeLegacyRow, type LegacyLogRow } from './legacy';

const sqlite = openDatabaseSync('kindred-log.db');
sqlite.execSync('PRAGMA journal_mode = WAL;');

const dbInstance = drizzle(sqlite, { schema });

const tableExists = (name: string) =>
  sqlite.getFirstSync<{ n: number }>(
    "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
    name,
  )!.n > 0;

/**
 * Run pending migrations. Databases created by the pre-migration bootstrap SQL
 * (no __drizzle_migrations table) are moved aside, migrated, and their rows upgraded.
 */
export async function initDatabase(): Promise<void> {
  const isLegacy = !tableExists('__drizzle_migrations') && tableExists('logs');
  if (isLegacy) {
    sqlite.execSync(`
      DROP INDEX IF EXISTS child_started_idx;
      DROP INDEX IF EXISTS sync_status_idx;
      ALTER TABLE logs RENAME TO logs_legacy;
    `);
  }

  await migrate(dbInstance, migrations);

  if (isLegacy) {
    const rows = sqlite.getAllSync<LegacyLogRow>('SELECT * FROM logs_legacy');
    dbInstance.transaction((tx) => {
      for (const row of rows) {
        tx.insert(schema.logsTable).values(upgradeLegacyRow(row)).onConflictDoNothing().run();
      }
    });
    sqlite.execSync('DROP TABLE logs_legacy;');
  }
}

export { dbInstance as db, schema };
