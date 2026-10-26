# Project Handoff & Context Specification: `kindred-log`

## 1. Project Overview
`kindred-log` is a local-first, offline-capable baby/child activity tracking mobile application (logging feeds, diapers, and sleep/wake windows) built within a `pnpm` monorepo (`~/src/kindred-log`)[cite: 4].

## 2. Tech Stack & Environment
- **Monorepo / Package Manager:** `pnpm` workspaces (Turborepo / `pnpm run dev` task runner)[cite: 4]
- **Mobile Framework:** Expo SDK 57 (recently upgraded from an earlier SDK to match the latest Expo Go client)[cite: 4]
- **Core Libraries (SDK 57):** React 19.2.3, React Native 0.86.3, TypeScript 6, `expo-router` ~57.0.28, Reanimated 4.5.1 / Worklets 0.10.1, New Architecture enabled. Use `npx expo install <pkg>` (not `pnpm add`) for anything Expo-managed; verify with `npx expo install --check`.
- **Styling:** NativeWind v4 (`nativewind/babel` preset) + Tailwind CSS. Dark only for launch (slate ground, muted cards, pastel accents), but built for themes:
  - `apps/mobile/theme/palette.js` is the single source of every UI color, by role (`ground`, `surface`, `raised`, `line`, `ink`/`inkMuted`/`inkFaint`…, and per hue `violet` (500, for tints and borders with opacity), `violetSoft` (300), `violetPale` (200), `violetStrong` (400), `violetDeep` (600), `violetFaint` (100); plus `avatarNBg`/`avatarNInk`).
  - `tailwind.config.js` replaces Tailwind's palette with these roles as CSS variables: write `bg-surface`, `text-ink-muted`, `border-violet/40`, never `bg-slate-900` (raw palette classes no longer exist and silently do nothing).
  - Color props in JS (icons, charts, navigation) use `colors.<role>` from `theme/colors`, read at render time (no module-level copies; `TYPE_META.color` is a getter). No hex literals except data colors (diaper swatches).
  - `theme/palette.test.ts` fails on raw palette classes or hex literals in `app/`, `components/`, `features/`.
  - Adding a theme later: add a map next to `dark` with the same keys (the test checks), switch the CSS variables (NativeWind `vars()` or a `.dark:root`/class block) and swap `colors`.
- **State & Local Persistence:** Zustand (in-memory UI state) backed by `expo-sqlite` via `drizzle-orm/expo-sqlite` (SQLCipher-encrypted in native builds, plain in Expo Go), with Drizzle migrations (see §3 DB).
- **Runtime Environment:** Node.js v24.9.0 on macOS (Apple Silicon)[cite: 4]

## 3. Repository & File Structure

Roadmap: see `PROJECT.md` §5. The feature-parity plan (Huckleberry + Baby Buddy, phases 1–6) is summarized there.

### `packages/shared` (`@kindred-log/shared`, consumed as TS source)
- `src/schemas/log.schema.ts`: `LogEntry` + discriminated `LogPayload` union (feed, diaper, sleep, pumping, growth, temperature, medication, potty, activity, milestone, note). Canonical units only: ml, g, cm, °C, seconds, epoch ms.
- **`endedAt` rule:** for `TIMED_LOG_TYPES` (sleep, feed, pumping, activity), `endedAt` is always set once the entry is complete (= `startedAt` for instant ones like a bottle), and `null` means a running timer. For other types it's always `null`.
- `src/schemas/child.schema.ts`: `Child`.
- `src/crypto/` (import from `@kindred-log/shared/crypto`): end-to-end encryption for sync, shared by the app and the server.
  - Built on the audited `@noble/*` and `@scure/bip39` libraries. Never hand-roll primitives, and never use `Math.random` for keys.
  - React Native must call `setRandomSource` with `expo-crypto` at startup.
  - Contents:
    - `aead` (XChaCha20-Poly1305).
    - `keys`: device identity (Ed25519 sign + X25519 box) and sealed boxes.
    - `recovery`: 24 words to an identity. Its test vector must never change, or existing recovery keys stop working.
    - `pairing`: the 6-digit code.
    - `deviceLog`: the signed, hash-chained family membership. Every client verifies it.
    - `files`: chunked photo encryption.
