// Package deploy holds the tests of the server's deploy scripts (deploy.sh, deploy-ci.sh): there's no Go here
// besides. deploy.sh runs against a machine made of stubs in a temporary directory (the server, systemd, curl, the
// clock), each of its ways through played out: the restart, going back, the marks, the checks of a release.
package deploy

import (
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
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
	rm -f "$W/crash-at"
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
	[ "$(cat "$W/behave-$r" 2>/dev/null)" != never ] || exit 7
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
	behave     string // healthy (""), never (doesn't come up), crash (comes up, stops after 30 s)
	migrates   bool   // its start copies the database and migrates it
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
	return fmt.Sprintf("#!/bin/sh\ncase $1 in\nversion) echo %s ;;\nmigrations) %s ;;\n*) exit 1 ;;\nesac\n", says, list)
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
		"signers": filepath.Join(root, "etc", "release-signers"), "lock": filepath.Join(root, "lock")}
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
	}
	if r.migrates {
		m.write(filepath.Join(m.world, "migrates-"+r.tag), "", 0o644)
	}
}

// deploy runs deploy.sh (as its own unit already), and says what it printed and how it ended.
func (m *machine) deploy(args ...string) (string, int) {
	m.t.Helper()
	os.Remove(filepath.Join(m.world, "log"))
	cmd := exec.Command("/bin/sh", append([]string{m.script}, args...)...)
	cmd.Env = append(os.Environ(), "PATH="+filepath.Join(m.root, "stubs")+":"+os.Getenv("PATH"), "WORLD="+m.world,
		"LINK="+m.link, "DATA="+m.data, "TMPDIR="+filepath.Join(m.root, "tmp"), "ALMANAC_DEPLOY_UNIT=1")
	out, err := cmd.CombinedOutput()
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
