package store

import (
	"path/filepath"
	"strings"
	"testing"
)

// Right or not (0112): an order answered so far is worth 1 or 0, never close; a run keeps neither time nor whom it was
// against; a duel keeps no ghost_run (it became recording_run, gone since 0117); an avatar is its shape alone; Днес's
// lines are today_lines.
func TestRightOrNot(t *testing.T) {
	db := openBefore(t, filepath.Join(t.TempDir(), "game.db"), "0112_right_or_not.sql")
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at, avatar) VALUES (1, 'Ана', 'ana', 1, 1, 'lynx-natural'),
			(2, 'Бо', 'bo', 1, 1, 'history-gold'), (3, 'Вя', 'vi', 1, 1, NULL), (4, 'Гал', 'gal', 1, 1, 'fox')`,
		`INSERT INTO runs (id, user_id, kind, questions, started_at, finished_at, ms, opponent, opponent_id, recorded,
			outcome) VALUES (10, 1, 'duel', '[]', 1, 2, 9000, 'Бо', 2, 0, 'won'),
			(11, 2, 'duel', '[]', 1, 2, 0, NULL, NULL, 0, NULL)`,
		`INSERT INTO answers (run_id, n, question_id, given, shown, score, is_right, ms, at) VALUES
			(10, 0, 'o1', '{"order":[1,0,2,3]}', '{"order":[0,1,2,3]}', 0.667, 0, 1, 1),
			(10, 1, 'o2', '{"order":[0,1,2,3]}', '{"order":[0,1,2,3]}', 1, 1, 1, 1),
			(10, 2, 'n1', '{"value":5}', '{"value":5}', 0.4, 0, 1, 1),
			(10, 3, 'o3', NULL, NULL, 0, 0, 1, 1)`,
		`INSERT INTO duels (id, kind, questions, a_id, a_run, ghost_run, created_at, expires_at) VALUES
			(1, 'recording', '[]', 1, 10, 11, 1, 9)`,
		`INSERT INTO home_lines (user_id, what, at) VALUES (1, 'friend:2', 1)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrateTo(migrationsThrough("0112_right_or_not.sql")); err != nil {
		t.Fatal(err)
	}
	var scores, avatars, lines string
	_ = db.Read.QueryRow(`SELECT group_concat(question_id || '=' || score, ' ') FROM (SELECT * FROM answers ORDER BY n)`).
		Scan(&scores)
	_ = db.Read.QueryRow(`SELECT group_concat(coalesce(avatar, '-'), ' ') FROM (SELECT * FROM users ORDER BY id)`).
		Scan(&avatars)
	_ = db.Read.QueryRow(`SELECT group_concat(what, ' ') FROM today_lines`).Scan(&lines)
	if scores != "o1=0.0 o2=1.0 n1=0.4 o3=0.0" || avatars != "lynx history - fox" || lines != "friend:2" {
		t.Fatalf("scores %q, avatars %q, lines %q", scores, avatars, lines)
	}
	for _, column := range []string{"runs.ms", "runs.opponent", "runs.opponent_id", "runs.recorded", "runs.outcome",
		"duels.ghost_run"} {
		table, name, _ := strings.Cut(column, ".")
		var n int
		if _ = db.Read.QueryRow(`SELECT count(*) FROM pragma_table_info(?) WHERE name = ?`, table, name).Scan(&n); n != 0 {
			t.Errorf("%s is still there", column)
		}
	}
	db.Close()
}

// No recordings (0117): a duel is with a friend only; those played against a recording go, their runs stay the players'
// games; a friend's duel stays; a duel names neither a kind nor a recording.
func TestNoRecordings(t *testing.T) {
	db := openBefore(t, filepath.Join(t.TempDir(), "game.db"), "0117_no_recordings.sql")
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at) VALUES (1, 'Ана', 'ana', 1, 1), (2, 'Бо', 'bo', 1, 1)`,
		`INSERT INTO runs (id, user_id, kind, questions, started_at, finished_at) VALUES (10, 1, 'duel', '[]', 1, 2),
			(11, 2, 'topic', '[]', 1, 2), (12, 1, 'duel', '[]', 1, 2)`,
		`INSERT INTO duels (id, kind, questions, a_id, a_run, recording_run, created_at, expires_at) VALUES
			(1, 'recording', '[]', 1, 10, 11, 1, 9)`,
		`INSERT INTO duels (id, kind, questions, a_id, a_run, b_id, created_at, expires_at) VALUES
			(2, 'person', '[]', 1, 12, 2, 1, 9)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := db.migrateTo(migrationsThrough("0117_no_recordings.sql")); err != nil {
		t.Fatal(err)
	}
	var duels string
	var runs int
	_ = db.Read.QueryRow(`SELECT group_concat(id, ' ') FROM duels`).Scan(&duels)
	_ = db.Read.QueryRow(`SELECT count(*) FROM runs`).Scan(&runs)
	if duels != "2" || runs != 3 {
		t.Fatalf("duels %q, runs %d", duels, runs)
	}
	for _, name := range []string{"kind", "recording_run"} {
		var n int
		if _ = db.Read.QueryRow(`SELECT count(*) FROM pragma_table_info('duels') WHERE name = ?`, name).Scan(&n); n != 0 {
			t.Errorf("duels.%s is still there", name)
		}
	}
	db.Close()
}
