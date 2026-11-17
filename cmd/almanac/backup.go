package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	"filippo.io/age"

	"github.com/almanac-bg/almanac/internal/backup"
	"github.com/almanac-bg/almanac/internal/server"
)

// backupStore is the bucket the environment names (BACKUP_ENDPOINT, BACKUP_BUCKET, BACKUP_ACCESS_KEY,
// BACKUP_SECRET_KEY), or nil if it names none.
func backupStore() (*backup.Store, error) {
	s := &backup.Store{
		Endpoint:  os.Getenv("BACKUP_ENDPOINT"),
		Bucket:    os.Getenv("BACKUP_BUCKET"),
		AccessKey: os.Getenv("BACKUP_ACCESS_KEY"),
		SecretKey: os.Getenv("BACKUP_SECRET_KEY"),
		Region:    "auto",
	}
	if s.Endpoint == "" {
		return nil, nil
	}
	if s.Bucket == "" || s.AccessKey == "" || s.SecretKey == "" {
		return nil, errors.New("BACKUP_ENDPOINT needs BACKUP_BUCKET, BACKUP_ACCESS_KEY and BACKUP_SECRET_KEY too")
	}
	return s, nil
}

// backupRecipients are whom the copies are encrypted to (BACKUP_RECIPIENT), and what's wrong if they go unencrypted
// ("": nothing). A missing or broken recipient never stops the copies: they go unencrypted, and that's a problem told.
func backupRecipients() ([]age.Recipient, string) {
	v := os.Getenv("BACKUP_RECIPIENT")
	if strings.TrimSpace(v) == "" {
		return nil, "the copies go unencrypted: no BACKUP_RECIPIENT (README: Резервни копия)"
	}
	rs, err := backup.Recipients(v)
	if err != nil {
		return nil, "the copies go unencrypted: " + err.Error()
	}
	return rs, ""
}

