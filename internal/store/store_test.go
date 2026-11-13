package store

import (
	"database/sql"
	"fmt"
	"os"
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
	if _, err := db.Write.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Аз', 'az', 1, 1)`); err != nil {
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
		_, _ = tx.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('А', 'abc', 1, 1)`)
		_, err := tx.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Б', 'abc', 1, 1)`)
		return err // the same tag: refused, and the first insert goes too
	})
	var n int
	_ = db.Read.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
	if err == nil || n != 0 {
		t.Fatalf("err %v, %d users", err, n)
	}
}

// A migration that rebuilds a table keeps the rows that point to it.
func TestRebuildKeepsWhatPointsToIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	// Back to before the rebuild (0004), with a run, an answer and a challenge in it.
	db.Close()
	db = openAt(t, path, 3)
	for _, q := range []string{
		`INSERT INTO users (id, name, name_key, created_at, seen_at) VALUES (1, 'Аз', 'аз', 1, 1)`,
		`INSERT INTO runs (id, user_id, kind, category, questions, at, points, started_at, finished_at) VALUES (7, 1, 'topic', '', '[]', 1, 100, 1, 2)`,
		`INSERT INTO answers (run_id, n, question_id, score, points, is_right, ms, at) VALUES (7, 0, 'his-001', 1, 100, 1, 900, 2)`,
		`INSERT INTO challenges (code, run_id, created_at) VALUES ('abc234', 7, 3)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrateTo(4); err != nil {
		t.Fatal(err)
	}
	var answers, challenges int
	_ = db.Read.QueryRow(`SELECT count(*) FROM answers`).Scan(&answers)
	_ = db.Read.QueryRow(`SELECT count(*) FROM challenges`).Scan(&challenges)
	if answers != 1 || challenges != 1 {
		t.Fatalf("after the rebuild: %d answers, %d challenges", answers, challenges)
	}
	if _, err := db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at, opponent, recorded, outcome)
		VALUES (1, 'duel', '[]', 3, 'Бо', 1, 'won')`); err != nil {
		t.Fatalf("a duel: %v", err)
	}
	var fk int
	_ = db.Write.QueryRow(`PRAGMA foreign_keys`).Scan(&fk)
	if fk != 1 {
		t.Fatal("foreign keys stayed off")
	}
	// Challenges went later (0007): their links with them, and their runs stay, as games.
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	var runs int
	_ = db.Read.QueryRow(`SELECT count(*) FROM runs WHERE id = 7`).Scan(&runs)
	if _, err := db.Read.Exec(`SELECT count(*) FROM challenges`); err == nil || runs != 1 {
		t.Fatalf("after challenges went: table still there (%v), %d runs", err, runs)
	}
	// Deleting the run still takes its answers along: the reference survived the rebuild.
	_, _ = db.Write.Exec(`DELETE FROM runs WHERE id = 7`)
	_ = db.Read.QueryRow(`SELECT count(*) FROM answers`).Scan(&answers)
	if answers != 0 {
		t.Fatal("the answers' reference to runs didn't survive the rebuild")
	}
	db.Close()
}

