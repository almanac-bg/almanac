#!/bin/sh
# Takes the latest questions: fetches the private bank, checks it, and has the game reload it (no restart). As root:
#
#   almanac-bank
#
# It checks the new commit in a copy of its own before the checkout in /srv/almanac-bank moves (against that checkout,
# the bank the game plays, and the days' questions: `almanac bank check -live -used`), so a bank with errors never
# reaches it: it prints the errors, says which commit it left out, and stops (exit 1), the checkout and the game
# as they were. A good bank prints its count (…: N questions (M live)) and its problems counted (…: 0 errors, W
# warnings (by rule)); the checkout moves to it, and the game reloads it: the server plays a copy of its own
# (cmd/almanac/banks.go), and while Роял is on it holds the new bank until the evening is over
# (internal/server/bank.go). Then it asks the server (/api/health) what became of it, and its last line says:
#
#   live: <commit> <title>      the game plays it
#   held: <commit> <title>      checked, and in play once Роял is over
#
# or, with exit 1, that the server refused it or didn't say. One run at a time: a second waits for the first.
set -eu
repo=/srv/almanac-bank

exec 9>/run/almanac-bank.lock
if ! flock -n 9; then
	echo "another almanac-bank is under way: waiting for it"
	flock 9
fi

git -C "$repo" fetch --quiet origin
new=$(git -C "$repo" rev-parse '@{upstream}')
title=$(git -C "$repo" log -1 --format='%h %s' "$new")

# The new commit, checked where nothing plays it, against the bank the game plays (-live: a national day left with no
# question fails only if this commit took its last one), counting only the questions a day can still deal (-used: the
# days' questions, read as the game's user, who owns the database; without them the whole bank counts).
work=$(mktemp -d /var/tmp/almanac-bank.XXXXXX)
trap 'rm -rf "$work"' EXIT
stage=$work/bank
mkdir "$stage"
git -C "$repo" archive "$new" | tar -x -C "$stage"
set -- -live "$repo"
if systemd-run --quiet --pipe --wait -p User=almanac -p EnvironmentFile=/etc/almanac/env \
	/usr/local/bin/almanac bank used >"$work/used" 2>/dev/null; then
	set -- "$@" -used "$work/used"
else
	echo "warning: no days' questions (almanac bank used failed): the whole bank counts"
fi
out=$(/usr/local/bin/almanac bank check "$@" "$stage" 2>&1) || {
	echo "$out" | grep -v ': warning: ' | tail -20
	echo "not taken: $title has errors; the bank stays at $(git -C "$repo" log -1 --format='%h %s')"
	exit 1
}
echo "$out" | grep -E ' questions \([0-9]+ live\)$| errors, [0-9]+ warnings|^warning: '

if ! git -C "$repo" merge --ff-only --quiet "$new"; then
	echo "not taken: the checkout in $repo has changes of its own (git -C $repo status)" >&2
	exit 1
fi

# What the server plays, from the machine itself.
health() { curl -fsSk --max-time 5 --resolve almanac.bg:443:127.0.0.1 https://almanac.bg/api/health 2>/dev/null || true; }
case $(health) in *'"bank":{"commit":"'"$new"'"'*)
	echo "live: $title"
	exit 0
	;;
esac
if ! systemctl is-active --quiet almanac; then
	echo "the server isn't running: it takes $title as it starts"
	exit 0
fi
systemctl reload almanac

# The server copies and loads the bank (a few seconds), then plays it, holds it for Роял, or refuses it.
for _ in $(seq 60); do
	sleep 1
	case $(health) in
	*'"bank":{"commit":"'"$new"'"'*)
		echo "live: $title"
		exit 0
		;;
	*'"held":"'"$new"'"'*)
		echo "held: $title (Роял is on: in play once it's over)"
		exit 0
		;;
	*'"refused":{"commit":"'"$new"'"'*)
		echo "not taken: the server refused $title (journalctl -u almanac)" >&2
		exit 1
		;;
	esac
done
echo "not confirmed: the server doesn't say it plays $title (journalctl -u almanac)" >&2
exit 1
