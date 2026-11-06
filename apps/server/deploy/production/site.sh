#!/usr/bin/env bash
# Publishes the homepage (a folder of static files, kept in its own repo) to https://subby.baby:
#   apps/server/deploy/production/site.sh ~/src/subby-site
# Copies the folder's contents to /opt/subby/site; Caddy serves them right away, no restart.
# Files removed from the folder are removed from the site too. Dotfiles (.git, .DS_Store…) stay behind.
set -euo pipefail
HOST=${SUBBY_HOST:-subby}
SRC=${1:?Usage: site.sh <folder with index.html>}
[[ -f $SRC/index.html ]] || { echo "No index.html in $SRC" >&2; exit 1; }
rsync -rlt --delete --chmod=D755,F644 --exclude '.*' "$SRC"/ "$HOST:/opt/subby/site/"
echo "✓ Published. https://${SITE_DOMAIN:-subby.baby}"
