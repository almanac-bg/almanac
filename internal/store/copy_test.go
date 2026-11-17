package store

import (
	"database/sql"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"testing/fstest"
	"time"
)

// A copy only before migrations, kept through a start that stopped midway, made again for a release deployed again
// after it went back, and never over the way back by a release that is live already.
func TestKeepCopy(t *testing.T) {
	defer func(m fs.FS) { migrations = m }(migrations)
	set := fstest.MapFS{
		"migrations/0001_t.sql": {Data: []byte(`CREATE TABLE t (x INTEGER);`)},
		"migrations/0002_u.sql": {Data: []byte(`CREATE TABLE u (x INTEGER);`)},
	}
	migrations = set
	dir := t.TempDir()
	path := filepath.Join(dir, "almanac.db")
	copied := filepath.Join(dir, "before-v1.1.0.db")
	keep := func(want bool) {
		t.Helper()
		if made, err := KeepCopy(path, "v1.1.0"); made != want || err != nil {
			t.Fatalf("KeepCopy: made %v (want %v), %v", made, want, err)
		}
	}
	rows := func(path string) int {
		t.Helper()
		db, err := sql.Open("sqlite", "file:"+path+"?mode=ro&immutable=1")
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		var n int
		if err := db.QueryRow(`SELECT count(*) FROM t`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	write := func(db *DB, x int) {
		t.Helper()
		if _, err := db.Write.Exec(`INSERT INTO t VALUES (?)`, x); err != nil {
			t.Fatal(err)
		}
	}

	keep(false) // no database yet
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	write(db, 1)
	keep(false) // nothing to migrate: no copy, and no wait for one
	if _, err := os.Stat(copied); err == nil {
		t.Fatal("a copy with nothing to migrate")
	}

	// A release with a migration: copied, the latest writes still in the log included.
	set["migrations/0003_v.sql"] = &fstest.MapFile{Data: []byte(`CREATE TABLE v (x INTEGER);`)}
	keep(true)
	if n := rows(copied); n != 1 {
		t.Fatalf("rows in the copy: %d", n)
	}

	// It went back, more was played, and it's deployed again: the old copy hasn't what was played since.
	write(db, 2)
	keep(true)
	if n := rows(copied); n != 2 {
		t.Fatalf("rows in the copy made again: %d", n)
	}

	// It migrated part of the way (0003), and stopped before 0004: the copy from before 0003 is still the way back.
	db.Close()
	if db, err = Open(path); err != nil {
		t.Fatal(err)
	}
	write(db, 3)
	set["migrations/0004_w.sql"] = &fstest.MapFile{Data: []byte(`CREATE TABLE w (x INTEGER);`)}
	keep(false)
	if n := rows(copied); n != 2 {
		t.Fatalf("the way back was changed: %d rows", n)
	}

	// Unless the copy is newer than those migrations: then it isn't from before them.
	later := time.Now().Add(time.Hour)
	_ = os.Chtimes(copied, later, later)
	keep(true)
	if n := rows(copied); n != 3 {
		t.Fatalf("rows in the copy made again: %d", n)
	}

	// The release live, deployed again: nothing to migrate, and its way back stays as it is.
	db.Close()
	if db, err = Open(path); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Stat(copied)
	keep(false)
	if after, _ := os.Stat(copied); !after.ModTime().Equal(before.ModTime()) {
		t.Fatal("the copy of a live release changed")
	}

	// No room for a copy and the migrations: an error, and nothing made.
	set["migrations/0005_x.sql"] = &fstest.MapFile{Data: []byte(`CREATE TABLE x (x INTEGER);`)}
	defer func(f func(string) (uint64, bool)) { spaceFree = f }(spaceFree)
	spaceFree = func(string) (uint64, bool) { return 1 << 10, true }
	if made, err := KeepCopy(path, "v1.2.0"); made || err == nil {
		t.Fatalf("with no room: made %v, %v", made, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "before-v1.2.0.db")); err == nil {
		t.Fatal("copied with no room")
	}
	spaceFree = func(string) (uint64, bool) { return 1 << 40, true }

	// The latest copies are kept.
	for i := range 6 {
		at := time.Now().Add(-time.Duration(6-i) * time.Minute)
		name := filepath.Join(dir, "before-v1.0."+strconv.Itoa(i)+".db")
		if err := os.WriteFile(name, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		_ = os.Chtimes(name, at, at)
	}
	_ = os.Chtimes(copied, time.Unix(0, 0), time.Unix(0, 0))
	if made, err := KeepCopy(path, "v1.2.0"); !made || err != nil {
		t.Fatalf("KeepCopy: %v %v", made, err)
	}
	left, _ := filepath.Glob(filepath.Join(dir, "before-v*.db"))
	want := []string{"before-v1.0.4.db", "before-v1.0.5.db", "before-v1.2.0.db"}
	for i := range want {
		want[i] = filepath.Join(dir, want[i])
	}
	if slices.Sort(left); !slices.Equal(left, want) {
		t.Fatalf("kept %v, want %v", left, want)
	}
}

// Every copy beside the database goes after a month, whoever made it; the database itself never.
func TestPruneCopies(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "almanac.db")
	old := time.Now().Add(-CopiesKept - time.Hour)
	for _, name := range []string{"almanac.db", "before-v1.0.0.db", "before-v1.0.0.db-wal", "pre-v0.9.db",
		"replaced-2026-10-01T000000Z.db", "restored.db", "rooms.json"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		_ = os.Chtimes(filepath.Join(dir, name), old, old)
	}
	if err := os.WriteFile(filepath.Join(dir, "replaced-new.db"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := PruneCopies(path); err != nil {
		t.Fatal(err)
	}
	var left []string
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		left = append(left, e.Name())
	}
	if want := []string{"almanac.db", "replaced-new.db", "rooms.json"}; !slices.Equal(left, want) {
		t.Fatalf("left %v, want %v", left, want)
	}
}
