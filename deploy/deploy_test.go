// Package deploy holds the tests of the server's deploy scripts (deploy.sh, deploy-ci.sh, bank.sh): there's no Go
// here besides. deploy.sh runs against a machine made of stubs in a temporary directory (the server, systemd, curl, the
// clock), each of its ways through played out: the restart, going back, the marks, the checks of a release; and beside
// bank.sh, never at once.
package deploy

import (
	"bytes"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// The stubs: what deploy.sh calls on a server, each a script acting on the world's files (WORLD): the clock, the
// running version, its process. The clock moves only by sleep.
var stubs = map[string]string{
	"date":  `if [ "$1" = +%s ]; then cat "$WORLD/clock"; else exec /bin/date "$@"; fi`,
	"sleep": `c=$(cat "$WORLD/clock"); echo $((c + ${1%.*})) >"$WORLD/clock"`,
	"flock": `exit 0`,
	"df":    `printf 'Avail\n%s\n' "$(cat "$WORLD/free" 2>/dev/null || echo 99999999999)"`,
	"stat": `[ -e "$3" ] || exit 1
case $2 in
%s) wc -c <"$3" | tr -d ' ' ;;
%Y) cat "$3.mtime" 2>/dev/null || echo 0 ;;
esac`,
	"timeout": `shift
exec "$@"`,
	"setpriv": `while [ $# -gt 0 ]; do case $1 in --*) shift ;; *) break ;; esac; done
exec "$@"`,
	"ssh-keygen": `while [ $# -gt 0 ]; do if [ "$1" = -s ]; then sig=$2; fi; shift; done
[ "$(cat "$sig")" = good ]`,
	"systemctl": `W=$WORLD
now=$(cat "$W/clock")
echo "systemctl $* @$now" >>"$W/log"
case "$1 $2" in
"show -p")
	pid=$(cat "$W/pid")
	if [ -f "$W/crash-at" ] && [ "$now" -ge "$(cat "$W/crash-at")" ]; then pid=$((pid + 1000)); fi
	echo "$pid"
	exit 0
	;;
"is-active --quiet") [ -f "$W/active" ]; exit ;;
esac
case $1 in
stop)
	case " $* " in *" almanac "*)
		if [ -f "$W/fail-stop" ]; then exit 1; fi
		: >"$W/running"
		;;
	esac
	;;
restart | start)
	case " $* " in *" almanac "*) ;; *) exit 0 ;; esac
	v=$("$LINK" version)
	echo "$v" >"$W/running"
	echo $(($(cat "$W/pid") + 1)) >"$W/pid"
	echo "$now" >"$W/started"
	rm -f "$W/crash-at" "$W/probed"
	if [ "$(cat "$W/behave-$v" 2>/dev/null)" = crash ]; then echo $((now + 30)) >"$W/crash-at"; fi
	if [ -f "$W/migrates-$v" ] && [ ! -e "$DATA/before-$v.db" ]; then
		cp "$DATA/almanac.db" "$DATA/before-$v.db"
		echo "$now" >"$DATA/before-$v.db.mtime"
		echo "migrated by $v" >"$DATA/almanac.db"
		echo "log of $v" >"$DATA/almanac.db-wal"
	fi
	;;
esac`,
	"curl": `W=$WORLD
out= url=
while [ $# -gt 0 ]; do
	case $1 in
	-o) out=$2; shift ;;
	-X) shift ;;
	-w | --max-time | --resolve | --proto) shift ;;
	https://*) url=$1 ;;
	esac
	shift
done
case $url in
*/api/health)
	r=$(cat "$W/running")
	[ -n "$r" ] || exit 7
	behave=$(cat "$W/behave-$r" 2>/dev/null || true)
	[ "$behave" != never ] || exit 7
	# From some seconds after its start (from-<tag>): one write that takes the probe's 5 s and fails, its 503 then held
	# 30 s from the probe's start, as /api/health holds it (probeEvery); or every answer 5 s late and none (a hang).
	case $behave in stall | hang)
		now=$(cat "$W/clock")
		if [ $((now - $(cat "$W/started"))) -ge "$(cat "$W/from-$r")" ]; then
			if [ "$behave" = hang ]; then echo $((now + 5)) >"$W/clock"; exit 28; fi
			if [ ! -f "$W/probed" ]; then echo "$now" >"$W/probed"; echo $((now + 5)) >"$W/clock"; exit 22; fi
			[ "$now" -ge $(($(cat "$W/probed") + 30)) ] || exit 22
		fi
		;;
	esac
	if [ -f "$W/crash-at" ] && [ "$(cat "$W/clock")" -ge "$(cat "$W/crash-at")" ]; then exit 7; fi
	printf '{"version":"%s"}' "$r"
	;;
*/releases/download/*)
	tag=${url%/*} tag=${tag##*/}
	case $url in *.sig) src=$W/releases/$tag/almanac.sig ;; *) src=$W/releases/$tag/almanac ;; esac
	[ -f "$src" ] || exit 22
	cp "$src" "$out"
	;;
*) exit 6 ;;
esac`,
}

// A release, as the stubs play it.
type release struct {
	tag        string
	migrations []string // its lines of `almanac migrations`
	old        bool     // too old to list them
	says       string   // the version it says it is, if not its tag
	unsigned   bool
	badSig     bool
	// behave is how it runs: healthy (""), never (doesn't come up), crash (comes up, stops after 30 s), stall (one
	// write stalls from `from` seconds after its start, and health answers 503 for 30 s), hang (from `from` on, health
	// never answers).
	behave string
	from   int
	// reads says how it takes the bank the game plays (`almanac bank check`): "" for a program too old to check one
	// (it says nothing), "yes", "no" (it can't load it), "uneven" (it loads it, and fails on the categories' sizes),
	// "rules" (it loads it, and fails on the bank's rules: bank lint's, which the server never runs).
	reads    string
	migrates bool // its start copies the database and migrates it
}

func (r release) program() string {
	says := r.says
	if says == "" {
		says = r.tag
	}
	list := "printf '%s\\n' " + shellQuote(r.migrations...)
	if r.old {
		list = "exit 1"
	}
	check := "exit 1"
	switch r.reads {
	case "yes":
		check = `echo "$3: 0 errors, 0 warnings"`
	case "no":
		check = `echo "questions/general.json:7: gen-2: json: unknown field \"theme\""; echo "$3: 1 errors, 0 warnings"; ` +
			`echo "almanac: $3: 1 errors: the server would not play this bank" >&2; exit 1`
	case "uneven":
		check = `echo "$3: 0 errors, 0 warnings"; echo "almanac: $3: categories more than 2% off the mean" >&2; exit 1`
	case "rules":
		check = `echo "questions/general.json:7: gen-2: [fact] a fact ends in a period"; echo "$3: 1 errors, 0 warnings"; ` +
			`echo "almanac: $3: 1 errors against the bank's rules (bank lint): fix the bank or the rule" >&2; exit 1`
	}
	return fmt.Sprintf("#!/bin/sh\ncase $1 in\nversion) echo %s ;;\nmigrations) %s ;;\nbank) %s ;;\n*) exit 1 ;;\nesac\n",
		says, list, check)
}

func shellQuote(s ...string) string {
	q := make([]string, len(s))
	for i, v := range s {
		q[i] = "'" + strings.ReplaceAll(v, "'", `'\''`) + "'"
	}
	return strings.Join(q, " ")
}

// mig is a line of `almanac migrations`: a made-up sum, two spaces, the name.
func mig(sum byte, name string) string { return strings.Repeat(string(sum), 64) + "  " + name }

type machine struct {
	t                                   *testing.T
	root, world, lib, data, link, marks string
	bank                                string
	script                              string
}

// newMachine is a server running v1.0.0, whose migrations are 0001 and 0002, with deploy.sh installed.
func newMachine(t *testing.T) *machine {
	t.Helper()
	root := t.TempDir()
	m := &machine{t: t, root: root, world: filepath.Join(root, "world"), lib: filepath.Join(root, "lib"),
		data: filepath.Join(root, "data"), link: filepath.Join(root, "bin", "almanac"), marks: filepath.Join(root, "marks")}
	for _, d := range []string{m.world, m.lib, m.data, filepath.Dir(m.link), filepath.Join(root, "stubs"),
		filepath.Join(root, "etc"), filepath.Join(root, "tmp")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for name, body := range stubs {
		m.write(filepath.Join(root, "stubs", name), "#!/bin/sh\n"+body+"\n", 0o755)
	}
	m.write(filepath.Join(root, "etc", "release-signers"),
		"# a comment\nalmanac-release namespaces=\"almanac-release\" ssh-ed25519 AAAA almanac-release\n", 0o644)

	src, err := os.ReadFile("deploy.sh")
	if err != nil {
		t.Fatal(err)
	}
	script := string(src)
	paths := map[string]string{"dir": m.lib, "data": m.data, "link": m.link, "marks": m.marks,
		"signers": filepath.Join(root, "etc", "release-signers"), "lock": filepath.Join(root, "lock"),
		"bank": filepath.Join(root, "bank")}
	m.bank = paths["bank"]
	// Every path on the server is among these, so the tests never reach the machine's own.
	set := regexp.MustCompile(`^(` + strings.Join(slices.Collect(maps.Keys(paths)), "|") + `)=`)
	system := regexp.MustCompile(`(^|[\s="'])/(usr|var|etc|run|srv)/`)
	for i, line := range strings.Split(script, "\n") {
		if l := strings.TrimSpace(line); !strings.HasPrefix(l, "#") && !set.MatchString(line) && system.MatchString(l) {
			t.Fatalf("deploy.sh line %d names a path outside its block of paths: %s", i+1, l)
		}
	}
	for key, path := range paths {
		re := regexp.MustCompile(`(?m)^` + key + `=.*$`)
		if n := len(re.FindAllString(script, -1)); n != 1 {
			t.Fatalf("deploy.sh sets %s %d times, not once", key, n)
		}
		script = re.ReplaceAllLiteralString(script, key+"="+path)
	}
	m.script = filepath.Join(root, "deploy.sh")
	m.write(m.script, script, 0o755)

	m.write(filepath.Join(m.world, "clock"), "1000000", 0o644)
	m.write(filepath.Join(m.world, "pid"), "1", 0o644)
	m.write(filepath.Join(m.world, "active"), "", 0o644)
	m.write(filepath.Join(m.data, "almanac.db"), "the game\n", 0o600)
	m.install(release{tag: "v1.0.0", migrations: []string{mig('1', "0001_a.sql"), mig('2', "0002_b.sql")}})
	return m
}

func (m *machine) write(path, body string, mode os.FileMode) {
	m.t.Helper()
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		m.t.Fatal(err)
	}
}

func (m *machine) read(path string) string {
	m.t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		m.t.Fatal(err)
	}
	return string(b)
}