- `src/sync/` (`@kindred-log/shared/sync`):
  - `envelope`: `sealRecord`/`openRecord`. Metadata is bound to the ciphertext as AAD; tombstones carry no data.
  - `merge`: last-writer-wins with a device-id tie-break, the same rule on server and client.
  - Plan: `~/.claude/plans/let-s-analyze-the-current-precious-scroll.md` (Phase 2).
- `src/domain/`: pure, RN-free helpers. Put new business logic here and test it with vitest (`src/__tests__`).
  - `units`, `time`, `summary`, `validate` (`isCompletePayload` gates Save).
  - `feedTimer`: breastfeeding L/R timer state lives in the feed payload (`timerSide`, `timerSideSince`); `toggleSide`/`pauseFeed`.
  - `recent` (food/tag/medication suggestions, `medicationsDue`, `recentShortcuts` for Home: the 3 most recently logged categories besides the big tiles, tummy time separate, defaults Pump/Meds/Tummy), `milestones` (bundled checklist).
  - `stats` (`dailyStats` per-day totals, splitting sleep across midnight; `averageStats` over tracked days; `sleepSegments`; `solidsReport`; DST-safe `addDays`/`dayRange`).
  - `growth`: WHO LMS z-scores/percentiles (0–24 months, from the birth date; corrected age for preterm babies was dropped on purpose, and `dueDate` is stored but unused), `percentileCurves`. The tables in `domain/who/lms.ts` are generated from the CDC-hosted WHO CSVs; don't edit them by hand.
  - `prediction`: on-device nap prediction. Age norms (`ageNorms`), plus `sleepHabits` (the last 7 days; night sleep logged in pieces is merged into one night), `predictNextSleep` (put-down window plus `napMinutes`, the expected nap length) and `suggestedSchedule`. Heuristic, verified against the real Baby Buddy history.
  - `reminders`: `planReminders` (pure) turns `ReminderSettings` + per-child state into the notifications to schedule (stable `kl:` ids).
  - `story`: `childStory` builds a child's story of firsts (milestones, measurements, first solid food, birth), newest first. No counts or completion: we don't gamify childcare.
  - `csv`: `logsToCsv` (one file, mixed types, only used columns, formula-injection safe).
  - `babybuddy`: Baby Buddy record types, `mapRecord` (BB → payload), `detectUnits` (BB stores no units; e.g. weight may be g or kg), `bbRef` import refs.

### `apps/mobile`
- **Config:**
  - `app.json`: plugins `expo-router`, `expo-sqlite`, `expo-secure-store`, `expo-camera` (QR scanning; no microphone), `expo-notifications`, `expo-background-task`. No system date picker (see `DateTimeField`).
  - `babel.config.js`: `babel-preset-expo` with `jsxImportSource: 'nativewind'`, `nativewind/babel`, and `inline-import` for `.sql`.
  - `metro.config.js`: `withNativeWind(... './global.css')`, plus `sql` in `sourceExts`.
  - pnpm note: `react-native-css-interop` must stay a direct dependency or Metro can't resolve the NativeWind JSX runtime.
