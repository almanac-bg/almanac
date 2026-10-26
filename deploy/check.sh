#!/bin/sh
# Daily: what an uptime check from outside can't see — the HTTPS certificate is being renewed, the disk has room,
# every container runs, no reboot has been waiting for days. With a heartbeat URL as the argument, a good run pings
# it; a failed one says why on the heartbeat's /fail (an alert at once, with the reason), and a run that never
# happens is a missing ping (see README → Внедряване, step 10). Run from cron as root.
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

used=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$used" -le 85 ] || fail "the disk is $used% full"

services="app caddy"
grep -q '^COMPOSE_PROFILES=.*backup' .env && services="$services litestream"
for service in $services; do
  [ -n "$(docker compose ps --status running -q "$service")" ] || fail "$service is not running"
done
docker compose exec -T app wget -qO- http://127.0.0.1:3001/api/health >/dev/null || fail "the app's health check fails"

# Security updates reboot the server by themselves at night (README → step 1); one still waiting means that broke.
if [ -f /var/run/reboot-required ]; then
  waiting=$((($(date +%s) - $(stat -c %Y /var/run/reboot-required)) / 86400))
  [ "$waiting" -lt 3 ] || fail "a reboot for updates has been waiting $waiting days: $(tr '\n' ' ' </var/run/reboot-required.pkgs 2>/dev/null)"
fi

[ -z "$heartbeat" ] || curl -fsS -m 10 --retry 3 "$heartbeat" >/dev/null
echo "$(date -u +%FT%TZ) check ok"
