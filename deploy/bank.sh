#!/bin/sh
# Takes the latest questions: pulls the private bank, checks it, and has the game reload it (no restart). As root:
#
#   almanac-bank
set -eu
git -C /srv/almanac-bank pull --ff-only --quiet
/usr/local/bin/almanac bank check /srv/almanac-bank | head -1
systemctl reload almanac
echo "reloaded: $(git -C /srv/almanac-bank log -1 --format='%h %s')"
