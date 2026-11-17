#!/bin/sh
# Makes a release of the game the live one, at a moment the restart cuts no play, and goes back to the one before if
# the new one isn't healthy. As root, or from CI through deploy-ci.sh:
#
#   almanac-deploy v2.0.0        when nothing is under way (the usual way)
#   almanac-deploy v2.0.0 now    at once (to go back from a broken release)
#
# It runs as a unit of its own (almanac-deploy-v2.0.0: journalctl -u), and whoever started it follows its output: a
# deploy goes to its end, going back included, even if the session that started it is cut (CI cancelled, the network
# gone; Ctrl-C stops only the following: `systemctl stop almanac-deploy-v2.0.0` stops the deploy). One deploy at a
# time: a second waits for the first. A version that is live already is left as it is, so CI asks for the latest
# release after every merge, and a deploy that didn't happen is tried again. One that went back for not being healthy
# is marked (/var/lib/almanac-deploy), and CI doesn't ask for it again (deploy-ci.sh).
#
# The release comes from GitHub, and is taken only with its signature (almanac-linux-arm64.sig, made by the deploy
# workflow with a key that only it holds; /etc/almanac/release-signers is its public half, from deploy/release-signers)
# and only if the program says it is that version, asked as the game's user. One already here (the five latest are
# kept in /usr/local/lib/almanac) was checked when it came. A release from before signatures is taken, by hand, on
# its checksum alone with ALMANAC_UNSIGNED=1 almanac-deploy vX.Y.Z; and every release is, while release-signers
# names no key (signing not set up yet).
#
# Before the restart it drains the server (internal/server/drain.go): asked every few seconds, the server starts no
# live duel and no game in a room, and says it's ready once those under way are over (a duel by its own clock, seven
# minutes at the most; a room's game, five). Near Роял, from 20:37 until the evening's games are over, it doesn't
# drain: the restart waits. Connections that come during the restart wait in systemd's socket (almanac.socket) for the
# new server.
#
# The database: a version that brings a migration the database hasn't had copies it as it first starts, before
# migrating (before-vX.Y.Z.db: store.KeepCopy); this script can't, as the socket starts the server again as soon as a
# connection comes. So the disk must have room for that copy and the migrations, twice the database, or the deploy
# stops before it drains. Going back puts the copy back if the failed version made it: a program refuses a database
# that has a migration it doesn't know (internal/store), so the version before can only start on the database as it
# was before the new one migrated it, and what the failed version wrote is lost. A version without a migration makes
# no copy, and going back from it leaves the database as it is.
#
# Healthy: the server answers as the new version within three minutes, and then keeps answering, the same process,
# for two more (a crash after a good start goes back too).
set -eu
usage="usage: almanac-deploy vX.Y.Z [now]"
tag=${1:-}
# A version: v and three numbers, the whole string (no second line, no path).
case $tag in *[!v0-9.]* | '') tag=bad ;; esac
if ! printf '%s\n' "$tag" | grep -Exq 'v(0|[1-9][0-9]{0,5})(\.(0|[1-9][0-9]{0,5})){2}' || [ $# -gt 2 ]; then
	echo "$usage" >&2
	exit 1
fi
case ${2:-} in "" | now) ;; *)
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
	systemd-run --unit="$unit" --collect --wait --quiet --service-type=exec \
		--setenv=ALMANAC_DEPLOY_UNIT=1 --setenv=ALMANAC_UNSIGNED="${ALMANAC_UNSIGNED:-}" \
		"$(readlink -f "$0")" "$@" || ran=$?
	sleep 1 # its last lines reach the journal
	kill "$follower" 2>/dev/null || true
	exit "$ran"
fi

trap '' PIPE # its output is the journal's; nothing that reads it going away may stop it
exec 9>/run/almanac-deploy.lock
if ! flock -n 9; then
	echo "another deploy is under way: $tag waits for it"
	flock 9
fi

dir=/usr/local/lib/almanac
data=/var/lib/almanac
db=$data/almanac.db
program=$dir/almanac-$tag
# A version that went back for not being healthy: CI doesn't try it again (deploy-ci.sh), by hand it may be.
unhealthy=/var/lib/almanac-deploy/unhealthy-$tag

# The running server, from the machine itself.
api() { curl -fsSk --max-time 5 --resolve almanac.bg:443:127.0.0.1 -X "$1" "https://almanac.bg/api/$2"; }
answers() { api GET health 2>/dev/null | grep -q "\"version\":\"$1\""; }

previous=$(readlink /usr/local/bin/almanac || true)
if [ "$previous" = "$program" ] && answers "$tag"; then
	echo "live already: $tag"
	exit 0
fi

# The program, checked before anything of it runs.
incoming=
drained=
finish() {
	if [ -n "$incoming" ]; then rm -rf "$incoming"; fi
	# The server doesn't stay drained (it would end the drain by itself in a minute anyway).
	if [ -n "$drained" ]; then api DELETE drain >/dev/null 2>&1 || true; fi
}
trap finish EXIT
trap 'exit 1' HUP INT TERM
if [ -e "$program" ]; then
	echo "$tag is here already"
	touch "$program" # the latest used, kept
