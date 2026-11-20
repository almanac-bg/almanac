package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
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
	_, _ = db.Write.Exec(`INSERT INTO schema_migrations (name, applied_at) VALUES ('9999_from_the_future.sql', 1)`)
	db.Close()
	if _, err := Open(path); err == nil || !strings.Contains(err.Error(), "newer than this program") {
		t.Fatalf("opened a newer database: %v", err)
	}
}

// A database migrated before names were kept (only user_version counts it) takes the names of the migrations it has,
// and gets the rest.
func TestNamesForACountedDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db := openAt(t, path, 5)
	if _, err := db.Write.Exec(`DROP TABLE schema_migrations`); err != nil {
		t.Fatal(err)
	}
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	var count, version int
	_ = db.Read.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&count)
	_ = db.Read.QueryRow(`PRAGMA user_version`).Scan(&version)
	files, _ := fs.Glob(migrations, "migrations/*.sql")
	if count != len(files) || version != len(files) {
		t.Fatalf("%d names, version %d, %d migrations", count, version, len(files))
	}
	db.Close()

	// Counted past what this program has: a newer database, refused.
	db = openAt(t, path, 0)
	_, _ = db.Write.Exec(`DROP TABLE schema_migrations`)
	_, _ = db.Write.Exec(`PRAGMA user_version = 9999`)
	db.Close()
	if _, err := Open(path); err == nil || !strings.Contains(err.Error(), "newer than this program") {
		t.Fatalf("opened a newer counted database: %v", err)
	}
}

// Two changes made side by side may both add a migration with the same number: each is applied once, whichever lands
// first, and one that lands later with a lower name than the others is applied then.
func TestMigrationsWithTheSameNumber(t *testing.T) {
	defer func(m fs.FS) { migrations = m }(migrations)
	set := fstest.MapFS{
		"migrations/0001_a.sql": {Data: []byte(`CREATE TABLE a (x INTEGER);`)},
		"migrations/0002_b.sql": {Data: []byte(`CREATE TABLE b (x INTEGER);`)},
	}
	migrations = set
	db, err := Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	set["migrations/0002_c.sql"] = &fstest.MapFile{Data: []byte(`CREATE TABLE c (x INTEGER);`)}
	set["migrations/0003_d.sql"] = &fstest.MapFile{Data: []byte(`CREATE TABLE d (x INTEGER);`)}
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	set["migrations/0002_bb.sql"] = &fstest.MapFile{Data: []byte(`CREATE TABLE bb (x INTEGER);`)}
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"a", "b", "bb", "c", "d"} {
		if _, err := db.Write.Exec(`INSERT INTO ` + table + ` (x) VALUES (1)`); err != nil {
			t.Fatalf("table %s: %v", table, err)
		}
	}
	set["migrations/bad.sql"] = &fstest.MapFile{Data: []byte(`SELECT 1;`)}
	if err := db.migrate(); err == nil {
		t.Fatal("took a migration without a number")
	}
}

// A burst of reads keeps its connections for the next one: none closed for want of room among the idle, none opened
// anew (opening one reads the whole schema).
func TestReadsKeepTheirConnections(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	readers := db.Read.Stats().MaxOpenConnections
	burst := func() {
		var held, done sync.WaitGroup
		held.Add(readers)
		done.Add(readers)
		for range readers {
			go func() {
				defer done.Done()
				rows, err := db.Read.Query(`SELECT name FROM sqlite_schema`)
				held.Done()
				if err != nil {
					t.Error(err)
					return
				}
				held.Wait() // every connection taken at once
				rows.Close()
			}()
		}
		done.Wait()
	}
	burst()
	opened := db.Read.Stats().OpenConnections
	for range 3 {
		burst()
	}
	if s := db.Read.Stats(); s.MaxIdleClosed != 0 || s.OpenConnections != opened || opened != readers {
		t.Fatalf("after four bursts of %d reads: %d open (%d after the first), %d closed as idle", readers,
			s.OpenConnections, opened, s.MaxIdleClosed)
	}
}

// The read pool is about as big as the cores, not a multiple of them (the driver's allocator is one lock); the long
// reads over a whole table have a pool of their own, read-only too.
func TestPools(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if n := db.Read.Stats().MaxOpenConnections; n != max(4, runtime.NumCPU()+2) {
		t.Fatalf("%d readers on %d cores", n, runtime.NumCPU())
	}
	if n := db.Scan.Stats().MaxOpenConnections; n != scanners || db.Scan == db.Read {
		t.Fatalf("%d for the long reads", n)
	}
	if _, err := db.Scan.Exec(`CREATE TABLE t (x INTEGER)`); err == nil {
		t.Fatal("the long reads' pool writes")
	}
}

