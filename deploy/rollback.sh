#!/bin/sh
# Back to the image that ran before the last deploy (kept by deploy/deploy.sh), in seconds and without a build — or,
# with a commit (`deploy/rollback.sh 5a20eb3`), to the image CI published for that one. The checkout stays where it
# is: fix forward, or `git checkout <commit>` before the next deploy. A database the newer version migrated with
# compatible steps only (see apps/server/src/db.ts) works with the older one as it is; after a breaking step the older
# one refuses to start with it — then restore the copy taken before the migration (README → Връщане към предишна
# версия).
set -eu
cd "$(dirname "$0")/.."
if [ $# -gt 0 ]; then
  commit=$(git rev-parse --verify "$1^{commit}")
  release=$(git rev-parse --short "$commit")
  image="ghcr.io/almanac-bg/almanac:$commit"
  docker pull --quiet "$image" >/dev/null || {
    echo "No image for $release: CI publishes one only for commits on main that passed every check."
    exit 1
  }
  docker tag almanac:latest almanac:previous 2>/dev/null && cp .release .release-previous 2>/dev/null || true
  docker tag "$image" almanac:latest
  docker rmi "$image" >/dev/null
else
  docker image inspect almanac:previous >/dev/null 2>&1 || {
    echo "No previous image to go back to."
    exit 1
  }
  docker tag almanac:previous almanac:latest
  release=$(cat .release-previous 2>/dev/null || echo unknown)
fi
APP_RELEASE=$release docker compose up -d --no-build app
echo "$release" >.release
echo "$(date -u +%FT%TZ) rolled back to $release"
