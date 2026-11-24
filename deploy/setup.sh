#!/bin/sh
# Prepares a server for the game, once (running it again changes nothing but what deploy/ changed). As root, on Ubuntu,
# from a copy of deploy/:
#
#   sh setup.sh
#
# It is also how a change to deploy/ reaches the server: the deploy workflow compares the files installed here with the
# repository's after every deploy (deploy-ci.sh check), and fails until they're the same and in force.
#
# Last, it applies the host's baseline, the firewall and ssh's settings (harden.sh): when they change, they go back by
# themselves unless confirmed from a new login (`almanac-harden confirm`) within ten minutes.
#
# Then: put the settings in /etc/almanac/env (deploy/env.example), Cloudflare's origin certificate and key in
# /etc/almanac/origin.pem and origin.key, and install a release with deploy.sh.
set -eu
here=$(dirname "$0")

# What it needs besides the system: the firewall's tool, and updates that apply by themselves (Ubuntu's server image has
# both; a smaller one may not).
for p in nftables unattended-upgrades; do
  if ! dpkg-query -W -f '${Status}' "$p" 2>/dev/null | grep -q 'install ok installed'; then
    apt-get update
    apt-get install -y "$p"
  fi
done

# The game's own user, and its directory: the database and its copies.
id almanac >/dev/null 2>&1 || useradd --system --home-dir /var/lib/almanac --shell /usr/sbin/nologin almanac
install -d -o almanac -g almanac -m 700 /var/lib/almanac
install -d -o root -g almanac -m 750 /etc/almanac
install -d -m 755 /usr/local/lib/almanac

# The question bank: the private repository, read-only for the game (the server's deploy key reads it).
if [ ! -d /srv/almanac-bank/.git ]; then
  git clone git@github.com:almanac-bg/almanac-questions.git /srv/almanac-bank
fi

# Logs: the game's are in the journal only (journald.conf); rsyslog leaves them out (rsyslog.conf).
install -d /etc/systemd/journald.conf.d
install -m 644 "$here/journald.conf" /etc/systemd/journald.conf.d/almanac.conf
systemctl restart systemd-journald
journalctl --vacuum-time=14d --vacuum-size=2G >/dev/null
if [ -d /etc/rsyslog.d ]; then
  install -m 644 "$here/rsyslog.conf" /etc/rsyslog.d/10-almanac.conf
  systemctl restart rsyslog
fi

# Security updates by themselves, and the restart some need, in the quiet hour.
install -m 644 "$here/unattended-upgrades.conf" /etc/apt/apt.conf.d/52almanac-reboot

# The game's units and scripts. Each file here is one deploy-ci.sh check compares (deploy_test.go holds the two lists
# equal).
install -m 644 "$here/almanac.service" /etc/systemd/system/almanac.service
install -m 644 "$here/almanac.socket" /etc/systemd/system/almanac.socket
install -m 755 "$here/deploy.sh" /usr/local/sbin/almanac-deploy
install -m 755 "$here/deploy-ci.sh" /usr/local/sbin/almanac-deploy-ci
install -m 755 "$here/bank.sh" /usr/local/sbin/almanac-bank
install -m 644 "$here/release-signers" /etc/almanac/release-signers
systemctl daemon-reload
systemctl enable almanac.socket almanac.service

# The firewall and ssh, last: it installs almanac-harden, and nftables.conf and sshd.conf where they go.
sh "$here/harden.sh" apply
echo "ready: settings in /etc/almanac/env, then almanac-deploy vX.Y.Z"
