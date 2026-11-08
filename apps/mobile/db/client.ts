import { defaultDatabaseDirectory, deleteDatabaseSync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { File } from 'expo-file-system';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import * as schema from './schema';
import migrations from './migrations/migrations';
import { upgradeLegacyRow, type LegacyLogRow } from './legacy';
import { ENCRYPTED_DB, PLAIN_DB, planOpen, rawKey, toHex } from './encryption';

const KEY_ITEM = 'kl.dbKey';
// Readable after the first unlock (so future widgets/background work can open the database), and part of
// encrypted iOS backups, so a restored phone can still read its restored database.
const KEY_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

const dbFile = (name: string) => new File(`file://${defaultDatabaseDirectory}/${name}`);

/** SQLCipher answers `PRAGMA cipher_version`; plain SQLite (Expo Go) returns nothing. */
function hasSQLCipher(): boolean {
  const probe = openDatabaseSync(':memory:');
  try {
    return probe.getFirstSync<{ cipher_version: string }>('PRAGMA cipher_version') != null;
  } finally {
    probe.closeSync();
  }
}

function openWithKey(name: string, key: string): SQLiteDatabase {
  const db = openDatabaseSync(name);
  db.execSync(`PRAGMA key = ${rawKey(key)};`);
  // The key is only checked on first read; a wrong key fails here ("file is not a database").
  db.getFirstSync('SELECT count(*) FROM sqlite_master');
  return db;
}

/**
 * Opens the app database. In native builds it is encrypted with SQLCipher, with a random 256-bit key kept in
 * the keychain/keystore. A database from before encryption is copied into the encrypted file once, then deleted.
 */
function openAppDatabase(): SQLiteDatabase {
  const cipher = hasSQLCipher();
  let key = cipher ? SecureStore.getItem(KEY_ITEM, KEY_OPTIONS) : null;
  const plan = planOpen({
    cipher,
    hasKey: key !== null,
    hasPlain: cipher && dbFile(PLAIN_DB).exists,
    hasEncrypted: cipher && dbFile(ENCRYPTED_DB).exists,
  });

  if (plan.kind === 'plain') return openDatabaseSync(PLAIN_DB);

  if (plan.kind === 'setAside') {
    // Never delete data we can't read: move it aside, it can still be opened if the key turns up.
    dbFile(ENCRYPTED_DB).moveSync(dbFile(`subby.unreadable-${Date.now()}.db`));
    for (const ext of ['-wal', '-shm']) {
      const f = dbFile(ENCRYPTED_DB + ext);
      if (f.exists) f.delete();
    }
    console.warn('[db] encrypted database has no key; set aside and starting empty');
  }

  if (key === null) {
    key = toHex(getRandomBytes(32));
    // Saved before any encrypted data exists, so a crash can't leave data without its key.
    SecureStore.setItem(KEY_ITEM, key, KEY_OPTIONS);
  }

  if (plan.kind === 'encrypt') {
    // A leftover encrypted file is an interrupted copy; the plain database is still complete.
    if (dbFile(ENCRYPTED_DB).exists) deleteDatabaseSync(ENCRYPTED_DB);
    const plain = openDatabaseSync(PLAIN_DB);
    plain.execSync(`
      PRAGMA wal_checkpoint(TRUNCATE);
      ATTACH DATABASE '${defaultDatabaseDirectory}/${ENCRYPTED_DB}' AS encrypted KEY ${rawKey(key)};
      SELECT sqlcipher_export('encrypted');
      PRAGMA encrypted.user_version = ${plain.getFirstSync<{ user_version: number }>('PRAGMA user_version')!.user_version};
      DETACH DATABASE encrypted;
    `);
    plain.closeSync();
    deleteDatabaseSync(PLAIN_DB);
  }

  return openWithKey(ENCRYPTED_DB, key);
}

const sqlite = openAppDatabase();
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
