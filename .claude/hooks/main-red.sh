#!/bin/bash
# Tells a session, as it starts, when main's last finished checks failed. The browser tests run after a merge and hold
# nothing up, so a failure there is seen only if someone looks: this looks for every session. Says nothing when main is
# green, or when GitHub can't be reached.
set -u
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" 2>/dev/null || exit 0
command -v gh >/dev/null && command -v jq >/dev/null || exit 0

runs=$(timeout 8 gh run list -w CI -b main -L 10 --json conclusion,status,databaseId,displayTitle,url 2>/dev/null) || exit 0
last=$(jq -c '[.[] | select(.status == "completed" and .conclusion != "cancelled")][0] // empty' <<<"$runs")
[ -n "$last" ] || exit 0
[ "$(jq -r .conclusion <<<"$last")" = failure ] || exit 0

id=$(jq -r .databaseId <<<"$last")
jobs=$(timeout 8 gh run view "$id" --json jobs -q '[.jobs[] | select(.conclusion == "failure") | .name] | join(", ")' 2>/dev/null)
fixes=$(timeout 8 gh pr list --state open --search "fix in:title" --json number,title -q '.[] | "#\(.number) \(.title)"' 2>/dev/null | head -5)

echo "main is red: the checks of „$(jq -r .displayTitle <<<"$last")“ failed${jobs:+ in $jobs} ($(jq -r .url <<<"$last"))."
echo "CLAUDE.md: whoever sees it fixes it, now or with their change; \`gh run view $id --log-failed | grep -E '✘|Error'\` names what failed."
[ -n "$fixes" ] && printf 'Open fixes that may already be on it:\n%s\n' "$fixes"
exit 0
