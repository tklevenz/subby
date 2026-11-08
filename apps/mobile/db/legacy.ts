import type { LogEntry, LogPayload } from '@subby/shared';

/** Row shape of the v0 `logs` table created by the old bootstrap SQL. */
export type LegacyLogRow = {
  id: string;
  child_id: string;
  log_type: string;
  started_at: number;
  updated_at: number;
  is_deleted: number;
  sync_status: 'pending' | 'synced';
  payload: string;
};

type LegacyPayload =
  | { type: 'diaper'; condition: 'wet' | 'dirty' | 'both'; notes?: string }
  | {
      type: 'feed';
      method: 'bottle' | 'breast_left' | 'breast_right' | 'breast_both' | 'solids';
      amountMl?: number;
      durationSeconds?: number;
      notes?: string;
    }
  | { type: 'sleep'; endedAt: number | null; notes?: string };

/** Convert a v0 row to the current entry shape (endedAt column, breast sides). */
export function upgradeLegacyRow(row: LegacyLogRow): LogEntry {
  const old = JSON.parse(row.payload) as LegacyPayload;
  let payload: LogPayload;
  let endedAt: number | null = null;

  switch (old.type) {
    case 'sleep':
      payload = { type: 'sleep', notes: old.notes };
      endedAt = old.endedAt;
      break;
    case 'feed': {
      const secs = old.durationSeconds ?? 0;
      endedAt = row.started_at + secs * 1000;
      if (old.method === 'breast_left') {
        payload = { type: 'feed', method: 'breast', leftSeconds: secs, lastSide: 'left', notes: old.notes };
      } else if (old.method === 'breast_right') {
        payload = { type: 'feed', method: 'breast', rightSeconds: secs, lastSide: 'right', notes: old.notes };
      } else if (old.method === 'breast_both') {
        const half = Math.round(secs / 2);
        payload = { type: 'feed', method: 'breast', leftSeconds: half, rightSeconds: secs - half, notes: old.notes };
      } else {
        payload = { type: 'feed', method: old.method, amountMl: old.amountMl, notes: old.notes };
      }
      break;
    }
    default:
      payload = old;
  }

  return {
    id: row.id,
    childId: row.child_id,
    logType: payload.type,
    startedAt: row.started_at,
    endedAt,
    updatedAt: row.updated_at,
    isDeleted: Boolean(row.is_deleted),
    syncStatus: row.sync_status,
    importRef: null,
    createdBy: null,
    payload,
  };
}
