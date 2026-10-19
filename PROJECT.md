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

## 3. Monetization Strategy & Feature Tiers

The app utilizes a freemium model that gates collaboration, hardware scaling, and advanced data control rather than basic tracking or core privacy.

| Feature / Capability | Free Tier | Premium Tier (~€5–€9/month) |
| --- | --- | --- |
| **Children Tracked** | 1 Child | Unlimited Children |
| **Admin Users (Parents)** | Up to 2 Users | Up to 2 Users |
| **Caregiver Users (Nanny/Grandparents)** | 0 | Unlimited (Restricted Permissions) |
| **Devices per User** | 1 Device per User | Up to 3 Devices per User (Phone, Tablet, Watch) |
| **Core Logging & Local-First UI** | ✅ Included | ✅ Included |
| **End-to-End Encryption (E2EE)** | ✅ Included | ✅ Included |
| **Advanced Reports & CSV Export** | ❌ | ✅ Included |
| **Developer API & Home Assistant Integration** | ❌ | ✅ Included |

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
  * 1.4 History, trends, WHO growth percentiles, CSV export (premium).
  * 1.5 Local reminders (feeds, medication) + on-device nap prediction (SweetSpot equivalent; no cloud AI).
  * 1.6 Native build: SQLCipher, widgets, Live Activities, Siri shortcuts (Watch + contraction timer are stretch goals).
* Monorepo setup, Zod schemas, encrypted SQLite/Drizzle integration, and Zustand store configured.
* 3 AM Dashboard UI: Status summary header, recent activity timeline, and thumb-zone quick action dock.


* **Phase 2: Encrypted Sync & Multi-User Handshake (MVP v1.0)**
* NestJS backend setup, cryptographic key exchange, user accounts, and real-time E2EE background sync.


* **Phase 3: Premium Features & Integrations**
* Caregiver role permissions, multi-device management, data export tools, and Home Assistant API webhooks.
