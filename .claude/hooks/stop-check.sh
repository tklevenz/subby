#!/usr/bin/env bash
# Stop hook: before Claude hands back, typecheck and lint the packages with uncommitted or unpushed changes.
# Failures go back to Claude once. If they're still there when it stops again, the user gets a note instead (no loops).
# Tests are left to CI (.github/workflows/ci.yml): too slow to run on every stop.
set -uo pipefail

input=$(cat)
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

changed=$(
  {
    git status --porcelain --untracked-files=all | cut -c4- | sed 's/.* -> //'
    git diff --name-only '@{upstream}...HEAD' 2>/dev/null
  } | grep -v '\.md$' | sort -u
)
[ -z "$changed" ] && exit 0

filters=()
if grep -qE '^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json)$' <<<"$changed"; then
  : # root config changed: check everything (no filter)
else
  # Shared is consumed as TS source, so a change there is checked in the app and the server too.
  grep -q '^packages/shared/' <<<"$changed" && filters+=(--filter='...@subby/shared')
  grep -q '^apps/mobile/' <<<"$changed" && filters+=(--filter=@subby/mobile)
  grep -q '^apps/server/' <<<"$changed" && filters+=(--filter=@subby/server)
  [ ${#filters[@]} -eq 0 ] && exit 0
fi

out=$(NO_COLOR=1 FORCE_COLOR=0 pnpm turbo run typecheck lint "${filters[@]}" --output-logs=errors-only 2>&1) && exit 0
log=$(grep -vE '^\s*$|ELIFECYCLE|^ +(Tasks|Cached|Time):|^ +• ' <<<"$out" | tail -n 80)

if [ "$(jq -r '.stop_hook_active // false' <<<"$input")" = true ]; then
  jq -n '{systemMessage: "Typecheck or lint still fails after Claude'"'"'s retry. Run: pnpm typecheck && pnpm lint"}'
  exit 0
fi

reason=$(printf 'Typecheck or lint fails in the packages with changes. Fix it before handing back; if a failure is not from your change, say so instead.\n\n%s' "$log")
jq -n --arg r "$reason" '{decision: "block", reason: $r}'