// A database played on but never analysed has the tables' statistics once it's opened.
func TestOpenAnalyses(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db := openAt(t, path, -1)
	if _, err := db.Write.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000)
		INSERT INTO users (name, tag, created_at, seen_at) SELECT 'И', 't' || i, 1, 1 FROM n`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var stat string
	if err := db.Read.QueryRow(`SELECT stat FROM sqlite_stat1 WHERE tbl = 'users' AND idx = 'sqlite_autoindex_users_1'`).
		Scan(&stat); err != nil || !strings.HasPrefix(stat, "1000 ") {
		t.Fatalf("users' statistics: %q, %v", stat, err)
	}
}

// Every column that points to another table's rows has an index that starts with it (one of only the rows where it's
// set will do): deleting a row there, or a guest's merge, looks for what points to it, and without one reads the
// whole table, in the one write transaction.
func TestForeignKeysIndexed(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.Read.Query(`
		WITH fk AS (SELECT m.name t, f."from" c FROM sqlite_schema m, pragma_foreign_key_list(m.name) f
				WHERE m.type = 'table'),
			lead AS (SELECT m.name t, i.name c FROM sqlite_schema m, pragma_index_list(m.name) l, pragma_index_info(l.name) i
				LEFT JOIN sqlite_schema s ON s.name = l.name
				WHERE m.type = 'table' AND i.seqno = 0 AND (NOT l.partial OR s.sql LIKE '% WHERE ' || i.name || ' IS NOT NULL')
			UNION ALL SELECT m.name, p.name FROM sqlite_schema m, pragma_table_info(m.name) p WHERE m.type = 'table' AND p.pk = 1)
		SELECT DISTINCT fk.t || '.' || fk.c FROM fk WHERE NOT EXISTS (SELECT 1 FROM lead WHERE lead.t = fk.t AND lead.c = fk.c)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			t.Fatal(err)
		}
		t.Errorf("%s points to another table's rows and no index starts with it", col)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
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

