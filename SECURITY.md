# Security

Subby's promise is that nobody but a family's own phones can read its data, not even our server. If you find a way around that, or any other vulnerability, please tell us privately first.

## Reporting

Email **security@subby.baby** with:
- what you found and its impact,
- steps or code to reproduce it,
- the app version or server commit you tested.

Please don't open a public issue for a vulnerability, and don't test against other people's data on the hosted server. A server you run yourself (see `apps/server/README.md`) is the place for that.

We'll answer within a few days, keep you posted while we fix it, and credit you when it's released if you'd like.

## In scope

- The end-to-end encryption, the device log and key handling (`packages/shared/src/crypto`, `packages/shared/src/sync`).
- Anything that lets the server, a removed phone or an outsider read, change or delete a family's data.
- Subby Sync (`apps/server`) and the hosted service at `sync.subby.baby`.
- The app's local storage (SQLCipher database, keychain), backups and the Baby Buddy import.

## What the server is allowed to see

By design, the server knows metadata: device and family ids, public keys, signatures, record ids and versions, sizes, timestamps, IP addresses and push tokens. Learning that a family exists, or when it syncs, isn't a vulnerability. Reading or forging what it syncs is.
