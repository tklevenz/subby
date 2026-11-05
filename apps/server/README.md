# Subby Sync server

The sync server for Subby, the private baby tracker. It relays end-to-end encrypted data between a family's phones and stores only
what it needs to do that: ids, public keys, signatures, versions, timestamps of writes, sizes, and ciphertext.
It can't read names, entries or photos.

License: AGPL-3.0 (the app and the shared package are MIT).

Some internal names keep the project's old name, Kindred, on purpose: the `kindred-sync` service id and Docker
image, and the `kindred` Postgres user and database. Renaming them would break existing apps and installs.

## Self-hosting with Docker

You need a Linux machine with Docker (Compose v2) and this repository on it.

```sh
git clone <this repository> kindred-log    # or copy it over, e.g. with rsync
cd kindred-log/apps/server
cp docker.env.example .env
# Set POSTGRES_PASSWORD in .env, e.g. to the output of: openssl rand -hex 24
```

### With HTTPS (recommended)

Release builds of the app only talk to `https://` servers. Point a domain (or subdomain) at the machine, open
ports 80 and 443, set `DOMAIN=sync.example.com`, `HTTP_BIND=127.0.0.1` and `TRUST_PROXY=uniquelocal` in `.env` (the second keeps
plain HTTP off the network, so nothing can reach the server around the certificate; the third lets request limits
see each client's IP instead of Caddy's), then:

```sh
docker compose --profile https up -d --build
```

Caddy gets and renews a Let's Encrypt certificate automatically. In the app: Settings → Sync → Sync server
`https://sync.example.com`.

### Plain HTTP (LAN or VPN only)

```sh
docker compose up -d --build
```

The server listens on port 8787 on every interface (`HTTP_PORT` changes the port, `HTTP_BIND` the address). Development builds of the app accept `http://`
addresses; release builds don't. Don't expose plain HTTP to the internet: the data is encrypted, but login
tokens are not.

### Checking it

```sh
docker compose ps                              # both services "healthy"
curl http://localhost:8787/v1/info             # {"service":"kindred-sync",...}
docker compose logs -f server
```

### Updating

```sh
git pull
docker compose --profile https up -d --build   # or without --profile https
```

Database migrations run automatically when the server starts.

### Backups

Everything lives in two Docker volumes: `db` (Postgres) and `blobs` (encrypted photos). Back up both, for
example:

```sh
docker compose exec db pg_dump -U kindred kindred | gzip > kindred-$(date +%F).sql.gz
docker run --rm -v server_blobs:/data -v "$PWD":/backup alpine tar czf /backup/blobs-$(date +%F).tgz -C /data .
```

(The volume name starts with the Compose project name, by default the folder name `server`; see
`docker volume ls`.) Backups contain only encrypted data, but keep them private anyway.

### Building the image elsewhere

The image builds from the repository root:

```sh
docker build -f apps/server/Dockerfile -t kindred-sync .
# For a server with another CPU architecture, e.g. building on an Apple Silicon Mac for an x86 server:
docker buildx build --platform linux/amd64 -f apps/server/Dockerfile -t kindred-sync --load .
docker save kindred-sync | gzip | ssh my-server 'gunzip | docker load'
```

With a prebuilt image on the server, `docker compose up -d` (without `--build`) uses it.

## Configuration

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | (set by Compose) | Postgres connection string |
| `PORT` | `8787` | |
| `MODE` | `self` | `self` (no quotas or payment, no push) or `hosted` |
| `BLOB_STORE` | `disk` | `disk` (`BLOB_DIR`, `/data/blobs` in the image) or `s3` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | | for `BLOB_STORE=s3`, any S3-compatible storage |
| `PUSH` | `none` (`fcm` when hosted) | background "sync now" pings via Firebase Cloud Messaging |
| `FCM_SERVICE_ACCOUNT` | | for `PUSH=fcm`: path to the Firebase service-account key (`/secrets/firebase.json`, from `./secrets`) |
| `RATE_LIMIT` | `on` | per-client request limits (429 past them; generous, to stop scripts) or `off` |
| `TRUST_PROXY` | (none) | reverse proxies whose `X-Forwarded-For` to believe: `uniquelocal` for Caddy in this compose, or addresses/ranges |

Without push, phones sync while the app is open, and in the background as often as the phone allows (roughly
every 15 minutes or more). Push only reaches app builds made with the same Firebase project as the key, so the
store app can't be pushed to from a self-hosted server; if you build the app yourself with your own
`google-services.json`, `PUSH=fcm` with your project's key works. iOS (APNs) isn't sent to yet.

## Development

See the repository's `CLAUDE.md`: `pnpm db:up` (Postgres on port 54329), `pnpm serve:dev`, `pnpm test`.