// install puts a release on the machine as the live one, running.
func (m *machine) install(r release) {
	m.t.Helper()
	path := filepath.Join(m.lib, "almanac-"+r.tag)
	m.write(path, r.program(), 0o755)
	os.Remove(m.link)
	if err := os.Symlink(path, m.link); err != nil {
		m.t.Fatal(err)
	}
	m.write(filepath.Join(m.world, "running"), r.tag+"\n", 0o644)
}

// publish puts a release on GitHub, as the stubs serve it.
func (m *machine) publish(r release) {
	m.t.Helper()
	dir := filepath.Join(m.world, "releases", r.tag)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		m.t.Fatal(err)
	}
	m.write(filepath.Join(dir, "almanac"), r.program(), 0o644)
	if !r.unsigned {
		sig := "good"
		if r.badSig {
			sig = "bad"
		}
		m.write(filepath.Join(dir, "almanac.sig"), sig, 0o644)
	}
	if r.behave != "" {
		m.write(filepath.Join(m.world, "behave-"+r.tag), r.behave, 0o644)
		m.write(filepath.Join(m.world, "from-"+r.tag), fmt.Sprint(r.from), 0o644)
	}
	if r.migrates {
		m.write(filepath.Join(m.world, "migrates-"+r.tag), "", 0o644)
	}
}

