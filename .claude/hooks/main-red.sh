#!/bin/bash
# Tells a session, as it starts, when main's last finished checks or its last finished deploy failed. Neither holds a
# merge up: the browser tests run after it, and so does the release and its deploy (a release that went back, one the
# server refused, deploy files not installed), so a failure there is seen only if someone looks: this looks for every
# session; and the Dependabot pull requests ready to merge. Says nothing when there's none of it, or when GitHub can't
# be reached.
set -u
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" 2>/dev/null || exit 0
command -v gh >/dev/null && command -v jq >/dev/null || exit 0

fixes=
for workflow in CI Deploy; do
	runs=$(timeout 8 gh run list -w "$workflow" -b main -L 10 --json conclusion,status,databaseId,displayTitle,url 2>/dev/null) || continue
	last=$(jq -c '[.[] | select(.status == "completed" and .conclusion != "cancelled")][0] // empty' <<<"$runs")
	[ -n "$last" ] || continue
	[ "$(jq -r .conclusion <<<"$last")" = failure ] || continue

	id=$(jq -r .databaseId <<<"$last")
	jobs=$(timeout 8 gh run view "$id" --json jobs -q '[.jobs[] | select(.conclusion == "failure") | .name] | join(", ")' 2>/dev/null)
	if [ "$workflow" = CI ]; then
		echo "main is red: the checks of „$(jq -r .displayTitle <<<"$last")“ failed${jobs:+ in $jobs} ($(jq -r .url <<<"$last"))."
	else
		echo "main's deploy is red: the release and deploy of „$(jq -r .displayTitle <<<"$last")“ failed${jobs:+ in $jobs} ($(jq -r .url <<<"$last")); the latest release may not be live (deploy/deploy.sh says why a deploy stops)."
	fi
	echo "CLAUDE.md: whoever sees it fixes it, now or with their change; \`gh run view $id --log-failed | grep -E '✘|Error|::error|not '\` names what failed."
	fixes=1
done
# Dependabot's pull requests: nobody else merges them (one waited green for a day, the audit of 2026-11-24). Its
# five days of cooldown are the wait for a bad release; once its checks pass, a session merges it.
deps=$(timeout 8 gh pr list --state open --author app/dependabot --json number,title,statusCheckRollup \
	-q '.[] | select([.statusCheckRollup[]? | .conclusion // .state] | all(. == "SUCCESS" or . == "SKIPPED" or . == "NEUTRAL")) | "#\(.number) \(.title)"' 2>/dev/null)
[ -n "$deps" ] && printf 'Dependabot pull requests with their checks green, to merge (gh pr merge <n> --auto --squash):\n%s\n' "$deps"
if [ -n "$fixes" ]; then
	open=$(timeout 8 gh pr list --state open --search "fix in:title" --json number,title -q '.[] | "#\(.number) \(.title)"' 2>/dev/null | head -5)
	[ -n "$open" ] && printf 'Open fixes that may already be on it:\n%s\n' "$open"
fi
exit 0
