package store

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenMigratesAndReopens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Write.Exec(`INSERT INTO users (name, name_key, created_at, seen_at) VALUES ('Аз', 'аз', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	var name, mode string
	if err := db.Read.QueryRow(`SELECT name FROM users`).Scan(&name); err != nil || name != "Аз" {
		t.Fatalf("read %q, %v", name, err)
	}
	if err := db.Read.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil || mode != "wal" {
		t.Fatalf("journal mode %q, %v", mode, err)
	}
	// Reads can't write.
	if _, err := db.Read.Exec(`DELETE FROM users`); err == nil {
		t.Fatal("a write went through the read pool")
	}
	db.Close()

	// Opening again applies nothing twice.
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var n int
	_ = db.Read.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d users after reopening", n)
	}
}

func TestRefusesNewerDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = db.Write.Exec(`PRAGMA user_version = 9999`)
	db.Close()
	if _, err := Open(path); err == nil || !strings.Contains(err.Error(), "newer than this program") {
		t.Fatalf("opened a newer database: %v", err)
	}
}

func TestTxRollsBack(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	err = db.Tx(t.Context(), func(tx *sql.Tx) error {
		_, _ = tx.Exec(`INSERT INTO users (name, name_key, created_at, seen_at) VALUES ('А', 'а', 1, 1)`)
		_, err := tx.Exec(`INSERT INTO users (name, name_key, created_at, seen_at) VALUES ('а', 'а', 1, 1)`)
		return err // the same name: refused, and the first insert goes too
	})
	var n int
	_ = db.Read.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
	if err == nil || n != 0 {
		t.Fatalf("err %v, %d users", err, n)
	}
}
