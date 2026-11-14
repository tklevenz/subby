import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** A transaction handle has the same query API. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export const DB = Symbol('DB');

/**
 * Bounds on every request's database work, so nothing holds one of the pool's connections for long: waiting for a
 * row lock, a single statement, and a transaction left open between statements. Requests that hit them get a 503
 * (`common/errors.ts`). Migrations run on their own connection without them. In milliseconds.
 */
export const DB_TIMEOUTS = { lock_timeout: 10_000, statement_timeout: 30_000, idle_in_transaction_session_timeout: 60_000 };

export async function openDb(url: string, migrationsFolder: string) {
  const migrator = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(migrator), { migrationsFolder });
  } finally {
    await migrator.end();
  }
  const client = postgres(url, { max: 10, onnotice: () => {}, connection: DB_TIMEOUTS });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export { schema };