// backupCommand runs `almanac backup …`:
//
//	now [-force] [-json]     make a copy at once (the server makes each of its own so too, -json)
//	list                     the copies, newest first
//	restore [-identity F] [-into-place] <key|latest> [path]   write a copy to a new database file and check it; or
//	                         put it in place of the game's database (DB_PATH), with the game stopped
//	verify [-identity F] [key|latest]  bring a copy back and check it (the latest day's, if no key is given)
//	keys                     make the key pair that encrypts the copies (BACKUP_RECIPIENT) and opens them (kept off
//	                         the server)
//
// -identity names a file with the key that opens encrypted copies ("-": read it from the input, so it's never on the
// server's disk).
func backupCommand(args []string) error {
	if len(args) == 0 {
		return usage()
	}
	if args[0] == "keys" && len(args) == 1 {
		secret, recipient, err := backup.NewKeys()
		if err != nil {
			return err
		}
		fmt.Printf("# The key that opens the copies. Keep it off the server (in a password manager), and never lose it:\n"+
			"# without it no copy can be opened.\n%s\n\n# For the server's settings (/etc/almanac/env):\nBACKUP_RECIPIENT=%s\n", secret, recipient)
		return nil
	}
	s, err := backupStore()
	if err != nil {
		return err
	}
	if s == nil {
		return errors.New("no backups configured (BACKUP_ENDPOINT)")
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	fs := flag.NewFlagSet("backup "+args[0], flag.ContinueOnError)
	force := fs.Bool("force", false, "send a copy even of a database with an empty core table")
	asJSON := fs.Bool("json", false, "log as JSON, and say what was made as JSON (for the server)")
	identity := fs.String("identity", "", "the file with the key that opens encrypted copies (-: read from the input)")
	inPlace := fs.Bool("into-place", false, "put the copy in place of the game's database (the game stopped)")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	rest := fs.Args()
	ids, err := identities(*identity)
	if err != nil {
		return err
	}
	switch {
	case args[0] == "now" && len(rest) == 0:
		return backupNow(ctx, s, *force, *asJSON)
	case args[0] == "list" && len(rest) == 0:
		return listBackups(ctx, s)
	case args[0] == "restore" && *inPlace && len(rest) == 1:
		key, err := resolveKey(ctx, s, rest[0], "")
		if err != nil {
			return err
		}
		return restoreInPlace(ctx, s, key, dbPath(), ids)
	case args[0] == "restore" && !*inPlace && len(rest) == 2:
		key, err := resolveKey(ctx, s, rest[0], "")
		if err != nil {
			return err
		}
		if err := backup.Restore(ctx, s, key, rest[1], ids...); err != nil {
			return err
		}
		counts, err := backup.Check(ctx, rest[1])
		if err != nil {
			return fmt.Errorf("restored %s to %s, but the copy is damaged: %w", key, rest[1], err)
		}
		printCounts(key+" restored to "+rest[1]+" and whole", counts)
		return nil
	case args[0] == "verify" && len(rest) <= 1:
		key := "latest"
		if len(rest) == 1 {
			key = rest[0]
		}
		return verifyBackup(ctx, s, key, ids)
	}
	return usage()
}

// identities reads the keys that open encrypted copies from the file at path ("-": the input; "": none).
func identities(path string) ([]age.Identity, error) {
	switch path {
	case "":
		return nil, nil
	case "-":
		return backup.Identities(os.Stdin)
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return backup.Identities(f)
}

// resolveKey is key, or the newest copy under prefix if key is "latest".
func resolveKey(ctx context.Context, s *backup.Store, key, prefix string) (string, error) {
	if key != "latest" {
		return key, nil
	}
	return backup.Latest(ctx, s, prefix)
}

// backupNow makes a copy (makeBackup) and says what it made: as JSON for the server that runs it, else in words.
func backupNow(ctx context.Context, s *backup.Store, force, asJSON bool) error {
	if asJSON {
		slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	}
	r, err := makeBackup(ctx, s, force)
	if err != nil {
		return err
	}
	if asJSON {
		return json.NewEncoder(os.Stdout).Encode(r)
	}
	fmt.Printf("backed up: %s (%s%s)\n", strings.Join(r.Keys, ", "), size(r.Bytes), map[bool]string{true: ", encrypted", false: ", unencrypted"}[r.Encrypted])
	if r.Drilled {
		fmt.Println("the day's copy brought back and whole")
	}
	for _, w := range r.Warnings {
		fmt.Println("but:", w)
	}
	return nil
}

// makeBackup makes a copy of the database at DB_PATH, read-only: a path with no database is an error, never a new
// empty one.
func makeBackup(ctx context.Context, s *backup.Store, force bool) (*backup.Report, error) {
	path := dbPath()
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("no database to copy: %w", err)
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	defer db.Close()
	recipients, unencrypted := backupRecipients()
	b := &backup.Backer{Store: s, DB: db, Dir: filepath.Dir(path), Recipients: recipients, Force: force}
	r, err := b.Once(ctx)
	if err != nil {
		return nil, err
	}
	if unencrypted != "" {
		r.Warnings = append(r.Warnings, unencrypted)
	}
	return r, nil
}

// runBackups makes the server's hourly copies (backup.Run), each by this program as one of its own (`backup now`),
// at a lower priority than the game's: a copy never takes the processor from play, and its memory is never the game's.
// What goes wrong is a problem told (its mail once a day); the heartbeat (BACKUP_HEARTBEAT) is fetched after each copy
// that made it.
func runBackups(ctx context.Context, srv *server.Server) {
	heartbeat := os.Getenv("BACKUP_HEARTBEAT")
	backup.Run(ctx, filepath.Dir(dbPath()), func(ctx context.Context) error {
		r, err := backupAside(ctx)
		if err != nil {
			if ctx.Err() == nil {
				// The error carries the child's own words; kept on one line (the JSON log escapes it anyway).
				msg := strings.ReplaceAll(strings.ReplaceAll(err.Error(), "\r", " "), "\n", " ")
				slog.Error("backup", "err", msg)
				srv.Problem("backup: " + msg)
			}
			return err
		}
		slog.Info("backed up", "keys", r.Keys, "bytes", r.Bytes, "encrypted", r.Encrypted, "drilled", r.Drilled)
		for _, w := range r.Warnings {
			slog.Warn("backup", "problem", w)
			srv.Problem("backup: " + w)
		}
		if heartbeat != "" {
			beat(ctx, heartbeat)
		}
		return nil
	})
}

// self is this program, and what it needs in its environment besides the server's (tests).
var (
	self    = os.Executable
	selfEnv []string
)

// backupAside runs `almanac backup now -json` as a process of its own, at a lower priority, and returns what it made.
// If it can't be started apart, it's started as it can; if not at all (the program gone from under the server), the
// copy is made in the server itself: a copy that costs the game something is better than none.
func backupAside(ctx context.Context) (*backup.Report, error) {
	exe, err := self()
	var cmd *exec.Cmd
	var out bytes.Buffer
	last := &lastLine{}
	start := func(apart bool) error {
		cmd = exec.CommandContext(ctx, exe, "backup", "now", "-json")
		cmd.Env = append(os.Environ(), selfEnv...)
		cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) } // it removes its files as it goes
		cmd.WaitDelay = 30 * time.Second
		cmd.Stdout = &out
		cmd.Stderr = io.MultiWriter(os.Stderr, last) // its log is the server's
		if apart {
			aside(cmd)
		}
		return cmd.Start()
	}
	apart := err == nil
	if apart {
		if err = start(true); err != nil {
			slog.Warn("backup: not started apart", "err", err)
			apart, err = false, start(false)
		}
	}
	if err != nil {
		slog.Warn("backup: not started as a program of its own, so made in the server", "err", err)
		s, err := backupStore()
		if err != nil {
			return nil, err
		}
		return makeBackup(ctx, s, false)
	}
	if apart {
		lower(cmd.Process.Pid)
	}
	if err := cmd.Wait(); err != nil {
		if msg := strings.TrimPrefix(last.String(), "almanac: "); msg != "" {
			return nil, errors.New(msg)
		}
		return nil, err
	}
	var r backup.Report
	if err := json.Unmarshal(out.Bytes(), &r); err != nil {
		return nil, fmt.Errorf("what the copy made: %w", err)
	}
	return &r, nil
}

