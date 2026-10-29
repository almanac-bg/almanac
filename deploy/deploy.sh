#!/bin/sh
# Deploys what's on GitHub: both repositories, and the image CI built, tested and published for this commit (Caddy and
# Litestream on up-to-date images too). Nothing is built here, and nothing changes until that image is here: a commit
# CI hasn't passed has no image, and the deploy stops with the old code and the old question bank still in place. The
# image that ran until now is kept as `almanac:previous` for deploy/rollback.sh; a deploy that isn't healthy within
# 90 seconds goes back to it by itself. Run as root in the checkout, in a quiet hour: queues close while running
# matches play out (see docs/operations.md → Обновяване).
set -eu

# All of it is read before anything runs: the merge below may rewrite this very file, and sh reads a script as it goes.
main() {
  cd "$(dirname "$0")/.."
  echo "$(date -u +%FT%TZ) deploying (note the time: Litestream can bring the database back to it)"
  git fetch --quiet origin
  git -C private fetch --quiet origin
  commit=$(git rev-parse origin/main)
  release=$(git rev-parse --short "$commit")
  image="ghcr.io/almanac-bg/almanac:$commit"
  docker pull --quiet "$image" >/dev/null || {
    echo "No image for $release: CI publishes one once every check on the commit has passed (still running, or failed?)."
    exit 1
  }

  bank_before=$(git -C private rev-parse HEAD)
  caddy_before=$(git rev-parse -q --verify HEAD:deploy/Caddyfile || echo none)
  git merge --quiet --ff-only origin/main
  git -C private merge --quiet --ff-only origin/main
  bank_after=$(git -C private rev-parse HEAD)

  # What runs now becomes the way back — unless it's this very image again (a retry, or new questions only): then the
  # way back stays what it was.
  new_id=$(docker image inspect -f '{{.Id}}' "$image")
  old_id=$(docker image inspect -f '{{.Id}}' almanac:latest 2>/dev/null || echo none)
  if [ "$old_id" != none ] && [ "$old_id" != "$new_id" ]; then
    docker tag almanac:latest almanac:previous
    if [ -f .release ]; then cp .release .release-previous; fi
  fi
  docker tag "$image" almanac:latest
  # Only the two names above keep an image: one replaced by the next deploy goes with the prune below.
  docker rmi "$image" >/dev/null
  docker compose pull --ignore-buildable --quiet
  APP_RELEASE=$release docker compose up -d
  # Same image, new questions: the app reads the bank when it starts, and compose saw nothing to recreate.
  if [ "$old_id" = "$new_id" ] && [ "$bank_after" != "$bank_before" ]; then
    APP_RELEASE=$release docker compose up -d --no-deps --force-recreate app
  fi
  echo "$release" >.release
  # Caddy reads its config once: a changed Caddyfile (mounted from the checkout) takes effect when told to, without
  # dropping a connection. A config it refuses leaves the old one running, and the deploy says so.
  if [ "$(git rev-parse -q --verify HEAD:deploy/Caddyfile || echo none)" != "$caddy_before" ]; then
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || {
      echo "$(date -u +%FT%TZ) Caddy refused the new deploy/Caddyfile and kept the old one: fix it and deploy again"
      exit 1
    }
  fi

  if ! healthy; then
    echo "$(date -u +%FT%TZ) $release isn't answering through Caddy after 90 s: going back to what ran before"
    deploy/rollback.sh
    exit 1
  fi

  # Old images (and build layers from when the server built them itself) would fill the disk over time.
  docker image prune -f >/dev/null
  docker builder prune -f >/dev/null
  echo "$(date -u +%FT%TZ) deployed $release"
}

# The site answers its health check over HTTPS, through Caddy, the way visitors reach it.
healthy() {
  domain=$(sed -n 's/^DOMAIN=//p' .env)
  domain=${domain:-almanac.bg}
  tries=0
  while [ "$tries" -lt 30 ]; do
    curl -fsS -m 5 --resolve "$domain:443:127.0.0.1" "https://$domain/api/health" >/dev/null 2>&1 && return 0
    sleep 3
    tries=$((tries + 1))
  done
  return 1
}

main "$@"
exit
