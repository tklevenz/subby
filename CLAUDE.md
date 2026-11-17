# Subby

Subby (store title "Subby: Private Baby Tracker", repo `github.com/tklevenz/subby`, local checkout `~/src/kindred-log`) is a local-first, offline-capable baby tracker (feeds, diapers, sleep, and more) with optional end-to-end encrypted sync. `pnpm` monorepo: `@subby/shared` (`packages/shared`, consumed as TS source), `@subby/mobile` (`apps/mobile`, Expo), `@subby/server` (`apps/server`, the sync relay); root package `subby`. Domain `subby.baby`; the hosted sync runs at `sync.subby.baby`.

Roadmap: `PROJECT.md` §5. **Next:** the launch plan in `LAUNCH.md` (no public beta; we dogfood on the production server).

Area details load automatically from `.claude/rules/` when you touch those files: `shared-domain.md`, `i18n.md`, `mobile-data.md`, `mobile-ui.md`, `sync.md`, `server.md`. Procedures are skills: `native-build`, `server-ops`.

## Frozen identifiers (changing them breaks existing data)
- The `subby/…` crypto labels (signatures, the device log, sealed keys, records, and the recovery words' identity, pinned by its test vector).
- The `subby:` QR prefix, `BACKUP_FORMAT = 'subby-backup'` (`readBackup` also accepts the old `kindred-log-backup`; keep that), `subby.db` and the `kl.*` SecureStore keys, the `subby` URL scheme, the background task names.
- On the server: the `subby-sync` service id and the `subby` Postgres user and database.
- The package id **`baby.subby.app`** (Android package and iOS bundle id). Never change it again after the first store release.

## Brand
The mark is a yellow submarine with a crescent moon in its big porthole, on navy (`#0E1B3D`), wordmark in Fredoka. Components and assets: `mobile-ui.md`.

## Tech stack
- Expo SDK 57, React 19, React Native 0.86, TypeScript 6, `expo-router` 57, Reanimated 4.5 / Worklets 0.10, New Architecture (exact versions: `apps/mobile/package.json`). Node 24 on macOS (Apple Silicon).
- Use `npx expo install <pkg>` (not `pnpm add`) for anything Expo-managed; verify with `npx expo install --check`.
- State: Zustand (in-memory) backed by `expo-sqlite` via `drizzle-orm/expo-sqlite` (SQLCipher-encrypted in native builds, plain in Expo Go), Drizzle migrations.
- Minimum iOS 17.0 (`expo-build-properties` `ios.deploymentTarget`): the pods are built for Xcode's recommended minimum; raise it with the Xcode toolchain.
- `android/` and `ios/` are generated and gitignored. Never edit them: change `app.json` or a config plugin. Builds: the `native-build` skill.
- `babel.config.js`: `babel-preset-expo` with `jsxImportSource: 'nativewind'`, `nativewind/babel`, and `inline-import` for `.sql`. `metro.config.js`: `withNativeWind(... './global.css')`, plus `sql` in `sourceExts`. `react-native-css-interop` must stay a direct dependency or Metro can't resolve the NativeWind JSX runtime.
- `app.json` plugins: `expo-router`, `expo-splash-screen`, `expo-sqlite`, `expo-secure-store`, `expo-camera` (QR scanning; no microphone), `expo-notifications`, `expo-background-task`.

## Styling (NativeWind v4 + Tailwind)
Dark only for launch, but built for themes.
- `tailwind.config.js` replaces Tailwind's palette with roles from `theme/palette.js` as CSS variables: write `bg-surface`, `text-ink-muted`, `border-violet/40`, never `bg-slate-900` (raw palette classes no longer exist and silently do nothing).
- Color props in JS (icons, charts, navigation) use `colors.<role>` from `theme/colors`, read at render time (no module-level copies; `TYPE_META.color` is a getter). No hex literals except data colors (diaper swatches).
- `theme/palette.test.ts` enforces this in `app/`, `components/`, `features/`.

## Rules that apply everywhere
- **Product:** no gamification (no milestone counts, checklist progress, streaks or scores). No feature gates or paywall in the app: it's free and complete, any number of children; only syncing on the hosted server is paid (PROJECT.md §3).
- **UX:** 2-tap maximum for common logs (sleep: 1 tap on its tile; diaper: tile + type; feed: tile + sheet).
- **UI text:** never in the code. `t('…')` everywhere (`@subby/shared/i18n`); module-level lists with labels are functions or getters (`ranges()`, `get label()`). A new English key needs all six translations. `features/strings.test.ts` enforces it. Details: `i18n.md`.
- **Units:** canonical only in data: ml, g, cm, °C, seconds, epoch ms.
- **`endedAt`:** for `TIMED_LOG_TYPES` (sleep, feed, pumping, activity), `endedAt` is always set once the entry is complete (= `startedAt` for instant ones like a bottle), and `null` means a running timer. For other types it's always `null`.
- **Time:** store epoch ms, measure durations as differences, step days with `addDays`/`startOfDay` (never + 24 h), read habits off the wall clock.
- **Business logic** goes in `packages/shared/src/domain/` (pure, RN-free), tested with vitest.
- **Sync:** every write sets `syncStatus: 'pending'`. Keep it that way for anything new. Deletes are tombstones, never hard deletes (`db/tombstone`).
- **Photos:** a stored photo reference (`photoUri`, children and notes) is the file's name in `Paths.document/photos`, never a path. iOS moves the app's folder on every reinstall and update, so stored paths broke and synced photos away for the whole family. Resolve with `photoFile(ref)`.
- **Server:** never add a column that holds readable user data (zero-knowledge relay). Rules: `server.md`.
- **Crypto:** never hand-roll primitives, never `Math.random` for keys. Never log or export the database key.
- Use the `brand/` loaders (`SubLoader`, `SubSpinner`, …), not `ActivityIndicator`; `Toggle`, not a bare `Switch`.

## Commands
- `pnpm test` / `pnpm typecheck` from the root (turbo). `pnpm lint` (flat config: hook rules, no-floating-promises; `void` for fire-and-forget).
- `pnpm run dev` starts the app (dev build); `pnpm --filter @subby/mobile dev:go` for Expo Go.
- Shared tests run with `TZ=Europe/Berlin`, so DST cases cross real clock changes on any machine.
- Server e2e tests need the dev Postgres (`cd apps/server && pnpm db:up`, port 54329); without it they're skipped with a warning.
- Mobile schema change: edit `apps/mobile/db/schema.ts`, then `cd apps/mobile && npx drizzle-kit generate --name <change>`; commit `db/migrations/*`, never edit an applied migration. Server: edit `src/db/schema.ts`, then `pnpm db:generate`.
- Re-run `node scripts/licenses.mjs` (in `apps/mobile`) when dependencies change, before a store build.
