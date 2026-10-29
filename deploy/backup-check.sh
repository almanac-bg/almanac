#!/bin/sh
# Daily: restores the off-site backup (Litestream) next to the live database, without touching it, and checks that
# the copy opens, is intact, has the accounts in it — and is current: the app stamps the time into the database every
# 15 minutes (maintenance), so a copy whose stamp is more than an hour behind the live one means replication has
# stopped (an expired key, a full bucket). A backup that is never restored isn't a backup. With a heartbeat URL as the
# argument, a good run pings it and a failed one says why on its /fail (see docs/self-hosting.md, step 10). Run from
# cron as root.
set -eu
cd "$(dirname "$0")/.."
heartbeat=${1:-}
fail() {
  echo "$(date -u +%FT%TZ) backup check failed: $*"
  [ -z "$heartbeat" ] || curl -fsS -m 10 --retry 3 --data-raw "$*" "$heartbeat/fail" >/dev/null || true
  exit 1
}
clean() { docker compose run --rm --no-deps --entrypoint sh app -c 'rm -f /data/restore-test.db*'; }

clean
docker compose run --rm --no-deps litestream restore -o /data/restore-test.db /data/quiz.db ||
  fail "litestream could not restore the backup"
result=$(docker compose run --rm --no-deps --entrypoint node app -e "
  const { DatabaseSync } = require('node:sqlite');
  const copy = new DatabaseSync('/data/restore-test.db', { readOnly: true });
  const live = new DatabaseSync('/data/quiz.db', { readOnly: true });
  const stamp = (db) => Number(db.prepare(\"SELECT value FROM settings WHERE key = 'alive_at'\").get()?.value ?? 0);
  const behind = Math.round((stamp(live) - stamp(copy)) / 60000);
  console.log(copy.prepare('PRAGMA quick_check').get().quick_check, copy.prepare('SELECT COUNT(*) AS n FROM users').get().n, behind);") ||
  result="error"
clean
set -- $result
[ "${1:-}" = ok ] || fail "the restored copy is broken: $result"
[ "${3:-999}" -le 60 ] || fail "the backup is ${3} minutes behind the live database: replication has stopped"

[ -z "$heartbeat" ] || curl -fsS -m 10 --retry 3 "$heartbeat" >/dev/null
echo "$(date -u +%FT%TZ) backup ok: intact, $2 accounts, $3 minutes behind"
