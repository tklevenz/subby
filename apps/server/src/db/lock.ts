import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { RetryLater } from '../common/errors';
import { schema, type Db, type Tx } from './db';

/** Serializes writes per family (log appends, key rotation, sync seq, logins). Use it through `familyTransaction`. */
export async function lockFamily(tx: Tx, familyId: string) {
  const [family] = await tx.select().from(schema.families).where(eq(schema.families.id, familyId)).for('update');
  if (!family) throw new BadRequestException('Unknown family');
  return family;
}

/** A family's writes in this process at most, the running one included; past it, 429. */
export const MAX_FAMILY_QUEUE = 8;

/**
 * Runs each family's writes one after another, in process, before they take a database connection. Without it,
 * every write waiting for the family's row lock held one of the pool's few connections, so one family sending many
 * at once could stall everyone else. Bounded: a family with MAX_FAMILY_QUEUE writes already waiting gets a 429.
 */
export class FamilyQueue {
  private readonly queues = new Map<string, { tail: Promise<void>; size: number }>();

  constructor(private readonly max = MAX_FAMILY_QUEUE) {}

  run<T>(familyId: string, fn: () => Promise<T>): Promise<T> {
    const q = this.queues.get(familyId) ?? { tail: Promise.resolve(), size: 0 };
    if (q.size >= this.max) return Promise.reject(new RetryLater(429, 'Too many changes for this family at once, try again shortly', 2));
    q.size++;
    this.queues.set(familyId, q);
    const result = q.tail.then(fn);
    q.tail = result.then(
      () => this.done(familyId, q),
      () => this.done(familyId, q),
    );
    return result;
  }

  /** Writes queued or running, for tests. */
  size(familyId: string) {
    return this.queues.get(familyId)?.size ?? 0;
  }

  private done(familyId: string, q: { size: number }) {
    q.size--;
    if (q.size === 0 && this.queues.get(familyId) === q) this.queues.delete(familyId);
  }
}

// One queue per database handle, so each app instance (tests start several) has its own.
const queues = new WeakMap<Db, FamilyQueue>();
export const familyQueue = (db: Db) => {
  let q = queues.get(db);
  if (!q) queues.set(db, (q = new FamilyQueue()));
  return q;
};

/** A transaction holding the family's row lock, queued behind the family's other writes (`FamilyQueue`). */
export function familyTransaction<T>(db: Db, familyId: string, fn: (tx: Tx, family: typeof schema.families.$inferSelect) => Promise<T>): Promise<T> {
  return familyQueue(db).run(familyId, () => db.transaction(async (tx) => fn(tx, await lockFamily(tx, familyId))));
}
