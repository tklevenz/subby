# Kindred Log - Architecture & Coding Rules

## Tech Stack
- Monorepo: pnpm workspaces + Turborepo
- Mobile: React Native (Expo SDK 52+), Expo Router, TypeScript (strict mode)
- Styling: NativeWind v4 (Tailwind CSS). Always default to dark-mode friendly classes.
- State Management: Zustand (interfacing directly with local SQLite via Drizzle ORM)
- Local Database: `@op-engineering/op-sqlite` with SQLCipher enabled + `drizzle-orm`
- Validation & Types: `zod` in `packages/shared`

## Strict Engineering Constraints
1. **Offline-First & Local-Only Reads:** UI components read state exclusively from Zustand, which hydrates from local SQLite. Never fetch directly from a remote API inside a component.
2. **UUIDv7 Primary Keys:** Never use auto-incrementing integers. All entity IDs (`id`, `childId`) must be client-generated UUIDv7 strings (`uuidv7` package) for chronological sorting and collision-free offline generation.
3. **Soft Deletes Only:** Never execute `DELETE FROM` SQL queries on user data. Always update `isDeleted = true` and `updatedAt = Date.now()`.
4. **Sync-Ready Schema:** Separate routing metadata (`id`, `childId`, `logType`, `startedAt`, `updatedAt`, `isDeleted`, `syncStatus`) from sensitive payload details (`payloadJson`).
5. **3-Second UX Rule:** Logging actions must require 2 taps or fewer. Avoid text inputs where buttons or sliders work.
