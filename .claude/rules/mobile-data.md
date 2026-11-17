---
paths:
  - "apps/mobile/db/**"
  - "apps/mobile/store/**"
  - "apps/mobile/features/**"
  - "apps/mobile/app/backup.tsx"
  - "apps/mobile/app/import/**"
  - "apps/mobile/app/reminders.tsx"
  - "apps/mobile/app/_layout.tsx"
  - "apps/mobile/index.ts"
---

# Mobile: database, stores, features

## DB
- `db/schema.ts` (Drizzle): tables `children`, `logs` (generic, JSON `payload`, `ended_at`, `import_ref` unique), `settings` (kv), `reminders`.
- `db/client.ts`: `initDatabase()` runs migrations at startup and upgrades pre-migration v0 databases via `db/legacy.ts`.
- **Schema changes:** edit `db/schema.ts`, then `cd apps/mobile && npx drizzle-kit generate --name <change>`. Commit the generated `db/migrations/*`, and never edit an applied migration.
- **Encryption:** `app.json` sets `expo-sqlite` `useSQLCipher`. `openAppDatabase()` opens `subby.db` with a random 256-bit raw key from `expo-secure-store` (`kl.dbKey`, `AFTER_FIRST_UNLOCK`). The startup decision is the pure `planOpen` in `db/encryption.ts` (tested):
  - The pre-encryption plain `subby-plain.db` is copied in once with `sqlcipher_export`, then deleted. Every step is safe to re-run after a crash.
  - An encrypted file whose key is missing (e.g. Android restore) is moved aside as `subby.unreadable-<ts>.db`, never deleted.
  - Expo Go has no SQLCipher (`PRAGMA cipher_version` is empty) and keeps using plain `subby-plain.db`.
  - Never log or export the key. Inspect a device database with `sqlcipher`, not `sqlite3`.
- `db/tombstone` (`deletedLog(s)`) is the only way to scrub a deleted log.

## Stores (Zustand, write-through to SQLite)
- `useLogStore`: date-windowed load + `loadOlder`, `addLog`, `startTimer`/`stopTimer`, `updateLog(id, {payload?, startedAt?, endedAt?})`, `softDeleteLog` (keeps only id and type: the payload becomes `{type}`), `getLog`. Update, delete and `getLog` work for entries outside the loaded window too (falling back to SQLite). `revision` is bumped on every write.
- Note photos are deleted from disk when their entry is deleted or the photo is replaced (`features/photos.ts`).
- `queries.ts`: `fetchLogs(childId, {from, to, types, where})` reads SQLite directly; `useLogQuery` re-reads on every `revision`. Use these for anything beyond the store's 30-day window: History day/week, Trends, Growth, Solids, Export, and all-time lookups such as allergens in `FoodPicker` and milestones done. `HAS_FOODS` filters feeds that have foods.
- `useChildStore` (`deleteChild` turns the child's logs into scrubbed tombstones (`{type}` payload) so deletes reach other phones, deletes its reminders and photos, and leaves a scrubbed tombstone row), `useSettingsStore` (units, clock, activeChildId…; `set` updates memory before the DB write, so back-to-back read-modify-writes like `saveSync` don't lose each other's changes, and `null` deletes the row because `value` is NOT NULL), `useActiveChild`.
- `store/timeHelpers.ts`: `useNow`, `useFormatTime`, `formatDayLabel`, ISO date helpers; re-exports the shared formatters.

## Photos (`features/photos.ts`)
- `pickPhoto` shrinks when picked with `expo-image-manipulator`: longest edge 2048 px (avatars 512), re-encoded as JPEG (0.8), which also drops location and camera metadata; then copied into `Paths.document/photos`. If shrinking fails, the original is kept.
- Resolve a stored reference with `photoFile(ref)` (`Image` sources, sharing) or the helpers here; older rows holding a full path use its last part, so no migration.

## Backup (`app/backup.tsx`, `features/backup.ts`)
Settings → Backup & restore; also linked from onboarding, not route-guarded.
- Back up: everything on the phone into one file.
  - Android saves straight to the public Downloads folder through the local native module `modules/subby-downloads` (MediaStore, Android 10+, no permission; autolinked, so changing it needs a prebuild). Android's folder picker doesn't allow Downloads itself.
  - iOS opens the share sheet, which has "Save to Files".
  - The cache copy is deleted afterwards.
- Restore: pick a file with `File.pickFileAsync` (no document-picker package), preview, then merge in one transaction. Restored rows are `pending`, so they sync.
- The screen waits a frame before working (`nextFrame`), since zip and the transaction are synchronous and would block the loader. Without children (a fresh install) only Restore is shown.
- An import ref already used by another row here is dropped from the restored row.

## Reminders (`features/reminders/scheduler.ts`)
- expo-notifications, local only. `useReminderSync` (in `_layout`) re-plans on log/child/settings changes and app foreground, debounced and serialized.
- Reminder settings are device-local (`settings.reminders`), not the synced `reminders` table, which is still unused.
- Kinds: feed, diaper and pumping intervals, medication due, nap/bedtime, and forgotten timers.
- Not a reminder: "When another phone logs a sleep" (Settings → Notifications, its own switch, `settings.familyAlerts`; only with Sync). `features/reminders/family.ts`: `notifyFamily` runs after each sync run, headless too, on the entries other phones wrote; off by default, so each phone opts in and a grandparent's stays quiet; timely only with push.
- `enabled` is a pause-all switch (default on), shown on the Reminders screen only once a kind is set up; Settings has one Reminders row with the real state (Off, N on, Paused, Blocked: permission denied for good), no switch. Permission is asked when the first kind is turned on.
- Tapping a notification switches to that child; forgotten-timer reminders also open the entry.
- expo-notifications is `require`d lazily and skipped in Expo Go on Android (it crashes on import there); `remindersAvailable` is false in that case. **Never import it statically.**

## Baby Buddy import (`features/import/babybuddy/`, `app/import/babybuddy.tsx`)
- The wizard: connect → review children/units → progress → summary. Not route-guarded, so onboarding can link to it.
- `client.ts`: read-only REST client (token auth, paging: only the offset is taken from `next` (`nextOffset`), and it must move forward, so the token never follows a link elsewhere).
- `importer.ts`: `previewImport` (counts, children, unit detection) and `runImport` (one transaction per page, `onConflictDoNothing` on `import_ref`, so re-runs only add new records and never overwrite local edits).
- The API key is never persisted. Only `settings.bbUrl` is remembered.
- Opt-in tests that hit real data (kept outside the repo): `BB_DUMP=<all.json> pnpm --filter @subby/shared test`, `BB_URL=… BB_TOKEN=… npx vitest run client` in `apps/mobile`.

## Diagnostics (`features/diagnostics.ts`)
Settings → Help → Share diagnostics: a plain-text report for support (version, system, counts, reminders, background, sync status and `useSyncStore.lastError`, access), shown first and shared only through the share sheet. No names, ids or own-server address; no analytics or crash SDK.

## Helpers
`features/errorMessage` (`errorMessage(e)`), `useAsyncAction` (busy/error), `usePoll` (never overlapping ticks), `usePayloadForm`, `optionalModule` (lazy native modules; Expo Go). Shared: `notePhoto`, `endBeforeStart`, `sameName`, `hasStool`, `MEASURES`, `MINUTE_MS`/`HOUR_MS`/`DAY_MS`.
