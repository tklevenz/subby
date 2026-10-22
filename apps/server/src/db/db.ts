import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** A transaction handle has the same query API. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export const DB = Symbol('DB');

export async function openDb(url: string, migrationsFolder: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.end() };
}

export { schema };
