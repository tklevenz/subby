# Project Handoff & Context Specification: `kindred-log`

## 1. Project Overview
`kindred-log` is a local-first, offline-capable baby/child activity tracking mobile application (logging feeds, diapers, and sleep/wake windows) built within a `pnpm` monorepo (`~/src/kindred-log`)[cite: 4].

## 2. Tech Stack & Environment
- **Monorepo / Package Manager:** `pnpm` workspaces (Turborepo / `pnpm run dev` task runner)[cite: 4]
- **Mobile Framework:** Expo SDK 57 (recently upgraded from an earlier SDK to match the latest Expo Go client)[cite: 4]
- **Core Libraries (SDK 57):** React 19.2.3, React Native 0.86.3, TypeScript 6, `expo-router` ~57.0.28, Reanimated 4.5.1 / Worklets 0.10.1, New Architecture enabled. Use `npx expo install <pkg>` (not `pnpm add`) for anything Expo-managed; verify with `npx expo install --check`.
- **Styling:** NativeWind v4 (`nativewind/babel` preset) + Tailwind CSS (`dark` mode, `bg-slate-950` base palette with muted cards and pastel accents)[cite: 4]
- **State & Local Persistence:** Zustand (in-memory UI state) backed by `expo-sqlite` via `drizzle-orm/expo-sqlite` (unencrypted in Expo Go), with Drizzle migrations (see §3 DB).
- **Runtime Environment:** Node.js v24.9.0 on macOS (Apple Silicon)[cite: 4]

## 3. Repository & File Structure

Roadmap: see `PROJECT.md` §5. The feature-parity plan (Huckleberry + Baby Buddy, phases 1–6) is summarized there.

### `packages/shared` (`@kindred-log/shared`, consumed as TS source)
- `src/schemas/log.schema.ts`: `LogEntry` + discriminated `LogPayload` union (feed, diaper, sleep, pumping, growth, temperature, medication, potty, activity, milestone, note). Canonical units only: ml, g, cm, °C, seconds, epoch ms.
- **`endedAt` rule:** for `TIMED_LOG_TYPES` (sleep, feed, pumping, activity), `endedAt` is always set once the entry is complete (= `startedAt` for instant ones like a bottle), and `null` means a running timer. For other types it's always `null`.
- `src/schemas/child.schema.ts`: `Child`.
- `src/domain/`: pure, RN-free helpers. Put new business logic here and test it with vitest (`src/__tests__`).
  - `units`, `time`, `summary`, `validate` (`isCompletePayload` gates Save).
  - `feedTimer`: breastfeeding L/R timer state lives in the feed payload (`timerSide`, `timerSideSince`); `toggleSide`/`pauseFeed`.
  - `recent` (food/tag/medication suggestions, `medicationsDue`), `milestones` (bundled checklist).
  - `babybuddy`: Baby Buddy record types, `mapRecord` (BB → payload), `detectUnits` (BB stores no units; e.g. weight may be g or kg), `bbRef` import refs.

### `apps/mobile`
- **Config:**
  - `app.json`: plugins `expo-router`, `expo-sqlite`, `expo-secure-store`, datetimepicker.
  - `babel.config.js`: `babel-preset-expo` with `jsxImportSource: 'nativewind'`, `nativewind/babel`, and `inline-import` for `.sql`.
  - `metro.config.js`: `withNativeWind(... './global.css')`, plus `sql` in `sourceExts`.
  - pnpm note: `react-native-css-interop` must stay a direct dependency or Metro can't resolve the NativeWind JSX runtime.
- **DB:**
  - `db/schema.ts` (Drizzle): tables `children`, `logs` (generic, JSON `payload`, `ended_at`, `import_ref` unique), `settings` (kv), `reminders`.
  - `db/client.ts`: `initDatabase()` runs migrations at startup and upgrades pre-migration v0 databases via `db/legacy.ts`.
  - **Schema changes:** edit `db/schema.ts`, then `cd apps/mobile && npx drizzle-kit generate --name <change>`. Commit the generated `db/migrations/*`, and never edit an applied migration.
- **Stores (Zustand, write-through to SQLite):**
  - `useLogStore`: date-windowed load + `loadOlder`, `addLog`, `startTimer`/`stopTimer`, `updateLog(id, {payload?, startedAt?, endedAt?})`, `softDeleteLog`.
  - `useChildStore` (`deleteChild` hard-deletes the child's logs, reminders and photos and leaves a scrubbed tombstone row), `useSettingsStore` (units, clock, activeChildId, isPremium stub), `useActiveChild`.
- **Routes (expo-router):**
  - `app/_layout.tsx`: DB init + hydration; `Stack.Protected` sends users to `onboarding` when no child exists.
  - `app/(tabs)/`: `index` (Home dashboard), `history`, `trends` (placeholder), `settings`.
  - `app/entry/[id].tsx`: edit/backdate any entry.
  - `app/child/[id].tsx`: add (`new`) or edit a child; danger zone deletes a child after the user types its name.
  - `app/import/babybuddy.tsx`: import wizard (connect → review children/units → progress → summary). Not route-guarded, so onboarding can link to it.
- **Components:**
  - `StatusHeader` (+ `ChildSwitcher`), `ActiveTimers`, `LogTimeline` (day-grouped) / `LogRow` (tap to edit, swipe to delete), `QuickActionDock`.
  - `logTypes.tsx`: `TYPE_META` (label/icon/colors) + `defaultPayload` per type. `logDisplay.tsx`: row text per entry.
  - `editors/`: **one editor per log type** (`EDITORS` registry), shared by the "log new" sheet and the edit screen. `fields.tsx` has NumberField/UnitNumberField (canonical value, display unit), TagsField, PhotoField (copies into `Paths.document/photos`); `FoodPicker`.
  - `sheets/`: `SheetHost` owns the **single** `BottomSheet` on Home and swaps content per `useSheetStore` request: `FeedSheet` (live L/R timer, bottle, solids), `LogSheet` (generic, + `CommonFields` notes/tags), `AddLogSheet` (type grid). Keep one Modal (iOS can't present while another dismisses).
  - `ui.tsx`: Chip, Segmented, TextField, Button, Card, Row.
  - `DateTimeField`.
- **Baby Buddy import (`features/import/babybuddy/`):**
  - `client.ts`: read-only REST client (token auth, paging; rewrites `next` links to the user's base URL).
  - `importer.ts`: `previewImport` (counts, children, unit detection) and `runImport` (one transaction per page, `onConflictDoNothing` on `import_ref`, so re-runs only add new records and never overwrite local edits).
  - The API key is never persisted. Only `settings.bbUrl` is remembered.
  - Opt-in tests that hit real data (kept outside the repo): `BB_DUMP=<all.json> pnpm --filter @kindred-log/shared test`, `BB_URL=… BB_TOKEN=… npx vitest run client` in `apps/mobile`.
- **Utilities:** `store/timeHelpers.ts` (`useNow`, `useFormatTime`, `formatDayLabel`, ISO date helpers; re-exports the shared formatters).
- **UX rule:** 2-tap maximum for common logs.

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
- **Next: Phase 4**: history day/week views, trends, WHO growth charts, CSV export.
