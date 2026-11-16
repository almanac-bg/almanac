#!/bin/sh
# Takes the latest questions: pulls the private bank, checks it, and has the game reload it (no restart). As root:
#
#   almanac-bank
#
# It prints the bank's count (…: N questions (M live)) and its problems counted (…: 0 errors, W warnings (by rule)),
# and stops before the reload if the check fails, with its errors.
set -eu
git -C /srv/almanac-bank pull --ff-only --quiet
out=$(/usr/local/bin/almanac bank check /srv/almanac-bank 2>&1) || {
	echo "$out" | grep -v ': warning: ' | tail -20
	echo "not reloaded: the bank has errors"
	exit 1
}
echo "$out" | grep -E ' questions \([0-9]+ live\)$| errors, [0-9]+ warnings'
systemctl reload almanac
echo "reloaded: $(git -C /srv/almanac-bank log -1 --format='%h %s')"
