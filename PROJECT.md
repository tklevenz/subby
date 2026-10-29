# Project Overview: Kindred Log

> **Master Hand-off Document for AI Agents & Developers**
> *Project Name:* Kindred Log
> *Core Vision:* A privacy-first, offline-first, exceptionally fast baby tracking mobile application combining the data-ownership ethos of Signal with the reliability and speed required by tired parents at 3 AM.

---

## 1. Project Premise & Problem Statement

Mainstream baby tracking applications (e.g., Huckleberry, Glow, Nara Baby) offer polished user experiences but engage in heavy data harvesting, profiling infant health, sleep, and feeding patterns for advertising or third-party data brokers.

Conversely, existing self-hosted open-source alternatives (like Baby Buddy) respect privacy but suffer from clunky, slow web interfaces that fail the "Wife/Partner Acceptance Factor" during middle-of-the-night care routines.

**Kindred Log bridges this gap:**

* **Zero-Knowledge Privacy:** End-to-end encrypted (E2EE) synchronization where the server acts as an encrypted storage blob relay and cannot read user data.
* **Frictionless UI:** Designed specifically for one-handed, 3 AM operation with high-contrast dark modes, haptic feedback, and a 2-tap maximum logging rule.
* **Power-User Extensibility:** Future-proofed with an optional API and official Home Assistant integration tier for technical parents.

---

## 2. Architecture & Security Model (The "Signal" Approach)

Kindred Log is built on a **Local-First, Offline-Capable Architecture**.

### Data Storage & Encryption

* **Local Database:** SQLite via `expo-sqlite`. In dev/production builds it is encrypted at rest with **SQLCipher** (the `useSQLCipher` plugin option), with the key in the device keychain (`expo-secure-store`). Expo Go builds are unencrypted and for development only.
* **Primary Keys:** All entity IDs (`id`, `childId`) are client-generated **UUIDv7** strings to ensure collision-free offline creation and chronological sorting.
* **Soft Deletes:** No hard database deletes. Records utilize an `isDeleted` boolean flag and an `updatedAt` timestamp to prevent sync corruption.

### Cryptographic Sync & Handshake (v1.0 Design)

1. **Client Key Pairs:** Each user generates an asymmetric key pair. Private keys never leave the device hardware enclave.
2. **Shared Symmetric Key (`SharedLogKey`):** A symmetric key encrypts all baby log payloads (diapers, feeds, sleep).
3. **Zero-Knowledge Relay:** The NestJS backend stores only encrypted metadata and encrypted key blobs. It never holds plaintext access to the health logs.
4. **Device Authorization (Layer 2):** New devices or secondary screens (e.g., an iPad in the nursery) are authorized securely via a local QR code handshake with an existing trusted device.

---

## 3. Monetization (draft plan, 2026-10-29)

Subby is open source: the app and shared package are MIT, Subby Sync (the server) is AGPL-3.0, and the name is kept as a trademark. Every app feature is free, for any number of children, because a gate in MIT code can't hold and would hit self-hosters too. We charge for what costs money to run: the official Subby Sync server.

**The model: a one-time unlock per phone, no subscription.** Baby tracking lasts a few years, so the hosting cost per family is bounded and a one-time price can cover it. Parents also dislike subscriptions for a tool they'll stop using.

| | Official Subby Sync | Self-hosted Subby Sync |
| --- | --- | --- |
| **App features, children** | All, unlimited | All, unlimited |
| **First phone** | Free: encrypted backup off the phone, recovery key, notifications | Free |
| **Each further phone** | One-time unlock (about €6–8) | Free, unlimited |
| **Push notifications** | Yes | No (live sync while open, OS background sync); a push relay comes later |
| **Photo sync** | Included up to an allowance per family | Unlimited (your storage) |

**How it works:**
- **Per phone, not per family:** each phone owns its purchase, so there's no main account or license holder. A purchase is linked to the phone's device id through the store's own account field (Apple `appAccountToken`, Google `obfuscatedAccountId`). "Restore purchases" moves it to a new phone; the server keeps one active phone per purchase.
- **Trying it out:** a new phone can join a family and pull everything, but it pushes only once it's unlocked. The first phone in a family always syncs.
- **On the server:** one row per purchase (store transaction id, device id), checked in `Entitlements.canSync`. No expiry and no personal data. Self-hosted mode always allows everything.
- **Inactive families:** deleted after about 12 months without a sync, with warnings first. The phones keep all their data.
- **Photos:** stored compressed (see the roadmap). Past the allowance, new photos stay on the phone only, as oversized ones already do.