- **DB:**
  - `db/schema.ts` (Drizzle): tables `children`, `logs` (generic, JSON `payload`, `ended_at`, `import_ref` unique), `settings` (kv), `reminders`.
  - `db/client.ts`: `initDatabase()` runs migrations at startup and upgrades pre-migration v0 databases via `db/legacy.ts`.
  - **Encryption:** `app.json` sets `expo-sqlite` `useSQLCipher`. `openAppDatabase()` opens `kindred.db` with a random 256-bit raw key from `expo-secure-store` (`kl.dbKey`, `AFTER_FIRST_UNLOCK`). The startup decision is the pure `planOpen` in `db/encryption.ts` (tested):
    - The pre-encryption plain `kindred-log.db` is copied in once with `sqlcipher_export`, then deleted. Every step is safe to re-run after a crash.
    - An encrypted file whose key is missing (e.g. Android restore) is moved aside as `kindred.unreadable-<ts>.db`, never deleted.
    - Expo Go has no SQLCipher (`PRAGMA cipher_version` is empty) and keeps using plain `kindred-log.db`.
    - Never log or export the key. Inspect a device database with `sqlcipher`, not `sqlite3`.
  - **Schema changes:** edit `db/schema.ts`, then `cd apps/mobile && npx drizzle-kit generate --name <change>`. Commit the generated `db/migrations/*`, and never edit an applied migration.
