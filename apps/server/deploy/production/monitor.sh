#!/usr/bin/env bash
# Checks the official server every 5 minutes (systemd timer, ops-setup.sh) and reports to Healthchecks.io
# (LAUNCH.md O3): success with a status line, or /fail with what's wrong. Healthchecks.io emails when a report says
# so, or when none arrives (the server or this box is down). Only status numbers leave the server, no user data.
#   monitor.sh          check and report
#   monitor.sh --dry    check and print, without reporting
set -uo pipefail
cd "${SUBBY_DIR:-$(dirname "$0")}"

# Reads one setting from .env without sourcing it, like Compose does: an inline " # comment" and quotes are dropped.
setting() { grep -m1 "^$1=" .env | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true; }

DISK_MAX=80   # percent of the root disk
TLS_MIN=14    # days a certificate must still be valid (Caddy renews from 30 days before)

ping_url=$(setting HC_PING_SERVER)
domain=$(setting DOMAIN)
site=$(setting SITE_DOMAIN)
site=${site:-subby.baby}
problems=()

# The sync server through Caddy and TLS: the app, Postgres and photo storage (/healthz checks the last two).
health=$(curl -fsS --max-time 10 "https://$domain/healthz" 2>&1) || problems+=("sync /healthz: ${health:-no answer}")
# The website.
curl -fsS --max-time 10 -o /dev/null "https://$site/" 2>/dev/null || problems+=("website $site not answering")

# Certificates (both names; Caddy renews them, this catches it failing to).
tls_days() {
  local end
  end=$(echo | openssl s_client -servername "$1" -connect "$1:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [[ -n $end ]] && echo $(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 )) || echo -1
}
tls=$(tls_days "$domain")
tls_site=$(tls_days "$site")
(( tls >= TLS_MIN )) || problems+=("TLS for $domain: $tls days left")
(( tls_site >= TLS_MIN )) || problems+=("TLS for $site: $tls_site days left")

# Disk, and what the database takes of it.
disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
(( disk < DISK_MAX )) || problems+=("disk ${disk}% full")
db_bytes=$(docker compose exec -T db psql -U subby -d subby -Atc "select pg_database_size('subby')" </dev/null 2>/dev/null | tr -dc 0-9)
[[ -n $db_bytes ]] || problems+=("database not answering")
mem=$(free -m | awk '/^Mem:/ {print $7}')

status="disk ${disk}%, database $(( ${db_bytes:-0} / 1024 / 1024 )) MB, ${mem} MB memory available, TLS ${tls}/${tls_site} days"
if (( ${#problems[@]} )); then
  message="$(printf '%s; ' "${problems[@]}")"
  message="${message%; } | $status"
  suffix=/fail
else
  message=$status
  suffix=
fi

if [[ ${1:-} == --dry ]]; then
  echo "${suffix:-ok} $message"
  exit
fi
[[ -n $ping_url ]] || { echo "HC_PING_SERVER is not set in .env: $message" >&2; exit 1; }
curl -fsS --max-time 10 --retry 3 -o /dev/null --data-raw "$message" "$ping_url$suffix"
