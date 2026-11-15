package backup

import (
	"bytes"
	"compress/gzip"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// AWS's own example of a signed request ("Example: GET Object", Signature Version 4 for Amazon S3).
func TestSignsAsAWSDoes(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	req.Header.Set("Range", "bytes=0-9")
	sign(req, "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1", nil,
		time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC))
	want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
		"SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
		"Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if got := req.Header.Get("Authorization"); got != want {
		t.Fatalf("signed\n%s\nwant\n%s", got, want)
	}
}

// fakeStore keeps what's put in it, checking each request is signed.
type fakeStore struct {
	mu   sync.Mutex
	objs map[string][]byte
}

func (f *fakeStore) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=key/") {
		http.Error(w, "unsigned", http.StatusForbidden)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	switch r.Method {
	case http.MethodPut:
		body, _ := io.ReadAll(r.Body)
		f.objs[r.URL.Path] = body
	case http.MethodGet:
		body, ok := f.objs[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(body)
	}
}

// world is a game's database with a player, a day and a game in it, a bucket, and a heartbeat that counts its beats.
type world struct {
	dir   string
	db    *store.DB
	fake  *fakeStore
	store *Store
	beats *int
}

func newWorld(t *testing.T) *world {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	for _, q := range []string{
		`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Аз', 'az', 1, 1)`,
		`INSERT INTO days (day, questions) VALUES ('2026-11-15', '[]')`,
		`INSERT INTO runs (user_id, kind, day, questions, started_at) VALUES (1, 'day', '2026-11-15', '[]', 1)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	fake := &fakeStore{objs: map[string][]byte{}}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	return &world{dir: dir, db: db, fake: fake, beats: new(int),
		store: &Store{Endpoint: srv.URL, Bucket: "backups", AccessKey: "key", SecretKey: "secret", Region: "auto"}}
}

func (w *world) backer(t *testing.T, db *sql.DB) *Backer {
	beat := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { *w.beats++ }))
	t.Cleanup(beat.Close)
	return &Backer{Store: w.store, DB: db, Dir: w.dir, Heartbeat: beat.URL}
}

// put stores a file, gzipped, under key, as a copy would be.
func (w *world) put(t *testing.T, key string, file []byte) {
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	zw.Write(file)
	zw.Close()
	if err := w.store.Put(t.Context(), key, gz.Bytes()); err != nil {
		t.Fatal(err)
	}
}

func TestBackUpAndRestore(t *testing.T) {
	w := newWorld(t)
	dir, fake, s, beats := w.dir, w.fake, w.store, w.beats
	b := w.backer(t, w.db.Read)
	if err := b.Once(t.Context()); err != nil {
		t.Fatal(err)
	}
	keys := Keys(time.Now())
	for _, k := range keys {
		data := fake.objs["/backups/"+k]
		if _, err := gzip.NewReader(bytes.NewReader(data)); err != nil || len(data) == 0 {
			t.Fatalf("%s: %d bytes, %v", k, len(data), err)
		}
	}
	if *beats != 1 {
		t.Fatalf("%d heartbeats", *beats)
	}

	restored := filepath.Join(dir, "restored.db")
	if err := Restore(t.Context(), s, keys[0], restored); err != nil {
		t.Fatal(err)
	}
	if err := Restore(t.Context(), s, keys[0], restored); err == nil {
		t.Fatal("restored over a file that's there")
	}
	back, err := sql.Open("sqlite", "file:"+restored+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer back.Close()
	var name, check string
	if err := back.QueryRow(`SELECT name FROM users`).Scan(&name); err != nil || name != "Аз" {
		t.Fatalf("restored %q, %v", name, err)
	}
	if err := back.QueryRow(`PRAGMA integrity_check`).Scan(&check); err != nil || check != "ok" {
		t.Fatalf("integrity %q %v", check, err)
	}
}

// The day's copy just stored comes back whole, with its rows; nothing of the drill is left behind.
func TestTheDrillBringsTheDaysCopyBack(t *testing.T) {
	w := newWorld(t)
	b := w.backer(t, w.db.Read)
	now := time.Date(2026, 11, 15, drillHour, 5, 0, 0, time.UTC)
	if err := b.once(t.Context(), now); err != nil {
		t.Fatal(err)
	}
	if _, ok := w.fake.objs["/backups/days/15.db.gz"]; !ok {
		t.Fatalf("stored %v", w.fake.objs)
	}
	if err := b.Drill(t.Context(), now); err != nil {
		t.Fatal(err)
	}
	counts, err := Drill(t.Context(), w.store, "days/15.db.gz", w.dir)
	if err != nil {
		t.Fatal(err)
	}
	if counts["users"] != 1 || counts["days"] != 1 || counts["runs"] != 1 || counts["schema_migrations"] == 0 {
		t.Fatalf("rows %v", counts)
	}
	left, _ := filepath.Glob(filepath.Join(w.dir, "drill-*"))
	if len(left) > 0 {
		t.Fatalf("left behind %v", left)
	}
}

func TestTheDrillFails(t *testing.T) {
	w := newWorld(t)
	b := w.backer(t, w.db.Read)
	now := time.Date(2026, 11, 15, drillHour, 5, 0, 0, time.UTC)

	// No copy at all.
	if _, err := Drill(t.Context(), w.store, "days/15.db.gz", w.dir); !errors.Is(err, ErrMissing) {
		t.Fatalf("a missing copy: %v", err)
	}
	if err := b.Drill(t.Context(), now); err == nil || !strings.Contains(err.Error(), "days/15.db.gz") {
		t.Fatalf("a missing copy: %v", err)
	}

	// A copy cut short on its way.
	if err := b.once(t.Context(), now); err != nil {
		t.Fatal(err)
	}
	whole := w.fake.objs["/backups/days/15.db.gz"]
	w.fake.objs["/backups/days/15.db.gz"] = whole[:len(whole)/2]
	if _, err := Drill(t.Context(), w.store, "days/15.db.gz", w.dir); err == nil {
		t.Fatal("a cut copy passed")
	}

	// A copy whose pages are damaged.
	w.put(t, "days/15.db.gz", damaged(t))
	if _, err := Drill(t.Context(), w.store, "days/15.db.gz", w.dir); err == nil {
		t.Fatal("a damaged copy passed")
	}

	// A whole copy of a game with no games in it.
	if _, err := w.db.Write.Exec(`DELETE FROM runs`); err != nil {
		t.Fatal(err)
	}
	if err := b.once(t.Context(), now); err != nil {
		t.Fatal(err)
	}
	if _, err := Drill(t.Context(), w.store, "days/15.db.gz", w.dir); err == nil || !strings.Contains(err.Error(), "runs is empty") {
		t.Fatalf("an empty copy: %v", err)
	}
}

// A copy that isn't the game's is never sent: the good copies stay, and the heartbeat stays quiet.
func TestABadCopyIsNotSent(t *testing.T) {
	w := newWorld(t)
	other, err := sql.Open("sqlite", filepath.Join(w.dir, "other.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if _, err := other.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	b := w.backer(t, other)
	err = b.Once(t.Context())
	if err == nil || !strings.Contains(err.Error(), "damaged, not sent") {
		t.Fatalf("sent: %v", err)
	}
	if len(w.fake.objs) != 0 || *w.beats != 0 {
		t.Fatalf("stored %d, %d heartbeats", len(w.fake.objs), *w.beats)
	}
	left, _ := filepath.Glob(filepath.Join(w.dir, "snapshot-*"))
	if len(left) > 0 {
		t.Fatalf("left behind %v", left)
	}
}

func TestCheckFindsDamage(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "damaged.db")
	if err := os.WriteFile(path, damaged(t), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Check(t.Context(), path); err == nil {
		t.Fatal("damage not found")
	}
	if _, err := Check(t.Context(), filepath.Join(dir, "none.db")); err == nil {
		t.Fatal("a missing file passed")
	}
}

// damaged is a database file of the game whose index pages have been overwritten.
func damaged(t *testing.T) []byte {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Write.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
		INSERT INTO users (name, tag, created_at, seen_at) SELECT 'Играч', 'player' || i, 1, 1 FROM n`); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "copy.db")
	if _, err := db.Write.Exec(`VACUUM INTO ?`, path); err != nil {
		t.Fatal(err)
	}
	db.Close()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// Garble the second half of the file (past the schema on the first pages), a few bytes in every page.
	page := 4096
	for p := len(data) / page / 2; p < len(data)/page; p++ {
		for i := 100; i < 140; i++ {
			data[p*page+i] ^= 0x5a
		}
	}
	return data
}
