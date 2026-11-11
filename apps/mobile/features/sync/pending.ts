import { inArray } from 'drizzle-orm';
import { db, schema } from '../../db/client';

/** SQLite limits the variables in one statement; ids go in chunks of this size. */
const ID_CHUNK = 500;

/** Marks rows as not yet uploaded, so the next run pushes them: every child and entry, or only those with these ids. */
export async function markAllPending(ids?: string[]) {
  if (!ids) {
    await db.update(schema.childrenTable).set({ syncStatus: 'pending' });
    await db.update(schema.logsTable).set({ syncStatus: 'pending' });
    return;
  }
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    await db.update(schema.childrenTable).set({ syncStatus: 'pending' }).where(inArray(schema.childrenTable.id, chunk));
    await db.update(schema.logsTable).set({ syncStatus: 'pending' }).where(inArray(schema.logsTable.id, chunk));
  }
}
