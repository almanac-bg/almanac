#!/bin/sh
# A look at the whole server, read-only: the system and its updates, accounts and SSH, the firewall and what listens,
# Docker and the containers' limits, the app's files, scheduled jobs, the origin's certificate. It prints settings and
# states, never secrets: the names in .env without their values, key fingerprints, URLs in cron jobs masked, IP
# addresses cut to their first two parts. Changes nothing; run as root, on the server or from your machine:
#   ssh root@<server> 'cd /root/almanac && deploy/audit.sh'
set -u
cd "$(dirname "$0")/.."
s() { printf '\n== %s\n' "$1"; }
mask() { sed -E 's/([0-9]{1,3}\.[0-9]{1,3})\.[0-9]{1,3}\.[0-9]{1,3}/\1.x.x/g; s#https?://[^ "]+#<url>#g'; }
app=$(docker compose ps -q app 2>/dev/null)
data=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$app" 2>/dev/null)
data=${data:-"(the app isn't running)"}
domain=$(sed -n 's/^DOMAIN=//p' .env)

s "system"
os=$(sed -n 's/^PRETTY_NAME="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' /etc/os-release)
echo "$os, kernel $(uname -r), $(uptime -p), $(nproc) CPUs"
if [ -f /var/run/reboot-required ]; then
  echo "reboot waiting for: $(tr '\n' ' ' </var/run/reboot-required.pkgs 2>/dev/null)"
else
  echo "no reboot waiting"
fi
timedatectl show -p Timezone -p NTPSynchronized 2>/dev/null | tr '\n' ' '
echo
free -m | sed -n '1,3p'
swapon --show --noheadings 2>/dev/null | grep -q . || echo "no swap"
df -h / | tail -1
du -sh "$data" /var/lib/docker 2>/dev/null

s "updates"
apt list --upgradable 2>/dev/null | tail -n +2 | cut -d' ' -f1-2
installed=$(apt-cache policy docker-ce 2>/dev/null | sed -n 's/^ *Installed: //p')
candidate=$(apt-cache policy docker-ce 2>/dev/null | sed -n 's/^ *Candidate: //p')
echo "Docker: $installed installed, $candidate available (updated by hand: docs/operations.md)"
apt-config dump 2>/dev/null |
  grep -E '^(APT::Periodic::Unattended-Upgrade|Unattended-Upgrade::Automatic-Reboot(-Time)?) '
tail -200 /var/log/unattended-upgrades/unattended-upgrades.log 2>/dev/null |
  grep -E '^[0-9-]+ .*(Packages that will be upgraded|No packages found|All upgrades installed|ERROR)' |
  tail -3 | cut -c1-140

s "accounts"
awk -F: '$7 !~ /(nologin|false|sync|halt|shutdown)$/ {print $1 " uid=" $3 " shell=" $7}' /etc/passwd
passwd -S root 2>/dev/null
for keys in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -f "$keys" ] && echo "$keys:" && ssh-keygen -lf "$keys" 2>/dev/null | awk '{print "  " $1, $2, $NF}'
done
echo "sudo group: $(getent group sudo | cut -d: -f4)"

s "ssh"
settings='port|permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication'
settings="$settings|permitemptypasswords|x11forwarding|allowtcpforwarding|maxauthtries|persourcepenalties"
sshd -T 2>/dev/null | grep -E "^($settings) " | tr '\n' ';'
echo
failed='Invalid user|Connection closed by authenticating user|Disconnected from authenticating user'
echo "failed logins, 7 days: $(journalctl -u ssh -u sshd --since -7d 2>/dev/null | grep -c -E "$failed")"
echo "accepted logins, 7 days (method, user, address):"
journalctl -u ssh -u sshd --since -7d 2>/dev/null | grep -o -E 'Accepted [a-z]+ for [^ ]+ from [^ ]+' |
  awk '{print $2, $4, $6}' | mask | sort | uniq -c

s "firewall and what listens"
ufw status 2>/dev/null | sed -n '1,20p'
ss -tulpnH 2>/dev/null | awk '{print $1, $5, $7}' | sed -E 's/users:\(\("([^"]+)".*/\1/' | sort -u

s "docker"
echo "engine $(docker version --format '{{.Server.Version}}' 2>/dev/null), compose $(docker compose version --short)"
docker info --format 'logging={{.LoggingDriver}} live-restore={{.LiveRestoreEnabled}} {{.SecurityOptions}}' 2>/dev/null
limits='{{.Name}}: user={{.Config.User}} read-only={{.HostConfig.ReadonlyRootfs}}'
limits="$limits cap_drop={{.HostConfig.CapDrop}} cap_add={{.HostConfig.CapAdd}} {{.HostConfig.SecurityOpt}}"
limits="$limits memory={{.HostConfig.Memory}} pids={{.HostConfig.PidsLimit}} logs={{.HostConfig.LogConfig.Config}}"
limits="$limits {{.State.Status}} since {{.State.StartedAt}}"
for container in $(docker compose ps -q 2>/dev/null); do
  docker inspect --format "$limits" "$container"
done
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}} {{.CreatedSince}}' 2>/dev/null | head -10

s "the app's files"
stat -c '%a %U:%G %n' .env docker-compose.yml private "$data" "$data"/* 2>/dev/null | head -14
echo "code: $(git log --oneline -1 | cut -c1-50); local changes: $(git status --porcelain | wc -l)"
echo "bank: $(git -C private log --oneline -1 2>/dev/null | cut -c1-50);" \
  "local changes: $(git -C private status --porcelain 2>/dev/null | wc -l)"
echo ".env: $(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env | sort | tr '\n' ' ')"
echo ".env, empty: $(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=$/\1/p' .env | sort | tr '\n' ' ')"

s "scheduled jobs"
for job in /etc/cron.d/*; do
  echo "$job:" && grep -v -E '^[[:space:]]*(#|$)' "$job" | mask
done
echo "failed units: $(systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
journalctl --disk-usage 2>/dev/null

s "the origin's certificate"
echo | openssl s_client -connect 127.0.0.1:443 -servername "${domain:-almanac.bg}" 2>/dev/null |
  openssl x509 -noout -issuer -enddate 2>/dev/null

s "the cloud's metadata service (an internal address the app could be tricked into asking)"
metadata=http://169.254.169.254/hetzner/v1
echo "user-data: $(curl -s -m 3 "$metadata/userdata" | wc -c) bytes"
ask="fetch('$metadata/metadata/instance-id',{signal:AbortSignal.timeout(3000)})"
ask="$ask.then(r=>console.log('reachable',r.status),e=>console.log('not reachable',e.cause?.code||e.name))"
# </dev/null: exec would read the rest of a script piped to sh as its own input.
echo "from the app: $(docker compose exec -T app node -e "$ask" </dev/null 2>&1 | tail -1)"

s "kernel"
echo "apparmor=$(aa-enabled 2>/dev/null || echo no) syncookies=$(sysctl -n net.ipv4.tcp_syncookies)" \
  "rp_filter=$(sysctl -n net.ipv4.conf.all.rp_filter)"
