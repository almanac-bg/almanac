#!/bin/sh
# Daily: what an uptime check from outside can't see — the HTTPS certificates are being renewed, the clock is right,
# the disk has room, every container runs, the security updates install and no reboot has been waiting for days. With
# a heartbeat URL as the argument, a good run pings it; a failed one says why on the heartbeat's /fail (an alert at
# once, with the reason), and a run that never happens is a missing ping (see docs/self-hosting.md, step 10). Run from
# cron as root. (CHECK_ROOT: where the host's files are, for apps/server/test/check.test.ts.)
set -eu
cd "$(dirname "$0")/.."
heartbeat=${1:-}
root=${CHECK_ROOT:-}
# How many whole days ago a file was last changed.
days_since() { echo $((($(date +%s) - $(date -r "$1" +%s)) / 86400)); }
fail() {
  echo "$(date -u +%FT%TZ) check failed: $*"
  [ -z "$heartbeat" ] || curl -fsS -m 10 --retry 3 --data-raw "$*" "$heartbeat/fail" >/dev/null || true
  exit 1
}

domain=$(sed -n 's/^DOMAIN=//p' .env)
domain=${domain:-almanac.bg}
# Caddy renews 30 days before expiry: two weeks left means renewal has been failing for two weeks. Both names Caddy
# holds one for (deploy/Caddyfile): an expired www one makes Cloudflare answer 526 there, which no uptime check watches.
for name in "$domain" "www.$domain"; do
  cert=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$name" 2>/dev/null | openssl x509 2>/dev/null) ||
    cert=
  [ -n "$cert" ] || fail "no certificate for $name"
  echo "$cert" | openssl x509 -noout -checkend $((14 * 86400)) >/dev/null ||
    fail "the certificate for $name expires $(echo "$cert" | openssl x509 -noout -enddate | cut -d= -f2)"
done

# Sessions, reset links, the staff's codes and TLS all go by the clock.
[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ] || fail "the clock isn't synchronized (NTP)"

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
state=$root/var/tmp/almanac-app-restarts
before=$(cat "$state" 2>/dev/null || echo "$restarts")
echo "$restarts" >"$state"
[ "$restarts" -le "$before" ] || fail "the app restarted by itself $((restarts - before)) time(s) since the last check"

# Security updates reboot the server by themselves at night (docs/self-hosting.md, step 1); one still waiting means that broke.
if [ -f "$root/var/run/reboot-required" ]; then
  waiting=$(days_since "$root/var/run/reboot-required")
  [ "$waiting" -lt 3 ] || fail "a reboot for updates has been waiting $waiting days: $(tr '\n' ' ' <"$root/var/run/reboot-required.pkgs" 2>/dev/null)"
fi

# And the updates themselves installing (the 31 October review, OPS-2): each way that stops leaves no reboot waiting.
# An install cut short (a power loss, the night's reboot mid-way) stops every one after it.
[ -z "$(ls -A "$root/var/lib/dpkg/updates" 2>/dev/null)" ] || fail "an install was cut short: run dpkg --configure -a"
# The nightly run happened lately, and its last run had no error (a conffile question, a broken package).
log=$root/var/log/unattended-upgrades/unattended-upgrades.log
if [ -f "$log" ]; then
  [ "$(days_since "$log")" -lt 2 ] || fail "the security updates haven't run for $(days_since "$log") days"
  error=$(awk '/Starting unattended upgrades script/ { run = "" } { run = run $0 "\n" } END { printf "%s", run }' "$log" |
    grep -m1 ' ERROR ' || true)
  [ -z "$error" ] || fail "the security updates' last run failed: $error"
else
  fail "no log of the security updates (unattended-upgrades)"
fi
# A security update the nightly run keeps leaving (it needs a package it won't take): counted from the first check that
# saw one waiting.
security=$(apt list --upgradable 2>/dev/null | grep -- '-security' | cut -d/ -f1 | tr '\n' ' ' | sed 's/ $//')
seen=$root/var/tmp/almanac-security-update
if [ -z "$security" ]; then
  rm -f "$seen"
else
  [ -f "$seen" ] || date +%s >"$seen"
  waiting=$((($(date +%s) - $(cat "$seen")) / 86400))
  [ "$waiting" -lt 2 ] || fail "security updates have been waiting $waiting days: $security"
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
  dir=${BACKUP_DIR:-$(dirname "${DB_PATH:-/data/almanac.db}")/backups}
  [ "$dir" = off ] && echo off && exit
  newest=$(ls -t "$dir"/almanac-????-??-??.db 2>/dev/null | head -1)
  [ -n "$newest" ] && echo $(( ($(date +%s) - $(stat -c %Y "$newest")) / 3600 ))') || true
case "$age" in
  off) ;;
  '') fail "no daily copy of the database in the app's backups" ;;
  *) [ "$age" -le 26 ] || fail "the newest daily copy of the database is $age hours old" ;;
esac

# Docker itself comes from Docker's repository, which the nightly security updates leave alone (updating it restarts
# every container, at a moment nobody chose): one waiting a week is time for the update by hand, at a quiet moment
# (docs/operations.md → Обновяване). Counted from the first check that saw it.
docker_packages='docker-ce|docker-ce-cli|containerd\.io|docker-compose-plugin|docker-buildx-plugin'
docker_updates=$(apt list --upgradable 2>/dev/null | grep -o -E "^($docker_packages)/" | tr -d / | tr '\n' ' ')
seen=$root/var/tmp/almanac-docker-update
if [ -z "$docker_updates" ]; then
  rm -f "$seen"
else
  [ -f "$seen" ] || date +%s >"$seen"
  waiting=$((($(date +%s) - $(cat "$seen")) / 86400))
  [ "$waiting" -lt 7 ] || fail "a Docker update has been waiting $waiting days: $docker_updates"
fi

[ -z "$heartbeat" ] || curl -fsS -m 10 --retry 3 "$heartbeat" >/dev/null
# How the database grows, day by day, in this log.
data=$(docker compose exec -T app du -sh /data 2>/dev/null | cut -f1)
echo "$(date -u +%FT%TZ) check ok (disk $used% full, data ${data:-?})"
