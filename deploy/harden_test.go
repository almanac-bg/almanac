package deploy

import (
	"io/fs"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// harden.sh runs against a machine of stubs too: sshd (which reads its config as sshd does, a setting's first value
// winning, and refuses a file that says BROKEN), nft (a table loaded or not; BROKEN refused), systemctl and ufw (marks
// in WORLD). Each test plays a way through: applied and confirmed, gone back unconfirmed, refused before any change,
// gone back after a step failed.
var hardenStubs = map[string]string{
	"id":    `[ "$1" = -u ] && echo 0`,
	"flock": `exit 0`,
	"nft": `W=$WORLD
echo "nft $*" >>"$W/log"
case $1 in
-c) ! grep -q BROKEN "$3"; exit ;;
-f)
	if grep -q BROKEN "$2" || [ -f "$W/nft-fails" ]; then exit 1; fi
	if grep -q 'table inet almanac' "$2"; then cp "$2" "$W/loaded"; fi
	;;
list)
	[ -f "$W/loaded" ] || exit 1
	if [ "$2" = chain ]; then echo 'chain input { type filter hook input priority filter; policy drop; }'; else cat "$W/loaded"; fi
	;;
delete) [ -f "$W/loaded" ] || exit 1; rm "$W/loaded" ;;
esac`,
	"sshd": `W=$WORLD
conf= mode=
while [ $# -gt 0 ]; do
	case $1 in -t) mode=t ;; -T) mode=T ;; -f) conf=$2; shift ;; esac
	shift
done
echo "sshd -$mode $conf" >>"$W/log"
all() {
	while IFS= read -r line; do
		case $line in
		[Ii]nclude\ *) for f in ${line#* }; do if [ -f "$f" ]; then cat "$f"; echo; fi; done ;;
		*) printf '%s\n' "$line" ;;
		esac
	done <"$conf"
}
text=$(all)
if printf '%s\n' "$text" | grep -q BROKEN; then echo "sshd: a bad line" >&2; exit 255; fi
if [ "$conf" = "$MAIN" ] && [ -f "$W/sshd-fails" ]; then exit 255; fi
if [ $mode = T ]; then
	printf '%s\n' "$text" | awk '!/^[ \t]*(#|$)/ { k = tolower($1); if (!(k in seen)) { seen[k] = 1; $1 = k; print } }'
fi`,
	"systemctl": `W=$WORLD
echo "systemctl $*" >>"$W/log"
case "$1 $2" in
"is-enabled --quiet") [ -f "$W/enabled-$3" ]; exit ;;
"is-active --quiet") [ "$3" = ssh ]; exit ;;
esac
case $1 in
enable) shift; for u in "$@"; do : >"$W/enabled-$u"; done ;;
disable) shift; for u in "$@"; do rm -f "$W/enabled-$u"; done ;;
start) : >"$W/started-$2" ;;
stop) rm -f "$W/started-$2" ;;
reload) [ ! -f "$W/reload-fails" ] ;;
esac`,
	"ufw": `W=$WORLD
echo "ufw $*" >>"$W/log"
case $1 in
status) if [ -f "$W/ufw" ]; then echo "Status: active"; else echo "Status: inactive"; fi ;;
disable) rm -f "$W/ufw" ;;
--force) : >"$W/ufw" ;;
esac`,
}

// The machine as Ubuntu and the owner left it: ufw on (22 and 443 from anywhere), nftables off with Ubuntu's file,
// ssh's files of ours from before, and cloud-init's, which would allow passwords if ours came after it.
const (
	ubuntuNft    = "#!/usr/sbin/nft -f\nflush ruleset\ntable inet filter {\n}\n"
	oldSSH       = "PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n"
	oldX11       = "X11Forwarding no\n"
	cloudInitSSH = "PasswordAuthentication yes\n"
)

type host struct {
	t                                       *testing.T
	root, world, repo, script, main, sshdir string
	installed, units                        string
}

func newHost(t *testing.T) *host {
	t.Helper()
	root := t.TempDir()
	h := &host{t: t, root: root, world: filepath.Join(root, "world"), repo: filepath.Join(root, "repo"),
		main: filepath.Join(root, "etc", "ssh", "sshd_config"), sshdir: filepath.Join(root, "etc", "ssh", "sshd_config.d"),
		installed: filepath.Join(root, "sbin", "almanac-harden"), units: filepath.Join(root, "etc", "systemd")}
	for _, d := range []string{h.world, h.repo, h.sshdir, h.units, filepath.Dir(h.installed), filepath.Join(root, "stubs"),
		filepath.Join(root, "tmp")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for name, body := range hardenStubs {
		h.write(filepath.Join(root, "stubs", name), "#!/bin/sh\n"+body+"\n")
		os.Chmod(filepath.Join(root, "stubs", name), 0o755)
	}

	src, err := os.ReadFile("harden.sh")
	if err != nil {
		t.Fatal(err)
	}
	script := string(src)
	paths := map[string]string{"sshd_main": h.main, "sshd_dir": h.sshdir,
		"sshd_file": filepath.Join(h.sshdir, "10-almanac.conf"), "nft_file": filepath.Join(root, "etc", "nftables.conf"),
		"units": h.units, "state": filepath.Join(root, "state"), "installed": h.installed}
	set := regexp.MustCompile(`^(` + strings.Join(slices.Collect(maps.Keys(paths)), "|") + `)=`)
	system := regexp.MustCompile(`(^|[\s="'])/(usr|var|etc|run|srv)/`)
	for i, line := range strings.Split(script, "\n") {
		if l := strings.TrimSpace(line); !strings.HasPrefix(l, "#") && !set.MatchString(line) && system.MatchString(l) {
			t.Fatalf("harden.sh line %d names a path outside its block of paths: %s", i+1, l)
		}
	}
	for key, path := range paths {
		re := regexp.MustCompile(`(?m)^` + key + `=.*$`)
		if n := len(re.FindAllString(script, -1)); n != 1 {
			t.Fatalf("harden.sh sets %s %d times, not once", key, n)
		}
		script = re.ReplaceAllLiteralString(script, key+"="+path)
	}
	h.script = filepath.Join(h.repo, "harden.sh")
	h.write(h.script, script)
	for _, f := range []string{"nftables.conf", "sshd.conf"} {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		h.write(filepath.Join(h.repo, f), string(b))
	}

	h.write(h.main, "Include "+h.sshdir+"/*.conf\nKbdInteractiveAuthentication no\nX11Forwarding yes\n")
	h.write(filepath.Join(h.sshdir, "10-almanac.conf"), oldSSH)
	h.write(filepath.Join(h.sshdir, "50-cloud-init.conf"), cloudInitSSH)
	h.write(filepath.Join(h.sshdir, "60-almanac.conf"), oldX11)
	h.write(filepath.Join(root, "etc", "nftables.conf"), ubuntuNft)
	h.write(filepath.Join(h.world, "ufw"), "")
	return h
}

func (h *host) write(path, body string) {
	h.t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		h.t.Fatal(err)
	}
}

func (h *host) read(path string) string {
	h.t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		h.t.Fatal(err)
	}
	return string(b)
}