- **Stores (Zustand, write-through to SQLite):**
  - `useLogStore`: date-windowed load + `loadOlder`, `addLog`, `startTimer`/`stopTimer`, `updateLog(id, {payload?, startedAt?, endedAt?})`, `softDeleteLog`, `getLog`. Update, delete and `getLog` work for entries outside the loaded window too (falling back to SQLite). `revision` is bumped on every write.
  - Note photos are deleted from disk when their entry is deleted or the photo is replaced (`features/photos.ts`).
  - `queries.ts`: `fetchLogs(childId, {from, to, types, where})` reads SQLite directly; `useLogQuery` re-reads on every `revision`. Use these for anything beyond the store's 30-day window: History day/week, Trends, Growth, Solids, Export, and all-time lookups such as allergens in `FoodPicker` and milestones done. `HAS_FOODS` filters feeds that have foods.
  - `useChildStore` (`deleteChild` hard-deletes the child's logs, reminders and photos and leaves a scrubbed tombstone row), `useSettingsStore` (units, clock, activeChildId, isPremium stub; `set` updates memory before the DB write, so back-to-back read-modify-writes like `saveSync` don't lose each other's changes, and `null` deletes the row because `value` is NOT NULL), `useActiveChild`.
- **Routes (expo-router):**
  - `app/_layout.tsx`: DB init + hydration; `Stack.Protected` sends users to `onboarding` when no child exists.
  - `app/(tabs)/`:
    - `index`: Home: `components/home/HomeTiles` shows Sleep, Feed and Diaper as big tiles. The pinned tile sits on top (sleep by default; long-press a tile to pin it; `settings.homeTop` per child) and the other two side by side. Below: medication due, links to the sleep schedule and today's log, and shortcuts (`recentShortcuts` → `logTile`, plus More). Running pumping/activity timers show above the tiles via `ActiveTimers`.
      - Tapping the sleep tile (start or wake up) offers Undo for 5 s; a running sleep has a Discard button (with a confirmation). Accidental taps on the big tile are easy.
      - The header: the avatar opens the child's profile, the name switches child (`ChildSwitcher`).
    - `history`: List, Day (24 h lanes) and Week (sleep pattern + totals) views.
    - `trends`: 7/14/30-day averages and charts.
    - `settings`: includes a `__DEV__`-only Premium stub toggle.
  - `app/schedule.tsx` (next sleep + suggested day; linked from Home's "Sleep schedule" row), `app/reminders.tsx`.
  - `app/growth.tsx` (WHO chart, share as PNG via view-shot + expo-sharing), `app/solids.tsx`, `app/export.tsx` (CSV, Premium-gated).
  - `app/entry/[id].tsx`: edit/backdate any entry.
  - `app/child/new.tsx`: add a child (modal). It shows `PremiumGate` instead once the free limit is reached.
  - **Premium gates** (`isPremium` stub; dev toggle in Settings):
    - CSV export.
    - More than `FREE_CHILD_LIMIT` (1) children. This is checked by `useCanAddChild` in the UI and enforced again in `useChildStore.addChild`.
    - The Baby Buddy import defaults extra children to "Don't import" for free users.
  - `app/child/[id]/index.tsx`: the child's profile page (no stack header). Full-width photo cover with name and age, a growth chart (Weight/Length/Head, WHO band), and the story of firsts (`childStory`).
  - `app/child/[id]/edit.tsx`: edit details; the danger zone deletes a child after the user types its name.
  - Settings shows children as an avatar strip linking to their profiles. App-wide settings stay in Settings.
  - `app/import/babybuddy.tsx`: import wizard (connect → review children/units → progress → summary). Not route-guarded, so onboarding can link to it.
- **Components:**
  - `charts/`: hand-rolled with `react-native-svg` and Views (no chart library): `BarChart` (stacked), `DayTimeline`, `WeekPattern`, `GrowthChart`.
  - `ChildSwitcher` (avatar, switch child, open a profile), `ActiveTimers`, `LogTimeline` (day-grouped, History) / `LogRow` (tap to open; delete only from the entry screen).
  - `ChildAvatar`: the photo, or the child's initial on a per-child color. `PhotoMenu`: take/choose/remove; it runs the picker only after its modal has dismissed (iOS).
  - `logTypes.tsx`: `TYPE_META` (label/icon/colors) + `defaultPayload` per type. `logDisplay.tsx`: row text per entry.
  - `icons/`: all icons are Font Awesome 6 Free **solid**, drawn with `react-native-svg` (no icon font, no Lucide). `faPaths.ts` is generated from `@fortawesome/fontawesome-free/svgs/solid` (don't edit by hand); add an icon by adding its name there and a `make('<name>')` export in `index.tsx`. `PoopDroplet` (poop with a masked-out droplet) is the diaper icon. The CC BY 4.0 credit is at the bottom of Settings; keep it.
  - `editors/`: **one editor per log type** (`EDITORS` registry), shared by the "log new" sheet and the edit screen. `fields.tsx` has NumberField/UnitNumberField (canonical value, display unit), TagsField, PhotoField (copies into `Paths.document/photos`); `FoodPicker`.
  - `sheets/`: `SheetHost` owns the **single** `BottomSheet` on Home and swaps content per `useSheetStore` request: `FeedSheet` (live L/R timer, bottle, solids), `LogSheet` (generic, + `CommonFields` notes/tags; sleep, pumping and activity take a start and an end, where an empty end ("Still going") saves a running timer), `AddLogSheet` (grid of `LOG_TILE_KEYS`: every type, with Tummy time as its own tile; `logTile` in `logTypes.tsx` is shared with the Home shortcuts), `DiaperSheet` (one tap on Wet/Dirty/Both logs now, then optional color, Undo, auto-closes; Wet is blue, Dirty brown, Both neutral with both icons). Keep one Modal (iOS can't present while another dismisses).
  - `ui.tsx`: Chip, Segmented, TextField, Button, Card, Row.
  - `DateTimeField`: our own wheel sheet (`components/datetime/`: `WheelColumn`, tested `parts.ts`), the same on iOS and Android, replacing the system pickers.
    - `datetime` mode: day ("Today", "Yesterday", "Sat, Oct 24"…, a year back or to the value), hour and minute, plus AM/PM on a 12-hour clock.
    - `date` mode (birth date): day, month and year.
    - A value past `maximumDate` saves as the maximum.
- **Reminders (`features/reminders/scheduler.ts`):** expo-notifications, local only. `useReminderSync` (in `_layout`) re-plans on log/child/settings changes and app foreground, debounced and serialized. Reminder settings are device-local (`settings.reminders`), not the synced `reminders` table, which is still unused. Kinds: feed, diaper and pumping intervals, medication due, nap/bedtime, and forgotten timers. A master `enabled` switch also appears in Settings. Tapping a notification switches to that child; forgotten-timer reminders also open the entry. expo-notifications is `require`d lazily and skipped in Expo Go on Android (it crashes on import there); `remindersAvailable` is false in that case. Never import it statically.
- **Baby Buddy import (`features/import/babybuddy/`):**
  - `client.ts`: read-only REST client (token auth, paging; rewrites `next` links to the user's base URL).
  - `importer.ts`: `previewImport` (counts, children, unit detection) and `runImport` (one transaction per page, `onConflictDoNothing` on `import_ref`, so re-runs only add new records and never overwrite local edits).
  - The API key is never persisted. Only `settings.bbUrl` is remembered.
  - Opt-in tests that hit real data (kept outside the repo): `BB_DUMP=<all.json> pnpm --filter @kindred-log/shared test`, `BB_URL=… BB_TOKEN=… npx vitest run client` in `apps/mobile`.
- **Sync (`features/sync/`, the client of `apps/server`):**
  - `keystore.ts`: this device's identity seed and the family keys by epoch, in SecureStore. It installs `expo-crypto` as the shared crypto's random source on import.
  - `api.ts`: `checkServer`, `createFamily`, and `SyncSession`, which logs in by signed challenge and logs in again on 401.
  - `records.ts` (tested): local row ↔ encrypted body. Photo paths and Baby Buddy import refs are device-local and never synced.
  - **Photos** (`photos.ts`): a photo syncs as an encrypted blob with its own key; the reference `photoBlob: {id, key}` sits in the encrypted record (`children.photo_blob`, note `payload.photoBlob`), and `photoUri` stays this device's file.
    - Stores clear `photoBlob` whenever `photoUri` changes; `uploadPhotos` (before each push) uploads rows with a file but no reference, without bumping their version.
    - `downloadPhotos` (after each pull) fetches references without a local file into `photos/<blobId>.jpg`; a pulled version pointing at another blob drops (and deletes) the local copy.
    - `queueUnsyncedPhotos` re-queues photos from before photo sync, as an edit.
    - Each record lists its blob ids (`SyncRecord.blobs`, not in the AAD) so the server can delete unused photos.
    - Blob up/download uses `expo/fetch` (raw bytes).
  - `engine.ts`:
    - `setUpSync` creates the family; `turnOffSync` leaves the family (a self `remove` in the device log, best effort) and forgets this phone's keys.
    - Every run verifies the device log (`refreshMembers`): `members` for the UI, `newDevices` for the "New phone in your family" alert, and `removed` when another phone removed this one.
    - Phone names are encrypted `device` records (id = device id); a phone without one names itself (`defaultDeviceName`, from expo-device).
    - `syncNow` runs serialized: refresh keys, push pending rows in batches of 500 (marked synced only if unchanged since read), then pull since `settings.sync.lastSeq` and apply in a transaction with `clientApplies`.
    - Own echoes are skipped. A stale push re-pulls from 0.
    - The live WebSocket triggers pulls. `useSyncStore` holds the status for the UI.
  - `useSyncEngine` (in `_layout`) triggers sync on start, on store changes (debounced), when the app comes to the foreground, and on live messages.
  - **Background** (`background.ts`, imported first by the entry `index.ts`, because headless launches render no screen): `backgroundSync` = `appReady()` (`features/startup.ts`, opens the DB once per runtime) + `syncNow` + `replanReminders`.
    - Runs from an `expo-background-task` periodic task (everyone; at best every 15 min) and from an `expo-notifications` background task when a hosted server's "sync now" push arrives.
    - `setUpBackgroundSync` (each foreground start) registers the tasks, stores whether the server pushes (`settings.sync.push`), and registers the Expo push token. The token needs an Expo project id (`extra.eas.projectId`); without one, registration is skipped.
    - Without push and with other phones, medication reminders say to check the app first (`planReminders({ checkBeforeDosing })`).
  - `family.ts` (pairing): inviter `createInvite` → `inviteStatus` → `claimCode` (checks the claim's MAC) → `approveClaim` (signs the `add`, grants every epoch); joiner `claimInvite` → `joinStatus` → `finishJoin(join, 'merge' | 'replace')`. `removeDevice` signs a `remove`, rotates to a new epoch sealed to the remaining phones plus recovery, and tombstones the removed phone's name.
  - Recovery key (`family.ts`): `setRecoveryKey(words)` signs a `setRecovery` and grants every epoch to it (the server then drops the old recovery key's keys and sessions). `recoverFamily(server, words, local)` logs in as the recovery key (`SyncSession(..., asRecovery)`), checks the log's recovery key matches, signs this phone's `add`, grants it the keys, then finishes like a join (`completeJoin`).
  - Screens: `app/sync/index.tsx` (Settings → Sync: status, phones, rename, remove), `sync/add.tsx` (QR code, then compare the 6-digit code), `sync/join.tsx` (scan or paste, compare, then replace or merge local data; not route-guarded, so onboarding links to it), `sync/recovery.tsx` (show 24 words, type two back, only then register them; regenerating replaces the old words), `sync/recover.tsx` (server + words; linked from Join, not route-guarded). The Sync screen nudges a single-phone family without a recovery key (`useSyncStore.hasRecovery`). `components/QrCode.tsx` draws with `qrcode` + react-native-svg.
  - Every write already sets `syncStatus: 'pending'`. Keep it that way for anything new.
  - `deleteChild` now leaves scrubbed log tombstones (`{type}` payload) instead of hard-deleting, so deletes reach other phones.
- **Utilities:** `store/timeHelpers.ts` (`useNow`, `useFormatTime`, `formatDayLabel`, ISO date helpers; re-exports the shared formatters).
- **UX rule:** 2-tap maximum for common logs (sleep: 1 tap on its tile; diaper: tile + type; feed: tile + sheet).
- **Product rule:** no gamification. No milestone counts, checklist progress, streaks or scores.

### `apps/server` (`@kindred-log/server`, Kindred Sync; **AGPL-3.0**, everything else is MIT)
- **What it is:** a zero-knowledge sync relay. NestJS (Fastify) + PostgreSQL via Drizzle (`drizzle-orm/postgres-js`).
  - The server stores only ids, public keys, signatures, versions and ciphertext. Never add a column that holds readable user data.
  - The HTTP contract is `packages/shared/src/sync/protocol.ts` (zod). The server validates with `parse()` (`src/common/validate.ts`); the app uses the same types.
- **Endpoints (`/v1`):**
  - `info`.
  - `auth/challenge` + `auth/verify`: the device signs `authMessage(challenge)` and gets a bearer token. Sessions are stored hashed.
  - `families` (create) and `families/me/log`: the signed device log. The whole chain is verified with `verifyDeviceLog` on every append. Adds, removes and setRecovery update `devices` and `sessions`.
  - `keys`: `GET`, `grant`, and `rotate`. A rotation must be sealed to exactly the current members plus the recovery key.
  - `invites`: create, `:id`, `:id/claim`, `:id/status`. The QR secret never reaches the server, only the hash of a derived claim key.
  - `blobs/:id` (PUT/GET, `application/octet-stream`, ≤ `MAX_BLOB_BYTES`): encrypted photos in a `BlobStore` (`BLOB_STORE=disk`, default `./data/blobs`, or `s3` for any S3-compatible storage). A push links each record's listed `blobs`; blobs a record stops listing, and all of a tombstone's, are deleted; unlinked uploads are swept after a day. A record without `blobs` (older app) keeps its links. `Entitlements.canStore` is the hosted quota hook.
  - `sync/push` and `sync/pull`:
    - Last writer wins via `serverAccepts`, and a per-family `seq`.
    - New data must use the current epoch.
    - Records must be written as the calling device.
  - WebSocket `live?token=` sends data-free notifications (`seq`, `log`, `keys`, `invite`).
  - `push/token` (PUT/DELETE): hosted only (`PUSH=expo`, the default for `MODE=hosted`; a self-hosted server ignores tokens). After accepted writes, `PushService` sends the family's other phones a data-only `{kind: 'sync'}` ping through the Expo push service (coalesced over 2 s). Tokens are dropped when the service says DeviceNotRegistered or when the device is removed. `/v1/info` reports `push`.
- **Recovery-key sessions** (`deviceId === 'recovery'`) may only read the log and keys, append an `add`, and grant. They can't sync or rotate.
- **Code conventions:**
  - No `emitDecoratorMetadata` (tsx/esbuild/vitest don't emit it): always inject with an explicit `@Inject(Token)`.
  - `lockFamily(tx, id)` serializes writes per family.
- **Single-instance assumptions:** auth challenges and live sockets are in memory. Use Postgres LISTEN/NOTIFY to scale out.
- **Modes:** `MODE=self|hosted`. `Entitlements.canSync` is the hook for the hosted subscription (a stub for now).
- **Commands** (in `apps/server`):
  - `pnpm db:up`: dev Postgres on port **54329** via `docker-compose.dev.yml`.
  - `pnpm serve:dev`: needs `.env`, copied from `.env.example`. Deliberately not named `dev`, so the root `pnpm run dev` still only starts the app.
  - `pnpm build`: esbuild bundles the shared package; npm dependencies stay external.
  - Schema changes: edit `src/db/schema.ts`, then run `pnpm db:generate`. Migrations run at startup.
- **Docker / self-hosting** (`apps/server/README.md`):
  - `Dockerfile` builds from the repo root (`.dockerignore` keeps only the app's `package.json`).
  - The runtime stage installs only the server's npm dependencies, pinned from `pnpm list`. Don't use `pnpm deploy`: drizzle-orm's optional peers, shared with the app in the lockfile, pull in React Native (over 1 GB).
  - `docker-compose.yml` runs server + Postgres, with an optional `https` profile (Caddy, `DOMAIN`). Settings go in `docker.env.example` → `.env`.
  - Verified locally: the full client flow against the container (pair, sync, photo, live).
- **Tests:** `test/e2e.test.ts` runs the real server on a throwaway database. `test/client.ts` is a full simulated app (pairing, sync, removal + rotation, recovery) and the reference for the mobile sync engine. The tests are skipped, with a warning, when the dev Postgres isn't running.

### Native builds (local, no EAS)
- `expo-dev-client` is installed, so `pnpm run dev` / `expo start` now targets the **Kindred Log dev build**. Use `pnpm --filter @kindred-log/mobile dev:go` (or press `s`) for Expo Go.
- `android/` and `ios/` are generated (Continuous Native Generation) and gitignored. Never edit them: change `app.json` or a config plugin instead.
- Build and install on a USB-connected phone or an emulator: `cd apps/mobile && pnpm android`. After native changes (new native package, `app.json` plugins), run `pnpm android:clean`.
- Rebuild only for native changes; JS changes hot-reload as usual.
- **Release builds** (`./gradlew assembleRelease`): Gradle runs the Expo CLI directly, without pnpm's `NODE_PATH`, so Babel resolves presets from `apps/mobile/node_modules`. That's why `babel-preset-expo` and `@babel/plugin-transform-react-jsx` (named by NativeWind's preset) are direct devDependencies; keep them.
- **Standalone builds for a LAN server**: `app.config.js` adds `usesCleartextTraffic` (via `expo-build-properties`) only when `KINDRED_ALLOW_HTTP=1` is set during prebuild: `KINDRED_ALLOW_HTTP=1 npx expo prebuild --clean --platform android && (cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a)`. Release APKs are signed with the debug key, so they install over the dev build and keep the data. Never set the switch for a store build.
- **Background tasks don't run headless in dev-client builds** (the headless runtime can't load the bundle from Metro). Test them in a release build. Release builds block `http://`, so test against an https server, or temporarily allow cleartext in the generated manifest.
- Toolchain (Android): JDK 17, Android SDK 36, build-tools 36.0.0, NDK 27.1.12297006 (Gradle fetches the NDK). `JAVA_HOME` and `ANDROID_HOME` must be set.

### Commands
- `pnpm test` / `pnpm typecheck` from the root (turbo).
- `cd apps/mobile && npx expo install --check` after adding dependencies. Use `npx expo install` for anything Expo-managed.

---

## 4. Current State

- 2026-10-19: SDK 57 alignment done. (The earlier exit-code-7 crash was `expo-router@6` (SDK 54) running against SDK 57's `@expo/router-server`.)
- 2026-10-19: **Phase 1 (foundation) done**: schema v2, Drizzle migrations, children + onboarding, settings (units/clock), tabs, edit/backdate, persistent timers, History tab. Tests and typecheck pass; iOS + Android bundles build.
- Not yet verified on a physical device in Expo Go.
- 2026-10-19: **Phase 2 (tracking parity) done**: all 11 types can be logged and edited; live L/R breastfeeding timer; diaper long-press for details; "More" grid; medication-due cards. Tests and typecheck pass; iOS + Android bundles build.
- 2026-10-19: **Phase 3 (Baby Buddy import) done**: the wizard is reachable from Settings and onboarding. Verified against the user's live server: all 10,500 records page and map with 0 failures, units detected as ml/g/cm/°C. The DB write path still needs a run on a device.
- 2026-10-19: deleting a child (type-the-name confirmation) added.
- 2026-10-19: **Phase 4 (history, trends, growth, export) done**: aggregations checked against the real Baby Buddy export. Tests and typecheck pass; iOS + Android bundles build. Not yet tried on a device.
- 2026-10-20: **Phase 5 (reminders + nap prediction) done**: tests and typecheck pass; iOS + Android bundles build. Notifications not yet tried on a device.
- 2026-10-20: review pass:
  - Old entries can now be opened and edited.
  - Allergen warnings and milestones read all-time data.
  - Swipe-to-delete removed.
  - Deleted or replaced note photos are removed from disk.
  - Reminders got a master switch and new kinds.
  - Child profile pages with photos.
- 2026-10-22: Home C / profile D redesign, theme-ready palette, Font Awesome icons.
- 2026-10-22: **Phase 6 started: SQLCipher encryption** (local dev build, no EAS).
- 2026-10-22: **PROJECT.md Phase 2 (E2EE sync) started**: shared crypto/protocol (M1) and the sync server (M2) done. Phase 1.6 widgets etc. postponed.
- 2026-10-23: **M3 mobile sync engine done**: verified on an emulator against the dev server (setup, auto-upload, delete tombstones; crypto runs on Hermes). Pulling from a second device gets its first device test in M4.
- 2026-10-23: **M4 pairing done**: verified with the Pixel (real data) and an emulator: QR invite (pasted), matching codes, replace-on-join downloading ~10.5k records in ~20 s, live sync both ways, rename, removal with key rotation (epoch 2 sealed only to the Pixel; the removed phone sees a "removed" screen).
- 2026-10-23: **M5 recovery key done**: verified on the emulator: create (with the two-word check), wipe the app, recover from onboarding → Join → Use a recovery key, then remove the lost phone (the new epoch is sealed to the recovered phone and the recovery key).
- 2026-10-23: **M6 photo sync done**: server e2e covers upload/download, replacement and tombstone cleanup, the sweep and access control; the S3 store was checked against an S3 mock. On the emulator: a child photo uploads encrypted (only ciphertext on disk), comes back after wipe + recovery, and removing it deletes it on the server.
- 2026-10-23: **M7 background sync and push done**:
  - Periodic background sync verified headless on the emulator with a release build: app process killed, WorkManager started it without UI, the task logged in, synced and re-queued itself.
  - Push is covered by server e2e tests against a fake Expo push service. A real device push still needs an Expo project id plus FCM/APNs credentials (not set up).
- **Next:** M8, open source and hosting readiness (see the plan file).
