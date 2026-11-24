#!/bin/bash
# Clears away what finished work leaves on this Mac: every session and agent makes a branch and often a worktree, and
# GitHub deletes only the remote branch when its pull request merges. Run in the background as a session starts; what
# it removed is logged in .git/tidy.log.
#
# It removes only what can't be anyone's work in progress, and nothing that can't be had back:
# - a local branch whose pull request merged (GitHub keeps its commits), or that has no pull request and whose
#   changes are all on main already, and that no worktree has checked out;
# - a worktree in .claude/worktrees with nothing uncommitted (the private/ link aside) and nothing in it changed for a
#   day, whose branch's pull request merged, or whose work is all on main already (a branch with no pull request, as
#   an agent's, or no branch at all).
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
# landed says whether every file a commit changed since it left main is on main as it has it.
landed() {
	local base f
	base=$(git merge-base origin/main "$1") || return 1
	while read -r f; do
		[ "$(git rev-parse -q --verify "$1:$f")" = "$(git rev-parse -q --verify "origin/main:$f")" ] || return 1
	done < <(git diff --name-only "$base" "$1")
}

# Worktrees first, so that their branches are free to go below.
git worktree list --porcelain |
	awk '/^worktree /{w=$2; b=""} /^branch /{sub("refs/heads/","",$2); b=$2} /^detached/{b="-"} /^$/{if (w && b) print w"\t"b; w=""} END{if (w && b) print w"\t"b}' |
	while IFS=$'\t' read -r w b; do
		[[ $w == "$root/.claude/worktrees/"* ]] || continue
		if has "$merged" "$b"; then why=merged
		elif [ "$b" = - ] && landed "$(git -C "$w" rev-parse HEAD)"; then why="no branch, all of it on main"
		elif [ "$b" != - ] && ! has "$any" "$b" && landed "$b"; then why="no pull request, all of it on main"
		else continue
		fi
		[ -z "$(git -C "$w" status --porcelain | grep -vx '?? private')" ] || continue
		[ -z "$(find "$w" -mtime -1 -not -path '*/node_modules/*' -not -path '*/test-results/*' -print -quit)" ] || continue
		[ -L "$w/private" ] && run rm "$w/private"
		run git worktree remove --force "$w" 2>/dev/null && say "worktree $w ($b, $why)"
	done
[ -n "${DRY:-}" ] || git worktree prune

out=$(git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')
git for-each-ref refs/heads --format='%(refname:short)' | while read -r b; do
	[ "$b" = main ] && continue
	has "$out" "$b" && continue
	if has "$merged" "$b"; then
		run git branch -q -D "$b" && say "branch $b (merged)"
	elif ! has "$any" "$b" && landed "$b"; then
		run git branch -q -D "$b" && say "branch $b (no pull request, all of it on main)"
	fi
done
exit 0
