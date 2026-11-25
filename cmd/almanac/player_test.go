package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank/banktest"
	"github.com/almanac-bg/almanac/internal/seed"
	"github.com/almanac-bg/almanac/internal/store"
	"github.com/almanac-bg/almanac/internal/store/storetest"
)

// A player deleted at their request by mail (almanac player delete) leaves nothing that names them but the tombstone
// of their days, as their own deletion does: none of their rows, no duel left open against nobody, nothing under their
// address. Without -yes it only says who they are and what the database holds of them; and it never guesses whom.
func TestPlayerDelete(t *testing.T) {
	db := storetest.Open(t)
	ctx := t.Context()
	personas, err := seed.Seed(ctx, db, banktest.Sample(t), seed.Options{Players: 18, Days: 14, Seed: 7,
		Now: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	// The persona with an address that the database holds most of, the admin aside (whose days count for nobody, so
	// leave no tombstone: below); its address kept in the mail's tables too. The seed's history differs from run to
	// run, and the admin, who plays most days, is now and then the one it holds most of.
	var who, admin seed.Persona
	most := -1
	for _, p := range personas {
		if p.Key == "admin" {
			admin = p
			continue
		}
		var n int
		if err := db.Read.QueryRow(`SELECT (SELECT count(*) FROM runs WHERE user_id = ?1)
			+ (SELECT count(*) FROM duels WHERE a_id = ?1 OR b_id = ?1)`, p.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if p.Email != "" && n > most {
			who, most = p, n
		}
	}
	for _, q := range []string{
		`INSERT INTO mail_suppressed (email, until, times, reason) VALUES (?1, 9999999999999, 1, 'test')`,
		`INSERT INTO code_mails (email, at) VALUES (?1, 1)`,
		`INSERT INTO outbox (message, next_at, created_at) VALUES (json_object('to', ?1, 'subject', 's', 'text', 't'), 1, 1)`,
		`INSERT INTO friend_requests (from_id, to_email, at) SELECT id, ?1, 1 FROM users WHERE id <> ?2 LIMIT 1`,
	} {
		if _, err := db.Write.Exec(q, who.Email, who.ID); err != nil {
			t.Fatal(err)
		}
	}
	// An open duel waiting for them, a friend's if they have one (the seed's history may leave them none).
	if _, err := db.Write.Exec(`INSERT INTO duels (questions, a_id, b_id, created_at, sent_at, expires_at)
		SELECT '[]', u.id, ?1, 1, 1, 9999999999999 FROM users u WHERE u.id <> ?1
		ORDER BY EXISTS (SELECT 1 FROM friends WHERE user_id = ?1 AND friend_id = u.id) DESC, u.id LIMIT 1`, who.ID); err != nil {
		t.Fatal(err)
	}
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := db.Read.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return n
	}
	days := count(`SELECT count(*) FROM active_days WHERE user_id = ?`, who.ID)
	if days == 0 || count(`SELECT count(*) FROM duels WHERE ended_at IS NULL AND (a_id = ?1 OR b_id = ?1)`, who.ID) == 0 {
		t.Fatalf("%s: no days or no open duel to leave behind", who.Key)
	}

	for _, bad := range []string{"ivan", "@", "nobody@example.invalid", "@nosuch.player"} {
		if err := deletePlayer(ctx, db, bad, true, &bytes.Buffer{}); err == nil {
			t.Errorf("%q: a player deleted", bad)
		}
	}
	var out bytes.Buffer
	if err := deletePlayer(ctx, db, " "+strings.ToUpper(who.Email)+" ", false, &out); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"@" + who.Tag, "runs.user_id", "active_days.user_id", "friend_requests.to_email: 1",
		"outbox: 1", "nothing deleted"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("the listing has no %q:\n%s", want, out.String())
		}
	}
	if count(`SELECT count(*) FROM users WHERE id = ?`, who.ID) != 1 {
		t.Fatal("deleted without -yes")
	}

	out.Reset()
	if err := deletePlayer(ctx, db, "@"+who.Tag, true, &out); err != nil {
		t.Fatal(err)
	}
	residue(t, db, who.ID, who.Email, who.Tag)
	if n := count(`SELECT count(*) FROM active_days WHERE user_id = ?`, -who.ID); n == 0 || n > days {
		t.Errorf("%d days in the tombstone, of %d", n, days)
	}

	// An admin's days aren't counted, and play.Forget keeps only those that are: none kept.
	if admin.ID == 0 || count(`SELECT count(*) FROM active_days WHERE user_id = ?`, admin.ID) == 0 {
		t.Fatal("no admin, or one who played no day")
	}
	if err := deletePlayer(ctx, db, "@"+admin.Tag, true, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM active_days WHERE user_id IN (?1, -?1)`, admin.ID); n != 0 {
		t.Errorf("%d of the admin's days kept", n)
	}
}

// residue fails the test for anything left that names a player gone: a row under their id in a column that refers
// to users, a day under it, a duel left open against nobody, their address or their tag in any text.
func residue(t *testing.T, db *store.DB, id int64, email, tag string) {
	t.Helper()
	rows, err := db.Read.Query(`SELECT m.name, c.name, c.type, EXISTS (SELECT 1 FROM pragma_foreign_key_list(m.name) f
			WHERE f."from" = c.name AND f."table" = 'users')
		FROM sqlite_schema m, pragma_table_info(m.name) c WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'`)
	if err != nil {
		t.Fatal(err)
	}
	type column struct {
		table, name, kind string
		ref               bool
	}
	var cols []column
	for rows.Next() {
		var c column
		if err := rows.Scan(&c.table, &c.name, &c.kind, &c.ref); err != nil {
			t.Fatal(err)
		}
		cols = append(cols, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, c := range cols {
		q, arg := "", any(nil)
		switch {
		case c.ref || c.table == "users" && c.name == "id" || c.table == "active_days" && c.name == "user_id":
			q, arg = `SELECT count(*) FROM "`+c.table+`" WHERE "`+c.name+`" = ?`, id
		case c.kind == "TEXT" || c.kind == "":
			q, arg = `SELECT count(*) FROM "`+c.table+`" WHERE instr(lower("`+c.name+`"), ?) OR instr("`+c.name+`", ?)`, email
		default:
			continue
		}
		args := []any{arg}
		if strings.Contains(q, "instr") {
			args = append(args, "@"+tag)
		}
		var n int
		if err := db.Read.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatalf("%s.%s: %v", c.table, c.name, err)
		}
		if n > 0 {
			t.Errorf("%s.%s: %d rows still name the player", c.table, c.name, n)
		}
	}
	var open int
	if err := db.Read.QueryRow(`SELECT count(*) FROM duels WHERE ended_at IS NULL AND (a_id IS NULL OR b_id IS NULL)`).
		Scan(&open); err != nil {
		t.Fatal(err)
	}
	if open > 0 {
		t.Errorf("%d duels left open against nobody", open)
	}
}

// A command on the game's database, run without the service's settings, finds none where it looks: it says so, and
// makes no new one to answer from (nobody has that email, no question has reports), as if the game held nothing.
func TestCommandsRefuseNoDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "almanac.db")
	t.Setenv("DB_PATH", path)
	sample := filepath.Join("..", "..", "bank", "sample")
	for name, run := range map[string]func() error{
		"player":         func() error { return playerCommand([]string{"delete", "ivan@example.bg"}) },
		"admin":          func() error { return adminCommand([]string{"ivan@example.bg"}) },
		"bank reports":   func() error { return bankReports(nil) },
		"bank suspects":  func() error { return bankSuspects(sample) },
		"bank calibrate": func() error { return bankCalibrate(sample) },
	} {
		if err := run(); err == nil || !strings.Contains(err.Error(), "no database at "+path) {
			t.Errorf("%s: %v", name, err)
		}
		if _, err := os.Stat(path); err == nil {
			t.Fatalf("%s made a database", name)
		}
	}
}
