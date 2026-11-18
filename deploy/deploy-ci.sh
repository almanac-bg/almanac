#!/bin/sh
# What CI's deploy key may run on the server, and nothing else. Its line in root's authorized_keys:
#
#   command="/usr/local/sbin/almanac-deploy-ci",restrict ssh-ed25519 AAAA… almanac-ci-deploy
#
# and what it may ask (the SSH command):
#
#   vX.Y.Z   almanac-deploy with that version, as CI (deploy.sh ci): a signed release made live, or left as it is if
#            it's live; not one that went back for not being healthy, nor one that brings that one's migration
#            unchanged (deploy.sh says why: every merge would cut play twice for a release that fails the same way)
#   check    the SHA-256 of the deploy files installed here, by their names in the repository (deploy/…), for CI to
#            compare with its own (sha256sum -c): a difference means deploy/setup.sh's steps are due
set -eu
asked=${SSH_ORIGINAL_COMMAND:-}

if [ "$asked" = check ]; then
	sum() {
		if [ -f "$1" ]; then
			printf '%s  %s\n' "$(sha256sum <"$1" | cut -d' ' -f1)" "$2"
		else # not installed: a hash nothing has
			printf '%064d  %s\n' 0 "$2"
		fi
	}
	sum /etc/systemd/system/almanac.service deploy/almanac.service
	sum /etc/systemd/system/almanac.socket deploy/almanac.socket
	sum /usr/local/sbin/almanac-deploy deploy/deploy.sh
	sum /usr/local/sbin/almanac-deploy-ci deploy/deploy-ci.sh
	sum /usr/local/sbin/almanac-bank deploy/bank.sh
	sum /etc/almanac/release-signers deploy/release-signers
	exit 0
fi

# A version: v and three numbers, the whole string (no second line, no path). deploy.sh checks it again.
case $asked in *[!v0-9.]* | '') asked=bad ;; esac
if ! printf '%s\n' "$asked" | grep -Exq 'v(0|[1-9][0-9]{0,5})(\.(0|[1-9][0-9]{0,5})){2}'; then
	echo "only a version, like v2.21.1, or check" >&2
	exit 1
fi
exec /usr/local/sbin/almanac-deploy "$asked" ci
