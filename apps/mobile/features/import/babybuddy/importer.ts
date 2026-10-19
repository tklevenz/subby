import { uuidv7 } from 'uuidv7';
import {
  BB_ENDPOINTS,
  bbRef,
  detectUnits,
  mapRecord,
  type BBChild,
  type BBEndpoint,
  type ImportUnits,
  type LogEntry,
  type UnitSystem,
} from '@kindred-log/shared';
import { db, schema } from '../../../db/client';
import type { BBClient } from './client';

export type ImportPreview = {
  children: BBChild[];
  counts: Record<BBEndpoint, number>;
  units: ImportUnits;
  /** Sample raw values per measure, to show what the detected units mean. */
  examples: Partial<Record<keyof ImportUnits, number>>;
};

/** Connect, list children, count entries and detect units from recent samples. */
export async function previewImport(client: BBClient, fallback: UnitSystem): Promise<ImportPreview> {
  await client.profile();
  const [children, countList, feedings, pumping, weight, height, head, temperature] = await Promise.all([
    client.children(),
    Promise.all(BB_ENDPOINTS.map((e) => client.count(e))),
    client.sample('feedings', 200),
    client.sample('pumping'),
    client.sample('weight'),
    client.sample('height'),
    client.sample('head-circumference'),
    client.sample('temperature'),
  ]);

  const volume = [
    ...feedings.flatMap((f) => (f.amount ? [f.amount] : [])),
    ...pumping.map((p) => p.amount),
  ];
  const samples = {
    volume,
    weight: weight.map((w) => w.weight),
    length: height.map((h) => h.height),
    head: head.map((h) => h.head_circumference),
    temperature: temperature.map((t) => t.temperature),
  };

  return {
    children,
    counts: Object.fromEntries(BB_ENDPOINTS.map((e, i) => [e, countList[i]])) as Record<BBEndpoint, number>,
    units: detectUnits(samples, fallback),
    examples: {
      volume: volume[0],
      weight: samples.weight[0],
      length: samples.head[0] ?? samples.length[0],
      temperature: samples.temperature[0],
    },
  };
}

export type ImportProgress = { endpoint: BBEndpoint; done: number; total: number };
export type ImportResult = {
  imported: number;
  skipped: number; // already imported earlier (same server + record id)
  failed: { ref: string; reason: string }[];
  cancelled: boolean;
};

/**
 * Import every endpoint. Idempotent: rows are keyed by import_ref (unique), so re-running
 * only adds records that are new on the server; local edits to imported rows are never overwritten.
 */
export async function runImport(opts: {
  client: BBClient;
  units: ImportUnits;
  counts: Record<BBEndpoint, number>;
  /** Baby Buddy child id → Kindred child id. */
  childMap: Map<number, string>;
  /** For records without a child (BB allows that on feedings/sleep/pumping…). */
  fallbackChildId: string;
  onProgress: (p: ImportProgress) => void;
  isCancelled: () => boolean;
}): Promise<ImportResult> {
  const { client, units, childMap, fallbackChildId, onProgress, isCancelled } = opts;
  const result: ImportResult = { imported: 0, skipped: 0, failed: [], cancelled: false };

  for (const endpoint of BB_ENDPOINTS) {
    const total = opts.counts[endpoint];
    if (!total) continue;
    let done = 0;
    onProgress({ endpoint, done, total });

    for await (const page of client.pages(endpoint)) {
      if (isCancelled()) return { ...result, cancelled: true };
      const now = Date.now();
      const rows: LogEntry[] = [];

      for (const record of page.results) {
        try {
          const m = mapRecord(endpoint, record, client.host, units);
          const childId = (m.bbChildId !== null && childMap.get(m.bbChildId)) || fallbackChildId;
          rows.push({
            id: uuidv7(),
            childId,
            logType: m.payload.type,
            startedAt: m.startedAt,
            endedAt: m.endedAt,
            updatedAt: now,
            isDeleted: false,
            syncStatus: 'pending',
            importRef: m.importRef,
            createdBy: null,
            payload: m.payload,
          });
        } catch (err) {
          result.failed.push({ ref: bbRef(client.host, endpoint, record.id), reason: String(err) });
        }
      }

      // One transaction per page; existing import refs are skipped.
      db.transaction((tx) => {
        for (const row of rows) {
          const r = tx.insert(schema.logsTable).values(row).onConflictDoNothing({ target: schema.logsTable.importRef }).run();
          if (r.changes > 0) result.imported++;
          else result.skipped++;
        }
      });

      done += page.results.length;
      onProgress({ endpoint, done, total });
    }
  }
  return result;
}