// deploy runs deploy.sh (as its own unit already), and says what it printed and how it ended.
func (m *machine) deploy(args ...string) (string, int) {
	m.t.Helper()
	os.Remove(filepath.Join(m.world, "log"))
	out, err := m.command(m.script, args...).CombinedOutput()
	code := 0
	if e, ok := err.(*exec.ExitError); ok {
		code = e.ExitCode()
	} else if err != nil {
		m.t.Fatal(err)
	}
	if left, _ := os.ReadDir(filepath.Join(m.root, "tmp")); len(left) > 0 {
		m.t.Errorf("left behind in the temporary directory: %v", left)
	}
	return string(out), code
}

// command runs a script on the machine, its stubs first on the PATH (deploy.sh as its own unit already).
func (m *machine) command(script string, args ...string) *exec.Cmd {
	cmd := exec.Command("/bin/sh", append([]string{script}, args...)...)
	cmd.Env = append(os.Environ(), "PATH="+filepath.Join(m.root, "stubs")+":"+os.Getenv("PATH"), "WORLD="+m.world,
		"LINK="+m.link, "DATA="+m.data, "TMPDIR="+filepath.Join(m.root, "tmp"), "ALMANAC_DEPLOY_UNIT=1")
	return cmd
}

// log is what the stubs saw, in order: systemctl's calls.
func (m *machine) log() []string {
	b, _ := os.ReadFile(filepath.Join(m.world, "log"))
	return strings.Split(strings.TrimSpace(string(b)), "\n")
}

func (m *machine) restarted() bool {
	for _, l := range m.log() {
		if strings.HasPrefix(l, "systemctl restart") || strings.HasPrefix(l, "systemctl start") {
			return true
		}
	}
	return false
}

func (m *machine) live() string {
	m.t.Helper()
	target, err := os.Readlink(m.link)
	if err != nil {
		m.t.Fatal(err)
	}
	return strings.TrimPrefix(filepath.Base(target), "almanac-")
}

func expect(t *testing.T, out string, code, want int, says ...string) {
	t.Helper()
	if code != want {
		t.Fatalf("exit %d, not %d:\n%s", code, want, out)
	}
	for _, s := range says {
		if !strings.Contains(out, s) {
			t.Fatalf("doesn't say %q:\n%s", s, out)
		}
	}
}

var healthy = release{tag: "v1.0.1", migrations: []string{mig('1', "0001_a.sql"), mig('2', "0002_b.sql")}}

