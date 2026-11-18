#!/bin/sh
# The host's baseline: its firewall (deploy/nftables.conf) and ssh's settings (deploy/sshd.conf), applied so that a
# mistake in either can't lock anyone out: whatever goes wrong, the machine goes back to what it had. As root; setup.sh
# runs the first, and installs this as almanac-harden:
#
#   sh deploy/harden.sh apply   from the repository's deploy/: checks both files first (nft -c, sshd -t, and that
#                               each of sshd.conf's settings is in force among the other files), and changes nothing
#                               if one fails; else keeps what is there now, applies both (the firewall first: the
#                               new table at once, then ufw off; then ssh's file, and sshd reads it again; the
#                               connections open stay), checks them in place, and goes back at once if that fails.
#                               Then it waits for a confirmation: unconfirmed, everything goes back by itself in ten
#                               minutes (a timer of systemd's, which outlives the session), or as the machine starts
#                               again, if it restarts before that. Nothing changed, it says so and arms nothing.
#   almanac-harden confirm      from a NEW ssh login, the test that one still gets in: keeps what was applied.
#   almanac-harden undo         back to what was there before the last apply, now (confirmed or not).
#   almanac-harden verify       whether it is in force: confirmed, the firewall loaded and kept over a restart, each of
#                               ssh's settings in force. deploy-ci.sh check asks, for CI.
#
# CI's key and the owner's keep working: both log in as root with a key, the way sshd.conf allows; CI's comes from
# GitHub's machines, so 22 stays open to all (nftables.conf limits how fast).
set -eu

# The server's paths, all here (deploy/harden_test.go puts them elsewhere).
sshd_main=/etc/ssh/sshd_config
sshd_dir=/etc/ssh/sshd_config.d
sshd_file=/etc/ssh/sshd_config.d/10-almanac.conf
nft_file=/etc/nftables.conf
units=/etc/systemd/system
state=/var/lib/almanac-harden
installed=/usr/local/sbin/almanac-harden
# How long an apply waits to be confirmed, in seconds.
grace=600

before=$state/before
pending=$state/pending
unit=almanac-harden-undo

say() { printf '%s\n' "$*"; }
die() {
	printf 'almanac-harden: %s\n' "$*" >&2
	exit 1
}