func (h *host) has(name string) bool {
	_, err := os.Stat(filepath.Join(h.world, name))
	return err == nil
}

// run runs the script (the repository's copy, or the installed one), from an ssh login if `from` isn't empty.
func (h *host) run(script, from string, args ...string) (string, int) {
	h.t.Helper()
	os.Remove(filepath.Join(h.world, "log"))
	cmd := exec.Command("/bin/sh", append([]string{script}, args...)...)
	cmd.Env = append(os.Environ(), "PATH="+filepath.Join(h.root, "stubs")+":"+os.Getenv("PATH"), "WORLD="+h.world,
		"MAIN="+h.main, "TMPDIR="+filepath.Join(h.root, "tmp"), "SSH_CONNECTION="+from)
	out, err := cmd.CombinedOutput()
	code := 0
	if e, ok := err.(*exec.ExitError); ok {
		code = e.ExitCode()
	} else if err != nil {
		h.t.Fatal(err)
	}
	if left, _ := os.ReadDir(filepath.Join(h.root, "tmp")); len(left) > 0 {
		h.t.Errorf("left behind in the temporary directory: %v", left)
	}
	return string(out), code
}

func (h *host) apply(from string) (string, int) { return h.run(h.script, from, "apply") }
func (h *host) cmd(from string, args ...string) (string, int) {
	h.t.Helper()
	if _, err := os.Stat(h.installed); err != nil {
		h.t.Fatal("almanac-harden isn't installed")
	}
	return h.run(h.installed, from, args...)
}

