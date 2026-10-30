#!/bin/sh
# Daily: what an uptime check from outside can't see — the HTTPS certificate is being renewed, the disk has room,
# every container runs, no reboot has been waiting for days. With a heartbeat URL as the argument, a good run pings
# it; a failed one says why on the heartbeat's /fail (an alert at once, with the reason), and a run that never
# happens is a missing ping (see docs/self-hosting.md, step 10). Run from cron as root.
set -eu
cd "$(dirname "$0")/.."
heartbeat=${1:-}
fail() {
  echo "$(date -u +%FT%TZ) check failed: $*"
  [ -z "$heartbeat" ] || curl -fsS -m 10 --retry 3 --data-raw "$*" "$heartbeat/fail" >/dev/null || true
  exit 1
}

domain=$(sed -n 's/^DOMAIN=//p' .env)
domain=${domain:-almanac.bg}
# Caddy renews 30 days before expiry: two weeks left means renewal has been failing for two weeks.
end=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$domain" 2>/dev/null |
  openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
[ -n "$end" ] || fail "no certificate for $domain"
[ "$(date -d "$end" +%s)" -gt "$(($(date +%s) + 14 * 86400))" ] || fail "the certificate for $domain expires $end"

# Early enough to act: a full disk fails every write (results, sign-ups) and the backups with them.
used=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$used" -le 70 ] || fail "the disk is $used% full"

services="app caddy"
grep -q '^COMPOSE_PROFILES=.*backup' .env && services="$services litestream"
for service in $services; do
  [ -n "$(docker compose ps --status running -q "$service")" ] || fail "$service is not running"
done
docker compose exec -T app wget -qO- http://127.0.0.1:3001/api/health >/dev/null || fail "the app's health check fails"

# The app restarting by itself (out of memory, a crash Node couldn't report) shows nowhere else. Docker counts the
# restarts of a container; a deploy makes a new one, which starts again from zero.
app=$(docker compose ps -q app)
[ "$(docker inspect -f '{{.State.OOMKilled}}' "$app")" != true ] || fail "the app was stopped for running out of memory"
restarts=$(docker inspect -f '{{.RestartCount}}' "$app")
state=/var/tmp/almanac-app-restarts
before=$(cat "$state" 2>/dev/null || echo "$restarts")
echo "$restarts" >"$state"
[ "$restarts" -le "$before" ] || fail "the app restarted by itself $((restarts - before)) time(s) since the last check"

# Security updates reboot the server by themselves at night (docs/self-hosting.md, step 1); one still waiting means that broke.
if [ -f /var/run/reboot-required ]; then
  waiting=$((($(date +%s) - $(stat -c %Y /var/run/reboot-required)) / 86400))
  [ "$waiting" -lt 3 ] || fail "a reboot for updates has been waiting $waiting days: $(tr '\n' ' ' </var/run/reboot-required.pkgs 2>/dev/null)"
fi

# Cloudflare's ranges, as deploy/Caddyfile trusts them: one added there and missing here would make every visitor
# through it share Cloudflare's address (the rate limits with it). Compared only when both lists came.
if v4=$(curl -fsS -m 10 https://www.cloudflare.com/ips-v4) && v6=$(curl -fsS -m 10 https://www.cloudflare.com/ips-v6); then
  published=$(printf '%s\n%s\n' "$v4" "$v6" | grep . | sort -u | tr '\n' ' ')
  trusted=$(sed -n 's/^[[:space:]]*trusted_proxies static //p' deploy/Caddyfile | tr ' ' '\n' | grep . | sort -u | tr '\n' ' ')
  [ "$published" = "$trusted" ] || fail "Cloudflare's IP ranges changed: deploy/Caddyfile trusts $trusted; published: $published"
fi

# The daily copy (the fast way back, docs/operations.md): the newest under 26 hours old, or the upkeep stopped making
# them. Asked in the app's container, where the app looks (BACKUP_DIR, else beside the database); not when it's off.
age=$(docker compose exec -T app sh -c '
  dir=${BACKUP_DIR:-$(dirname "${DB_PATH:-/data/quiz.db}")/backups}
  [ "$dir" = off ] && echo off && exit
  newest=$(ls -t "$dir"/quiz-????-??-??.db 2>/dev/null | head -1)
  [ -n "$newest" ] && echo $(( ($(date +%s) - $(stat -c %Y "$newest")) / 3600 ))') || true
case "$age" in
  off) ;;
  '') fail "no daily copy of the database in the app's backups" ;;
  *) [ "$age" -le 26 ] || fail "the newest daily copy of the database is $age hours old" ;;
esac

[ -z "$heartbeat" ] || curl -fsS -m 10 --retry 3 "$heartbeat" >/dev/null
# How the database grows, day by day, in this log.
data=$(docker compose exec -T app du -sh /data 2>/dev/null | cut -f1)
echo "$(date -u +%FT%TZ) check ok (disk $used% full, data ${data:-?})"
