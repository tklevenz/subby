# Project Handoff & Context Specification: `kindred-log`

## 1. Project Overview
`kindred-log` is a local-first, offline-capable baby/child activity tracking mobile application (logging feeds, diapers, and sleep/wake windows) built within a `pnpm` monorepo (`~/src/kindred-log`)[cite: 4].

## 2. Tech Stack & Environment
- **Monorepo / Package Manager:** `pnpm` workspaces (Turborepo / `pnpm run dev` task runner)[cite: 4]
- **Mobile Framework:** Expo SDK 57 (recently upgraded from an earlier SDK to match the latest Expo Go client)[cite: 4]
- **Core Libraries (SDK 57):** React 19.2.3, React Native 0.86.3, TypeScript 6, `expo-router` ~57.0.28, Reanimated 4.5.1 / Worklets 0.10.1, New Architecture enabled. Use `npx expo install <pkg>` (not `pnpm add`) for anything Expo-managed; verify with `npx expo install --check`.
- **Styling:** NativeWind v4 (`nativewind/babel` preset) + Tailwind CSS (`dark` mode, `bg-slate-950` base palette with muted cards and pastel accents)[cite: 4]
- **State & Local Persistence:** Zustand (in-memory UI state) backed by `expo-sqlite` via `drizzle-orm/expo-sqlite` (unencrypted in Expo Go). Schema is bootstrapped with `CREATE TABLE IF NOT EXISTS` in `db/client.ts` — keep it in sync with `db/schema.ts` until a migration runner is added.
- **Runtime Environment:** Node.js v24.9.0 on macOS (Apple Silicon)[cite: 4]

## 3. Repository & File Structure (`apps/mobile`)

### Configuration Files
- `apps/mobile/app.json`: Expo configuration (name, slug, `expo-router` plugin, New Architecture enabled)[cite: 4].
- `apps/mobile/babel.config.js`: `babel-preset-expo` with `jsxImportSource: 'nativewind'` + `nativewind/babel` preset.
- `apps/mobile/metro.config.js`: `withNativeWind(config, { input: './global.css' })`; `global.css` is imported in `app/_layout.tsx`.
- pnpm note: `react-native-css-interop` must stay a direct dependency or Metro can't resolve the NativeWind JSX runtime.
- `apps/mobile/tailwind.config.js`: NativeWind v4 configuration, content paths, and dark mode setup[cite: 4].

### State & Data Layer
- **Store (Zustand + SQLite sync):**
  - `updateLog` method: Merges `payloadPatch` into the existing log entry's `payload`, sets `syncStatus: 'pending'`, performs an upsert into the local SQLite database, and updates the Zustand store state immediately[cite: 4].

### UI Components (`bg-slate-950` theme, muted cards, pastel accents)
- `StatusHeader.tsx`: Renders 3 summary status cards at the top of the screen:
  1. Last feed (relative time + feed detail)[cite: 4]
  2. Last diaper (condition: Wet / Dirty / Both)[cite: 4]
  3. Sleep / wake-window (live-ticking timer)[cite: 4]
- `LogTimeline.tsx`: `FlatList` displaying historical log entries with swipe-to-delete (triggers a confirmation alert), activity-type-colored icons, and compact timestamps[cite: 4].
- `QuickActionDock.tsx`: Fixed bottom action bar providing 1-tap diaper logging (`Wet` / `Dirty` / `Both`), a sleep toggle, and a trigger to open the feed modal[cite: 4].
- `FeedModal.tsx`: Bottom sheet modal for logging feeds, featuring quick bottle volume presets (`60` / `90` / `120` / `150` / `180` ml) with a `±10 ml` stepper, plus breast feeding duration presets (`5` / `10` / `15` / `20` / `25` min)[cite: 4].

### Utilities
- `timeHelpers.ts`: Time formatting functions (`formatDuration`, `formatRelative`, `formatTimeShort` — unused imports cleaned up)[cite: 4].

---

## 4. Current State

- 2026-10-19: SDK 57 alignment done. All Expo packages match SDK 57, `op-sqlite` replaced by `expo-sqlite`, NativeWind v4 fully wired, `tsc --noEmit` passes, and `pnpm run dev` serves iOS + Android bundles. (The earlier exit-code-7 crash was `expo-router@6` (SDK 54) running against SDK 57's `@expo/router-server`, which requires `expo-router/internal/routing`.)
- Not yet verified on a physical device in Expo Go.
