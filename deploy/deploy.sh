#!/bin/sh
# Makes a release of the game the live one, and goes back to the one before if the new one isn't healthy. As root, or
# from CI through deploy-ci.sh:
#
#   almanac-deploy v2.0.0        by hand (also how to go back to an older one)
#   almanac-deploy v2.0.0 ci     as CI asks: not a release that failed before (below)
#
# It runs as a unit of its own (almanac-deploy-v2.0.0: journalctl -u), and whoever started it follows its output: a
# deploy goes to its end, going back included, even if the session that started it is cut (CI cancelled, the network
# gone; Ctrl-C stops only the following: `systemctl stop almanac-deploy-v2.0.0` stops the deploy). One deploy at a
# time: a second waits for the first. Nor beside a bank reload (almanac-bank, bank.sh, takes the same lock): each
# waits for the other, as a reload's work (the days ahead drawn again) during the health watch below could pass for
# the new version's fault, and send it back (23 Nov 2026). A version that is live already is left as it is, so CI asks
# for the latest release after every merge, and a deploy that didn't happen is tried again.
#
# A release that went back for not being healthy is marked (/var/lib/almanac-deploy/unhealthy-vX.Y.Z, its first line
# says why), and CI doesn't ask for it again: every merge would cut play twice for a release that fails the same way.
# One that never came up after it began to migrate the database (its start made the copy, below) is marked by its
# migrations too, those it brought that the version before didn't have, each by its SHA-256 (`almanac migrations`): CI
# refuses any release that brings one of them unchanged, so the next patch, which carries it, isn't tried either; a
# changed migration is. By hand, either is deployed all the same. A mark goes once its version is live and healthy,
# or every migration it names is.
#
# The release comes from GitHub, and is taken only with its signature (almanac-linux-arm64.sig, made by the deploy
# workflow with a key that only it holds; /etc/almanac/release-signers is its public half, from deploy/release-signers)
# and only if the program says it is that version, asked as the game's user: the program is checked before anything of
# it runs. A release without one (from before signatures) is never taken: only one kept here already (the five used
# latest are kept in /usr/local/lib/almanac, each checked when it came) can be gone back to.
#
# Nothing the game plays lives only in its memory (every game is in the database, step by step), so a restart cuts no
# play, and the deploy restarts at once. Connections that come during the restart wait in systemd's socket
# (almanac.socket) for the new server.
#
# The database: a version that brings a migration the database hasn't had copies it as it first starts, before
# migrating (before-vX.Y.Z.db: store.KeepCopy); this script can't, as the socket starts the server again as soon as a
# connection comes. So the disk must have room for that copy and the migrations, twice the database, or the deploy
# stops before the restart. Going back puts the copy in the database's place, by renaming it, if the failed version
# made it: a program refuses a database that has a migration it doesn't know (internal/store), so the version before
# can only start on the database as it was before the new one migrated it. The failed version's database, its log
# with it, is kept beside it (failed-vX.Y.Z-<time>.db, pruned with the other copies after a month), for what it wrote
# and why it failed. A version without a migration makes no copy, and going back from it leaves the database as it is.
# Whatever stops this midway while the game is stopped, the game is started again as it ends.
#
# Healthy: the server answers as the new version within three minutes, and then keeps answering, the same process,
# for two more (a crash after a good start goes back too).
set -eu
usage="usage: almanac-deploy vX.Y.Z [ci]"
tag=${1:-}
# A version: v and three numbers, the whole string (no second line, no path).
case $tag in *[!v0-9.]* | '') tag=bad ;; esac
if ! printf '%s\n' "$tag" | grep -Exq 'v(0|[1-9][0-9]{0,5})(\.(0|[1-9][0-9]{0,5})){2}' || [ $# -gt 2 ]; then
	echo "$usage" >&2
	exit 1
fi
mode=${2:-}
case $mode in "" | ci) ;; *)
	echo "$usage" >&2
	exit 1
	;;
esac

# Its own unit, followed from here: what it prints comes back, and it goes on if this is cut off.
if [ -z "${ALMANAC_DEPLOY_UNIT:-}" ]; then
	unit=almanac-deploy-$tag
	journalctl -f -q -o cat --since "$(date '+%Y-%m-%d %H:%M:%S')" "_SYSTEMD_UNIT=$unit.service" &
	follower=$!
	ran=0
	systemd-run --unit="$unit" --collect --wait --quiet --service-type=exec --setenv=ALMANAC_DEPLOY_UNIT=1 \
		"$(readlink -f "$0")" "$@" || ran=$?
	sleep 1 # its last lines reach the journal
	kill "$follower" 2>/dev/null || true
	exit "$ran"
