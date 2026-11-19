package store

import (
	"database/sql"
	"io/fs"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
)

// only is the game's migrations named (all of them for none), as a set the tests may add to.
func only(t *testing.T, names ...string) fstest.MapFS {
	t.Helper()
	set := fstest.MapFS{}
	files, _ := fs.Glob(embedded, "migrations/*.sql")
	for _, f := range files {
		if len(names) > 0 && !slices.Contains(names, strings.TrimPrefix(f, "migrations/")) {
			continue
		}
		body, err := fs.ReadFile(embedded, f)
		if err != nil {
			t.Fatal(err)
		}
		set[f] = &fstest.MapFile{Data: body}
	}
	return set
}

// gameNames are the game's migrations' names, in order.
func gameNames(t *testing.T) []string {
	t.Helper()
	files, _ := fs.Glob(embedded, "migrations/*.sql")
	names := make([]string, len(files))
	for i, f := range files {
		names[i] = strings.TrimPrefix(f, "migrations/")
	}
	slices.Sort(names)
	return names
}

// A migration that takes something away names it, or it fails and leaves nothing of itself: a rebuild that copies a
// table by a list of its columns, written before another migration added one, can't lose it.
func TestMigrationNamesWhatItDrops(t *testing.T) {
	defer func(m fs.FS) { migrations = m }(migrations)
	set := fstest.MapFS{
		"migrations/0001_t.sql":     {Data: []byte(`CREATE TABLE t (x INTEGER); CREATE INDEX t_x ON t (x);`)},
		"migrations/0002_more.sql":  {Data: []byte(`ALTER TABLE t ADD COLUMN y INTEGER;`)},
		"migrations/0003_check.sql": {Data: []byte(rebuildT)},
	}
	migrations = set
	path := filepath.Join(t.TempDir(), "game.db")
	db := openAt(t, path, 2)
	defer db.Close()
	if _, err := db.Write.Exec(`INSERT INTO t (x, y) VALUES (1, 2)`); err != nil {
		t.Fatal(err)
	}
	err := db.migrate()
	if err == nil || !strings.Contains(err.Error(), "0003_check.sql") || !strings.Contains(err.Error(), "column t.y") ||
		!strings.Contains(err.Error(), "index t_x") {
		t.Fatalf("a rebuild lost a column and an index: %v", err)
	}
	var y, applied int
	if err := db.Write.QueryRow(`SELECT y FROM t`).Scan(&y); err != nil || y != 2 {
		t.Fatalf("the column after a refused rebuild: %d, %v", y, err)
	}
	_ = db.Write.QueryRow(`SELECT count(*) FROM schema_migrations WHERE name = '0003_check.sql'`).Scan(&applied)
	if applied != 0 {
		t.Fatal("a refused migration counts as applied")
	}

	// Named, it's meant: the column goes, and the index is made again.
	set["migrations/0003_check.sql"] = &fstest.MapFile{Data: []byte("-- drops: t.y\n" + rebuildT +
		"CREATE INDEX t_x ON t (x);")}
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Write.Exec(`INSERT INTO t (x) VALUES (-1)`); err == nil {
		t.Fatal("the rebuild didn't apply")
	}
}

// rebuildT rebuilds t to add a CHECK, by the columns it had before 0002 added y.
const rebuildT = `-- rebuild
CREATE TABLE t_new (x INTEGER CHECK (x >= 0));
INSERT INTO t_new (x) SELECT x FROM t;
DROP TABLE t;
ALTER TABLE t_new RENAME TO t;
`

