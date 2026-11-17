#!/bin/bash
# Clears away what finished work leaves on this Mac: every session and agent makes a branch and often a worktree, and
# GitHub deletes only the remote branch when its pull request merges. Run in the background as a session starts; what
# it removed is logged in .git/tidy.log.
#
# It removes only what can't be anyone's work in progress, and nothing that can't be had back:
# - a local branch whose pull request merged (GitHub keeps its commits), or that has no pull request and whose
#   changes are all on main already, and that no worktree has checked out;
# - a worktree in .claude/worktrees whose branch's pull request merged, with nothing uncommitted (the private/ link
#   aside) and nothing in it changed for a day.
#
# DRY=1 says what it would remove, and removes nothing.
set -u
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" 2>/dev/null || exit 0
common=$(git rev-parse --path-format=absolute --git-common-dir) || exit 0
root=$(dirname "$common")
log=$common/tidy.log
mkdir "$common/tidy.lock" 2>/dev/null || exit 0 # another session is at it
trap 'rmdir "$common/tidy.lock"' EXIT
say() { [ -n "${DRY:-}" ] && return 0; echo "$(date '+%F %T') $*" >>"$log"; }
# run runs a removal, or with DRY=1 prints it.
run() { if [ -n "${DRY:-}" ]; then echo "would: $*"; else "$@"; fi; }

git fetch -q --prune origin 2>/dev/null || exit 0
merged=$(gh pr list --state merged -L 1000 --json headRefName -q '.[].headRefName' 2>/dev/null) || exit 0
any=$(gh pr list --state all -L 1000 --json headRefName -q '.[].headRefName' 2>/dev/null) || exit 0
has() { grep -qxF -- "$2" <<<"$1"; }

# Worktrees first, so that their branches are free to go below.
git worktree list --porcelain | awk '/^worktree /{w=$2} /^branch /{sub("refs/heads/","",$2); print w"\t"$2}' |
	while IFS=$'\t' read -r w b; do
		[[ $w == "$root/.claude/worktrees/"* ]] && has "$merged" "$b" || continue
		[ -z "$(git -C "$w" status --porcelain | grep -vx '?? private')" ] || continue
		[ -z "$(find "$w" -mtime -1 -not -path '*/node_modules/*' -not -path '*/test-results/*' -print -quit)" ] || continue
		[ -L "$w/private" ] && run rm "$w/private"
		run git worktree remove --force "$w" 2>/dev/null && say "worktree $w ($b, merged)"
	done
[ -n "${DRY:-}" ] || git worktree prune

out=$(git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')
git for-each-ref refs/heads --format='%(refname:short)' | while read -r b; do
	[ "$b" = main ] && continue
	has "$out" "$b" && continue
	if has "$merged" "$b"; then
		run git branch -q -D "$b" && say "branch $b (merged)"
	elif ! has "$any" "$b"; then
		base=$(git merge-base origin/main "$b") || continue
		landed=yes
		while read -r f; do
			[ "$(git rev-parse -q --verify "$b:$f")" = "$(git rev-parse -q --verify "origin/main:$f")" ] || { landed=; break; }
		done < <(git diff --name-only "$base" "$b")
		[ -n "$landed" ] && run git branch -q -D "$b" && say "branch $b (no pull request, all of it on main)"
	fi
done
exit 0
