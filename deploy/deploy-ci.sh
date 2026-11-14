#!/bin/sh
# What CI's deploy key may run on the server, and nothing else: almanac-deploy with a version. Its line in root's
# authorized_keys:
#
#   command="/usr/local/sbin/almanac-deploy-ci",restrict ssh-ed25519 AAAA… almanac-ci-deploy
set -eu
tag=${SSH_ORIGINAL_COMMAND:-}
if ! printf '%s' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "only a version, like v2.21.1" >&2
  exit 1
fi
exec /usr/local/sbin/almanac-deploy "$tag"
