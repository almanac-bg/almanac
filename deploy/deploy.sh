#!/bin/sh
# Deploys what's on GitHub: both repositories, a fresh build on up-to-date base images (Node, Caddy, Litestream), and
# the image that ran until now kept as `almanac:previous` for deploy/rollback.sh. Run as root in the checkout, in a
# quiet hour: queues close while running matches play out (see README → Обновяване).
set -eu
cd "$(dirname "$0")/.."
echo "$(date -u +%FT%TZ) deploying (note the time: Litestream can bring the database back to it)"
git pull --ff-only
git -C private pull --ff-only
release=$(git rev-parse --short HEAD)

# What runs now becomes the way back.
if docker image inspect almanac:latest >/dev/null 2>&1; then
  docker tag almanac:latest almanac:previous
  [ -f .release ] && cp .release .release-previous
fi
docker compose pull --ignore-buildable --quiet
docker compose build --pull app
APP_RELEASE=$release docker compose up -d
echo "$release" >.release

# Old images and build layers (more than a week old) would fill the disk over time.
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null
echo "$(date -u +%FT%TZ) deployed $release"
