#!/usr/bin/env bash
# Checks the official server every 5 minutes (systemd timer, ops-setup.sh) and reports to Healthchecks.io
# (LAUNCH.md O3): success with a status line, or /fail with what's wrong. Healthchecks.io emails when a report says
# so, or when none arrives (the server or this box is down). Only status numbers leave the server, no user data.
# It also reads the server's counters (LAUNCH.md S7, `/metrics` inside the container): a burst of server errors or
# pushes that all fail is a problem too. Once a day it sends a summary of the day before (requests, pushes,
# purchase checks, and totals: families, phones by access, photos) to HC_PING_SUMMARY and appends it to stats.log.
#   monitor.sh          check and report
#   monitor.sh --dry    check and print, without reporting (or saving the counters)
set -uo pipefail
cd "${SUBBY_DIR:-$(dirname "$0")}"

# Reads one setting from .env without sourcing it, like Compose does: an inline " # comment" and quotes are dropped.
setting() { grep -m1 "^$1=" .env | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true; }

DISK_MAX=80   # percent of the root disk
TLS_MIN=14    # days a certificate must still be valid (Caddy renews from 30 days before)
BURST_5XX=5   # server errors since the last run (5 min) that make it a problem
PUSH_FAILS=3  # failed pushes since the last run, with none sent, that make it a problem
STATE=monitor.state  # the counters at the last run and the day's sums so far (written by this script only)

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

# The server's counters since it started (Prometheus text, on the container's own loopback only).
metrics() {
  docker compose exec -T server node -e "fetch('http://127.0.0.1:8788/metrics$1').then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((t) => process.stdout.write(t), () => process.exit(1))" </dev/null 2>/dev/null
}
# One value; `metric name file` sums every line matching the regex `name` (labels included).
metric() { awk -v k="$1" '{ v = $NF; $NF = ""; sub(/ $/, ""); if ($0 ~ "^" k "$") s += v } END { print s + 0 }' <<<"$2"; }
m=$(metrics '')
traffic=
if [[ -z $m ]]; then
  problems+=("server metrics not answering")
else
  started=$(metric subby_started_at "$m")
  now_req=$(metric subby_requests_total "$m")
  now_4xx=$(metric subby_requests_4xx_total "$m")
  now_5xx=$(metric subby_requests_5xx_total "$m")
  now_push=$(metric subby_push_sent_total "$m")
  now_pushfail=$(metric 'subby_push_(failed|error)_total' "$m")
  now_buy=$(metric 'subby_purchase_[a-z]+_verified_total' "$m")
  now_buyfail=$(metric 'subby_purchase_[a-z]+_(refused|pending|error)_total' "$m")

  prev_started=0 prev_req=0 prev_4xx=0 prev_5xx=0 prev_push=0 prev_pushfail=0 prev_buy=0 prev_buyfail=0
  day_date= day_req=0 day_4xx=0 day_5xx=0 day_push=0 day_pushfail=0 day_buy=0 day_buyfail=0
  # shellcheck source=/dev/null
  [[ -r $STATE ]] && source "$STATE"
  # Since the last run; after a restart the counters began again at 0.
  since() { (( started == prev_started && $1 >= $2 )) && echo $(( $1 - $2 )) || echo "$1"; }
  d_req=$(since "$now_req" "$prev_req") d_4xx=$(since "$now_4xx" "$prev_4xx") d_5xx=$(since "$now_5xx" "$prev_5xx")
  d_push=$(since "$now_push" "$prev_push") d_pushfail=$(since "$now_pushfail" "$prev_pushfail")
  d_buy=$(since "$now_buy" "$prev_buy") d_buyfail=$(since "$now_buyfail" "$prev_buyfail")

  if (( d_5xx >= BURST_5XX )); then
    routes=$(grep '^subby_requests_5xx{' <<<"$m" | awk '$NF > 0' | sed -E 's/^subby_requests_5xx\{route="(.*)"\} ([0-9]+)$/\1: \2/' | paste -sd, - | sed 's/,/, /g')
    problems+=("$d_5xx server errors in 5 min (since start: $routes)")
  fi
  (( d_pushfail >= PUSH_FAILS && d_push == 0 )) && problems+=("$d_pushfail pushes failed, none sent")
  traffic=", $d_req requests ($d_5xx 5xx)"

  today=$(date -u +%F)
  summary=
  if [[ -n $day_date && $day_date != "$today" ]]; then
    t=$(metrics '?totals=1')
    phones=$(grep '^subby_phones{' <<<"$t" | sed -E 's/^subby_phones\{access="(.*)"\} ([0-9]+)$/\1 \2/' | paste -sd, - | sed 's/,/, /g')
    summary="$day_date: $(( day_req + d_req )) requests ($(( day_4xx + d_4xx )) 4xx, $(( day_5xx + d_5xx )) 5xx), pushes $(( day_push + d_push )) sent / $(( day_pushfail + d_pushfail )) failed, purchases $(( day_buy + d_buy )) verified / $(( day_buyfail + d_buyfail )) not"
    summary+="; now $(metric subby_families "$t") families, phones: ${phones:-none}, $(metric subby_records "$t") records, $(metric subby_photos "$t") photos ($(( $(metric subby_photo_bytes "$t") / 1024 / 1024 )) MB), $(metric subby_push_tokens "$t") push tokens, $(metric subby_recovery_keys "$t") recovery keys"
    summary+="; database $(( ${db_bytes:-0} / 1024 / 1024 )) MB, disk ${disk}%"
    day_req=0 day_4xx=0 day_5xx=0 day_push=0 day_pushfail=0 day_buy=0 day_buyfail=0
  else
    (( day_req += d_req, day_4xx += d_4xx, day_5xx += d_5xx, day_push += d_push, day_pushfail += d_pushfail, day_buy += d_buy, day_buyfail += d_buyfail ))
  fi
  day_date=$today
fi

status="disk ${disk}%, database $(( ${db_bytes:-0} / 1024 / 1024 )) MB, ${mem} MB memory available, TLS ${tls}/${tls_site} days$traffic"
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
  [[ -n ${summary:-} ]] && echo "summary $summary"
  exit
fi

if [[ -n $m ]]; then
  {
    echo "prev_started=$started prev_req=$now_req prev_4xx=$now_4xx prev_5xx=$now_5xx prev_push=$now_push prev_pushfail=$now_pushfail prev_buy=$now_buy prev_buyfail=$now_buyfail"
    echo "day_date=$day_date day_req=$day_req day_4xx=$day_4xx day_5xx=$day_5xx day_push=$day_push day_pushfail=$day_pushfail day_buy=$day_buy day_buyfail=$day_buyfail"
  } >"$STATE.tmp" && mv "$STATE.tmp" "$STATE"
fi
if [[ -n ${summary:-} ]]; then
  echo "$summary" >>stats.log
  summary_url=$(setting HC_PING_SUMMARY)
  [[ -n $summary_url ]] && curl -fsS --max-time 10 --retry 3 -o /dev/null --data-raw "$summary" "$summary_url"
fi

[[ -n $ping_url ]] || { echo "HC_PING_SERVER is not set in .env: $message" >&2; exit 1; }
curl -fsS --max-time 10 --retry 3 -o /dev/null --data-raw "$message" "$ping_url$suffix"
