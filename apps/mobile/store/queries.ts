import { useEffect, useState } from 'react';
import { and, asc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { LogEntry, LogType } from '@subby/shared';
import { db, schema } from '../db/client';
import { runningTimer } from '../db/logFilters';
import { useLogStore } from './useLogStore';

/** Feeds with foods; avoids parsing thousands of milk feeds. Use with `types: ['feed']`. */
export const HAS_FOODS = sql`json_extract(payload, '$.foods') IS NOT NULL`;

export type LogQuery = {
  /** Entries that overlap [from, to): started in it, or still running/ending inside it. */
  from?: number;
  to?: number;
  types?: readonly LogType[];
  where?: SQL;
};

/** Read entries for a child straight from SQLite (beyond the store's in-memory window). */
export async function fetchLogs(childId: string, q: LogQuery = {}): Promise<LogEntry[]> {
  const t = schema.logsTable;
  const conditions = [eq(t.childId, childId), eq(t.isDeleted, false)];
  if (q.from !== undefined) {
    conditions.push(or(gte(t.startedAt, q.from), gte(t.endedAt, q.from), runningTimer())!);
  }
  if (q.to !== undefined) conditions.push(lt(t.startedAt, q.to));
  if (q.types) conditions.push(inArray(t.logType, [...q.types]));
  if (q.where) conditions.push(q.where);
  return db.select().from(t).where(and(...conditions)).orderBy(asc(t.startedAt));
}

/**
 * Entries for the active child matching `q`, re-read after every write (any add/edit/delete,
 * even outside the store's window). `null` while loading.
 */
export function useLogQuery(q: LogQuery): LogEntry[] | null {
  const childId = useLogStore((s) => s.activeChildId);
  const revision = useLogStore((s) => s.revision);
  const key = JSON.stringify({ childId, from: q.from, to: q.to, types: q.types });
  const [data, setData] = useState<{ key: string; rows: LogEntry[] } | null>(null);

  useEffect(() => {
    if (!childId) return;
    let alive = true;
    void fetchLogs(childId, q).then((rows) => alive && setData({ key, rows }));
    return () => {
      alive = false;
    };
    // `where` is expected to be stable per call site; the rest is captured by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);

  // Keep showing the previous result while an edit re-reads, but not another child's/range's.
  return data?.key === key ? data.rows : null;
}
