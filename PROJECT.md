# Project Overview: Subby

> **Master Hand-off Document for AI Agents & Developers**
> *Project Name:* Subby
> *Core Vision:* A privacy-first, offline-first, exceptionally fast baby tracking mobile application combining the data-ownership ethos of Signal with the reliability and speed required by tired parents at 3 AM.

---

## 1. Project Premise & Problem Statement

Mainstream baby tracking applications (e.g., Huckleberry, Glow, Nara Baby) offer polished user experiences but engage in heavy data harvesting, profiling infant health, sleep, and feeding patterns for advertising or third-party data brokers.

Conversely, existing self-hosted open-source alternatives (like Baby Buddy) respect privacy but suffer from clunky, slow web interfaces that fail the "Wife/Partner Acceptance Factor" during middle-of-the-night care routines.

**Subby bridges this gap:**

* **Zero-Knowledge Privacy:** End-to-end encrypted (E2EE) synchronization where the server acts as an encrypted storage blob relay and cannot read user data.
* **Frictionless UI:** Designed specifically for one-handed, 3 AM operation with high-contrast dark modes, haptic feedback, and a 2-tap maximum logging rule.
* **Power-User Extensibility:** Future-proofed with an optional API and official Home Assistant integration tier for technical parents.

---

## 2. Architecture & Security Model (The "Signal" Approach)

Subby is built on a **Local-First, Offline-Capable Architecture**.

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

## 3. Monetization (decided 2026-11-05)

Subby is open source: the app and shared package are MIT, Subby Sync (the server) is AGPL-3.0, and the name is kept as a trademark. The app is free and complete on its own, for any number of children: a single parent can keep everything on the phone, with the backup file for safety. We charge only for what costs money to run: the official Subby Sync server, which is for sharing between phones. Self-hosting is free.

**The model: a one-time unlock per phone, no subscription.** Baby tracking lasts a few years, so the hosting cost per family is bounded and a one-time price can cover it. Parents also dislike subscriptions for a tool they'll stop using.

| | App only | Official Subby Sync | Self-hosted Subby Sync |
| --- | --- | --- | --- |
| **App features, children** | All, unlimited | All, unlimited | All, unlimited |
| **Sharing between phones** | No | €6.99 per phone, once (14-day trial) | Free, unlimited |
| **Push notifications** | Not needed (reminders are local) | Yes | No at launch; a free relay through our server later |
| **Photo sync** | No | Up to 2 GB per family | Unlimited (your storage) |
| **Backup** | The backup file | The backup file, plus recovery from the server with the 24 words | The same, on your server |

**How it works:**
- **Every phone that syncs needs an unlock, paid one of two ways:**
  - *Its own unlock:* a non-consumable purchase on the person's store account. "Restore purchases" brings it back on a new phone, and it comes along into any family. The server records which phone uses it, one at a time.
  - *A gift from the family:* any member's phone buys a slot (a consumable), usually while adding a grandparent or nanny. The slot belongs to the family, frees up when its phone is removed, and works on Android and iPhone alike.
  - So the cost can be split however the family likes, with no main account or license holder. There's no free caregiver tier.
- **Trial:** a new family syncs fully for 14 days. No card, nothing renews. After the trial, a phone without an unlock still syncs for 48 hours (so a partner's phone doesn't stop in the middle of the night), then reads everything but can't log until it's unlocked.
- **Purchases** carry the buying phone's device id through the store's own account field (Apple `appAccountToken`, Google `obfuscatedAccountId`). The server verifies them itself against Google Play and the App Store (no RevenueCat) and stores only store, transaction id, kind and the device or family it belongs to. No personal data, no expiry. Refunds revoke. Self-hosted mode always allows everything.
- **Switching between Android and iPhone:** an own unlock stays with its store, so switching means buying again; gifted slots work on both.
- **Photos:** shrunk when picked (~2048 px). Past the 2 GB allowance, new photos stay on the phone only, as oversized ones already do.
- **Inactive families:** deleted from the server after 12 months without any phone syncing, with warnings in the app from month 11. That also drops gifted slots. The phones keep all their data.
- **Hosting:** Hetzner, Germany (a Cloud VPS, Object Storage for photos, encrypted nightly backups).
- Not at launch: a tip or supporter purchase.

The launch tickets for all of this are in `LAUNCH.md`.

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
* Then: everything in `LAUNCH.md` (store billing for the per-phone unlock (§3), the photo allowance, inactive-family cleanup, iOS, operations, legal, store release).


* **Phase 3: Integrations**
* Caregiver invites (limited or read-only), the push relay for self-hosted servers, and Home Assistant API webhooks. All free in the app; see §3.