// A transaction whose context ends midway (the player went away) says so, not that it's been rolled back twice.
func TestTxWithAnEndedContext(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithCancel(t.Context())
	err = db.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('А', 'abc', 1, 1)`); err != nil {
			return err
		}
		cancel()
		time.Sleep(10 * time.Millisecond) // database/sql rolls it back as the context ends
		_, err := tx.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Б', 'abd', 1, 1)`)
		return err
	})
	var n int
	_ = db.Read.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
	if !errors.Is(err, context.Canceled) || strings.Contains(err.Error(), "already been committed") || n != 0 {
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
	// Those challenges went later (0007): their links with them, and their runs stay, as games. (Challenges came back
	// in 0048, another table.)
	if err := db.migrateTo(7); err != nil {
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
	if tag != "player1" || avatar != "dog-gold" || email != "a@b.bg" { // the moon is drawn as a dog since 0023
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
	if err := db.migrateTo(migrationsThrough("0011_royal.sql")); err != nil {
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

// The avatars drawn anew (0023): the old free shapes become animals and the eye an owl, in the same tone; the rest
// stay as they were.
func TestAvatarsDrawnAnew(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db := openAt(t, path, 22)
	_, err := db.Write.Exec(`INSERT INTO users (id, name, tag, created_at, seen_at, avatar) VALUES
		(1, 'А', 'a', 1, 1, 'petal-gold'), (2, 'Б', 'b', 1, 1, 'eye-rose'), (3, 'В', 'c', 1, 1, 'star-sky'),
		(4, 'Г', 'd', 1, 1, NULL), (5, 'Д', 'e', 1, 1, 'hex-mint')`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	want := map[int]string{1: "fox-gold", 2: "owl-rose", 3: "star-sky", 4: "", 5: "frog-mint"}
	for id, w := range want {
		var got sql.NullString
		_ = db.Read.QueryRow(`SELECT avatar FROM users WHERE id = ?`, id).Scan(&got)
		if got.String != w {
			t.Errorf("player %d: %q, want %q", id, got.String, w)
		}
	}
	db.Close()
}

// The avatars as before (0024): the emblems and animals added by mistake go back to their family's emblem and to the
// animal the game gives; the rest stay.
func TestAvatarsAsBefore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db := openAt(t, path, 23)
	_, err := db.Write.Exec(`INSERT INTO users (id, name, tag, created_at, seen_at, avatar) VALUES
		(1, 'А', 'a', 1, 1, 'phoenix-gold'), (2, 'Б', 'b', 1, 1, 'knight-rose'), (3, 'В', 'c', 1, 1, 'squirrel-sky'),
		(4, 'Г', 'd', 1, 1, 'fox-mint'), (5, 'Д', 'e', 1, 1, 'owl-lilac'), (6, 'Е', 'f', 1, 1, 'wreath-sky')`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	want := map[int]string{1: "flame-gold", 2: "heart-rose", 3: "", 4: "fox-mint", 5: "owl-lilac", 6: "trophy-sky"}
	for id, w := range want {
		var got sql.NullString
		_ = db.Read.QueryRow(`SELECT avatar FROM users WHERE id = ?`, id).Scan(&got)
		if got.String != w {
			t.Errorf("player %d: %q, want %q", id, got.String, w)
		}
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

// Live duels (0020): open duels become live ones, those still waiting end without a result, and a recording stays
// only on the duels settled against it.
func TestLiveDuels(t *testing.T) {
	path := filepath.Join(t.TempDir(), "game.db")
	db := openAt(t, path, 19)
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
	if err := db.migrateTo(20); err != nil { // 0020 only: 0050 makes a friend's duel a challenge
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

// No challenges (0077): their duels go, with them; live duels stay as they were, kind or challenge aside; the games
// stay (one of the first challenges' a game of every topic); a player who came by a shared day or an invite came
// from elsewhere, and the counts of shares go.
func TestNoChallenges(t *testing.T) {
	db := openBefore(t, filepath.Join(t.TempDir(), "game.db"), "0077_no_challenges_invites_shares.sql")
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at, invite, came_from) VALUES
			(1, 'Ана', 'ana', 1, 1, 'abcdefgh', 'share'), (2, 'Бо', 'bo', 1, 1, NULL, 'invite'), (3, 'Ци', 'cy', 1, 1, NULL, 'room')`,
		`INSERT INTO runs (id, user_id, kind, questions, started_at, finished_at) VALUES
			(10, 1, 'duel', '[]', 1, 2), (11, 2, 'duel', '[]', 1, 2), (12, 2, 'topic', '[]', 1, 2), (13, 3, 'duel', '[]', 1, 2),
			(14, 3, 'challenge', '[]', 1, 2)`,
		`INSERT INTO challenges (id, code, user_id, run_id, created_at, expires_at) VALUES (1, 'abcdefgh', 2, 12, 2, 50)`,
		`INSERT INTO duels (id, kind, questions, a_id, a_run, b_id, b_run, ghost_run, challenge_id, created_at,
				expires_at, ended_at, outcome, a_delta, b_delta, rated, a_rating, b_rating, unrated) VALUES
			(1, 'live', '[1]', 1, 10, 2, 11, NULL, NULL, 1, 9, 4, 'a', 20, -20, 1, 1020, 980, NULL),
			(2, 'challenge', '[2]', 3, 13, NULL, NULL, 12, 1, 3, 9, 5, 'ghost_won', NULL, NULL, 0, NULL, NULL, 'known'),
			(3, 'live', '[3]', 3, 13, NULL, NULL, 12, NULL, 3, 9, 6, 'ghost_lost', -5, NULL, 1, 995, NULL, NULL)`,
		`INSERT INTO daily_counts (day, key, n) VALUES ('2026-11-18', 'share:day', 3), ('2026-11-18', 'visit:invite', 2),
			('2026-11-18', 'visit:home', 5)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrateTo(migrationsThrough("0077_no_challenges_invites_shares.sql")); err != nil {
		t.Fatal(err)
	}
	var duels, runs, from, counts string
	_ = db.Read.QueryRow(`SELECT group_concat(concat_ws(' ', id, questions, a_id, a_run, b_id, b_run, ghost_run, outcome,
		a_delta, b_delta, rated, a_rating, b_rating), ', ') FROM (SELECT * FROM duels ORDER BY id)`).Scan(&duels)
	_ = db.Read.QueryRow(`SELECT group_concat(id || kind || coalesce(category, '-'), ' ') FROM (SELECT * FROM runs ORDER BY id)`).Scan(&runs)
	_ = db.Read.QueryRow(`SELECT group_concat(came_from, ' ') FROM (SELECT came_from FROM users ORDER BY id)`).Scan(&from)
	_ = db.Read.QueryRow(`SELECT group_concat(key, ' ') FROM daily_counts`).Scan(&counts)
	if duels != "1 [1] 1 10 2 11 a 20 -20 1 1020 980, 3 [3] 3 13 12 ghost_lost -5 1 995" || runs != "10duel- 11duel- 12topic- 13duel- 14topic" ||
		from != "other other room" || counts != "visit:home" {
		t.Fatalf("duels %q, runs %q, came from %q, counts %q", duels, runs, from, counts)
	}
	db.Close()
}

// No second chance (0078): its games stay the players', as games of „Микс“, and so do the games of every topic kept
// without a topic; a goal of it still to do is drawn again with its day's, one done stays done and isn't told.
func TestNoSecondChance(t *testing.T) {
	db := openBefore(t, filepath.Join(t.TempDir(), "game.db"), "0078_no_second_chance.sql")
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at) VALUES (1, 'Ана', 'ana', 1, 1), (2, 'Бо', 'bo', 1, 1)`,
		`INSERT INTO runs (id, user_id, kind, category, questions, started_at, finished_at, xp) VALUES
			(10, 1, 'mistakes', NULL, '[]', 1, 2, 40), (11, 1, 'topic', '', '[]', 1, 2, 0), (12, 1, 'topic', NULL, '[]', 1, 2, 0),
			(13, 1, 'topic', 'history', '[]', 1, 2, 0), (14, 1, 'room', '', '[]', 1, 2, 0), (15, 1, 'day', NULL, '[]', 1, 2, 0)`,
		`INSERT INTO day_goals (user_id, day, n, goal) VALUES (1, '2026-11-20', 0, 'day'), (1, '2026-11-20', 1, 'mended3'),
			(1, '2026-11-20', 2, 'eight'), (2, '2026-11-20', 0, 'day'), (2, '2026-11-20', 1, 'mended3'), (2, '2026-11-20', 2, 'eight')`,
		`INSERT INTO goals_done (user_id, day, goal, at, xp, seen) VALUES (1, '2026-11-20', 'day', 1, 50, 0),
			(2, '2026-11-20', 'mended3', 1, 100, 0)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrateTo(migrationsThrough("0078_no_second_chance.sql")); err != nil {
		t.Fatal(err)
	}
	var runs, goals, done string
	_ = db.Read.QueryRow(`SELECT group_concat(id || kind || coalesce(category, '-') || xp, ' ')
		FROM (SELECT * FROM runs ORDER BY id)`).Scan(&runs)
	_ = db.Read.QueryRow(`SELECT group_concat(user_id || goal, ' ') FROM (SELECT * FROM day_goals ORDER BY user_id, n)`).Scan(&goals)
	_ = db.Read.QueryRow(`SELECT group_concat(user_id || goal || seen, ' ')
		FROM (SELECT * FROM goals_done ORDER BY user_id)`).Scan(&done)
	if runs != "10topicmix40 11topicmix0 12topicmix0 13topichistory0 14room0 15day-0" ||
		goals != "2day 2mended3 2eight" || done != "1day0 2mended31" {
		t.Fatalf("runs %q, goals %q, done %q", runs, goals, done)
	}
	db.Close()
}

// No rooms (0081): a room's game stays its player's, a game of its one topic or of „Микс“; nothing else of runs
// changes. A player who came by a room's link came from elsewhere, and the counts of those links go.
func TestNoRooms(t *testing.T) {
	db := openBefore(t, filepath.Join(t.TempDir(), "game.db"), "0081_no_rooms.sql")
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at, came_from) VALUES
			(1, 'Ана', 'ana', 1, 1, 'room'), (2, 'Бо', 'bo', 1, 1, 'home')`,
		`INSERT INTO runs (id, user_id, kind, category, questions, started_at, finished_at, points, xp, room_game, players)
			VALUES (10, 1, 'room', 'history', '[]', 1, 2, 900, 40, 'g1:1', 2), (11, 1, 'room', NULL, '[]', 3, 4, 300, 20, 'g2:1', 1),
			(12, 1, 'room', '', '[]', 5, 6, 100, 10, 'g3:1', 3), (13, 2, 'topic', 'mix', '[]', 1, 2, 500, 30, NULL, NULL),
			(14, 2, 'day', NULL, '[]', 1, 2, 700, 35, NULL, NULL)`,
		`INSERT INTO daily_counts (day, key, n) VALUES ('2026-11-18', 'visit:room', 3), ('2026-11-18', 'guest:room', 2),
			('2026-11-18', 'visit:home', 5)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrateTo(migrationsThrough("0081_no_rooms.sql")); err != nil {
		t.Fatal(err)
	}
	var runs, from, counts string
	_ = db.Read.QueryRow(`SELECT group_concat(concat_ws(' ', id, kind, coalesce(category, '-'), points, xp), ', ')
		FROM (SELECT * FROM runs ORDER BY id)`).Scan(&runs)
	_ = db.Read.QueryRow(`SELECT group_concat(came_from, ' ') FROM (SELECT came_from FROM users ORDER BY id)`).Scan(&from)
	_ = db.Read.QueryRow(`SELECT group_concat(key, ' ') FROM daily_counts`).Scan(&counts)
	if runs != "10 topic history 900 40, 11 topic mix 300 20, 12 topic mix 100 10, 13 topic mix 500 30, 14 day - 700 35" ||
		from != "other home" || counts != "visit:home" {
		t.Fatalf("runs %q, came from %q, counts %q", runs, from, counts)
	}
	db.Close()
}

// No Роял (0085): its games stay their players', as games of „Микс“ (one a cut left open ended at its last answer,
// none news to tell); its tournaments, evenings and plans go, with the choice of its notifications, those queued and
// their counts. Nothing else of runs or of the choices changes.
func TestNoRoyal(t *testing.T) {
	db := openBefore(t, filepath.Join(t.TempDir(), "game.db"), "0085_no_royal.sql")
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at) VALUES (1, 'Ана', 'ana', 1, 1), (2, 'Бо', 'bo', 1, 1)`,
		`INSERT INTO runs (id, user_id, kind, category, questions, started_at, finished_at, points, rights, xp, told)
			VALUES (10, 1, 'royal', NULL, '[]', 1, 2, 900, 9, 40, 0), (11, 2, 'royal', NULL, '[]', 3, NULL, 300, 2, 20, 0),
			(12, 2, 'topic', 'history', '[]', 1, 2, 500, 5, 30, 0), (13, 2, 'day', NULL, '[]', 1, 2, 700, 7, 35, 1)`,
		`INSERT INTO answers (run_id, n, question_id, score, points, is_right, ms, at) VALUES
			(10, 0, 'his-001', 1, 100, 1, 900, 2), (11, 0, 'his-002', 1, 100, 1, 900, 5), (11, 1, 'his-003', 0, 0, 0, 900, 8)`,
		`INSERT INTO royals (id, questions, created_at, closes_at, ended_at, day, starts_at) VALUES (1, '[]', 1, 1, 9, '2026-11-15', 1)`,
		`INSERT INTO royal_players (royal_id, user_id, run_id, joined_at, place, delta) VALUES (1, 1, 10, 1, 1, 12), (1, 2, 11, 1, 2, -12)`,
		`INSERT INTO royal_plans (day, user_id) VALUES ('2026-11-20', 1)`,
		`INSERT INTO royal_evenings (day) VALUES ('2026-11-15')`,
		`INSERT INTO push_prefs (user_id, kind, wanted) VALUES (1, 'royal', 1), (1, 'friends', 0), (2, 'day', 1)`,
		`INSERT INTO push_queue (user_id, kind, message, next_at, until) VALUES (1, 'royal', '{}', 1, 9), (1, '', '{}', 1, 9),
			(2, 'friends', '{}', 1, 9)`,
		`INSERT INTO daily_counts (day, key, n) VALUES ('2026-11-18', 'push:sent:royal', 3), ('2026-11-18', 'push:open:asked', 1),
			('2026-11-18', 'push:sent:friends', 5)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrateTo(migrationsThrough("0085_no_royal.sql")); err != nil {
		t.Fatal(err)
	}
	var runs, answers, prefs, queue, counts string
	_ = db.Read.QueryRow(`SELECT group_concat(concat_ws(' ', id, kind, coalesce(category, '-'), points, rights, xp,
			coalesce(finished_at, '-'), told), ', ') FROM (SELECT * FROM runs ORDER BY id)`).Scan(&runs)
	_ = db.Read.QueryRow(`SELECT group_concat(run_id, ' ') FROM (SELECT run_id FROM answers ORDER BY run_id, n)`).Scan(&answers)
	_ = db.Read.QueryRow(`SELECT group_concat(concat_ws(':', user_id, kind, wanted), ' ')
		FROM (SELECT * FROM push_prefs ORDER BY user_id, kind)`).Scan(&prefs)
	_ = db.Read.QueryRow(`SELECT group_concat(kind, ' ') FROM push_queue`).Scan(&queue)
	_ = db.Read.QueryRow(`SELECT group_concat(key, ' ') FROM daily_counts`).Scan(&counts)
	if runs != "10 topic mix 900 9 40 2 1, 11 topic mix 300 2 20 8 1, 12 topic history 500 5 30 2 0, 13 day - 700 7 35 2 1" ||
		answers != "10 11 11" || prefs != "1:friends:0 2:day:1" || queue != "friends" || counts != "push:sent:friends" {
		t.Fatalf("runs %q, answers %q, prefs %q, queue %q, counts %q", runs, answers, prefs, queue, counts)
	}
	for _, table := range []string{"royals", "royal_players", "royal_plans", "royal_evenings"} {
		var n int
		if _ = db.Read.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE name = ?`, table).Scan(&n); n != 0 {
			t.Errorf("%s is still there", table)
		}
	}
	if _, err := db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at) VALUES (1, 'royal', '[]', 3)`); err == nil {
		t.Error("a Роял run is taken still")
	}
	db.Close()
}

// openBefore opens a database migrated up to (not with) the named migration.
func openBefore(t *testing.T, path, name string) *DB {
	t.Helper()
	files, _ := fs.Glob(migrations, "migrations/*.sql")
	n := 0
	for _, f := range files {
		if strings.TrimPrefix(f, "migrations/") < name {
			n++
		}
	}
	return openAt(t, path, n)
}

// migrationsThrough is how many migrations there are up to the named one, with it: to migrate a test's database with
// it and none after.
func migrationsThrough(name string) int {
	files, _ := fs.Glob(migrations, "migrations/*.sql")
	n := 0
	for _, f := range files {
		if strings.TrimPrefix(f, "migrations/") <= name {
			n++
		}
	}
	return n
}

// Titles by play (0046): „Под две секунди“ is kept only by who meets „Пет за миг“'s rule (five right in one game, each
// under 3 s), with a rare one's XP; the others lose it, its title and avatar (taken off) and their telling; the clock's
// and the last second's titles go from whoever wears them.
func TestFastByTheNewRule(t *testing.T) {
	db := openBefore(t, filepath.Join(t.TempDir(), "game.db"), "0046_titles_by_play.sql")
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at, title, avatar) VALUES
			(1, 'А', 'a', 1, 1, 'speedDemon', 'bolt-gold'), (2, 'Б', 'b', 1, 1, 'speedDemon', 'bolt-rose'),
			(3, 'В', 'c', 1, 1, 'nightOwl', 'fox-sky')`,
		`INSERT INTO runs (id, user_id, kind, questions, started_at) VALUES (1, 1, 'topic', '[]', 1),
			(2, 2, 'topic', '[]', 1), (3, 2, 'topic', '[]', 1)`,
		// Five quick right answers in one game; four in one (the fifth on the line) and one in another.
		`INSERT INTO answers (run_id, n, question_id, score, points, is_right, ms, at) VALUES
			(1, 0, 'q', 1, 0, 1, 900, 1), (1, 1, 'q', 1, 0, 1, 1500, 1), (1, 2, 'q', 1, 0, 1, 2000, 1),
			(1, 3, 'q', 1, 0, 1, 2500, 1), (1, 4, 'q', 1, 0, 1, 2999, 1),
			(2, 0, 'q', 1, 0, 1, 900, 1), (2, 1, 'q', 1, 0, 1, 900, 1), (2, 2, 'q', 1, 0, 1, 900, 1),
			(2, 3, 'q', 1, 0, 1, 900, 1), (2, 4, 'q', 1, 0, 1, 3000, 1), (3, 0, 'q', 1, 0, 1, 900, 1)`,
		`INSERT INTO achievements (user_id, id, at, xp) VALUES (1, 'fast', 1, 50), (2, 'fast', 1, 50),
			(2, 'perfect', 1, 150)`,
		`INSERT INTO unlocks_told (user_id, id) VALUES (1, 'title:speedDemon:Светкавица'), (1, 'avatar:bolt:'),
			(2, 'title:speedDemon:Светкавица'), (2, 'avatar:bolt:'), (3, 'title:nightOwl:Нощна сова')`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	look := func(id int) string {
		var title, avatar sql.NullString
		_ = db.Read.QueryRow(`SELECT title, avatar FROM users WHERE id = ?`, id).Scan(&title, &avatar)
		return title.String + " " + avatar.String
	}
	count := func(q string) int {
		var n int
		if err := db.Read.QueryRow(q).Scan(&n); err != nil {
			t.Fatal(q, err)
		}
		return n
	}
	if got := look(1); got != "speedDemon bolt-gold" {
		t.Errorf("who meets the rule: %q", got)
	}
	if xp := count(`SELECT xp FROM achievements WHERE user_id = 1 AND id = 'fast'`); xp != 150 {
		t.Errorf("kept with %d XP", xp)
	}
	if n := count(`SELECT count(*) FROM unlocks_told WHERE user_id = 1`); n != 2 {
		t.Errorf("who meets the rule keeps %d told", n)
	}
	if got := look(2); got != " " {
		t.Errorf("who doesn't: %q", got)
	}
	if n := count(`SELECT count(*) FROM achievements WHERE user_id = 2`); n != 1 {
		t.Errorf("who doesn't keeps %d achievements", n)
	}
	if n := count(`SELECT count(*) FROM unlocks_told WHERE user_id IN (2, 3)`); n != 0 {
		t.Errorf("still told: %d", n)
	}
	if got := look(3); got != " fox-sky" {
		t.Errorf("the night's title: %q", got)
	}
	db.Close()
}

// The streak forgives a day a week (0084): each day missed in a streak before it is kept as the reserve days judged
// it, so that no streak going ends and none ended comes back. Ана's first day earns a reserve day (the rules before
// 2026-11-19), which keeps the first day missed; the next ends it. Бо's goals earn a second, and both keep two days
// missed in one week, as the new rule wouldn't; the third ends it. Ви's first day earns one, kept on the day after;
// the day after that ends the streak, under the rules of 2026-11-19 too.
func TestStreakForgives(t *testing.T) {
	db := openBefore(t, filepath.Join(t.TempDir(), "game.db"), "0084_streak_forgives.sql")
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at, streak_told) VALUES (1, 'Ана', 'ana', 1, 1, 'kept:2026-11-03'),
			(2, 'Бо', 'bo', 1, 1, 'ended:2026-11-13'), (3, 'Ви', 'vi', 1, 1, '')`,
		`INSERT INTO runs (user_id, kind, day, questions, started_at, finished_at) VALUES
			(1, 'day', '2026-11-01', '[]', 1, 2), (1, 'day', '2026-11-02', '[]', 1, 2), (1, 'day', '2026-11-04', '[]', 1, 2),
			(2, 'day', '2026-11-09', '[]', 1, 2), (2, 'day', '2026-11-10', '[]', 1, 2),
			(3, 'day', '2026-11-17', '[]', 1, 2), (3, 'topic', NULL, '[]', 1, 2)`,
		`INSERT INTO goals_done (user_id, day, goal, at) VALUES (2, '2026-11-09', 'a', 1), (2, '2026-11-09', 'b', 1),
			(2, '2026-11-09', 'c', 1), (2, '2026-11-10', 'a', 1), (2, '2026-11-10', 'b', 1), (2, '2026-11-10', 'c', 1)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrateTo(migrationsThrough("0084_streak_forgives.sql")); err != nil {
		t.Fatal(err)
	}
	var missed, told string
	_ = db.Read.QueryRow(`SELECT group_concat(concat_ws(' ', user_id, day, kept), ', ')
		FROM (SELECT * FROM streak_missed ORDER BY user_id, day)`).Scan(&missed)
	_ = db.Read.QueryRow(`SELECT group_concat(streak_told, ' ') FROM (SELECT streak_told FROM users ORDER BY id)`).Scan(&told)
	want := "1 2026-11-03 1, 1 2026-11-05 0, 2 2026-11-11 1, 2 2026-11-12 1, 2 2026-11-13 0, 3 2026-11-18 1, 3 2026-11-19 0"
	if missed != want || told != "forgiven:2026-11-03 ended:2026-11-13 " {
		t.Fatalf("missed %q, want %q; told %q", missed, want, told)
	}
	db.Close()
}
