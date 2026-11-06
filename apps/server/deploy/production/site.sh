#!/usr/bin/env bash
# Publishes the homepage (a folder of static files, kept in its own repo) to https://subby.baby:
#   (cd ../subby.baby && npm test) && apps/server/deploy/production/site.sh ../subby.baby/_site
# Copies the folder's contents to /opt/subby/site; Caddy serves them right away, no restart.
# Files removed from the folder are removed from the site too. .git and .DS_Store stay behind; .well-known goes up.
set -euo pipefail
HOST=${SUBBY_HOST:-subby}
SRC=${1:?Usage: site.sh <folder with index.html>}
[[ -f $SRC/index.html ]] || { echo "No index.html in $SRC" >&2; exit 1; }
# macOS's rsync has no --chmod: permissions are set on the server afterwards.
rsync -rlt --delete --exclude .git --exclude .DS_Store "$SRC"/ "$HOST:/opt/subby/site/"
ssh "$HOST" 'find /opt/subby/site -type d -exec chmod 755 {} + && find /opt/subby/site -type f -exec chmod 644 {} +'
echo "✓ Published. https://${SITE_DOMAIN:-subby.baby}"
