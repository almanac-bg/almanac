#!/bin/bash
# Formatting the way CI checks it (gofmt for Go, Biome for the client), so that no session's pull request fails on it.
#
#   format.sh edit    after an Edit or Write: formats that file (the hook's JSON on stdin names it)
#   format.sh commit  before a git commit: formats every changed file; if any changed, stops the commit to add them
#
# Sessions write files with tools and scripts, never through an editor that formats on save: this is that editor.
set -u
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0
biome=node_modules/@biomejs/cli-darwin-arm64/biome
[ -x "$biome" ] || biome=$(ls node_modules/@biomejs/cli-*/biome 2>/dev/null | head -1)

# fmt formats the files given that CI formats; prints those it changed.
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

case "${1:-}" in
edit)
	f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
	[ -n "$f" ] && fmt "${f#"$PWD"/}" >/dev/null
	exit 0
	;;
commit)
	changed=$(fmt $( (git diff --name-only HEAD; git ls-files --others --exclude-standard) | sort -u))
	if [ -n "$changed" ]; then
		echo "Formatted as CI wants it, so the commit was stopped: git add these and commit again:" >&2
		echo "$changed" >&2
		exit 2
	fi
	exit 0
	;;
esac