**Open details (not decided):**
- The price, and whether it's per phone or one price per family.
- The photo allowance (2–5 GB?), and whether to sell more.
- Free caregiver invites (nanny, grandparents), limited or read-only, as members who don't pay.
- Switching between Android and iPhone means buying again (stores don't share purchases). Accept that or allow a manual transfer.
- The inactivity period and its warnings.
- An optional tip or supporter purchase.
- Store billing: verify purchases ourselves or use RevenueCat.

---

## 4. Tech Stack Specification

### Monorepo Infrastructure

* **Tooling:** `pnpm` workspaces + `Turborepo`.
* **Shared Contract:** `packages/shared` containing strict `zod` schemas and TypeScript interfaces shared between the mobile client and backend.

### Frontend (Mobile App)

* **Framework:** React Native via **Expo SDK 57** (Expo Router).
* **Styling:** **NativeWind v4** (Tailwind CSS for React Native), utilizing an OLED-friendly dark palette (`bg-slate-950`).
* **State Management:** **Zustand** (synchronous in-memory store hydrating directly from local SQLite).
* **Local Database:** `drizzle-orm` over `expo-sqlite` (SQLCipher in native builds), with migrations from `drizzle-kit`.
* **Interactions:** `expo-haptics` for tactile feedback on logging actions.

### Backend & Infrastructure (v1.0 & Beyond)

* **Framework:** **NestJS** (TypeScript) with modular architecture.
* **Database:** **PostgreSQL** with Prisma or Drizzle ORM.
* **Hosting:** **Hetzner Cloud** (EU-based, strict GDPR compliance, optimal price-to-performance).

---

## 5. Development Roadmap & Status

* **Phase 1: Local-First Solo App (MVP v0.1) — *In Progress***
* Feature parity with Huckleberry + Baby Buddy, in sub-phases:
  * 1.1 Foundation (done 2026-10-19): schema v2 (11 log types, canonical units), migrations, multiple children, settings, tabs, edit/backdate, persistent timers.
  * 1.2 Tracking parity (done 2026-10-19): live breastfeeding L/R timer, bottle milk type, solids, pumping, growth, temperature, medication, potty, activities, milestones, notes/tags.
  * 1.3 Baby Buddy import (done 2026-10-19): in-app, over Baby Buddy's REST API (URL + token), re-runnable without duplicates via `import_ref`.
  * 1.4 History, trends, WHO growth percentiles, CSV export (done 2026-10-19).
  * 1.5 Local reminders (feeds, medication, nap window) + on-device nap prediction (SweetSpot equivalent; no cloud AI) (done 2026-10-20).
  * 1.6 Native build: SQLCipher (done 2026-10-22), widgets, Live Activities, Siri shortcuts (Watch + contraction timer are stretch goals).
* Monorepo setup, Zod schemas, encrypted SQLite/Drizzle integration, and Zustand store configured.
* 3 AM Dashboard UI: Status summary header, recent activity timeline, and thumb-zone quick action dock.


* **Phase 2: Encrypted Sync & Multi-User Handshake (MVP v1.0)**
* NestJS backend setup, cryptographic key exchange, user accounts, and real-time E2EE background sync.
* M1–M7 done (2026-10-23): crypto and protocol, server, sync engine, pairing, recovery key, photo sync, background sync and push.
* M8, open source and hosting readiness:
  * Remove the app's premium gates: the one-child limit (`FREE_CHILD_LIMIT`, `PremiumGate`, the Baby Buddy import default) and the "Premium" label on CSV export.
  * Compress photos when they're picked: resize to a long edge of about 2048 px (avatars smaller) and re-encode as JPEG. There's no need to keep full-size camera photos (often 5–10 MB) in Subby; this keeps photo sync and the hosted allowance small. Existing photos stay as they are.
  * `LICENSE` files, the self-hosting README and the hosted-mode entitlements.
* Then: store billing for the per-phone unlock (§3), the photo allowance and inactive-family cleanup on the hosted server.


* **Phase 3: Integrations**
* Caregiver invites (limited or read-only), the push relay for self-hosted servers, and Home Assistant API webhooks. All free in the app; see §3.
