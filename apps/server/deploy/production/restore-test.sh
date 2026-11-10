#!/usr/bin/env bash
# Restores a backup of the official server into a throwaway Postgres on this Mac and compares it with production
# (LAUNCH.md O2). The private key stays here: the server only streams the encrypted file.
#   apps/server/deploy/production/restore-test.sh                 the newest backup
#   apps/server/deploy/production/restore-test.sh daily/subby-…   a given one (see: ssh subby /opt/subby/backup.sh --list)
#   KEEP=1 …                                                      leave the database running afterwards (port 54330)
#
# Needs Docker, age (brew install age) and the key at ~/subby-backup.key (or SUBBY_BACKUP_KEY=<path>).
# For a real restore onto a server, decrypt the same way and pipe into `pg_restore --clean --if-exists -d subby`.
set -euo pipefail

HOST=${SUBBY_HOST:-subby}
KEY=${SUBBY_BACKUP_KEY:-$HOME/subby-backup.key}
NAME=subby-restore-test
[[ -r $KEY ]] || { echo "No private key at $KEY (set SUBBY_BACKUP_KEY)." >&2; exit 1; }

backup=${1:-$(ssh "$HOST" /opt/subby/backup.sh --list | awk '{print $NF}' | grep '^daily/' | sort | tail -1)}
[[ -n $backup ]] || { echo "No backups in the bucket yet." >&2; exit 1; }

docker rm -f "$NAME" >/dev/null 2>&1 || true
echo "→ Starting a throwaway Postgres ($NAME, port 54330)"
docker run -d --name "$NAME" -e POSTGRES_USER=subby -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=subby \
  -p 127.0.0.1:54330:5432 postgres:17-alpine >/dev/null
until docker exec "$NAME" pg_isready -U subby -d subby -q 2>/dev/null; do sleep 1; done
sleep 2 # the image restarts Postgres once after initializing

echo "→ Restoring $backup"
ssh "$HOST" "/opt/subby/backup.sh --cat '$backup'" | age -d -i "$KEY" | docker exec -i "$NAME" pg_restore -U subby -d subby --no-owner --exit-on-error

# Row counts per table: the backup next to production now (production may have grown since the backup).
counts='select string_agg(format($$%s %s$$, t, (xpath($$/row/c/text()$$, query_to_xml(format($$select count(*) c from %I$$, t), false, true, $$$$)))[1]), E'"'"'\n'"'"' order by t) from (select table_name::text t from information_schema.tables where table_schema = $$public$$ and table_type = $$BASE TABLE$$) x'
restored=$(docker exec "$NAME" psql -U subby -d subby -At -c "$counts")
live=$(ssh "$HOST" "cd /opt/subby && docker compose exec -T db psql -U subby -d subby -At" <<<"$counts")
echo
printf '%-28s %12s %12s\n' table backup production
join -a1 -a2 -e - -o 0,1.2,2.2 <(sort <<<"$restored") <(sort <<<"$live") | while read -r t b l; do
  printf '%-28s %12s %12s\n' "$t" "$b" "$l"
done

missing=$(join -v2 <(sort <<<"$restored") <(sort <<<"$live") | wc -l | tr -d ' ')
if [[ ${KEEP:-} == 1 ]]; then
  echo; echo "Left running: postgres://subby:restore@127.0.0.1:54330/subby (docker rm -f $NAME when done)"
else
  docker rm -f "$NAME" >/dev/null
fi
(( missing == 0 )) || { echo "✗ $missing table(s) missing from the backup" >&2; exit 1; }
echo "✓ Restored $backup"
