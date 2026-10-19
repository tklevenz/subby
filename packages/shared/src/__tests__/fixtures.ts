import type { LogEntry, LogPayload } from '../schemas/log.schema';

let seq = 0;
export function entry(payload: LogPayload, startedAt: number, endedAt: number | null = null): LogEntry {
  seq += 1;
  return {
    id: `0190a000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    childId: '0190a000-0000-7000-8000-000000000000',
    logType: payload.type,
    startedAt,
    endedAt,
    updatedAt: startedAt,
    isDeleted: false,
    syncStatus: 'pending',
    importRef: null,
    createdBy: null,
    payload,
  };
}

/** Sort DESC by startedAt, like the store does. */
export const desc = (logs: LogEntry[]) => [...logs].sort((a, b) => b.startedAt - a.startedAt);
