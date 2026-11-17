package store

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestKeepCopy(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "almanac.db")
	if made, err := KeepCopy(path, "v1.0.0"); made || err != nil {
		t.Fatalf("with no database: %v %v", made, err)
	}
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Write.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Ана', 'ana', 0, 0)`); err != nil {
		t.Fatal(err)
	}
	// While the database is open, its latest writes still in the log: the copy has them.
	if made, err := KeepCopy(path, "v1.0.0"); !made || err != nil {
		t.Fatalf("the first copy: %v %v", made, err)
	}
	cp, err := Open(filepath.Join(dir, "before-v1.0.0.db"))
	if err != nil {
		t.Fatal(err)
	}
	var n int
	_ = cp.Read.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
	cp.Close()
	if n != 1 {
		t.Fatalf("players in the copy: %d", n)
	}
	if made, _ := KeepCopy(path, "v1.0.0"); made {
		t.Fatal("copied again for the same version")
	}

	// The latest are kept.
	_ = os.Chtimes(filepath.Join(dir, "before-v1.0.0.db"), time.Unix(0, 0), time.Unix(0, 0))
	for i := range 12 {
		v := "v1.1." + string(rune('a'+i))
		if _, err := KeepCopy(path, v); err != nil {
			t.Fatal(err)
		}
		at := time.Now().Add(-time.Duration(12-i) * time.Minute)
		_ = os.Chtimes(filepath.Join(dir, "before-"+v+".db"), at, at)
	}
	if _, err := KeepCopy(path, "v2.0.0"); err != nil {
		t.Fatal(err)
	}
	left, _ := filepath.Glob(filepath.Join(dir, "before-v*.db"))
	if len(left) != KeptCopies {
		t.Fatalf("%d copies kept", len(left))
	}
	for _, kept := range []string{"v2.0.0", "v1.1.l", "v1.1.k"} {
		if _, err := os.Stat(filepath.Join(dir, "before-"+kept+".db")); err != nil {
			t.Fatalf("%s not kept", kept)
		}
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
