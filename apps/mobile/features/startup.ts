import { initDatabase } from '../db/client';
import { useChildStore } from '../store/useChildStore';
import { useSettingsStore } from '../store/useSettingsStore';

let ready: Promise<void> | null = null;

/**
 * Opens and migrates the database and loads settings and children, once per JS runtime. Shared by the app's
 * first render and background tasks (which can start the runtime without any UI), so neither does it twice.
 */
export function appReady(): Promise<void> {
  ready ??= (async () => {
    await initDatabase();
    await Promise.all([useSettingsStore.getState().hydrate(), useChildStore.getState().hydrate()]);
  })().catch((e: unknown) => {
    ready = null; // let the next caller try again
    throw e;
  });
  return ready;
}
