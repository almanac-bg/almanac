#!/bin/sh
# Daily: what an uptime check from outside can't see — the HTTPS certificate is being renewed, the disk has room,
# every container runs. With a heartbeat URL as the argument, a run where all is well pings it, so a missing ping is
# the alert (see README → Внедряване, step 10). Run from cron as root.
set -eu
cd "$(dirname "$0")/.."
fail() {
  echo "$(date -u +%FT%TZ) check failed: $*"
  exit 1
}

domain=$(sed -n 's/^DOMAIN=//p' .env)
domain=${domain:-almanac.bg}
# Caddy renews 30 days before expiry: two weeks left means renewal has been failing for two weeks.
end=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$domain" 2>/dev/null |
  openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
[ -n "$end" ] || fail "no certificate for $domain"
[ "$(date -d "$end" +%s)" -gt "$(($(date +%s) + 14 * 86400))" ] || fail "the certificate for $domain expires $end"

used=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$used" -le 85 ] || fail "the disk is $used% full"

services="app caddy"
grep -q '^COMPOSE_PROFILES=.*backup' .env && services="$services litestream"
for service in $services; do
  [ -n "$(docker compose ps --status running -q "$service")" ] || fail "$service is not running"
done
docker compose exec -T app wget -qO- http://127.0.0.1:3001/api/health >/dev/null || fail "the app's health check fails"

[ -z "${1:-}" ] || curl -fsS -m 10 --retry 3 "$1" >/dev/null
echo "$(date -u +%FT%TZ) check ok"
