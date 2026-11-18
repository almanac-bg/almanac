package main

import (
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"filippo.io/age"

	"github.com/almanac-bg/almanac/internal/backup"
	"github.com/almanac-bg/almanac/internal/store"
)

// TestMain lets the test program be this one too, as a server's copy runs it (`almanac backup now -json`).
func TestMain(m *testing.M) {
	if os.Getenv("ALMANAC_TEST_AS_MAIN") == "1" {
		if err := run(os.Args[1:]); err != nil {
			fmt.Fprintln(os.Stderr, "almanac:", err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// bucket is a bucket in memory, enough for the copies.
type bucket struct {
	mu   sync.Mutex
	objs map[string][]byte
}

func (b *bucket) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b.mu.Lock()
	defer b.mu.Unlock()
	key := strings.TrimPrefix(r.URL.Path, "/backups/")
	switch {
	case r.Method == http.MethodPut:
		b.objs[key], _ = io.ReadAll(r.Body)
	case r.URL.Query().Get("list-type") == "2":
		fmt.Fprint(w, "<ListBucketResult>")
		for k, v := range b.objs {
			if strings.HasPrefix(k, r.URL.Query().Get("prefix")) {
				// Each a second apart, in the order of their names (which are times).
				at := time.Date(2026, 11, 17, 0, 0, 0, 0, time.UTC).Add(time.Duration(len(k)) * time.Second)
				if strings.HasPrefix(k, "hours/") || strings.HasPrefix(k, "days/") {
					at, _ = time.Parse("2006-01-02T150405Z", strings.TrimSuffix(strings.TrimSuffix(k[strings.Index(k, "/")+1:], ".age"), ".db.gz"))
				}
				_ = xml.NewEncoder(w).Encode(struct {
					XMLName      xml.Name `xml:"Contents"`
					Key          string
					Size         int
					LastModified time.Time
				}{Key: k, Size: len(v), LastModified: at})
			}
		}
		fmt.Fprint(w, "</ListBucketResult>")
	default:
		v, ok := b.objs[key]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(v)
	}
}

// The server's copies are made by this program as one of its own; what they made comes back, and what went wrong.
// One is put back in place of the database, with the key kept off the server.
func TestBackupsAside(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "almanac.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Аз', 'az', 1, 1)`,
		`INSERT INTO days (day, questions) VALUES ('2026-11-15', '[]')`,
		`INSERT INTO runs (user_id, kind, day, questions, started_at) VALUES (1, 'day', '2026-11-15', '[]', 1)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	b := &bucket{objs: map[string][]byte{}}
	srv := httptest.NewServer(b)
	defer srv.Close()
	for k, v := range map[string]string{"DB_PATH": path, "BACKUP_ENDPOINT": srv.URL, "BACKUP_BUCKET": "backups",
		"BACKUP_ACCESS_KEY": "key", "BACKUP_SECRET_KEY": "secret", "BACKUP_RECIPIENT": ""} {
		t.Setenv(k, v)
	}
	self = func() (string, error) { return os.Args[0], nil }
	selfEnv = []string{"ALMANAC_TEST_AS_MAIN=1"}
	t.Cleanup(func() { self, selfEnv = os.Executable, nil })

	// No key: the copy goes all the same, unencrypted, and that's said.
	r, err := backupAside(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if r.Encrypted || !r.Drilled || len(r.Keys) != 2 || len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "unencrypted") {
		t.Fatalf("%+v", r)
	}

	// With one, encrypted; the day's copy is made already.
	secret, recipient, err := newKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("BACKUP_RECIPIENT", recipient)
	time.Sleep(time.Second) // a new name
	if r, err = backupAside(t.Context()); err != nil {
		t.Fatal(err)
	}
	if !r.Encrypted || r.Drilled || len(r.Keys) != 1 || len(r.Warnings) != 0 {
		t.Fatalf("%+v", r)
	}

	// The program gone from under the server: the copy is made in the server.
	self = func() (string, error) { return "", os.ErrNotExist }
	time.Sleep(time.Second)
	if r, err = backupAside(t.Context()); err != nil || !r.Encrypted || len(r.Keys) != 1 {
		t.Fatalf("%+v %v", r, err)
	}
	self = func() (string, error) { return os.Args[0], nil }

	// What went wrong is the error.
	t.Setenv("DB_PATH", filepath.Join(dir, "none.db"))
	if _, err := backupAside(t.Context()); err == nil || !strings.HasPrefix(err.Error(), "no database to copy") {
		t.Fatalf("%v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "none.db")); err == nil {
		t.Fatal("made a database")
	}
	t.Setenv("DB_PATH", path)

	// Back in place: the newest copy, opened with the key; the database it replaces is kept aside.
	if _, err := db.Write.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Ти', 'ti', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	ids, err := age.ParseIdentities(strings.NewReader(secret))
	if err != nil {
		t.Fatal(err)
	}
	s, _ := backupStore()
	key, err := resolveKey(t.Context(), s, "latest", "")
	if err != nil || !strings.HasSuffix(key, ".age") {
		t.Fatalf("latest %q %v", key, err)
	}
	if err := restoreInPlace(t.Context(), s, key, path, backup.Opening{}, key); err == nil {
		t.Fatal("opened without the key")
	}
	if err := restoreInPlace(t.Context(), s, key, path, backup.Opening{IDs: ids}, "latest"); err == nil {
		t.Fatal("put in place without its key typed back")
	}
	if _, err := os.Stat(path + ".restoring"); err == nil {
		t.Fatal("left the copy beside it")
	}
	if err := restoreInPlace(t.Context(), s, key, path, backup.Opening{IDs: ids}, key); err != nil {
		t.Fatal(err)
	}
	back, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer back.Close()
	var n int
	if err := back.Read.QueryRow(`SELECT count(*) FROM users`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("players %d %v", n, err)
	}
	if kept, _ := filepath.Glob(filepath.Join(dir, "replaced-*.db")); len(kept) != 1 {
		t.Fatalf("kept %v", kept)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "almanac.db.*")); len(left) > 0 {
		t.Fatalf("left %v", left)
	}
}

func newKeyPair() (secret, recipient string, err error) {
	id, err := age.GenerateHybridIdentity()
	if err != nil {
		return "", "", err
	}
	return id.String(), id.Recipient().String(), nil
}

func TestLastLine(t *testing.T) {
	var l lastLine
	fmt.Fprint(&l, "{\"level\":\"INFO\"}\nalmanac: it went")
	fmt.Fprint(&l, " wrong\n\n")
	if got := l.String(); got != "almanac: it went wrong" {
		t.Fatalf("%q", got)
	}
}