func (h *host) log() []string {
	b, _ := os.ReadFile(filepath.Join(h.world, "log"))
	return strings.Split(strings.TrimSpace(string(b)), "\n")
}

// logged says where in the log a call is (-1: not there).
func (h *host) logged(prefix string) int {
	return slices.IndexFunc(h.log(), func(l string) bool { return strings.HasPrefix(l, prefix) })
}

// state is what the machine has: its files under etc/, and what is in force (the table, nftables enabled, ufw on,
// the undo's units).
func (h *host) state() map[string]string {
	h.t.Helper()
	s := map[string]string{}
	filepath.WalkDir(filepath.Join(h.root, "etc"), func(path string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			s[strings.TrimPrefix(path, h.root)] = h.read(path)
		}
		return nil
	})
	for _, mark := range []string{"loaded", "ufw", "enabled-nftables", "enabled-almanac-harden-undo.service",
		"started-almanac-harden-undo.timer"} {
		if h.has(mark) {
			s["world:"+mark] = h.read(filepath.Join(h.world, mark))
		}
	}
	return s
}

func (h *host) same(before map[string]string, when string) {
	h.t.Helper()
	if after := h.state(); !maps.Equal(before, after) {
		h.t.Fatalf("%s, the machine changed:\nbefore %v\nafter  %v", when, before, after)
	}
}

const ownerFirst, ownerAgain = "198.51.100.7 50000 2.31.121.12 22", "198.51.100.7 50001 2.31.121.12 22"

// Applied, then confirmed from a new login: the firewall alone and loaded, ssh's file in force and alone of ours,
// nothing armed any more; applied again, nothing changes; undone, all as it was.
func TestHardenApplied(t *testing.T) {
	t.Parallel()
	h := newHost(t)
	before := h.state()
	nft, sshd := h.read(filepath.Join(h.repo, "nftables.conf")), h.read(filepath.Join(h.repo, "sshd.conf"))

	out, code := h.apply(ownerFirst)
	expect(t, out, code, 0, "from a NEW one: almanac-harden confirm", "goes back by itself in 10 minutes")
	if !h.has("loaded") || !h.has("enabled-nftables") || h.has("ufw") {
		t.Fatalf("the firewall: loaded %v, enabled %v, ufw %v", h.has("loaded"), h.has("enabled-nftables"), h.has("ufw"))
	}
	if got := h.read(filepath.Join(h.root, "etc", "nftables.conf")); got != nft {
		t.Fatal("nftables.conf isn't the repository's")
	}
	files, _ := filepath.Glob(filepath.Join(h.sshdir, "*"))
	if len(files) != 2 || h.read(filepath.Join(h.sshdir, "10-almanac.conf")) != sshd ||
		h.read(filepath.Join(h.sshdir, "50-cloud-init.conf")) != cloudInitSSH {
		t.Fatalf("ssh's files: %v", files)
	}
	// Armed before anything changed; the table in force before ufw went; sshd read its file again.
	armed, loaded, ufwOff, reload := h.logged("systemctl start almanac-harden-undo.timer"), h.logged("nft -f"),
		h.logged("ufw disable"), h.logged("systemctl reload ssh")
	if armed < 0 || loaded < armed || ufwOff < loaded || reload < ufwOff {
		t.Fatalf("the order: armed %d, loaded %d, ufw off %d, reloaded %d\n%v", armed, loaded, ufwOff, reload, h.log())
	}
	if !h.has("enabled-almanac-harden-undo.service") ||
		!strings.Contains(h.read(filepath.Join(h.units, "almanac-harden-undo.service")), "ExecStart="+h.installed+" undo unconfirmed") ||
		!strings.Contains(h.read(filepath.Join(h.units, "almanac-harden-undo.timer")), "OnActiveSec=600") {
		t.Fatal("the way back isn't armed")
	}

	out, code = h.cmd("", "verify")
	expect(t, out, code, 1, "not confirmed")
	out, code = h.cmd(ownerFirst, "confirm")
	expect(t, out, code, 1, "the login that applied it")
	out, code = h.cmd("", "confirm")
	expect(t, out, code, 1, "from a new ssh login")
	out, code = h.cmd(ownerAgain, "confirm")
	expect(t, out, code, 0, "Confirmed")
	if h.has("enabled-almanac-harden-undo.service") || h.has("started-almanac-harden-undo.timer") {
		t.Fatal("still armed")
	}
	if units, _ := os.ReadDir(h.units); len(units) != 0 {
		t.Fatalf("the units are still there: %v", units)
	}
	out, code = h.cmd("", "verify")
	expect(t, out, code, 0)
	kept := h.state()

	// Again: nothing to do, nothing armed; the timer's undo, late, does nothing.
	out, code = h.apply(ownerAgain)
	expect(t, out, code, 0, "in force already")
	if h.logged("systemctl start") >= 0 {
		t.Fatalf("armed again: %v", h.log())
	}
	out, code = h.cmd("", "undo", "unconfirmed")
	expect(t, out, code, 0)
	h.same(kept, "the timer's undo after a confirmation")

	// By hand: back to Ubuntu's, ufw and all.
	out, code = h.cmd(ownerAgain, "undo")
	expect(t, out, code, 0, "back to what was there")
	h.same(before, "undone")
	if reloaded := h.logged("systemctl reload ssh"); reloaded < 0 || reloaded > h.logged("ufw --force enable") {
		t.Fatalf("ssh goes back first, then the firewall, ufw on before the table goes: %v", h.log())
	}
}