// The case the checks are for: a rebuild written before another change added a column to its table, which lands
// (and deploys) first with a higher number. The database has had 0003; the late 0002 would lose 0003's column. It's
// refused before anything is applied, the other migration still to do as well.
func TestLateRebuildRefused(t *testing.T) {
	defer func(m fs.FS) { migrations = m }(migrations)
	set := fstest.MapFS{
		"migrations/0001_t.sql":   {Data: []byte(`CREATE TABLE t (x INTEGER);`)},
		"migrations/0003_add.sql": {Data: []byte(`ALTER TABLE t ADD COLUMN y INTEGER;`)},
	}
	migrations = set
	path := filepath.Join(t.TempDir(), "game.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Write.Exec(`INSERT INTO t (x, y) VALUES (1, 2)`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	set["migrations/0002_check.sql"] = &fstest.MapFile{Data: []byte(rebuildT)}
	set["migrations/0004_u.sql"] = &fstest.MapFile{Data: []byte(`CREATE TABLE u (x INTEGER);`)}
	_, err = Open(path)
	if err == nil || !strings.Contains(err.Error(), "0002_check.sql arrive after 0003_add.sql") ||
		!strings.Contains(err.Error(), "column t.y") || !strings.Contains(err.Error(), "Nothing is applied") {
		t.Fatalf("opened with a late rebuild that loses a column: %v", err)
	}
	// The database is as it was: neither 0002 nor 0004 applied, and the column there with its value.
	raw, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	var y, applied int
	_ = raw.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&applied)
	if err := raw.QueryRow(`SELECT y FROM t`).Scan(&y); err != nil || y != 2 || applied != 2 {
		t.Fatalf("the refused database: y %d (%v), %d migrations", y, err, applied)
	}
	raw.Close()
	// Kept as it is but given a number after 0003's, it would lose y in a new database too: refused there, at once.
	delete(set, "migrations/0002_check.sql")
	set["migrations/0005_check.sql"] = &fstest.MapFile{Data: []byte(rebuildT)}
	if _, err := Open(filepath.Join(t.TempDir(), "new.db")); err == nil || !strings.Contains(err.Error(), "column t.y") {
		t.Fatalf("a new database lost a column: %v", err)
	}
	// A rebuild can't hold both before and after a column is added: it's moved after 0003, and keeps y.
	set["migrations/0005_check.sql"] = &fstest.MapFile{Data: []byte(`-- rebuild
CREATE TABLE t_new (x INTEGER CHECK (x >= 0), y INTEGER);
INSERT INTO t_new (x, y) SELECT x, y FROM t;
DROP TABLE t;
ALTER TABLE t_new RENAME TO t;
`)}
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Read.QueryRow(`SELECT y FROM t WHERE x = 1`).Scan(&y); err != nil || y != 2 {
		t.Fatalf("after the late rebuild: %d, %v", y, err)
	}
	if _, err := db.Write.Exec(`INSERT INTO u (x) VALUES (1)`); err != nil {
		t.Fatal(err)
	}
}