fi

# Where everything is (deploy/setup.sh puts it there; the tests, deploy/deploy_test.go, elsewhere).
dir=/usr/local/lib/almanac
data=/var/lib/almanac
link=/usr/local/bin/almanac
marks=/var/lib/almanac-deploy
signers=/etc/almanac/release-signers
lock=/run/almanac-deploy.lock # bank.sh's too

trap '' PIPE # its output is the journal's; nothing that reads it going away may stop it
exec 9>"$lock"
if ! flock -n 9; then
	echo "another deploy, or a bank reload (almanac-bank), is under way: $tag waits for it"
	flock 9
fi

db=$data/almanac.db
program=$dir/almanac-$tag
unhealthy=$marks/unhealthy-$tag

# The running server, from the machine itself.
api() { curl -fsSk --max-time 5 --resolve almanac.bg:443:127.0.0.1 -X "$1" "https://almanac.bg/api/$2"; }
answers() { api GET health 2>/dev/null | grep -q "\"version\":\"$1\""; }
# A program's migrations, as `almanac migrations` lists them (nothing from one too old to say).
migrations() { setpriv --reuid=almanac --regid=almanac --clear-groups "$1" migrations 2>/dev/null || true; }

previous=$(readlink "$link" || true)
if [ "$previous" = "$program" ] && answers "$tag"; then
	echo "live already: $tag"
	exit 0
fi
if [ -f "$unhealthy" ]; then
	cat "$unhealthy" >&2
	if [ "$mode" = ci ]; then
		echo "not tried again from CI: a new release goes out, or almanac-deploy $tag by hand" >&2
		exit 1
	fi
	echo "deployed all the same, by hand"
fi

incoming=
work=
stopped=
finish() {
	# The game stopped for going back, and this cut off midway: started again, whatever it starts on.
	if [ -n "$stopped" ]; then systemctl start almanac.socket almanac || true; fi
	if [ -n "$incoming" ]; then rm -rf "$incoming"; fi
	if [ -n "$work" ]; then rm -rf "$work"; fi
}
trap finish EXIT
trap 'exit 1' HUP INT TERM
work=$(mktemp -d)

# The program, checked before anything of it runs.
if [ -e "$program" ]; then
	echo "$tag is here already"
	touch "$program" # the latest used, kept
else
	if ! grep -q '^[^#[:space:]]' "$signers" 2>/dev/null; then
		echo "not taken: $signers names no key, and a release is taken only with its signature (deploy/release-signers)" >&2
		exit 1
	fi
	incoming=$(mktemp -d "$dir/.incoming.XXXXXX")
	chmod 755 "$incoming" # the game's user runs it, below
	url=https://github.com/almanac-bg/almanac/releases/download/$tag/almanac-linux-arm64
	curl -fsSL --proto '=https' -o "$incoming/almanac" "$url"
	if ! curl -fsSL --proto '=https' -o "$incoming/almanac.sig" "$url.sig" 2>/dev/null; then
		echo "not taken: $tag has no signature (one from before signatures can't be deployed, unless it's kept in $dir)" >&2
		exit 1
	fi
	ssh-keygen -Y verify -f "$signers" -I almanac-release -n almanac-release -s "$incoming/almanac.sig" <"$incoming/almanac"
	chmod 755 "$incoming/almanac"
	said=$(setpriv --reuid=almanac --regid=almanac --clear-groups "$incoming/almanac" version)
	if [ "$said" != "$tag" ]; then
		echo "not taken: the program says it is $said, not $tag" >&2
		exit 1
	fi
	mv "$incoming/almanac" "$program"
fi

# Its migrations, and CI's check of them against those that failed before.
migrations "$program" >"$work/brings"
if [ "$mode" = ci ] && [ -s "$work/brings" ]; then
	for mark in "$marks"/unhealthy-v*; do
		[ -f "$mark" ] || continue
		sed -n 's/^migration //p' "$mark" >"$work/failed"
		if [ -s "$work/failed" ] && grep -qxFf "$work/failed" "$work/brings"; then
			head -n 1 "$mark" >&2
			echo "not tried from CI: $tag brings that release's migration, unchanged:" >&2
			grep -xFf "$work/failed" "$work/brings" >&2
			echo "change it, or almanac-deploy $tag by hand" >&2
			exit 1
		fi
	done
fi