// Nobody confirms: the timer's undo (or the machine's start) puts back all of it.
func TestHardenUnconfirmed(t *testing.T) {
	t.Parallel()
	h := newHost(t)
	before := h.state()
	_, code := h.apply(ownerFirst)
	expect(t, "", code, 0)
	out, code := h.cmd("", "undo", "unconfirmed")
	expect(t, out, code, 0, "back to what was there")
	h.same(before, "gone back")
	if ufwOn, gone := h.logged("ufw --force enable"), h.logged("nft delete table inet almanac"); ufwOn < 0 || gone < ufwOn {
		t.Fatalf("ufw on before the table goes: %v", h.log())
	}
	out, code = h.cmd(ownerAgain, "confirm")
	expect(t, out, code, 1, "nothing waits")
}

// A changed firewall, unconfirmed, goes back to the one in force before it, loaded again.
func TestHardenChangedThenBack(t *testing.T) {
	t.Parallel()
	h := newHost(t)
	h.apply(ownerFirst)
	if _, code := h.cmd(ownerAgain, "confirm"); code != 0 {
		t.Fatal("not confirmed")
	}
	first := h.state()
	conf := filepath.Join(h.repo, "nftables.conf")
	h.write(conf, h.read(conf)+"# changed\n")
	out, code := h.apply(ownerFirst)
	expect(t, out, code, 0, "almanac-harden confirm")
	if !strings.HasSuffix(h.read(filepath.Join(h.world, "loaded")), "# changed\n") {
		t.Fatal("the new table isn't loaded")
	}
	if h.logged("ufw disable") >= 0 {
		t.Fatalf("ufw was off already: %v", h.log())
	}
	out, code = h.cmd("", "undo", "unconfirmed")
	expect(t, out, code, 0)
	h.same(first, "gone back to the first")
}