// lastLine keeps the last line written to it (a program's error, as main prints it).
type lastLine struct {
	mu   sync.Mutex
	line []byte
	cur  []byte
}

func (l *lastLine) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, c := range p {
		if c == '\n' {
			if len(bytes.TrimSpace(l.cur)) > 0 {
				l.line = append(l.line[:0], l.cur...)
			}
			l.cur = l.cur[:0]
		} else if len(l.cur) < 4096 {
			l.cur = append(l.cur, c)
		}
	}
	return len(p), nil
}

func (l *lastLine) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(bytes.TrimSpace(l.cur)) > 0 {
		return string(bytes.TrimSpace(l.cur))
	}
	return string(bytes.TrimSpace(l.line))
}

// beat fetches the heartbeat's URL: a monitor that hears nothing for a while says so.
func beat(ctx context.Context, url string) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil); err == nil {
		if res, err := http.DefaultClient.Do(req); err == nil {
			res.Body.Close()
		}
	}
}

// listBackups prints the copies in the bucket, newest first.
func listBackups(ctx context.Context, s *backup.Store) error {
	objs, err := s.List(ctx, "")
	if err != nil {
		return err
	}
	for _, o := range objs {
		kind := "unencrypted"
		if strings.HasSuffix(o.Key, ".age") {
			kind = "encrypted"
		}
		fmt.Printf("%s  %9s  %-11s  %s\n", o.Modified.UTC().Format("2006-01-02 15:04 UTC"), size(o.Size), kind, o.Key)
	}
	if len(objs) == 0 {
		fmt.Println("no copies")
	}
	return nil
}