// Tags (0009) rebuild users: everyone gets a tag, names may repeat, and what points to users stays.
func TestTagsKeepPlayers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db := openAt(t, path, 8)
	for _, q := range []string{
		`INSERT INTO users (id, name, name_key, email, created_at, seen_at, avatar) VALUES (1, 'Аз', 'аз', 'a@b.bg', 1, 1, 'moon-gold')`,
		`INSERT INTO users (id, name, name_key, created_at, seen_at) VALUES (2, 'Ти', 'ти', 1, 1)`,
		`INSERT INTO friends (user_id, friend_id, since) VALUES (1, 2, 5), (2, 1, 5)`,
		`INSERT INTO sessions (token_hash, user_id, created_at, seen_at, expires_at) VALUES (x'01', 1, 1, 1, 9)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	var tag, avatar, email string
	_ = db.Read.QueryRow(`SELECT tag, avatar, email FROM users WHERE id = 1`).Scan(&tag, &avatar, &email)
	if tag != "player1" || avatar != "moon-gold" || email != "a@b.bg" {
		t.Fatalf("after the rebuild: %q %q %q", tag, avatar, email)
	}
	if _, err := db.Write.Exec(`UPDATE users SET name = 'Аз' WHERE id = 2`); err != nil {
		t.Fatalf("two players named alike: %v", err)
	}
	// Deleting a player still takes their friendships and sessions along.
	_, _ = db.Write.Exec(`DELETE FROM users WHERE id = 1`)
	var friends, sessions int
	_ = db.Read.QueryRow(`SELECT count(*) FROM friends`).Scan(&friends)
	_ = db.Read.QueryRow(`SELECT count(*) FROM sessions`).Scan(&sessions)
	if friends != 0 || sessions != 0 {
		t.Fatalf("after deleting a player: %d friendships, %d sessions", friends, sessions)
	}
	db.Close()
}

// Роял (0011) rebuilds runs: their answers and the duels that point to them stay.
func TestRoyalKeepsRuns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db := openAt(t, path, 10)
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at) VALUES (1, 'Аз', 'az', 1, 1)`,
		`INSERT INTO runs (id, user_id, kind, questions, at, points, started_at, finished_at) VALUES (7, 1, 'duel', '[]', 1, 100, 1, 2)`,
		`INSERT INTO answers (run_id, n, question_id, score, points, is_right, ms, at) VALUES (7, 0, 'his-001', 1, 100, 1, 900, 2)`,
		`INSERT INTO duels (kind, questions, a_id, a_run, created_at, expires_at) VALUES ('open', '[]', 1, 7, 1, 9)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	var answers, duels int
	_ = db.Read.QueryRow(`SELECT count(*) FROM answers WHERE run_id = 7`).Scan(&answers)
	_ = db.Read.QueryRow(`SELECT count(*) FROM duels WHERE a_run = 7`).Scan(&duels)
	if answers != 1 || duels != 1 {
		t.Fatalf("after the rebuild: %d answers, %d duels", answers, duels)
	}
	if _, err := db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at) VALUES (1, 'royal', '[]', 3)`); err != nil {
		t.Fatalf("a Роял run: %v", err)
	}
	db.Close()
}

// openAt opens a new database migrated only up to migration n.
func openAt(t *testing.T, path string, n int) *DB {
	t.Helper()
	_ = os.Remove(path)
	_ = os.Remove(path + "-wal")
	_ = os.Remove(path + "-shm")
	w, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_txlock=immediate")
	if err != nil {
		t.Fatal(err)
	}
	w.SetMaxOpenConns(1)
	r, _ := sql.Open("sqlite", "file:"+path+"?mode=ro")
	db := &DB{Write: w, Read: r}
	if err := db.migrateTo(n); err != nil {
		t.Fatal(err)
	}
	return db
}

// Live duels (0017): open duels become live ones, those still waiting end without a result, and a recording stays
// only on the duels settled against it.
func TestLiveDuels(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db := openAt(t, path, 16)
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at) VALUES (1, 'Аз', 'az', 1, 1), (2, 'Бо', 'bo', 1, 1)`,
		`INSERT INTO runs (id, user_id, kind, questions, started_at) VALUES (7, 1, 'duel', '[]', 1), (8, 2, 'duel', '[]', 1)`,
		// waiting; taken and settled (it had a recording, unused); settled against its recording; a friend's
		`INSERT INTO duels (id, kind, questions, a_id, a_run, ghost_run, created_at, expires_at) VALUES (1, 'open', '[]', 1, 7, 8, 1, 9)`,
		`INSERT INTO duels (id, kind, questions, a_id, a_run, b_id, b_run, ghost_run, created_at, expires_at, ended_at, outcome)
			VALUES (2, 'open', '[]', 1, 7, 2, 8, 8, 1, 9, 5, 'a')`,
		`INSERT INTO duels (id, kind, questions, a_id, a_run, ghost_run, created_at, expires_at, ended_at, outcome)
			VALUES (3, 'open', '[]', 1, 7, 8, 1, 9, 5, 'ghost_won')`,
		`INSERT INTO duels (id, kind, questions, a_id, a_run, b_id, created_at, expires_at) VALUES (4, 'friend', '[]', 1, 7, 2, 1, 9)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	want := map[int64]string{1: "live expired 0 1", 2: "live a 0 1", 3: "live ghost_won 1 1", 4: "friend  0 1"}
	rows, err := db.Read.Query(`SELECT id, kind, coalesce(outcome, ''), ghost_run IS NOT NULL, rated FROM duels`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var kind, outcome string
		var ghost, rated int
		_ = rows.Scan(&id, &kind, &outcome, &ghost, &rated)
		if got := fmt.Sprintf("%s %s %d %d", kind, outcome, ghost, rated); got != want[id] {
			t.Fatalf("duel %d: %q, want %q", id, got, want[id])
		}
	}
	db.Close()
}
