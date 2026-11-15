#!/bin/sh
# Installs a release of the game and restarts the server into it, at a moment the restart cuts no play; back to the
# one before if the new one isn't healthy within 30 seconds. As root, or from CI through deploy-ci.sh:
#
#   almanac-deploy v2.0.0        when nothing is under way (the usual way)
#   almanac-deploy v2.0.0 now    at once (to go back from a broken release)
#
# Before the restart it drains the server (internal/server/drain.go): asked every few seconds, the server starts no
# live duel and no game in a room, and says it's ready once those under way are over (five minutes at the most). Near
# Роял, from 20:39 until the evening's games are over, it doesn't drain: the restart waits. Connections that come
# during the restart wait in systemd's socket (almanac.socket) for the new server. One deploy at a time: a second
# waits for the first.
#
# The new version copies the database as it first starts, before its migrations (before-vX.Y.Z.db, the ten latest
# kept: store.KeepCopy); this script can't, as the socket starts the server again as soon as a connection comes. Going
# back puts that copy back as well: a program refuses a database that has a migration it doesn't know
# (internal/store), so the version before can only start on the database as it was before the new one migrated it.
# What the failed version wrote in its seconds is lost.
set -eu
tag=${1:?usage: almanac-deploy vX.Y.Z [now]}
case $tag in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "not a version: $tag" >&2; exit 1 ;; esac
case ${2:-} in "" | now) ;; *) echo "usage: almanac-deploy vX.Y.Z [now]" >&2; exit 1 ;; esac

exec 9>/run/almanac-deploy.lock
if ! flock -n 9; then
  echo "another deploy is under way: $tag waits for it"
  flock 9
fi

dir=/usr/local/lib/almanac
url=https://github.com/almanac-bg/almanac/releases/download/$tag/almanac-linux-arm64
cd "$dir"
curl -fsSL -o "almanac-$tag.part" "$url"
curl -fsSL -o "almanac-$tag.sha256" "$url.sha256"
echo "$(cut -d' ' -f1 "almanac-$tag.sha256")  almanac-$tag.part" | sha256sum -c --quiet -
chmod 755 "almanac-$tag.part"
mv "almanac-$tag.part" "almanac-$tag"
rm "almanac-$tag.sha256"
"./almanac-$tag" version

# The running server, from the machine itself.
api() { curl -fsSk --max-time 5 --resolve almanac.bg:443:127.0.0.1 -X "$1" "https://almanac.bg/api/$2"; }

# Whatever happens from here, the server doesn't stay drained (it would end the drain by itself in a minute anyway).
trap 'api DELETE drain >/dev/null 2>&1 || true' EXIT
trap 'exit 1' HUP INT TERM
if [ -z "${2:-}" ]; then
  # A server too old to drain answers 404: then it restarts at once, as before.
  started=$(date +%s)
  told=-1
  while status=$(api POST drain 2>/dev/null); do
    case $status in *'"ready":true'*) echo "ready: $status"; break ;; esac
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

previous=$(readlink /usr/local/bin/almanac || true)
data=/var/lib/almanac
db=$data/almanac.db
copy=$data/before-$tag.db
# A copy left from an earlier run of this version is stale: the new server makes it afresh as it starts.
rm -f "$copy" "$copy-wal"
ln -sfn "$dir/almanac-$tag" /usr/local/bin/almanac
systemctl restart almanac

for _ in $(seq 30); do
  sleep 1
  if api GET health 2>/dev/null | grep -q "\"version\":\"$tag\""; then
    echo "live: $tag"
    # Keep the five latest, to go back to any of them: almanac-deploy <tag> now.
    ls -t "$dir"/almanac-v* | tail -n +6 | xargs -r rm
    exit 0
  fi
done
echo "$tag isn't healthy (journalctl -u almanac)" >&2
if [ -n "$previous" ]; then
  # The socket too, while the database is put back: a connection to it would start the server midway.
  systemctl stop almanac.socket 2>/dev/null || true
  systemctl stop almanac
  if [ -e "$copy" ]; then
    # The new version's log and shared memory belong to its database, never to the copy: replayed onto it, they'd
    # corrupt it.
    rm -f "$db-wal" "$db-shm"
    cp -p "$copy" "$db"
    if [ -e "$copy-wal" ]; then cp -p "$copy-wal" "$db-wal"; fi
    restored=", on the database as it was before $tag"
  else
    restored=" (it never opened the database)"
  fi
  ln -sfn "$previous" /usr/local/bin/almanac
  systemctl start almanac
  echo "back to $(basename "$previous")${restored}" >&2
fi
exit 1
