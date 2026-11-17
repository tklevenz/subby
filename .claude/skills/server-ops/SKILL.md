---
name: server-ops
description: Operate the Subby Sync server - Docker image and self-hosting, the runtime lockfile, production backups and restore tests, monitoring, admin.js commands (grants, restored). Use when changing server dependencies, the Dockerfile or compose files, anything under apps/server/deploy, or when restoring, monitoring or granting slots on the production server.
---

# Server operations

## Docker / self-hosting (`apps/server/README.md`)
- `Dockerfile` builds from the repo root (`.dockerignore` keeps only the app's `package.json`).
- The runtime stage installs only the server's npm dependencies with `npm ci` from `apps/server/runtime/package-lock.json` (every transitive dependency pinned). After changing the server's dependencies, run `pnpm runtime-lock` in `apps/server` and commit both `runtime/` files; the Docker build fails while `runtime/package.json` doesn't match what pnpm resolved.
- Don't use `pnpm deploy`: drizzle-orm's optional peers, shared with the app in the lockfile, pull in React Native (over 1 GB).
- Both compose files rotate container logs (json-file, 5 × 10 MB).
- `docker-compose.yml` runs server + Postgres, with an optional `https` profile (Caddy, `DOMAIN`). Settings go in `docker.env.example` → `.env`.
  - With HTTPS, set `HTTP_BIND=127.0.0.1` so plain HTTP isn't reachable around Caddy.
  - The dev Postgres binds to 127.0.0.1 only.
- Self-hosting docs use `sync.example.com`; the hosted server is `sync.subby.baby`.
- Android Auto Backup only includes shared preferences (minus SecureStore), via expo-secure-store's rules. Photos and the database are never in Google backup; keep it that way if backup rules change.
- Verified locally: the full client flow against the container (pair, sync, photo, live).

## Admin commands (`node dist/admin.js …` inside the container; `src/admin.ts`)
- `restored`: run after restoring a backup (README "Restoring a backup"). Counts up every family's `restore_gen` and notes its seq, so phones resync.
- `status | grant-slots <family> [n] | revoke-grants <family>`: slots with `store: 'grant'` and no buyer, for our own family, support and press. No HTTP endpoint.

## Production backups (`apps/server/deploy/production`, LAUNCH.md O2)
- `backup.sh` (nightly systemd timer on the server) streams `pg_dump -Fc | age` to the `S3_BACKUP_BUCKET` (daily/weekly/monthly prefixes, deleted by the bucket's lifecycle after 8/36/95 days; the script never deletes); the server only has the age public key.
- `ops-setup.sh` (run from the Mac) installs it and sets the bucket rules (photo bucket: versioning, 30 days).
- `restore-test.sh` restores into a throwaway Postgres on the Mac with `~/subby-backup.key`.
- Backup retention is what the privacy policy promises; change both together.

## Monitoring (LAUNCH.md O3)
- `monitor.sh` (every 5 min) reports `/healthz`, the website, certificates, disk and database to Healthchecks.io (`HC_PING_SERVER`), and `backup.sh` reports each run (`HC_PING_BACKUP`); both timers come from `ops-setup.sh`.
- `monitor.sh` also reads the server's counters (metrics on `127.0.0.1:8788`) and alerts on a 5xx burst or failing pushes, and once a day writes a summary of totals to `stats.log` and `HC_PING_SUMMARY`.