# effective <main config> <drop-in>: whether each setting of the drop-in is in force under that config, as sshd -T
# says: every word of its value among that setting's (sshd takes a setting's first value, and an earlier file may set
# it otherwise). Says which aren't.
effective() {
	sshd -T -f "$1" | awk -v want="$2" '
		BEGIN {
			while ((getline line < want) > 0) {
				if (line ~ /^[ \t]*(#|$)/) continue
				n = split(line, w)
				k = tolower(w[1])
				keys[k] = 1
				for (i = 2; i <= n; i++) need[k " " tolower(w[i])] = 1
			}
		}
		(tolower($1) in keys) { for (i = 2; i <= NF; i++) have[tolower($1) " " tolower($i)] = 1 }
		END {
			for (p in need) if (!(p in have)) { print "not in force: " p; bad = 1 }
			exit bad
		}'
}

# loaded: the firewall's table is in the kernel, and nftables.service loads it as the machine starts.
loaded() {
	local ok=0
	if ! nft list chain inet almanac input 2>/dev/null | grep -q 'policy drop'; then
		say "the firewall isn't loaded (nft list table inet almanac)"
		ok=1
	fi
	if ! systemctl is-enabled --quiet nftables; then
		say "nftables.service isn't enabled: a restart would leave the firewall out"
		ok=1
	fi
	return $ok
}

# in_force: what apply put in place is there and working, confirmed or not.
in_force() {
	local ok=0
	loaded || ok=1
	if [ ! -f "$sshd_file" ]; then
		say "no $sshd_file"
		ok=1
	elif ! effective "$sshd_main" "$sshd_file"; then
		ok=1
	fi
	return $ok
}

verify() {
	local ok=0
	if [ -f "$pending" ]; then
		say "applied, not confirmed: almanac-harden confirm from a new login (or undo); unconfirmed, it goes back"
		ok=1
	fi
	in_force || ok=1
	return $ok
}

reload_ssh() {
	# Ubuntu starts sshd by its socket (ssh.socket): not running yet, it reads the files when it starts.
	if systemctl is-active --quiet ssh; then
		systemctl reload ssh
	fi
}

lock() {
	install -d -m 700 "$state"
	exec 9>>"$state/lock"
	flock -w 60 9 || die "another almanac-harden is running"
}

# undo [unconfirmed]: back to what was kept before the last apply. Unconfirmed (the timer's), only while that apply
# waits. Every step is tried, whichever fails; ssh first, then the firewall, ufw on again before nftables' table goes,
# so the machine is never open.
undo() {
	if [ "${1:-}" = unconfirmed ] && [ ! -f "$pending" ]; then
		return 0
	fi
	[ -d "$before" ] || die "nothing to go back to: no apply kept what was there"
	local failed=0
	for f in "$sshd_dir"/*almanac*.conf; do
		if [ -f "$f" ]; then rm -f "$f"; fi
	done
	for f in "$before"/sshd/*.conf; do
		if [ -f "$f" ]; then cp -p "$f" "$sshd_dir/"; fi
	done
	if sshd -t -f "$sshd_main"; then
		reload_ssh || failed=1
	else
		say "sshd -t refuses the files it had: sshd keeps the settings it read last"
		failed=1
	fi

	if [ -f "$before/ufw" ]; then
		ufw --force enable >/dev/null || failed=1
	fi
	if [ -f "$before/nftables.conf" ]; then
		cp -p "$before/nftables.conf" "$nft_file" || failed=1
	else
		rm -f "$nft_file"
	fi
	if [ -f "$before/loaded" ]; then
		nft -f "$nft_file" || failed=1
	elif nft list table inet almanac >/dev/null 2>&1; then
		nft delete table inet almanac || failed=1
	fi
	if [ -f "$before/enabled" ]; then
		systemctl enable nftables || failed=1
	else
		systemctl disable nftables || failed=1
	fi

	disarm
	if [ $failed = 0 ]; then
		say "back to what was there before the apply"
	else
		say "back, but not all of it (above)"
	fi
	return $failed
}

disarm() {
	rm -f "$pending"
	if [ -f "$units/$unit.service" ] || [ -f "$units/$unit.timer" ]; then
		systemctl stop "$unit.timer" 2>/dev/null || true
		systemctl disable "$unit.service" 2>/dev/null || true
		rm -f "$units/$unit.timer" "$units/$unit.service"
		systemctl daemon-reload || true
	fi
}

# back: a step of apply failed; everything goes back at once.
back() {
	say "almanac-harden: $1; going back" >&2
	undo || true
	exit 1
}

apply() {
	src=$(dirname "$0")
	if [ ! -f "$src/nftables.conf" ] || [ ! -f "$src/sshd.conf" ]; then
		die "apply from the repository's deploy/ (sh deploy/harden.sh apply, as setup.sh does)"
	fi
	[ ! -f "$pending" ] || die "an apply waits already: almanac-harden confirm from a new login, or undo"

	# 1. Both files checked before anything changes: ssh's among the other files as they will be, ours alone of ours.
	nft -c -f "$src/nftables.conf" || die "nft -c refuses nftables.conf: nothing changed"
	try=$(mktemp -d)
	trap 'rm -rf "$try"' EXIT
	mkdir "$try/d"
	for f in "$sshd_dir"/*.conf; do
		case ${f##*/} in *almanac*) continue ;; esac
		if [ -f "$f" ]; then cp -p "$f" "$try/d/"; fi
	done
	cp "$src/sshd.conf" "$try/d/${sshd_file##*/}"
	sed "s|^\([Ii]nclude[[:space:]][[:space:]]*\)$sshd_dir/|\1$try/d/|" "$sshd_main" >"$try/sshd_config"
	sshd -t -f "$try/sshd_config" || die "sshd -t refuses sshd.conf: nothing changed"
	effective "$try/sshd_config" "$src/sshd.conf" ||
		die "sshd.conf isn't all in force among the other files in $sshd_dir (above): nothing changed"

	install -m 755 "$0" "$installed"
	if cmp -s "$src/sshd.conf" "$sshd_file" && cmp -s "$src/nftables.conf" "$nft_file" && verify >/dev/null; then
		say "in force already: nothing changed"
		return 0
	fi

	# 2. What is there now, to go back to.
	rm -rf "$before"
	mkdir -p "$before/sshd"
	for f in "$sshd_dir"/*almanac*.conf; do
		if [ -f "$f" ]; then cp -p "$f" "$before/sshd/"; fi
	done
	if [ -f "$nft_file" ]; then cp -p "$nft_file" "$before/nftables.conf"; fi
	if nft list table inet almanac >/dev/null 2>&1; then : >"$before/loaded"; fi
	if systemctl is-enabled --quiet nftables; then : >"$before/enabled"; fi
	if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then : >"$before/ufw"; fi

	# 3. Going back by itself, unless confirmed, armed before anything changes: by the timer, or as the machine starts
	# (the service is enabled until then). The login that applies is kept: the confirmation must come from another.
	printf '%s\n' "${SSH_CONNECTION:-}" >"$pending"
	cat >"$units/$unit.service" <<-EOF
		[Unit]
		Description=almanac-harden: back to the host's settings from before an apply nobody confirmed
		After=nftables.service ufw.service

		[Service]
		Type=oneshot
		ExecStart=$installed undo unconfirmed

		[Install]
		WantedBy=multi-user.target
	EOF
	cat >"$units/$unit.timer" <<-EOF
		[Unit]
		Description=almanac-harden: back in $grace seconds, unless confirmed

		[Timer]
		OnActiveSec=$grace
		AccuracySec=1
	EOF
	{ systemctl daemon-reload && systemctl enable "$unit.service" && systemctl start "$unit.timer"; } ||
		back "the timer that goes back didn't start"

	# 4. The firewall: the new table at once (it replaces only its own; connections open stay open), loaded again as
	# the machine starts, and then alone (ufw off: the table was in force before ufw went).
	install -m 644 "$src/nftables.conf" "$nft_file" || back "installing $nft_file"
	nft -f "$nft_file" || back "nft -f $nft_file"
	systemctl enable nftables || back "enabling nftables.service"
	if [ -f "$before/ufw" ]; then
		ufw disable >/dev/null || back "ufw disable"
	fi

	# 5. ssh: its file in place of ours before it, checked where it lies, read again by sshd (logins open stay).
	for f in "$sshd_dir"/*almanac*.conf; do
		if [ -f "$f" ]; then rm -f "$f"; fi
	done
	install -m 644 "$src/sshd.conf" "$sshd_file" || back "installing $sshd_file"
	sshd -t -f "$sshd_main" || back "sshd -t"
	reload_ssh || back "reloading sshd"

	# 6. Checked in place; the new login is the last check, and the owner's.
	in_force || back "not in force (above)"
	minutes=$((grace / 60))
	say "Applied: the firewall (nftables.conf) and ssh (sshd.conf)."
	say "Keep this login open, and from a NEW one: almanac-harden confirm"
	say "Unconfirmed, everything goes back by itself in $minutes minutes (or: almanac-harden undo)."
}

confirm() {
	[ -f "$pending" ] || die "nothing waits to be confirmed"
	[ -n "${SSH_CONNECTION:-}" ] || die "confirm from a new ssh login: that one gets in is the test"
	[ "$SSH_CONNECTION" != "$(cat "$pending")" ] || die "this is the login that applied it: confirm from a new one"
	in_force || die "not in force (above): almanac-harden undo, or let it go back by itself"
	disarm
	say "Confirmed: kept. (almanac-harden undo still goes back to what was there before.)"
}

case ${1:-} in
apply)
	[ "$(id -u)" = 0 ] || die "as root"
	lock
	apply
	;;
confirm)
	[ "$(id -u)" = 0 ] || die "as root"
	lock
	confirm
	;;
undo)
	[ "$(id -u)" = 0 ] || die "as root"
	lock
	undo "${2:-}"
	;;
verify)
	verify
	;;
*)
	echo "usage: almanac-harden apply | confirm | undo | verify" >&2
	exit 2
	;;
esac