// Refused before anything changes: a file nft or sshd refuses, a setting an earlier file overrides, an apply that
// waits, an apply from the installed copy.
func TestHardenRefused(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name  string
		setup func(h *host)
		says  string
	}{
		{"nftables.conf refused", func(h *host) {
			h.write(filepath.Join(h.repo, "nftables.conf"), h.read(filepath.Join(h.repo, "nftables.conf"))+"BROKEN\n")
		}, "nft -c refuses"},
		{"sshd.conf refused", func(h *host) {
			h.write(filepath.Join(h.repo, "sshd.conf"), h.read(filepath.Join(h.repo, "sshd.conf"))+"BROKEN\n")
		}, "sshd -t refuses"},
		{"a file before ours", func(h *host) {
			h.write(filepath.Join(h.sshdir, "05-other.conf"), "MaxAuthTries 6\nAllowTcpForwarding yes\n")
		}, "not in force: maxauthtries 3"},
		{"no Include", func(h *host) {
			h.write(h.main, "X11Forwarding yes\n")
		}, "not in force: permitrootlogin prohibit-password"},
		{"one waits", func(h *host) {
			os.MkdirAll(filepath.Join(h.root, "state"), 0o700)
			h.write(filepath.Join(h.root, "state", "pending"), ownerFirst+"\n")
		}, "waits already"},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			h := newHost(t)
			c.setup(h)
			before := h.state()
			out, code := h.apply(ownerFirst)
			expect(t, out, code, 1, c.says)
			h.same(before, "refused")
			if h.logged("nft -f") >= 0 || h.logged("ufw disable") >= 0 || h.logged("systemctl reload") >= 0 {
				t.Fatalf("changed something: %v", h.log())
			}
		})
	}

	h := newHost(t)
	h.apply(ownerFirst)
	h.cmd(ownerAgain, "confirm")
	out, code := h.cmd(ownerAgain, "apply")
	expect(t, out, code, 1, "apply from the repository's deploy/")
}

// A step that fails midway puts back all that was done before it, at once.
func TestHardenBackOnFailure(t *testing.T) {
	t.Parallel()
	for _, fail := range []string{"nft-fails", "sshd-fails", "reload-fails"} {
		t.Run(fail, func(t *testing.T) {
			t.Parallel()
			h := newHost(t)
			before := h.state()
			h.write(filepath.Join(h.world, fail), "")
			out, code := h.apply(ownerFirst)
			expect(t, out, code, 1, "going back")
			os.Remove(filepath.Join(h.world, fail))
			h.same(before, "after "+fail)
			if _, err := os.Stat(filepath.Join(h.root, "state", "pending")); err == nil {
				t.Fatal("still waits for a confirmation")
			}
		})
	}
}

// What setup.sh installs is what deploy-ci.sh check compares, file for file, and every file of deploy/ that goes on
// the server is among them.
func TestCheckedAsInstalled(t *testing.T) {
	t.Parallel()
	read := func(name string) string {
		b, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	setup, harden := read("setup.sh"), read("harden.sh")
	installed := map[string]string{} // deploy/ file → where it goes
	for _, m := range regexp.MustCompile(`(?m)^\s*install -m \d+ "\$here/([^"]+)" (/\S+)$`).FindAllStringSubmatch(setup, -1) {
		installed[m[1]] = m[2]
	}
	for file, key := range map[string]string{"nftables.conf": "nft_file", "sshd.conf": "sshd_file", "harden.sh": "installed"} {
		m := regexp.MustCompile(`(?m)^` + key + `=(/\S+)$`).FindStringSubmatch(harden)
		if m == nil {
			t.Fatalf("harden.sh sets no %s", key)
		}
		installed[file] = m[1]
	}
	checked := map[string]string{}
	for _, m := range regexp.MustCompile(`(?m)^\s*sum (/\S+) deploy/(\S+)$`).FindAllStringSubmatch(read("deploy-ci.sh"), -1) {
		checked[m[2]] = m[1]
	}
	if !maps.Equal(installed, checked) {
		t.Errorf("setup.sh and harden.sh install\n%v\ndeploy-ci.sh check compares\n%v", installed, checked)
	}
	// Not on the server: the setup itself, the settings' example, Hetzner's firewall (set in its console or by hcloud),
	// the tests.
	apart := []string{"setup.sh", "env.example", "hetzner-firewall.json"}
	entries, _ := os.ReadDir(".")
	for _, e := range entries {
		name := e.Name()
		if _, ok := checked[name]; !ok && !slices.Contains(apart, name) && !strings.HasSuffix(name, "_test.go") {
			t.Errorf("deploy/%s goes on the server, but deploy-ci.sh check doesn't compare it", name)
		}
	}
}
