// Package storetest gives a test a fresh database of its own, at the schema of today.
//
// Migrating from nothing is the slow part of opening a new database, many times over under the race detector (the
// SQLite driver is Go, so every statement of every migration is instrumented): with a database per test, that was
// most of the time the tests took. Here the migrations run once per test program, into a template that each test
// gets a copy of; store.Open on the copy finds nothing to apply.
package storetest

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/almanac-bg/almanac/internal/store"
)

var (
	once     sync.Once
	template []byte
	failed   error
)

// Open opens a new, empty database in the test's own temporary folder, migrated, and closes it when the test ends.
func Open(t testing.TB) *store.DB {
	t.Helper()
	once.Do(func() { template, failed = migrated() })
	if failed != nil {
		t.Fatal(failed)
	}
	path := filepath.Join(t.TempDir(), "game.db")
	if err := os.WriteFile(path, template, 0o600); err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// migrated is the file of a new database with every migration applied, its write-ahead log folded in.
func migrated() ([]byte, error) {
	dir, err := os.MkdirTemp("", "almanac-template-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "game.db")
	db, err := store.Open(path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Write.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		db.Close()
		return nil, err
	}
	if err := db.Close(); err != nil {
		return nil, err
	}
	return os.ReadFile(path)
}