// A release goes live at once: nothing is played in the server's memory, so the restart waits for nothing. One live
// already is left as it is, and a mode that isn't one is refused.
func TestDeploy(t *testing.T) {
	t.Parallel()
	t.Run("at once", func(t *testing.T) {
		t.Parallel()
		m := newMachine(t)
		m.publish(healthy)
		out, code := m.deploy("v1.0.1", "ci")
		expect(t, out, code, 0, "live: v1.0.1")
		if m.live() != "v1.0.1" || !m.restarted() {
			t.Fatalf("live: %s, %v", m.live(), m.log())
		}
	})
	t.Run("by hand", func(t *testing.T) {
		t.Parallel()
		m := newMachine(t)
		m.publish(healthy)
		out, code := m.deploy("v1.0.1")
		expect(t, out, code, 0, "live: v1.0.1")
	})
	t.Run("live already", func(t *testing.T) {
		t.Parallel()
		m := newMachine(t)
		out, code := m.deploy("v1.0.0", "ci")
		expect(t, out, code, 0, "live already")
		if m.restarted() {
			t.Fatalf("restarted: %v", m.log())
		}
	})
	t.Run("no such mode", func(t *testing.T) {
		t.Parallel()
		m := newMachine(t)
		m.publish(healthy)
		out, code := m.deploy("v1.0.1", "now")
		expect(t, out, code, 1, "usage")
		if m.restarted() {
			t.Fatalf("restarted: %v", m.log())
		}
	})
}

// A release is taken only signed, and only if it says it's that version; and only with room for a copy of the
// database. Each refusal comes before the restart.
func TestRefused(t *testing.T) {
	t.Parallel()
	for name, c := range map[string]struct {
		r       release
		setup   func(m *machine)
		says    string
		arrives bool
	}{
		"unsigned":        {r: release{tag: "v1.0.1", unsigned: true}, says: "has no signature"},
		"a bad signature": {r: release{tag: "v1.0.1", badSig: true}},
		"no key": {r: healthy, setup: func(m *machine) {
			m.write(filepath.Join(m.root, "etc", "release-signers"), "# none yet\n", 0o644)
		}, says: "names no key"},
		"another version": {r: release{tag: "v1.0.1", says: "v6.6.6"}, says: "says it is v6.6.6"},
		"no room": {r: healthy, setup: func(m *machine) {
			m.write(filepath.Join(m.world, "free"), "10", 0o644)
		}, says: "MB free", arrives: true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			m := newMachine(t)
			m.publish(c.r)
			if c.setup != nil {
				c.setup(m)
			}
			out, code := m.deploy("v1.0.1", "ci")
			expect(t, out, code, 1, c.says)
			if m.restarted() || m.live() != "v1.0.0" {
				t.Fatalf("deployed: %v", m.log())
			}
			if _, err := os.Stat(filepath.Join(m.lib, "almanac-v1.0.1")); (err == nil) != c.arrives {
				t.Fatalf("kept: %v", err)
			}
		})
	}
}

// A release that never comes up after it began to migrate goes back to the version before on the database as it was
// (the copy, renamed into place), keeps its own database aside, and is marked by its new migration: CI tries neither
// it nor a release with that migration unchanged again; a changed one, or one by hand, goes out, and clears the mark.
func TestBackFromAMigration(t *testing.T) {
	t.Parallel()
	m := newMachine(t)
	before := []string{mig('1', "0001_a.sql"), mig('2', "0002_b.sql")}
	bad := mig('3', "0003_c.sql")
	m.publish(release{tag: "v1.1.0", migrations: append(before, bad), behave: "never", migrates: true})
	out, code := m.deploy("v1.1.0", "ci")
	expect(t, out, code, 1, "isn't healthy: it didn't answer", "back to almanac-v1.0.0, on the database as it was before v1.1.0")
	if m.live() != "v1.0.0" || strings.TrimSpace(m.read(filepath.Join(m.world, "running"))) != "v1.0.0" {
		t.Fatalf("not back: %s, %v", m.live(), m.log())
	}
	if db := m.read(filepath.Join(m.data, "almanac.db")); db != "the game\n" {
		t.Fatalf("the database: %q", db)
	}
	for _, gone := range []string{"almanac.db-wal", "before-v1.1.0.db"} {
		if _, err := os.Stat(filepath.Join(m.data, gone)); err == nil {
			t.Fatalf("%s is still there", gone)
		}
	}
	failed, _ := filepath.Glob(filepath.Join(m.data, "failed-v1.1.0-*.db"))
	if len(failed) != 1 || m.read(failed[0]) != "migrated by v1.1.0\n" || m.read(failed[0]+"-wal") != "log of v1.1.0\n" {
		t.Fatalf("the failed version's database isn't kept: %v", failed)
	}
	mark := m.read(filepath.Join(m.marks, "unhealthy-v1.1.0"))
	if lines := strings.Split(strings.TrimSpace(mark), "\n"); len(lines) != 2 || lines[1] != "migration "+bad {
		t.Fatalf("the mark: %q", mark)
	}

	out, code = m.deploy("v1.1.0", "ci")
	expect(t, out, code, 1, "not tried again from CI")

	// The next patch, with the same migration: refused before the restart. Changed, it goes out.
	m.publish(release{tag: "v1.1.1", migrations: append(before, bad), migrates: true})
	out, code = m.deploy("v1.1.1", "ci")
	expect(t, out, code, 1, "brings that release's migration, unchanged", "0003_c.sql")
	if m.restarted() {
		t.Fatalf("restarted: %v", m.log())
	}
	m.publish(release{tag: "v1.1.2", migrations: append(before, mig('4', "0003_c.sql")), migrates: true})
	out, code = m.deploy("v1.1.2", "ci")
	expect(t, out, code, 0, "live: v1.1.2", "their migrations have run")
	if _, err := os.Stat(filepath.Join(m.marks, "unhealthy-v1.1.0")); err == nil {
		t.Fatal("the mark is still there")
	}
}