else
	incoming=$(mktemp -d "$dir/.incoming.XXXXXX")
	chmod 755 "$incoming" # the game's user runs it, below
	url=https://github.com/almanac-bg/almanac/releases/download/$tag/almanac-linux-arm64
	curl -fsSL --proto '=https' -o "$incoming/almanac" "$url"
	signers=/etc/almanac/release-signers
	if ! grep -q '^[^#[:space:]]' "$signers" 2>/dev/null; then
		echo "$signers names no key yet: $tag is taken on its checksum alone"
		unsigned=1
	elif curl -fsSL --proto '=https' -o "$incoming/almanac.sig" "$url.sig" 2>/dev/null; then
		ssh-keygen -Y verify -f "$signers" -I almanac-release -n almanac-release -s "$incoming/almanac.sig" \
			<"$incoming/almanac"
		unsigned=
	elif [ "${ALMANAC_UNSIGNED:-}" = 1 ]; then
		echo "$tag has no signature: taken on its checksum alone (ALMANAC_UNSIGNED=1)"
		unsigned=1
	else
		echo "$tag has no signature: not taken (one from before signatures, by hand: ALMANAC_UNSIGNED=1 almanac-deploy $*)" >&2
		exit 1
	fi
	if [ -n "$unsigned" ]; then
		curl -fsSL --proto '=https' -o "$incoming/almanac.sha256" "$url.sha256"
		echo "$(cut -d' ' -f1 "$incoming/almanac.sha256")  $incoming/almanac" | sha256sum -c --quiet -
	fi
	chmod 755 "$incoming/almanac"
	said=$(setpriv --reuid=almanac --regid=almanac --clear-groups "$incoming/almanac" version)
	if [ "$said" != "$tag" ]; then
		echo "not taken: the program says it is $said, not $tag" >&2
		exit 1
	fi
	mv "$incoming/almanac" "$program"
fi

# Room for a copy of the database and its migrations: refused here, before any play is cut.
size=$(($(stat -c %s "$db" 2>/dev/null || echo 0) + $(stat -c %s "$db-wal" 2>/dev/null || echo 0)))
room=$(df --output=avail -B1 "$data" | tail -n 1)
if [ "$room" -lt $((2 * size)) ]; then
	echo "not deployed: $((room >> 20)) MB free in $data, and a copy of the database with its migrations may take $((2 * size >> 20)) MB" >&2
	exit 1
fi

if [ -z "${2:-}" ]; then
	# A server too old to drain answers 404: then it restarts at once, as before.
	drained=1
	started=$(date +%s)
	told=-1
	while status=$(api POST drain 2>/dev/null); do
		case $status in *'"ready":true'*)
			echo "ready: $status"
			break
			;;
		esac
		waited=$(($(date +%s) - started))
		if [ "$waited" -ge 2700 ]; then
			echo "not ready after 45 minutes ($status): restarting all the same" >&2
			break
		fi
		if [ $((waited / 60)) -gt "$told" ]; then
			told=$((waited / 60))
			echo "waiting ($told min): $status"
		fi
		sleep 5
	done
fi

restarted=$(date +%s)
ln -sfn "$program" /usr/local/bin/almanac
systemctl restart almanac

healthy=
why="it didn't answer as $tag within three minutes"
until=$((restarted + 180))
while [ "$(date +%s)" -lt "$until" ]; do
	sleep 1
	if answers "$tag"; then
		healthy=1
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
	# The five used latest are kept, to go back to any of them: almanac-deploy <tag> now.
	# shellcheck disable=SC2012 # the names are versions: no spaces, no new lines
	ls -t "$dir"/almanac-v* | tail -n +6 | while read -r old; do
		if [ "$old" != "$program" ]; then rm -f "$old"; fi
	done
	exit 0
fi

echo "$tag isn't healthy: $why (journalctl -u almanac)" >&2
mkdir -p "$(dirname "$unhealthy")"
echo "$tag went back at $(date -u '+%Y-%m-%d %H:%M UTC'): $why" >"$unhealthy"
if [ -z "$previous" ] || [ "$previous" = "$program" ]; then
	echo "nothing to go back to" >&2
	exit 1
fi
# The socket too, while the database is put back: a connection to it would start the server midway.
systemctl stop almanac.socket 2>/dev/null || true
systemctl stop almanac
copy=$data/before-$tag.db
restored=" (on the database as it is: $tag didn't migrate it)"
if [ -e "$copy" ] && [ "$(stat -c %Y "$copy")" -ge "$restarted" ]; then
	# The new version's log and shared memory belong to its database, never to the copy: replayed onto it, they'd
	# corrupt it.
	rm -f "$db-wal" "$db-shm"
	cp -p "$copy" "$db"
	restored=", on the database as it was before $tag"
fi
ln -sfn "$previous" /usr/local/bin/almanac
systemctl start almanac.socket almanac
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
