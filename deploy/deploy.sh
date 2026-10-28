#!/bin/sh
# Deploys what's on GitHub: both repositories, and the image CI built, tested and published for this commit (Caddy and
# Litestream on up-to-date images too). Nothing is built here: a commit CI hasn't passed has no image, and the deploy
# stops before changing anything that runs. The image that ran until now is kept as `almanac:previous` for
# deploy/rollback.sh. Run as root in the checkout, in a quiet hour: queues close while running matches play out (see
# README → Обновяване).
set -eu

# All of it is read before anything runs: the `git pull` below may rewrite this very file, and sh reads a script as it
# goes.
main() {
  cd "$(dirname "$0")/.."
  echo "$(date -u +%FT%TZ) deploying (note the time: Litestream can bring the database back to it)"
  git pull --ff-only
  git -C private pull --ff-only
  commit=$(git rev-parse HEAD)
  release=$(git rev-parse --short HEAD)
  image="ghcr.io/almanac-bg/almanac:$commit"
  docker pull --quiet "$image" >/dev/null || {
    echo "No image for $release: CI publishes one once every check on the commit has passed (still running, or failed?)."
    exit 1
  }

  # What runs now becomes the way back.
  if docker image inspect almanac:latest >/dev/null 2>&1; then
    docker tag almanac:latest almanac:previous
    [ -f .release ] && cp .release .release-previous
  fi
  docker tag "$image" almanac:latest
  # Only the two names above keep an image: one replaced by the next deploy goes with the prune below.
  docker rmi "$image" >/dev/null
  docker compose pull --ignore-buildable --quiet
  APP_RELEASE=$release docker compose up -d
  echo "$release" >.release

  # Old images (and build layers from when the server built them itself) would fill the disk over time.
  docker image prune -f >/dev/null
  docker builder prune -f >/dev/null
  echo "$(date -u +%FT%TZ) deployed $release"
}

main "$@"
exit
