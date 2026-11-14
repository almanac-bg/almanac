#!/bin/sh
# Prepares a server for the game, once (running it again changes nothing). As root, on Ubuntu:
#
#   sh setup.sh
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

# Logs: kept 14 days (the privacy page says so).
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nMaxRetentionSec=14day\n' > /etc/systemd/journald.conf.d/almanac.conf
systemctl restart systemd-journald

here=$(dirname "$0")
install -m 644 "$here/almanac.service" /etc/systemd/system/almanac.service
install -m 755 "$here/deploy.sh" /usr/local/sbin/almanac-deploy
install -m 755 "$here/deploy-ci.sh" /usr/local/sbin/almanac-deploy-ci
install -m 755 "$here/deploy-ci.sh" /usr/local/sbin/almanac-deploy-ci
install -m 755 "$here/bank.sh" /usr/local/sbin/almanac-bank
systemctl daemon-reload
systemctl enable almanac
echo "ready: settings in /etc/almanac/env, then almanac-deploy vX.Y.Z"
