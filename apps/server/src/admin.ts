import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { loadConfig } from './config';
import { openDb, schema, type Db } from './db/db';
import { Entitlements } from './sync/entitlements';

/**
 * Server-side admin, run inside the container (never over HTTP):
 *   docker compose exec server node dist/admin.js <command>
 * Grants are gifted slots without a payment (store `grant`), for our own family, support or press. Slots belong to
 * the family, so they cover its phones through reinstalls and re-joins. Phones see a change on their next sync.
 */
const USAGE = `Usage: node dist/admin.js <command>
  status <family-id>             who may sync, slots, trial and photo use
  grant-slots <family-id> [n]    give the family n slots (default 1), no payment
  revoke-grants <family-id>      take back every granted slot
  restored                       after restoring the database from a backup: phones sync everything again`;

/** The admin's grants have no buying phone. */
const NOBODY = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runAdmin(db: Db, entitlements: Entitlements, args: string[], print: (line: string) => void = console.log) {
  const [command, familyId, count] = args;
  if (command === 'restored') {
    // Each family's phones see the count change on their next pull. They give back what this server lost (newer
    // log entries, records, photos) and refuse old-key records written after the backup (past `restored_seq`).
    const families = await db
      .update(schema.families)
      .set({ restoreGen: sql`${schema.families.restoreGen} + 1`, restoredSeq: sql`${schema.families.seq}` })
      .returning({ id: schema.families.id });
    print(`Marked ${families.length} famil${families.length === 1 ? 'y' : 'ies'} as restored. Their phones sync everything again on their next run.`);
    return;
  }
  if (!command || !familyId || !UUID.test(familyId)) throw new AdminError(USAGE);
  const [family] = await db.select({ id: schema.families.id }).from(schema.families).where(eq(schema.families.id, familyId));
  if (!family) throw new AdminError(`No family ${familyId} on this server`);

  switch (command) {
    case 'status': {
      const e = await entitlements.forDevice(familyId, NOBODY);
      if (!entitlements.hosted) print('Self-hosted server: everyone syncs for free.');
      if (e.trialEndsAt) print(`Trial ${e.trialEndsAt > Date.now() ? 'until' : 'ended'} ${new Date(e.trialEndsAt).toISOString()}`);
      print(`Slots: ${e.slots} (${e.freeSlots} unused)`);
      for (const d of e.devices) print(`  ${d.id}  ${d.access}`);
      print(`Photos: ${(e.photoBytes / 1024 ** 2).toFixed(1)} MB${e.photoLimit ? ` of ${(e.photoLimit / 1024 ** 3).toFixed(0)} GB` : ''}`);
      return;
    }
    case 'grant-slots': {
      const n = count === undefined ? 1 : Number(count);
      if (!Number.isInteger(n) || n < 1 || n > 20) throw new AdminError('n must be a whole number from 1 to 20');
      await db.insert(schema.purchases).values(
        Array.from({ length: n }, () => ({ id: `grant:${randomUUID()}`, store: 'grant' as const, kind: 'slot' as const, deviceId: NOBODY, familyId })),
      );
      print(`Granted ${n} slot${n === 1 ? '' : 's'} to ${familyId}.`);
      return;
    }
    case 'revoke-grants': {
      const gone = await db
        .update(schema.purchases)
        .set({ revoked: true })
        .where(and(eq(schema.purchases.familyId, familyId), eq(schema.purchases.store, 'grant'), eq(schema.purchases.revoked, false)))
        .returning({ id: schema.purchases.id });
      print(`Revoked ${gone.length} granted slot${gone.length === 1 ? '' : 's'}.`);
      return;
    }
    default:
      throw new AdminError(USAGE);
  }
}

export class AdminError extends Error {}

// Run directly (dist/admin.js), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = loadConfig(process.env, fileURLToPath(new URL('../drizzle', import.meta.url)));
  const { db, close } = await openDb(config.databaseUrl, config.migrationsFolder);
  try {
    await runAdmin(db, new Entitlements(config, db), process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof AdminError ? e.message : e);
    process.exitCode = 1;
  } finally {
    await close();
  }
}