# Room for a copy of the database and its migrations: refused here, before the restart.
size=$(($(stat -c %s "$db" 2>/dev/null || echo 0) + $(stat -c %s "$db-wal" 2>/dev/null || echo 0)))
room=$(df --output=avail -B1 "$data" | tail -n 1)
if [ "$room" -lt $((2 * size)) ]; then
	echo "not deployed: $((room >> 20)) MB free in $data, and a copy of the database with its migrations may take $((2 * size >> 20)) MB" >&2
	exit 1
fi

restarted=$(date +%s)
ln -sfn "$program" "$link"
systemctl restart almanac

healthy=
answered=
why="it didn't answer as $tag within three minutes"
until=$((restarted + 180))
while [ "$(date +%s)" -lt "$until" ]; do
	sleep 1
	if answers "$tag"; then
		healthy=1 answered=1
		break
	fi
done
if [ -n "$healthy" ]; then
	echo "answering: $tag; watching it for two minutes"
	pid=$(systemctl show -p MainPID --value almanac)
	missed=0
	until=$(($(date +%s) + 120))
	while [ "$(date +%s)" -lt "$until" ]; do
		sleep 5
		if [ "$(systemctl show -p MainPID --value almanac)" != "$pid" ]; then
			healthy= why="it stopped after it started"
			break
		fi
		if answers "$tag"; then missed=0; else missed=$((missed + 1)); fi
		if [ "$missed" -ge 3 ]; then
			healthy= why="it stopped answering"
			break
		fi
	done
fi
if [ -n "$healthy" ]; then
	echo "live: $tag"
	rm -f "$unhealthy"
	# A mark whose migrations have all run now, healthy, holds nothing back any more.
	sed 's/^[0-9a-f]*  //' "$work/brings" >"$work/names"
	for mark in "$marks"/unhealthy-v*; do
		[ -f "$mark" ] && [ -s "$work/names" ] || continue
		sed -n 's/^migration [0-9a-f]*  //p' "$mark" >"$work/named"
		if [ -s "$work/named" ] && ! grep -vxFf "$work/names" "$work/named" >/dev/null; then
			echo "their migrations have run: $(head -n 1 "$mark")"
			rm -f "$mark"
		fi
	done
	# The five used latest are kept, to go back to any of them: almanac-deploy <tag>.
	# shellcheck disable=SC2012 # the names are versions: no spaces, no new lines
	ls -t "$dir"/almanac-v* | tail -n +6 | while read -r old; do
		if [ "$old" != "$program" ]; then rm -f "$old"; fi
	done
	exit 0
fi

echo "$tag isn't healthy: $why (journalctl -u almanac)" >&2
copy=$data/before-$tag.db
migrated=
if [ -e "$copy" ] && [ "$(stat -c %Y "$copy")" -ge "$restarted" ]; then migrated=1; fi
mkdir -p "$marks"
{
	echo "$tag went back at $(date -u '+%Y-%m-%d %H:%M UTC'): $why"
	# It never came up, and had begun to migrate: its migrations are the likely cause, and the next patch brings them.
	if [ -n "$migrated" ] && [ -z "$answered" ] && [ -n "$previous" ]; then
		migrations "$previous" >"$work/had"
		if [ -s "$work/had" ]; then
			grep -vxFf "$work/had" "$work/brings" | sed 's/^/migration /' || true
		else
			echo "(the version before can't list its migrations: this one alone is marked)"
		fi
	fi
} >"$unhealthy"
if [ -z "$previous" ] || [ "$previous" = "$program" ]; then
	echo "nothing to go back to" >&2
	exit 1
fi
# The socket too, while the database is put back: a connection to it would start the server midway.
stopped=1
systemctl stop almanac.socket 2>/dev/null || true
systemctl stop almanac
ln -sfn "$previous" "$link"
restored=" (on the database as it is: $tag didn't migrate it)"
if [ -n "$migrated" ]; then
	# The failed version's database is kept, its log with it; then the log goes, for the copy to take the database's
	# place by a rename: the database there at every moment is a whole one (never a log replayed onto another's file).
	failed=$data/failed-$tag-$(date -u '+%Y%m%dT%H%M%SZ').db
	ln -f "$db" "$failed"
	if [ -e "$db-wal" ]; then ln -f "$db-wal" "$failed-wal"; fi
	rm -f "$db-wal" "$db-shm"
	mv -f "$copy" "$db"
	sync
	restored=", on the database as it was before $tag ($tag's kept: $(basename "$failed"))"
fi
systemctl start almanac.socket almanac
stopped=
back=$(basename "$previous")
for _ in $(seq 60); do
	sleep 1
	if answers "${back#almanac-}"; then
		echo "back to $back$restored" >&2
		exit 1
	fi
done
echo "back to $back$restored, but it doesn't answer either (journalctl -u almanac)" >&2
exit 1
