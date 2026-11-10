#!/usr/bin/env bash
# Nightly backup of the official server's database (LAUNCH.md O2). Lives in /opt/subby next to .env; a systemd timer
# runs it (ops-setup.sh installs both). It never sees a decryption key:
#   backup.sh               dump the database, encrypt it to the age public key below, upload it to S3_BACKUP_BUCKET
#   backup.sh --list        list the backups in the bucket
#   backup.sh --cat <path>  print one (still encrypted) to stdout, for restore-test.sh on the Mac
#
# - pg_dump in custom format (compressed), encrypted with age, streamed to the bucket: nothing readable touches the disk.
# - Every night goes to daily/, Sundays also to weekly/, the 1st of a month also to monthly/. The bucket's lifecycle
#   rules (ops-setup.sh) delete them after 8, 36 and 95 days; this script deletes nothing. So data a family
#   deleted is gone from backups after at most ~3 months (the privacy policy says so).
# - On success it writes backups/last-backup (UTC time and size) and reports to Healthchecks.io (HC_PING_BACKUP,
#   LAUNCH.md O3), which emails when a run fails or none arrives for a day.
set -euo pipefail
cd "$(dirname "$0")"

# The matching private key is kept offline, never on this server.
AGE_RECIPIENT=${AGE_RECIPIENT:-age19q8v038r7jnmryec9tr28heuhwuju7773lrdrd2yk2gss5maes8sv2mjks}

# Reads one setting from .env without sourcing it, like Compose does: an inline " # comment" and quotes are dropped.
setting() { grep -m1 "^$1=" .env | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true; }

bucket=$(setting S3_BACKUP_BUCKET)
[[ -n $bucket ]] || { echo "S3_BACKUP_BUCKET is not set in .env" >&2; exit 1; }
# rclone takes its whole config from the environment, so no credentials file is written.
export RCLONE_CONFIG_BACKUP_TYPE=s3 RCLONE_CONFIG_BACKUP_PROVIDER=Other
export RCLONE_CONFIG_BACKUP_ENDPOINT=$(setting S3_ENDPOINT) RCLONE_CONFIG_BACKUP_REGION=$(setting S3_REGION)
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=$(setting S3_BACKUP_ACCESS_KEY_ID) RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=$(setting S3_BACKUP_SECRET_ACCESS_KEY)
export RCLONE_S3_NO_CHECK_BUCKET=true
# The config comes from the environment: no "config file not found" notices.
export RCLONE_LOG_LEVEL=ERROR
remote="backup:$bucket"

case ${1:-} in
  --list)
    rclone lsl "$remote" | sort -k2,3
    exit
    ;;
  --cat)
    [[ ${2:-} =~ ^(daily|weekly|monthly)/subby-[0-9TZ-]+\.dump\.age$ ]] || { echo "Usage: backup.sh --cat daily/subby-<date>.dump.age" >&2; exit 1; }
    rclone cat "$remote/$2"
    exit
    ;;
  "") ;;
  *) echo "Usage: backup.sh [--list | --cat <path>]" >&2; exit 1 ;;
esac

# Healthchecks.io: start, then success or failure (a missing report alerts too).
hc=$(setting HC_PING_BACKUP)
report() { [[ -z $hc ]] || curl -fsS --max-time 10 --retry 3 -o /dev/null --data-raw "${2:-}" "$hc$1" || true; }
trap 'rc=$?; (( rc == 0 )) || report /fail "backup failed (exit $rc)"' EXIT
report /start

name=subby-$(date -u +%Y-%m-%dT%H%MZ).dump.age
target=daily/$name
echo "→ Backing up to $target"
if ! docker compose exec -T db pg_dump -U subby -Fc subby | age -r "$AGE_RECIPIENT" | rclone rcat "$remote/$target"; then
  # A failed dump may have left a partial object.
  rclone deletefile "$remote/$target" 2>/dev/null || true
  echo "✗ Backup failed" >&2
  exit 1
fi
size=$(rclone size --json "$remote/$target" | sed -E 's/.*"bytes":([0-9]+).*/\1/')
# A dump of an empty database is still a few KB; anything smaller means pg_dump wrote nothing.
(( size > 1024 )) || { rclone deletefile "$remote/$target" || true; echo "✗ Backup is only $size bytes" >&2; exit 1; }

[[ $(date -u +%u) == 7 ]] && rclone copyto "$remote/$target" "$remote/weekly/$name"
[[ $(date -u +%d) == 01 ]] && rclone copyto "$remote/$target" "$remote/monthly/$name"

install -d -m 0700 backups
echo "$(date -u +%FT%TZ) $target $size" > backups/last-backup
echo "✓ $target ($size bytes)"
report "" "$target, $size bytes"
