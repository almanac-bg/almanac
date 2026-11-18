#!/bin/sh
# Prepares a server for the game, once (running it again changes nothing but what deploy/ changed). As root, on Ubuntu:
#
#   sh setup.sh
#
# It is also how a change to deploy/ reaches the server: the deploy workflow compares the files installed here with the
# repository's after every deploy (deploy-ci.sh check), and fails until they're the same.
#
# Then: put the settings in /etc/almanac/env (deploy/env.example), Cloudflare's origin certificate and key in
# /etc/almanac/origin.pem and origin.key, and install a release with deploy.sh.
set -eu

# The game's own user, and its directory: the database and its copies.
id almanac >/dev/null 2>&1 || useradd --system --home-dir /var/lib/almanac --shell /usr/sbin/nologin almanac
install -d -o almanac -g almanac -m 700 /var/lib/almanac
install -d -o root -g almanac -m 750 /etc/almanac
install -d -m 755 /usr/local/lib/almanac

# The question bank: the private repository, read-only for the game (the server's deploy key reads it).
if [ ! -d /srv/almanac-bank/.git ]; then
  git clone git@github.com:almanac-bg/almanac-questions.git /srv/almanac-bank
fi

# Logs: the game's are in the journal only, kept 14 days at most (the privacy page says so: a failed request's line
# has the player's address) and 2 GB at most. rsyslog would copy them to /var/log/syslog, which logrotate keeps for
# five weeks: it leaves the game's lines out, and those it copied before are taken out of its files.
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nMaxRetentionSec=14day\nSystemMaxUse=2G\n' > /etc/systemd/journald.conf.d/almanac.conf
systemctl restart systemd-journald
journalctl --vacuum-time=14d --vacuum-size=2G >/dev/null
if [ -d /etc/rsyslog.d ]; then
  printf '# The game logs to the journal only, kept 14 days there (deploy/setup.sh).\nif $programname == "almanac" then stop\n' \
    > /etc/rsyslog.d/10-almanac.conf
  game=' almanac\[[0-9]*\]: '
  for f in /var/log/syslog*; do
    [ -f "$f" ] || continue
    case "$f" in
    *.gz)
      if zgrep -q "$game" "$f"; then
        zcat "$f" | grep -v "$game" | gzip > "$f.tmp"
        chown --reference="$f" "$f.tmp"
        chmod --reference="$f" "$f.tmp"
        mv "$f.tmp" "$f"
      fi
      ;;
    *) sed -i "/$game/d" "$f" ;;
    esac
  done
  systemctl restart rsyslog # after the files changed under it: it writes to them anew
fi

here=$(dirname "$0")
install -m 644 "$here/almanac.service" "$here/almanac.socket" /etc/systemd/system/
install -m 755 "$here/deploy.sh" /usr/local/sbin/almanac-deploy
install -m 755 "$here/deploy-ci.sh" /usr/local/sbin/almanac-deploy-ci
install -m 755 "$here/bank.sh" /usr/local/sbin/almanac-bank
install -m 644 "$here/release-signers" /etc/almanac/release-signers
systemctl daemon-reload
systemctl enable almanac.socket almanac.service
echo "ready: settings in /etc/almanac/env, then almanac-deploy vX.Y.Z"