// By hand, a marked release goes out all the same.
func TestByHand(t *testing.T) {
	t.Parallel()
	m := newMachine(t)
	bad := mig('3', "0003_c.sql")
	m.publish(release{tag: "v1.1.0", migrations: []string{bad}, behave: "never", migrates: true})
	_, code := m.deploy("v1.1.0", "ci")
	expect(t, "", code, 1)
	m.publish(release{tag: "v1.1.1", migrations: []string{bad}, migrates: true})
	out, code := m.deploy("v1.1.1")
	expect(t, out, code, 0, "live: v1.1.1", "their migrations have run")
	if marks, _ := os.ReadDir(m.marks); len(marks) != 0 {
		t.Fatalf("marks left: %v", marks)
	}
}

// One that came up and then stopped is marked alone: its migrations ran, so the next patch is tried.
func TestBackFromACrash(t *testing.T) {
	t.Parallel()
	m := newMachine(t)
	m.publish(release{tag: "v1.0.2", migrations: healthy.migrations, behave: "crash"})
	out, code := m.deploy("v1.0.2", "ci")
	expect(t, out, code, 1, "it stopped after it started", "back to almanac-v1.0.0 (on the database as it is")
	if mark := m.read(filepath.Join(m.marks, "unhealthy-v1.0.2")); strings.Contains(mark, "migration") {
		t.Fatalf("the mark: %q", mark)
	}
	if db := m.read(filepath.Join(m.data, "almanac.db")); db != "the game\n" {
		t.Fatalf("the database: %q", db)
	}
	m.publish(release{tag: "v1.0.3", migrations: healthy.migrations})
	out, code = m.deploy("v1.0.3", "ci")
	expect(t, out, code, 0, "live: v1.0.3")
	if _, err := os.Stat(filepath.Join(m.marks, "unhealthy-v1.0.2")); err != nil {
		t.Fatal("the crashed release's mark is gone: CI would try it again")
	}
}

// One that brings a migration and refuses to start before it copies the database (store.CheckShape: its schema isn't
// what the migrations make) goes back on the database as it is, and is marked alone: nothing of it migrated, and its
// new migration isn't what failed, so a release that brings it is tried (one with the schema's cause fixed starts).
func TestBackFromARefusedStart(t *testing.T) {
	t.Parallel()
	m := newMachine(t)
	brings := append(slices.Clone(healthy.migrations), mig('3', "0003_c.sql"))
	m.publish(release{tag: "v1.1.0", migrations: brings, behave: "never"})
	out, code := m.deploy("v1.1.0", "ci")
	expect(t, out, code, 1, "isn't healthy: it didn't answer", "back to almanac-v1.0.0 (on the database as it is: v1.1.0 didn't migrate it)")
	if m.live() != "v1.0.0" || strings.TrimSpace(m.read(filepath.Join(m.world, "running"))) != "v1.0.0" {
		t.Fatalf("not back: %s, %v", m.live(), m.log())
	}
	if db := m.read(filepath.Join(m.data, "almanac.db")); db != "the game\n" {
		t.Fatalf("the database: %q", db)
	}
	if failed, _ := filepath.Glob(filepath.Join(m.data, "failed-*")); len(failed) > 0 {
		t.Fatalf("a failed database kept: %v", failed)
	}
	if mark := m.read(filepath.Join(m.marks, "unhealthy-v1.1.0")); strings.Contains(mark, "migration") {
		t.Fatalf("the mark: %q", mark)
	}
	m.publish(release{tag: "v1.1.1", migrations: brings, migrates: true})
	out, code = m.deploy("v1.1.1", "ci")
	expect(t, out, code, 0, "live: v1.1.1")
}

// The watch after a good start: one write that stalls (a 503, held 30 s by /api/health) keeps the release, whenever
// in the two minutes it comes, as on 23 Nov 2026 it didn't; a server that stops answering goes back.
func TestWatch(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		behave string
		from   int
		live   bool
	}{
		{"stall", 5, true}, {"stall", 20, true}, {"stall", 60, true}, {"stall", 100, true},
		{"hang", 20, false}, {"hang", 60, false},
	} {
		t.Run(fmt.Sprintf("%s from +%ds", c.behave, c.from), func(t *testing.T) {
			t.Parallel()
			m := newMachine(t)
			m.publish(release{tag: "v1.0.1", migrations: healthy.migrations, behave: c.behave, from: c.from})
			out, code := m.deploy("v1.0.1", "ci")
			if c.live {
				expect(t, out, code, 0, "live: v1.0.1")
				return
			}
			expect(t, out, code, 1, "isn't healthy: it stopped answering", "back to almanac-v1.0.0")
		})
	}
}

