#!/bin/bash
# Formatting the way CI checks it (gofmt for Go, Biome for the client), so that no session's pull request fails on it.
#
#   format.sh edit    after an Edit or Write: formats that file (the hook's JSON on stdin names it)
#   format.sh commit  before a command with a git commit in it: refuses a message that skips CI; formats the files
#                     the commit takes (staged, named in the command, or every changed one with -a), and if any
#                     changed, stops the commit to add them; stops it too while Biome finds anything to warn of in
#                     them (CI fails on a warning: package.json's check)
#
# Sessions write files with tools and scripts, never through an editor that formats on save: this is that editor.
# Only the commit's own files, in the checkout it runs in (a worktree's, not the shared one): several sessions share
# the machine, and one's untracked file is never another's to format or to be stopped by (the audit, 2026-11-24).
set -u
input=$(cat)

# fmt formats the files given (paths from the checkout's top) that CI formats; prints those it changed.
fmt() {
	local f before
	for f in "$@"; do
		[ -f "$f" ] || continue
		case "$f" in
		*.go) [[ "$f" == internal/assets/dist/* ]] && continue ;;
		web/*.ts | web/*.css | web/*.json | e2e/*.ts | e2e/*.json | *.json) ;;
		*) continue ;;
		esac
		before=$(shasum "$f")
		case "$f" in
		*.go) gofmt -w "$f" ;;
		*) [ -n "$biome" ] && "$biome" check --write --files-ignore-unknown=true --no-errors-on-unmatched "$f" >/dev/null 2>&1 ;;
		esac
		[ "$before" != "$(shasum "$f")" ] && echo "$f"
	done
}

# top goes to the top of the checkout we're in, and finds Biome there or in the main checkout (a worktree has no
# node_modules of its own).
top() {
	cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0
	local main
	main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
	biome=$(ls "$PWD"/node_modules/@biomejs/cli-*/biome "$main"/node_modules/@biomejs/cli-*/biome 2>/dev/null | head -1)
}

case "${1:-}" in
edit)
	f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty' <<<"$input")
	[ -n "$f" ] && cd "$(dirname "$f")" 2>/dev/null || exit 0
	top
	fmt "${f#"$PWD"/}" >/dev/null
	exit 0
	;;
commit)
	cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
	# Only a command that commits: the hook's filter lets others through.
	grep -qE '(^|[;&|(]|\s)git(\s+-C\s+\S+)?\s+commit\b' <<<"$cmd" || exit 0
	# A skip marker in a commit's message skips every check of the push, the one that would refuse it too.
	if grep -qiE '\[(skip ci|ci skip|no ci|skip actions|actions skip)\]' <<<"$cmd"; then
		echo "The commit's message holds [skip ci] or the like: GitHub would run no check and no deploy on it. Reword it." >&2
		exit 2
	fi
	# The checkout the command commits in: where the session's shell is, or the command's own `cd` if it starts so.
	dir=$(jq -r '.cwd // empty' <<<"$input")
	cd "${dir:-${CLAUDE_PROJECT_DIR:-.}}" 2>/dev/null || exit 0
	if [[ "$cmd" =~ ^cd[[:space:]]+([^[:space:]\;\&]+) ]]; then
		to=${BASH_REMATCH[1]//\"/}
		cd "${to/#\~/$HOME}" 2>/dev/null || exit 0
	fi
	top
	# What the commit takes: what's staged, the files the command names (`git add a b && git commit`), and with -a
	# every tracked file changed.
	files=$( (
		git diff --cached --name-only
		for w in $cmd; do
			w=${w//\"/}
			[ -f "$w" ] && echo "${w#./}"
		done
		grep -qE 'commit\b.*\s-[a-zA-Z]*a' <<<"$cmd" && git diff --name-only
	) | sort -u)
	[ -n "$files" ] || exit 0
	# shellcheck disable=SC2086 # the repo's paths have no spaces
	changed=$(fmt $files)
	if [ -n "$changed" ]; then
		echo "Formatted as CI wants it, so the commit was stopped: git add these and commit again:" >&2
		echo "$changed" >&2
		exit 2
	fi
	client=$(grep -E '^(web|e2e)/.*\.(ts|css|json)$|^[^/]*\.json$' <<<"$files" | while read -r f; do [ -f "$f" ] && echo "$f"; done)
	# shellcheck disable=SC2086
	if [ -n "$biome" ] && [ -n "$client" ] && ! out=$("$biome" ci --error-on-warnings --colors=off $client 2>&1); then
		echo "Biome found something to fix, so the commit was stopped (CI would fail on it too):" >&2
		echo "$out" | grep -vE '^\s*$' | head -60 >&2
		exit 2
	fi
	exit 0
	;;
esac
