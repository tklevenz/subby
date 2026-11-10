#!/usr/bin/env bash
# Sets up backups (LAUNCH.md O2) and monitoring (O3) on the official server. Run from the Mac, once and after
# changing one of these files (safe to re-run; deploy.sh also copies the scripts, but not the timers):
#   apps/server/deploy/production/ops-setup.sh
#
# - Installs age and rclone, backup.sh and a systemd timer (03:30 UTC nightly) in /opt/subby.
# - Installs monitor.sh and a timer (every 5 minutes) reporting to Healthchecks.io (HC_PING_SERVER; backup.sh
#   reports to HC_PING_BACKUP).
# - Backup bucket (S3_BACKUP_BUCKET): lifecycle rules delete daily/ after 8 days, weekly/ after 36, monthly/ after 95.
# - Photo bucket (S3_BUCKET): versioning on, so a wrong delete can be undone for 30 days; older versions then expire.
#   The photos are encrypted on the phones, so they need no further encryption.
# - Runs a first backup and lists the bucket.
# The bucket settings are made with the AWS CLI in a throwaway container (nothing is installed for it).
set -euo pipefail

HOST=${SUBBY_HOST:-subby}
DIR=/opt/subby
HERE=$(cd "$(dirname "$0")" && pwd)

echo "→ Installing backup.sh, monitor.sh and their timers on $HOST"
scp -q "$HERE/backup.sh" "$HERE/monitor.sh" "$HOST:$DIR/"
ssh "$HOST" "set -e
  chmod 0700 $DIR/backup.sh $DIR/monitor.sh
  command -v age >/dev/null && command -v rclone >/dev/null || (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq age rclone >/dev/null)
  cat > /etc/systemd/system/subby-backup.service <<'EOF'
[Unit]
Description=Subby Sync database backup
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=$DIR/backup.sh
Nice=10
EOF
  cat > /etc/systemd/system/subby-backup.timer <<'EOF'
[Unit]
Description=Nightly Subby Sync database backup

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  cat > /etc/systemd/system/subby-monitor.service <<'EOF'
[Unit]
Description=Subby Sync health report to Healthchecks.io
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=$DIR/monitor.sh
EOF
  cat > /etc/systemd/system/subby-monitor.timer <<'EOF'
[Unit]
Description=Subby Sync health report every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now subby-backup.timer subby-monitor.timer >/dev/null"

echo "→ Bucket rules"
# The AWS CLI reads the keys from the environment; .env is only read on the server and nothing is printed.
ssh "$HOST" "cd $DIR && bash -s" <<'REMOTE'
set -e
  setting() { grep -m1 "^$1=" .env | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true; }
  aws() {
    docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION="$(setting S3_REGION)" \
      -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
      amazon/aws-cli:2.17.0 --endpoint-url "$(setting S3_ENDPOINT)" "$@"
  }
  rule() { echo "{\"ID\":\"$1\",\"Status\":\"Enabled\",\"Filter\":{\"Prefix\":\"$1/\"},\"Expiration\":{\"Days\":$2}}"; }

  export AWS_ACCESS_KEY_ID=$(setting S3_BACKUP_ACCESS_KEY_ID) AWS_SECRET_ACCESS_KEY=$(setting S3_BACKUP_SECRET_ACCESS_KEY)
  aws s3api put-bucket-lifecycle-configuration --bucket "$(setting S3_BACKUP_BUCKET)" \
    --lifecycle-configuration "{\"Rules\":[$(rule daily 8),$(rule weekly 36),$(rule monthly 95)]}"
  echo "  backup bucket: lifecycle set"

  export AWS_ACCESS_KEY_ID=$(setting S3_ACCESS_KEY_ID) AWS_SECRET_ACCESS_KEY=$(setting S3_SECRET_ACCESS_KEY)
  photos=$(setting S3_BUCKET)
  aws s3api put-bucket-versioning --bucket "$photos" --versioning-configuration Status=Enabled
  aws s3api put-bucket-lifecycle-configuration --bucket "$photos" --lifecycle-configuration \
    "{\"Rules\":[{\"ID\":\"old-versions\",\"Status\":\"Enabled\",\"Filter\":{\"Prefix\":\"\"},\"NoncurrentVersionExpiration\":{\"NoncurrentDays\":30},\"Expiration\":{\"ExpiredObjectDeleteMarker\":true}}]}"
  echo "  photo bucket: versioning on, old versions expire after 30 days"
REMOTE

echo "→ Health check"
ssh "$HOST" "$DIR/monitor.sh --dry && systemctl start subby-monitor.service"

echo "→ First backup"
ssh "$HOST" "systemctl start subby-backup.service && journalctl -u subby-backup.service -n 3 --no-pager -o cat && $DIR/backup.sh --list"
