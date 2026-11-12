#!/bin/sh
# Installs a release of the game and starts it; back to the one before if it isn't healthy within 30 seconds. As root:
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
ln -sfn "$dir/almanac-$tag" /usr/local/bin/almanac
systemctl restart almanac

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
  ln -sfn "$previous" /usr/local/bin/almanac
  systemctl restart almanac
  echo "back to $(basename "$previous")" >&2
fi
exit 1
