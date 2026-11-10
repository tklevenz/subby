#!/usr/bin/env bash
# Deploys the committed server to the official Subby Sync (LAUNCH.md O4). Run from anywhere in the repo, on a Mac
# with Docker and `ssh subby` set up:
#   apps/server/deploy/production/deploy.sh             build HEAD, ship it, start it
#   apps/server/deploy/production/deploy.sh --rollback  start the previous image again
#
# - The image is built here (linux/amd64), tagged with the commit, and loaded on the server: nothing builds there.
# - Before switching, the database is dumped to /opt/subby/backups/pre-<tag>.sql.gz (the last 10, at most 30 days:
#   they're unencrypted, so deleted data mustn't linger). The nightly encrypted backups are backup.sh's.
# - The server runs its migrations itself at start. Migrations only go forward: a rollback runs the old code
#   on the new schema, which is fine as long as migrations only add (keep it that way), otherwise restore the dump.
set -euo pipefail

HOST=${SUBBY_HOST:-subby}
DIR=/opt/subby
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(git -C "$HERE" rev-parse --show-toplevel)
URL=https://sync.subby.baby

remote() { ssh "$HOST" "cd $DIR && $*"; }

start() {
  local tag=$1
  echo "→ Starting subby-sync:$tag"
  # IMAGE_TAG lives in .env with the other settings; only that line changes (nothing is printed).
  remote "sed -i '/^IMAGE_TAG=/d' .env && echo IMAGE_TAG=$tag >> .env && docker compose up -d --remove-orphans"
  echo "→ Waiting for $URL/healthz"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 "$URL/healthz" >/dev/null 2>&1; then
      echo "✓ Healthy: subby-sync:$tag"
      return 0
    fi
    sleep 2
  done
  echo "✗ Not healthy after 60 s. Logs: ssh $HOST 'cd $DIR && docker compose logs --tail 100 server'" >&2
  return 1
}

if [[ ${1:-} == --rollback ]]; then
  previous=$(remote "cat previous-tag 2>/dev/null" || true)
  [[ -n $previous ]] || { echo "No previous image recorded." >&2; exit 1; }
  start "$previous"
  exit
fi

# Only committed code goes out, so every deploy is a commit you can find again.
if [[ -n $(git -C "$ROOT" status --porcelain -- apps/server packages/shared pnpm-lock.yaml) ]]; then
  echo "Commit the server and shared changes first." >&2
  exit 1
fi
tag=$(git -C "$ROOT" rev-parse --short=12 HEAD)

echo "→ Building subby-sync:$tag (linux/amd64)"
docker build --platform linux/amd64 -f "$ROOT/apps/server/Dockerfile" -t "subby-sync:$tag" "$ROOT"

echo "→ Shipping the image to $HOST"
docker save "subby-sync:$tag" | gzip | ssh "$HOST" 'gunzip | docker load'

echo "→ Installing compose file and Caddyfile"
caddyfile_before=$(remote "sha256sum Caddyfile 2>/dev/null | cut -d' ' -f1" || true)
scp -q "$HERE/docker-compose.yml" "$HERE/Caddyfile" "$HERE/backup.sh" "$HERE/monitor.sh" "$HOST:$DIR/"
remote "chmod 0700 backup.sh monitor.sh"
remote "install -d -m 0755 site"

# The tag running now becomes the rollback target, and the database is dumped before anything changes.
remote "install -d -m 0700 backups
  current=\$(grep '^IMAGE_TAG=' .env | cut -d= -f2 || true)
  if [ -n \"\$current\" ] && [ \"\$current\" != '$tag' ]; then echo \"\$current\" > previous-tag; fi
  if docker compose ps --status running db | grep -q db; then
    docker compose exec -T db pg_dump -U subby subby | gzip > backups/pre-$tag.sql.gz
    echo '→ Database dumped to backups/pre-$tag.sql.gz'
  fi
  ls -1t backups/pre-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm --
  find backups -name 'pre-*.sql.gz' -mtime +30 -delete"

start "$tag"
# Caddy reads its Caddyfile only at start (its admin API is off), so a changed one needs a restart.
if [[ $(remote "sha256sum Caddyfile | cut -d' ' -f1") != "$caddyfile_before" ]]; then
  echo "→ Caddyfile changed: restarting Caddy"
  remote "docker compose restart caddy"
fi
# Old images, except the running and the previous one.
remote "docker image ls subby-sync --format '{{.Tag}}' | grep -vx -e '$tag' -e \"\$(cat previous-tag 2>/dev/null)\" | sed 's/^/subby-sync:/' | xargs -r docker image rm >/dev/null 2>&1 || true"
