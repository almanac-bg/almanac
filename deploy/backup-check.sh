#!/bin/sh
# Weekly: restores the off-site backup (Litestream) next to the live database, without touching it, and checks that
# the copy opens, is intact and has the accounts in it. A backup that is never restored isn't a backup. With a
# heartbeat URL as the argument, a good run pings it (see README → Внедряване, step 10). Run from cron as root.
set -eu
cd "$(dirname "$0")/.."
clean() { docker compose run --rm --no-deps --entrypoint sh app -c 'rm -f /data/restore-test.db*'; }

clean
docker compose run --rm --no-deps litestream restore -o /data/restore-test.db /data/quiz.db
result=$(docker compose run --rm --no-deps --entrypoint node app -e "
  const db = new (require('node:sqlite').DatabaseSync)('/data/restore-test.db');
  console.log(db.prepare('PRAGMA quick_check').get().quick_check, db.prepare('SELECT COUNT(*) AS n FROM users').get().n);")
clean
case "$result" in
  "ok "*) ;;
  *)
    echo "$(date -u +%FT%TZ) backup check failed: $result"
    exit 1
    ;;
esac

[ -z "${1:-}" ] || curl -fsS -m 10 --retry 3 "$1" >/dev/null
echo "$(date -u +%FT%TZ) backup ok (integrity, accounts): $result"
