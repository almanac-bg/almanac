#!/bin/sh
# Deploys what's on GitHub: both repositories (the question bank in private/ when it's a clone of one), and the image
# CI built, tested and published for this commit (IMAGE in .env: a fork's own; Caddy and Litestream on up-to-date
# images too), pulled by digest and only with CI's build provenance (deploy/pull-image.sh). Nothing is built here, and
# nothing changes until that image is here: a commit CI hasn't passed has no image, and the deploy stops with the old
# code and the old question bank still in place. The
# image that ran until now is kept as `almanac:previous` for deploy/rollback.sh; a deploy that isn't healthy within
# 90 seconds goes back to it by itself. Run as root in the checkout. It waits for a quiet moment first (no class in the
# middle of a match, not the evening Роял's hour), up to 20 minutes; `deploy/deploy.sh --now` doesn't. Queues close
# while running matches play out (see docs/operations.md → Обновяване).
set -eu

# All of it is read before anything runs: the merge below may rewrite this very file, and sh reads a script as it goes.
main() {
  case "${1:-}" in
    '' | --now) ;;
    *)
      echo "Usage: deploy/deploy.sh [--now]"
      exit 2
      ;;
  esac
  cd "$(dirname "$0")/.."
  git fetch --quiet origin
  # The bank as a clone of its own repository (almanac-questions), or a file put there by hand (docs/self-hosting.md).
  bank=$([ -d private/.git ] && echo git || echo file)
  [ "$bank" = file ] || git -C private fetch --quiet origin
  commit=$(git rev-parse origin/main)
  release=$(git rev-parse --short "$commit")
  pulled=0
  image=$(deploy/pull-image.sh "$commit") || pulled=$?
  if [ "$pulled" = 3 ]; then
    echo "The image for $release has no build provenance from its repository's CI: not deployed. Was the tag pushed by hand?"
    exit 1
  elif [ "$pulled" != 0 ]; then
    echo "No image for $release: CI publishes one once every check on the commit has passed (still running, or failed?)."
    exit 1
  fi
  [ "${1:-}" = --now ] || quiet_moment || exit 1
  echo "$(date -u +%FT%TZ) deploying (note the time: Litestream can bring the database back to it)"

  bank_before=$([ "$bank" = file ] || git -C private rev-parse HEAD)
  [ "$bank" = file ] || git -C private merge --quiet --ff-only origin/main
  bank_after=$([ "$bank" = file ] || git -C private rev-parse HEAD)
  # The new code on the new questions, in a container of its own, before anything switches: a bank it can't load (a
  # slip in the file, a format the code doesn't know yet) leaves the game as it is, on the questions it has.
  if [ "$bank_after" != "$bank_before" ] && ! docker run --rm -e DB_PATH=/tmp/check.db \
    -e QUESTIONS_PATH=/app/private/questions.json -v "$PWD/private:/app/private:ro" "$image" \
    node apps/server/dist/cli.mjs check-bank; then
    git -C private reset --quiet --hard "$bank_before"
    echo "$(date -u +%FT%TZ) $release doesn't load the new question bank: nothing changed, the bank is back where it was"
    exit 1
  fi
  caddy_before=$(git rev-parse -q --verify HEAD:deploy/Caddyfile || echo none)
  git merge --quiet --ff-only origin/main

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
    # New questions only: the code was fine before them, so they go back, not the code.
    if [ "$old_id" = "$new_id" ] && [ "$bank_after" != "$bank_before" ]; then
      echo "$(date -u +%FT%TZ) $release isn't answering on the new questions after 90 s: back to the questions before"
      git -C private reset --quiet --hard "$bank_before"
      APP_RELEASE=$release docker compose up -d --no-deps --force-recreate app
      exit 1
    fi
    echo "$(date -u +%FT%TZ) $release isn't answering through Caddy after 90 s: going back to what ran before"
    deploy/rollback.sh
    exit 1
  fi

  # Old images (and build layers from when the server built them itself) would fill the disk over time.
  docker image prune -f >/dev/null
  docker builder prune -f >/dev/null
  echo "$(date -u +%FT%TZ) deployed $release"
}

# Why a restart now would cut something short, from the app that's running (/api/live, which answers only on its own
# machine): a line per reason, nothing when it's quiet, or when there's no app to ask (an app from before /api/live
# answers 404: nothing).
busy() {
  docker compose exec -T app node -e '
    fetch(`http://127.0.0.1:${process.env.PORT ?? 3001}/api/live`)
      .then((r) => (r.ok ? r.json() : { busy: [] }))
      .then((live) => live.busy.forEach((reason) => console.log(reason)), () => {})' 2>/dev/null || true
}

# Waits, up to 20 minutes, until nothing busy() names is going on. A restart cuts a match short after DRAIN_SECONDS
# (a class's can run 11 minutes) and empties the lobbies, so this is what keeps a deploy from landing on a lesson.
quiet_moment() {
  reasons=$(busy)
  [ -z "$reasons" ] && return 0
  echo "$(date -u +%FT%TZ) waiting for a quiet moment, up to 20 minutes (deploy/deploy.sh --now doesn't wait):"
  echo "$reasons" | sed 's/^/  /'
  waited=0
  while [ -n "$reasons" ]; do
    if [ "$waited" -ge 1200 ]; then
      echo "$(date -u +%FT%TZ) still not quiet after 20 minutes: nothing deployed. Again later, or with --now:"
      echo "$reasons" | sed 's/^/  /'
      return 1
    fi
    sleep 30
    waited=$((waited + 30))
    reasons=$(busy)
  done
  echo "$(date -u +%FT%TZ) quiet now"
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
