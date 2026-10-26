#!/bin/sh
# Back to the image that ran before the last deploy (kept by deploy/deploy.sh), in seconds and without a build. The
# checkout stays where it is: fix forward, or `git checkout <commit>` before the next deploy. If the newer version had
# migrated the database, the older one refuses to start with it — then restore the copy taken before the migration
# (README → Връщане към предишна версия).
set -eu
cd "$(dirname "$0")/.."
docker image inspect almanac:previous >/dev/null 2>&1 || {
  echo "No previous image to go back to."
  exit 1
}
docker tag almanac:previous almanac:latest
release=$(cat .release-previous 2>/dev/null || echo unknown)
APP_RELEASE=$release docker compose up -d --no-build app
echo "$release" >.release
echo "$(date -u +%FT%TZ) rolled back to $release"
