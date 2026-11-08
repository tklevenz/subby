# Subby

**Subby** is a private baby tracker: feeds, diapers, sleep and night wakings, pumping, growth, medication and more, logged in two taps at 3 AM. Everything lives on the phone, encrypted. There are no accounts, no ads and no tracking.

**Subby Sync** shares one family's log between phones (parents, grandparents, a nanny) with end-to-end encryption. The server only ever stores ciphertext, public keys and version numbers: it can't read a single feed, name or photo. Use the hosted service at `sync.subby.baby`, or run your own server for free.

Website: [subby.baby](https://subby.baby)

## What's in this repository

| Path | What | License |
| --- | --- | --- |
| `apps/mobile` | The app (Expo / React Native, iOS and Android) | MIT |
| `packages/shared` | Schemas, domain logic, the end-to-end encryption and the sync protocol, shared by app and server | MIT |
| `apps/server` | Subby Sync, the zero-knowledge sync server (NestJS, PostgreSQL) | AGPL-3.0 |

## Self-hosting Subby Sync

The server runs with Docker Compose (server and Postgres, plus Caddy for HTTPS if you want it). See [`apps/server/README.md`](apps/server/README.md). Self-hosting is free and unlimited: every app feature works with your own server.

## Development

Needs Node.js 24 and pnpm 10.

```sh
pnpm install
pnpm test        # every package
pnpm typecheck
pnpm run dev     # the app (Subby dev build); see CLAUDE.md for native builds
```

The server's end-to-end tests need the dev database: `pnpm --filter @subby/server db:up`.

`CLAUDE.md` is the detailed map of the code (architecture, conventions, how sync and encryption work). `PROJECT.md` has the product plan, and `LAUNCH.md` the work left before the first release.

## Contributing

Issues and pull requests are welcome. For anything bigger than a fix, please open an issue first, so we can agree on the approach. Contributions are accepted under the license of the part they change (MIT, or AGPL-3.0 for `apps/server`).

Product rules worth knowing before proposing features:
- Logging stays at two taps or fewer for common entries.
- No gamification: no streaks, scores or milestone counts.
- The server must never hold readable user data.

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## Trademark

The code is open source, but "Subby", the Subby name and the submarine logo are trademarks of the project. Forks are welcome under their own name and logo. Please don't publish a modified app or a hosted service as "Subby" or "Subby Sync".
