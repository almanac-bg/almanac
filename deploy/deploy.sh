#!/bin/sh
# Installs a release of the game and starts it; back to the one before if it isn't healthy within 30 seconds. The
# database is copied first (before-vX.Y.Z.db, the ten latest kept), and going back puts that copy back as well: a
# program refuses a database that has a migration it doesn't know (internal/store), so the version before can only
# start on the database as it was before the new one migrated it. What the failed version wrote in its seconds is lost.
# As root, or from CI through deploy-ci.sh:
#
#   almanac-deploy v2.0.0
set -eu
tag=${1:?usage: almanac-deploy vX.Y.Z}
case $tag in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "not a version: $tag" >&2; exit 1 ;; esac

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

previous=$(readlink /usr/local/bin/almanac || true)
data=/var/lib/almanac
db=$data/almanac.db
copy=$data/before-$tag.db
systemctl stop almanac
# The database with its write-ahead log, if a stop that wasn't clean left one: the log holds the last writes.
cp -p "$db" "$copy"
rm -f "$copy-wal"
if [ -s "$db-wal" ]; then cp -p "$db-wal" "$copy-wal"; fi
ls -t "$data"/before-v*.db | tail -n +11 | while read -r old; do rm -f "$old" "$old-wal"; done
ln -sfn "$dir/almanac-$tag" /usr/local/bin/almanac
systemctl start almanac

for _ in $(seq 30); do
  sleep 1
  if curl -fsk --max-time 2 --resolve almanac.bg:443:127.0.0.1 https://almanac.bg/api/health | grep -q '"ok":true'; then
    echo "live: $tag"
    # Keep the five latest, to go back to any of them: almanac-deploy <tag> again.
    ls -t "$dir"/almanac-v* | tail -n +6 | xargs -r rm
    exit 0
  fi
done
echo "$tag isn't healthy (journalctl -u almanac)" >&2
if [ -n "$previous" ]; then
  systemctl stop almanac
  # The new version's log and shared memory belong to its database, never to the copy: replayed onto it, they'd
  # corrupt it.
  rm -f "$db-wal" "$db-shm"
  cp -p "$copy" "$db"
  if [ -e "$copy-wal" ]; then cp -p "$copy-wal" "$db-wal"; fi
  ln -sfn "$previous" /usr/local/bin/almanac
  systemctl start almanac
  echo "back to $(basename "$previous"), on the database as it was before $tag" >&2
fi
exit 1