// A version before that can't list its migrations: the release alone is marked.
func TestBackToAnOldOne(t *testing.T) {
	t.Parallel()
	m := newMachine(t)
	m.install(release{tag: "v1.0.0", old: true})
	m.publish(release{tag: "v1.1.0", migrations: []string{mig('3', "0003_c.sql")}, behave: "never", migrates: true})
	out, code := m.deploy("v1.1.0", "ci")
	expect(t, out, code, 1, "back to almanac-v1.0.0")
	if mark := m.read(filepath.Join(m.marks, "unhealthy-v1.1.0")); strings.Contains(mark, "\nmigration") ||
		!strings.Contains(mark, "can't list its migrations") {
		t.Fatalf("the mark: %q", mark)
	}
}

// Going back cut off midway (here, the service won't stop) starts the game again all the same.
func TestBackCutOff(t *testing.T) {
	t.Parallel()
	m := newMachine(t)
	m.publish(release{tag: "v1.1.0", behave: "never", migrates: true})
	m.write(filepath.Join(m.world, "fail-stop"), "", 0o644)
	out, code := m.deploy("v1.1.0")
	expect(t, out, code, 1)
	l := m.log()
	if !strings.HasPrefix(l[len(l)-1], "systemctl start almanac.socket almanac") {
		t.Fatalf("not started again: %v\n%s", l, out)
	}
}

// Going back below a migration by hand, as CLAUDE.md's steps (Production) do it, their commands run here: the mark
// holds the newer release back from CI, and every release that brings its migration unchanged; and with the older one
// linked first, an older one that fails has nothing to go back to, so the newer one never starts on the copy. A step
// that can't do its part does nothing: no mark without migrations to hold back, nothing moved without the copy.
func TestBackBelowAMigrationByHand(t *testing.T) {
	t.Parallel()
	src, err := os.ReadFile("../CLAUDE.md")
	if err != nil {
		t.Fatal(err)
	}
	doc := string(src)
	doc = doc[strings.Index(doc, "Going back to an older minor"):]
	try := func(t *testing.T, m *machine, has string) (string, error) {
		t.Helper()
		for _, block := range strings.Split(doc, "```bash\n")[1:] {
			block = block[:strings.Index(block, "```")]
			if !strings.Contains(block, has) {
				continue
			}
			for _, r := range [][2]string{{"/var/lib/almanac-deploy", m.marks}, {"/var/lib/almanac", m.data},
				{"/usr/local/lib/almanac", m.lib}, {"/usr/local/bin/almanac", m.link}, {"/run/", m.world + "/"},
				{"vNEW", "v1.1.0"}, {"vOLD", "v1.0.0"}, {"vX.Y.Z", "v1.1.0"}} {
				block = strings.ReplaceAll(block, r[0], r[1])
			}
			m.write(filepath.Join(m.root, "step.sh"), block, 0o755)
			out, err := m.command(filepath.Join(m.root, "step.sh")).CombinedOutput()
			return string(out), err
		}
		t.Fatalf("CLAUDE.md has no step with %s", has)
		return "", nil
	}
	step := func(t *testing.T, m *machine, has string) string {
		t.Helper()
		out, err := try(t, m, has)
		if err != nil {
			t.Fatalf("the step with %s: %v\n%s", has, err, out)
		}
		return out
	}
	bad := mig('3', "0003_c.sql")
	for _, c := range []struct {
		name, says string
		old        release
		newer      []string
	}{
		{"no migration between", "stop: no migration between",
			release{tag: "v1.0.0", migrations: healthy.migrations}, healthy.migrations},
		{"the older one can't list them", "stop: v1.0.0 can't list its migrations",
			release{tag: "v1.0.0", old: true}, append(slices.Clone(healthy.migrations), bad)},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			m := newMachine(t)
			m.install(c.old)
			m.install(release{tag: "v1.1.0", migrations: c.newer})
			if out := step(t, m, "unhealthy-vNEW"); !strings.Contains(out, c.says) {
				t.Fatalf("doesn't say %q:\n%s", c.says, out)
			}
			if left, _ := os.ReadDir(m.marks); len(left) > 0 {
				t.Fatalf("marked: %v", left)
			}
		})
	}
	t.Run("the copy is missing", func(t *testing.T) {
		t.Parallel()
		m := newMachine(t)
		m.install(release{tag: "v1.1.0", migrations: append(slices.Clone(healthy.migrations), bad)})
		m.write(filepath.Join(m.data, "almanac.db-wal"), "log of v1.1.0\n", 0o600)
		if out, err := try(t, m, "failed-by-hand"); err == nil {
			t.Fatalf("went on without the copy:\n%s", out)
		}
		left, _ := os.ReadDir(m.data)
		if len(left) != 2 || m.read(filepath.Join(m.data, "almanac.db")) != "the game\n" || m.live() != "v1.1.0" {
			t.Fatalf("moved: %v, linked %s", left, m.live())
		}
	})
	for _, fails := range []bool{false, true} {
		t.Run(fmt.Sprintf("the older one fails: %v", fails), func(t *testing.T) {
			t.Parallel()
			m := newMachine(t)
			m.install(release{tag: "v1.1.0", migrations: append(healthy.migrations, bad)})
			m.write(filepath.Join(m.data, "before-v1.1.0.db"), "the game\n", 0o600)
			m.write(filepath.Join(m.data, "almanac.db"), "migrated by v1.1.0\n", 0o600)
			m.write(filepath.Join(m.data, "almanac.db-wal"), "log of v1.1.0\n", 0o600)
			step(t, m, "unhealthy-vNEW")
			if mark := m.read(filepath.Join(m.marks, "unhealthy-v1.1.0")); !strings.HasSuffix(mark, "\nmigration "+bad+"\n") ||
				strings.Count(mark, "\n") != 2 {
				t.Fatalf("the mark: %q", mark)
			}
			m.write(filepath.Join(m.world, "running"), "", 0o644) // systemctl stop almanac.socket almanac
			step(t, m, "failed-by-hand")
			if db := m.read(filepath.Join(m.data, "almanac.db")); db != "the game\n" || m.live() != "v1.0.0" {
				t.Fatalf("the database %q, linked %s", db, m.live())
			}
			if kept, _ := filepath.Glob(filepath.Join(m.data, "failed-by-hand-*.db-wal")); len(kept) != 1 {
				t.Fatalf("the migrated database's log isn't kept: %v", kept)
			}
			if fails {
				m.write(filepath.Join(m.world, "behave-v1.0.0"), "never", 0o644)
				out, code := m.deploy("v1.0.0")
				expect(t, out, code, 1, "nothing to go back to")
				if r := strings.TrimSpace(m.read(filepath.Join(m.world, "running"))); r != "v1.0.0" || m.live() != "v1.0.0" {
					t.Fatalf("running %s, linked %s", r, m.live())
				}
				return
			}
			out, code := m.deploy("v1.0.0")
			expect(t, out, code, 0, "live: v1.0.0")
			out, code = m.deploy("v1.1.0", "ci")
			expect(t, out, code, 1, "not tried again from CI")
			m.publish(release{tag: "v1.1.1", migrations: append(healthy.migrations, bad), migrates: true})
			out, code = m.deploy("v1.1.1", "ci")
			expect(t, out, code, 1, "brings that release's migration, unchanged")
			if m.live() != "v1.0.0" {
				t.Fatalf("live: %s", m.live())
			}
		})
	}
}

