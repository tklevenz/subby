/**
 * TEMPORARY (dogfooding, LAUNCH.md A16): a ring buffer of sync events (live socket, pushes, runs) kept on the phone
 * and shown at the end of Settings → Diagnostics, to find out why a phone missed another phone's sleep.
 * Remove before the store release: this file, its `syncEvent` calls (grep `syncEvent`), the Diagnostics section and
 * the `debugSyncLog` settings row (delete it in a cleanup step, or leave it: nothing reads it then).
 *
 * Nothing personal: event names, counts, HTTP statuses and error messages, never ids or entry contents.
 * Every event also goes to logcat (`[synclog]`), so `adb logcat -s ReactNativeJS` shows them live.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/client';

const KEY = 'debugSyncLog';
const MAX = 300;

let events: string[] | null = null;
let loading: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function load() {
  if (events) return;
  loading ??= (async () => {
    try {
      const [row] = await db.select().from(schema.settingsTable).where(eq(schema.settingsTable.key, KEY));
      const saved = Array.isArray(row?.value) ? (row.value as string[]) : [];
      events = saved.slice(-MAX);
    } catch {
      events ??= [];
    }
  })();
  await loading;
}

/** Writes the buffer soon (several events in a burst are one write). A headless run calls `flushSyncEvents` itself. */
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushSyncEvents();
  }, 1000);
}

export async function flushSyncEvents() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  try {
    await load();
    const value = events ?? [];
    await db.insert(schema.settingsTable).values({ key: KEY, value }).onConflictDoUpdate({ target: schema.settingsTable.key, set: { value } });
  } catch {
    // The database isn't open yet (a very early event) or is busy: the next event writes again.
  }
}

/** Notes one event with the local time. Fire and forget; never throws. */
export function syncEvent(what: string) {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const line = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${what}`;
  console.log(`[synclog] ${line}`); // i18n-ignore
  void load().then(() => {
    events!.push(line);
    if (events!.length > MAX) events!.splice(0, events!.length - MAX);
    scheduleFlush();
  });
}

/** For Diagnostics: newest last. */
export async function syncEvents(): Promise<string[]> {
  await load();
  return [...(events ?? [])];
}