// A late migration that leaves the schema otherwise than a new database has it (here an index the applied one had
// dropped already) is refused too, though it loses nothing.
func TestLateMigrationThatDiffers(t *testing.T) {
	defer func(m fs.FS) { migrations = m }(migrations)
	set := fstest.MapFS{
		"migrations/0001_t.sql":      {Data: []byte(`CREATE TABLE t (x INTEGER);`)},
		"migrations/0003_no_t_x.sql": {Data: []byte("-- drops: t_x\nDROP INDEX IF EXISTS t_x;")},
	}
	migrations = set
	path := filepath.Join(t.TempDir(), "game.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	set["migrations/0002_t_x.sql"] = &fstest.MapFile{Data: []byte(`CREATE INDEX t_x ON t (x);`)}
	if _, err := Open(path); err == nil || !strings.Contains(err.Error(), "index t_x extra") {
		t.Fatalf("opened with a late index a new database doesn't have: %v", err)
	}
}

// Migrations with the same number are made side by side, and production has them in the order they land, which
// their names don't tell: each such group gives the same schema in every order.
func TestSameNumbersInAnyOrder(t *testing.T) {
	names := gameNames(t)
	groups := map[string][]string{}
	for _, name := range names {
		groups[name[:4]] = append(groups[name[:4]], name)
	}
	base, err := memory()
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	if _, err := base.Write.Exec(migrationsTable); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < len(names); {
		group := groups[names[i][:4]]
		if len(group) > 1 {
			var first map[string]string
			for _, order := range orders(group) {
				trial, err := memory()
				if err != nil {
					t.Fatal(err)
				}
				if err := copySchema(base.Write, trial.Write); err != nil {
					t.Fatal(err)
				}
				if err := trial.applyAll(order); err != nil {
					t.Fatalf("%v: %v", order, err)
				}
				shape, err := shapeOf(trial.Write)
				trial.Close()
				if err != nil {
					t.Fatal(err)
				}
				if first == nil {
					first = shape
				} else if diff := unlike(shape, first); len(diff) > 0 {
					t.Errorf("%v, applied in this order, make another schema than %v: %s", order, group, diff)
				}
			}
		}
		if err := base.applyAll(group); err != nil {
			t.Fatal(err)
		}
		i += len(group)
	}
}

// orders are every order of the names.
func orders(names []string) [][]string {
	if len(names) <= 1 {
		return [][]string{slices.Clone(names)}
	}
	var out [][]string
	for i := range names {
		rest := slices.Concat(names[:i], names[i+1:])
		for _, o := range orders(rest) {
			out = append(out, append([]string{names[i]}, o...))
		}
	}
	return out
}

// production is the order production first had the migrations in, as it kept them (applied_at), 2026-11-17: those up
// to 0020 in order, then each as its change landed, several out of order.
var production = []string{
	"0021_arena.sql", "0022_titles.sql", "0023_avatars_drawn.sql", "0024_day_goals.sql", "0024_avatars_as_before.sql",
	"0025_progression.sql", "0026_active_days.sql", "0027_push_prefs.sql", "0028_mistakes.sql", "0029_leagues.sql",
	"0030_no_arena.sql", "0031_recorded_opponent.sql", "0032_answers_by_time.sql", "0033_phones.sql",
	"0034_unfolding.sql", "0035_scripted.sql", "0036_no_xp_view.sql", "0037_board_by_rights.sql",
	"0038_league_on_day_points.sql", "0038_daily_counts.sql", "0039_royal_out.sql", "0039_room_runs.sql",
	"0040_royal_evenings.sql", "0040_push_reminded.sql", "0041_recordings_told.sql", "0042_facts_achievements.sql",
	"0043_devotion_titles.sql", "0043_streak_repairs.sql", "0044_duel_ratings.sql", "0044_streak_mail.sql",
	"0045_devotion_titles_on.sql", "0046_titles_by_play.sql", "0047_together_lines.sql", "0047_handoffs.sql",
	"0048_challenges.sql", "0047_told_once.sql", "0049_one_take_each.sql", "0050_one_challenge.sql",
	"0051_title_names.sql", "0052_device_sessions.sql", "0052_lookup_indexes.sql", "0053_idle_guests.sql",
}

// A database migrated as production's was, each migration as it landed (the late ones tried first, and taken), has
// the schema of a new one; then it takes the rest.
func TestProductionsOrder(t *testing.T) {
	defer func(m fs.FS) { migrations = m }(migrations)
	all := gameNames(t)
	had := slices.Clone(all[:slices.Index(all, "0021_arena.sql")])
	migrations = only(t, had...)
	db, err := memory()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	for _, name := range production {
		had = append(had, name)
		migrations = only(t, had...)
		if err := db.migrate(); err != nil {
			t.Fatalf("with %s: %v", name, err)
		}
	}
	migrations = embedded
	if err := db.migrate(); err != nil {
		t.Fatal(err)
	}
	fresh, err := memory()
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	if err := fresh.migrate(); err != nil {
		t.Fatal(err)
	}
	have, _ := shapeOf(db.Read)
	want, _ := shapeOf(fresh.Read)
	if diff := unlike(have, want); len(diff) > 0 || len(want) == 0 {
		t.Fatalf("production's order made another schema: %s", diff)
	}
}

func TestShapeIgnoresCommentsAndColumnOrder(t *testing.T) {
	a := sortedTable(plain("CREATE TABLE t (\n  x INTEGER, -- the x, (one)\n  y TEXT CHECK (y IN ('a', 'b, c')), z INTEGER)"))
	b := sortedTable(plain("CREATE TABLE t (x INTEGER, z INTEGER, y TEXT CHECK (y IN ('a', 'b, c')))"))
	if a != b {
		t.Fatalf("%q\n%q", a, b)
	}
	if c := sortedTable(plain("CREATE TABLE t (x INTEGER, y TEXT CHECK (y IN ('a', 'b')))")); c == a {
		t.Fatal("a different CHECK is the same shape")
	}
	if got := plain("x /* a\n comment */ y '--not' -- yes"); got != "x y '--not'" {
		t.Fatalf("%q", got)
	}
}

// Duels outlive their players (0055): every duel stays as it was; then a player who goes leaves the other's duels,
// their own side none, and a challenge's takers keep theirs without it.
func TestDuelsOutlivePlayers(t *testing.T) {
	db := openBefore(t, filepath.Join(t.TempDir(), "game.db"), "0055_duels_outlive_players.sql")
	defer db.Close()
	for _, q := range []string{
		`INSERT INTO users (id, name, tag, created_at, seen_at) VALUES (1, 'Ана', 'ana', 1, 1), (2, 'Бо', 'bo', 1, 1),
			(3, 'Ци', 'cy', 1, 1)`,
		`INSERT INTO runs (id, user_id, kind, questions, started_at, finished_at) VALUES
			(10, 1, 'duel', '[]', 1, 2), (11, 2, 'duel', '[]', 1, 2), (12, 2, 'topic', '[]', 1, 2), (13, 3, 'duel', '[]', 1, 2)`,
		`INSERT INTO challenges (id, code, user_id, run_id, created_at, expires_at) VALUES (1, 'abcdefgh', 2, 12, 2, 50)`,
		`INSERT INTO duels (id, kind, questions, a_id, a_run, b_id, b_run, ghost_run, challenge_id, created_at,
				expires_at, ended_at, outcome, a_delta, b_delta, rated, a_rating, b_rating, a_left, b_left) VALUES
			(1, 'live', '[1]', 1, 10, 2, 11, NULL, NULL, 1, 9, 4, 'a', 20, -20, 1, 1020, 980, NULL, 3),
			(2, 'challenge', '[2]', 3, 13, NULL, NULL, 12, 1, 3, 9, 5, 'ghost_won', NULL, NULL, 0, NULL, NULL, NULL, NULL)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	row := func(id int) string {
		var s string
		_ = db.Read.QueryRow(`SELECT concat_ws(' ', kind, questions, a_id, a_run, b_id, b_run, ghost_run, challenge_id,
			created_at, expires_at, ended_at, outcome, a_delta, b_delta, rated, a_rating, b_rating, a_left, b_left)
			FROM duels WHERE id = ?`, id).Scan(&s)
		return s
	}
	before := []string{row(1), row(2)}
	// 0055 and none after: 0077 takes the challenges away.
	if err := db.migrateTo(migrationsThrough("0055_duels_outlive_players.sql")); err != nil {
		t.Fatal(err)
	}
	if after := []string{row(1), row(2)}; !slices.Equal(before, after) || after[0] == "" {
		t.Fatalf("the duels: %q, before %q", after, before)
	}
	if _, err := db.Write.Exec(`DELETE FROM users WHERE id = 2`); err != nil {
		t.Fatal(err)
	}
	if got := []string{row(1), row(2)}; !slices.Equal(got, []string{
		"live [1] 1 10 1 9 4 a 20 -20 1 1020 980 3", // concat_ws skips nulls: no b_id, b_run
		"challenge [2] 3 13 3 9 5 ghost_won 0",
	}) {
		t.Fatalf("after Бо went: %q", got)
	}
}

// A deploy marks a failed release by its migrations' sums (deploy/deploy.sh): a line each, its SHA-256 and its name
// as sha256sum writes them, in order, so a migration changed in any way is another line.
func TestMigrationSums(t *testing.T) {
	migrations = fstest.MapFS{
		"migrations/0002_b.sql": {Data: []byte("CREATE TABLE b (x INTEGER) STRICT;\n")},
		"migrations/0001_a.sql": {Data: []byte("CREATE TABLE a (x INTEGER) STRICT;\n")},
	}
	t.Cleanup(func() { migrations = embedded })
	lines, err := MigrationSums()
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{
		"a03c80479578052d47a7b93adbc448eb9a64ca4beb6cce21e318510dcadfc12a  0001_a.sql",
		"9fb189c02992a1b4227a0afb29f532f9e8589a75d6a16eac1ade4854b1dcd92b  0002_b.sql",
	}; !slices.Equal(lines, want) {
		t.Fatalf("%q, not %q", lines, want)
	}
}