// The floor under going back: a program that can't read the bank the game plays is never made live, by CI or by hand,
// and nothing restarts for it: an older one than the bank (a field it doesn't know), a newer one whose load (its format,
// bank.Load) the bank doesn't pass yet. One that reads it is deployed, as is one that only fails `bank check` on what
// isn't the server's to refuse (the categories' sizes; the bank's rules, bank lint's: a stricter rule holds the next
// bank update, never a release), one too old to check a bank at all, and any on a server with no bank's checkout yet.
func TestNotBelowTheBank(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name, reads string
		noBank      bool
		mode        []string
		live        bool
	}{
		{"it reads the bank", "yes", false, nil, true},
		{"it refuses the bank, by hand", "no", false, nil, false},
		{"it refuses the bank, from CI", "no", false, []string{"ci"}, false},
		{"only the sizes fail", "uneven", false, nil, true},
		{"only the bank's rules fail", "rules", false, []string{"ci"}, true},
		{"too old to check a bank", "", false, nil, true},
		{"no bank on the server yet", "no", true, nil, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			m := newMachine(t)
			if !c.noBank {
				if err := os.MkdirAll(m.bank, 0o755); err != nil {
					t.Fatal(err)
				}
				m.write(filepath.Join(m.bank, "categories.json"), "[]", 0o644)
			}
			m.publish(release{tag: "v0.9.0", reads: c.reads})
			out, code := m.deploy(append([]string{"v0.9.0"}, c.mode...)...)
			if c.live {
				expect(t, out, code, 0, "live: v0.9.0")
				return
			}
			expect(t, out, code, 1, "not deployed: v0.9.0 doesn't read the bank the game plays", `unknown field "theme"`)
			if m.live() != "v1.0.0" || m.restarted() {
				t.Fatalf("the game was touched: live %s, %v\n%s", m.live(), m.log(), out)
			}
			if _, err := os.Stat(filepath.Join(m.marks, "unhealthy-v0.9.0")); err == nil {
				t.Fatal("marked unhealthy: it never ran")
			}
		})
	}
	// What deploy.sh looks for is what `almanac bank check` says of a bank it can't load.
	const says = "the server would not play this bank"
	for _, file := range []string{"deploy.sh", "../cmd/almanac/bank.go"} {
		if src, err := os.ReadFile(file); err != nil || !strings.Contains(string(src), says) {
			t.Errorf("%s doesn't say %q (%v): deploy.sh tells a bank refused by it", file, says, err)
		}
	}
}