// verifyBackup brings back the copy under key ("latest": the newest under days/) and checks it. An encrypted copy is
// opened with ids; without them, it's checked as far as it can be without its key: stored whole, as it was sent.
func verifyBackup(ctx context.Context, s *backup.Store, key string, ids []age.Identity) error {
	key, err := resolveKey(ctx, s, key, "days/")
	if err != nil {
		return err
	}
	tmp := os.TempDir()
	if dir := filepath.Dir(dbPath()); dirExists(dir) {
		tmp = dir // where there's room for a database
	}
	counts, err := backup.Drill(ctx, s, key, tmp, ids...)
	if errors.Is(err, backup.ErrEncrypted) {
		st, err := backup.Intact(ctx, s, key)
		if err != nil {
			return fmt.Errorf("%s: %w", key, err)
		}
		fmt.Printf("%s: encrypted, stored whole as it was sent (%s; rows then: %s).\n"+
			"To open it and check the database itself, run this where its key is (off the server): backup verify -identity <file> %s\n",
			key, size(st.Bytes), st.Rows, key)
		return nil
	}
	if err != nil {
		return fmt.Errorf("%s: %w", key, err)
	}
	printCounts(key+" brought back and whole", counts)
	return nil
}

// restoreInPlace puts the copy under key in place of the game's database at path, with the game stopped: brought
// back beside it and checked first, owned as the directory is (when root restores it), and swapped in at once. The
// database it replaces is kept beside it (replaced-<when>.db, with its log), in case the copy was the wrong one; the
// old one's shared memory goes, as it would corrupt the copy.
func restoreInPlace(ctx context.Context, s *backup.Store, key, path string, ids []age.Identity) error {
	if err := gameStopped(); err != nil {
		return err
	}
	dir := filepath.Dir(path)
	tmp := path + ".restoring"
	os.Remove(tmp)
	if err := backup.Restore(ctx, s, key, tmp, ids...); err != nil {
		return err
	}
	counts, err := backup.Check(ctx, tmp)
	if err != nil {
		os.Remove(tmp)
		return fmt.Errorf("%s came back damaged, and the database is as it was: %w", key, err)
	}
	if err := ownAs(tmp, dir); err != nil {
		os.Remove(tmp)
		return err
	}
	if _, err := os.Stat(path); err == nil {
		kept := filepath.Join(dir, "replaced-"+time.Now().UTC().Format("2006-01-02T150405Z")+".db")
		if err := os.Rename(path, kept); err != nil {
			os.Remove(tmp)
			return err
		}
		if err := os.Rename(path+"-wal", kept+"-wal"); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		fmt.Println("the database it replaces is kept as", kept)
	}
	for _, f := range []string{path + "-wal", path + "-shm"} {
		if err := os.Remove(f); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	printCounts(key+" restored in place of "+path+" and whole", counts)
	fmt.Println("start the game: systemctl start almanac.socket almanac")
	return nil
}

// gameStopped says whether the game is stopped, where systemd runs it: a database swapped under a running server
// would be lost, or worse.
func gameStopped() error {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return nil
	}
	for _, unit := range []string{"almanac.socket", "almanac.service"} {
		if exec.Command("systemctl", "is-active", "--quiet", unit).Run() == nil {
			return errors.New("the game is running: systemctl stop almanac.socket almanac first")
		}
	}
	return nil
}

func dirExists(dir string) bool {
	fi, err := os.Stat(dir)
	return err == nil && fi.IsDir()
}

func size(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f kB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}

func printCounts(what string, counts map[string]int64) {
	fmt.Println(what + ":")
	for _, t := range slices.Sorted(maps.Keys(counts)) {
		fmt.Printf("  %-18s %d rows\n", t, counts[t])
	}
}

func dbPath() string {
	if p := os.Getenv("DB_PATH"); p != "" {
		return p
	}
	return "almanac.db"
}