// A deploy and a bank reload never run at once: both take one lock, the same file on the server, and each waits for
// the other, saying so: a new program reads the bank it will play, and a reload is checked by the program that plays it.
func TestDeployAndBankShareALock(t *testing.T) {
	t.Parallel()
	lockOf := func(script string) string {
		t.Helper()
		src, err := os.ReadFile(script)
		if err != nil {
			t.Fatal(err)
		}
		set := regexp.MustCompile(`(?m)^lock=(\S+)`).FindAllStringSubmatch(string(src), -1)
		if len(set) != 1 {
			t.Fatalf("%s sets its lock %d times, not once", script, len(set))
		}
		return set[0][1]
	}
	if d, b := lockOf("deploy.sh"), lockOf("bank.sh"); d != b {
		t.Fatalf("deploy.sh locks %s, bank.sh %s: they'd run at once", d, b)
	}
	for _, c := range []struct {
		name, says string
		run        func(m *machine) *exec.Cmd
		ran        func(m *machine) bool
	}{
		{"a deploy waits for a bank reload", "a bank reload (almanac-bank), is under way: v1.0.1 waits for it",
			func(m *machine) *exec.Cmd { m.publish(healthy); return m.command(m.script, "v1.0.1", "ci") },
			func(m *machine) bool { return m.restarted() }},
		{"a bank reload waits for a deploy", "a deploy, or another almanac-bank, is under way: waiting for it",
			func(m *machine) *exec.Cmd { return m.command(m.bankScript()) },
			func(m *machine) bool { return slices.Contains(m.log(), "git fetch") }},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			m := newMachine(t)
			// flock as util-linux's takes it on a descriptor the shell holds open (in perl: macOS has no flock).
			m.write(filepath.Join(m.root, "stubs", "flock"), `#!/bin/sh
nb=0
if [ "$1" = -n ]; then nb=1; shift; fi
exec perl -e 'use Fcntl ":flock"; open(my $f, ">&=", $ARGV[0]) or exit 2; flock($f, LOCK_EX | ($ARGV[1] ? LOCK_NB : 0)) or exit 1' "$1" "$nb"
`, 0o755)
			// The other one, under way: it holds the lock.
			held, err := os.OpenFile(filepath.Join(m.root, "lock"), os.O_CREATE|os.O_WRONLY, 0o644)
			if err != nil {
				t.Fatal(err)
			}
			defer held.Close()
			if err := syscall.Flock(int(held.Fd()), syscall.LOCK_EX); err != nil {
				t.Fatal(err)
			}
			var out lockedBuffer
			cmd := c.run(m)
			cmd.Stdout, cmd.Stderr = &out, &out
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			for deadline := time.Now().Add(10 * time.Second); !strings.Contains(out.String(), c.says); {
				if time.Now().After(deadline) {
					_ = cmd.Process.Kill()
					t.Fatalf("doesn't say %q:\n%s", c.says, out.String())
				}
				time.Sleep(10 * time.Millisecond)
			}
			time.Sleep(300 * time.Millisecond) // time enough to go on, were it not waiting
			if c.ran(m) {
				t.Fatalf("went on while the other held the lock: %v", m.log())
			}
			if err := syscall.Flock(int(held.Fd()), syscall.LOCK_UN); err != nil {
				t.Fatal(err)
			}
			_ = cmd.Wait()
			if !c.ran(m) {
				t.Fatalf("didn't go on once the lock was free: %v\n%s", m.log(), out.String())
			}
		})
	}
}

// bankScript is bank.sh on the machine, its lock deploy.sh's, and its checkout a folder of the machine's (the git
// stub only says what it was asked, and fails: the test goes as far as the lock).
func (m *machine) bankScript() string {
	m.t.Helper()
	src, err := os.ReadFile("bank.sh")
	if err != nil {
		m.t.Fatal(err)
	}
	script := string(src)
	for key, path := range map[string]string{"lock": filepath.Join(m.root, "lock"), "repo": filepath.Join(m.root, "repo")} {
		re := regexp.MustCompile(`(?m)^` + key + `=.*$`)
		if n := len(re.FindAllString(script, -1)); n != 1 {
			m.t.Fatalf("bank.sh sets %s %d times, not once", key, n)
		}
		script = re.ReplaceAllLiteralString(script, key+"="+path)
	}
	m.write(filepath.Join(m.root, "stubs", "git"), "#!/bin/sh\n"+`echo "git $3" >>"$WORLD/log"; exit 1`+"\n", 0o755)
	path := filepath.Join(m.root, "bank.sh")
	m.write(path, script, 0o755)
	return path
}

// lockedBuffer is a script's output, read while it runs.
type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// A command run as a unit of its own and waited for (`systemd-run … --wait`) is collected when it ends: without
// --collect, one that fails stays in systemd as a failed unit until someone resets it (three did on the server, from
// ad-hoc runs of the lines the docs and skills give). So every such line the scripts, docs and skills give collects.
func TestTransientUnitsCollected(t *testing.T) {
	t.Parallel()
	var files []string
	for _, pattern := range []string{"*.sh", "../*.md", "../.claude/skills/*/*.md"} {
		found, err := filepath.Glob(pattern)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, found...)
	}
	waits := regexp.MustCompile("systemd-run\\s[^'`]*--wait")
	seen := 0
	for _, file := range files {
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for i, line := range strings.Split(string(src), "\n") {
			if !waits.MatchString(line) {
				continue
			}
			seen++
			if !strings.Contains(line, "--collect") {
				t.Errorf("%s:%d: systemd-run --wait without --collect: %s", file, i+1, strings.TrimSpace(line))
			}
		}
	}
	if seen < 4 {
		t.Fatalf("found %d systemd-run lines: has the search lost them?", seen)
	}
}
