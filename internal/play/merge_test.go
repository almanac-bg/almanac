package play

import (
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
)

// Every reference to a player in the schema (a column that points to users, a column named for one without the
// reference, and every one of users' own) is carried by a step of Merge or left with the guest on purpose
// (mergeLeft): a new table or column can't be lost, unseen, to every guest who signs in.
func TestMergeCoversTheSchema(t *testing.T) {
	w := setup(t)
	rows, err := w.db.Read.Query(`
		SELECT m.name || '.' || f."from" FROM sqlite_schema m, pragma_foreign_key_list(m.name) f
			WHERE m.type = 'table' AND f."table" = 'users'
		UNION SELECT m.name || '.' || c.name FROM sqlite_schema m, pragma_table_info(m.name) c
			WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND (m.name = 'users'
				OR c.name IN ('user_id', 'player_id') OR c.name LIKE '%\_user\_id' ESCAPE '\')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	refs := map[string]bool{}
	for rows.Next() {
		var ref string
		if err := rows.Scan(&ref); err != nil {
			t.Fatal(err)
		}
		refs[ref] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	named := map[string]string{}
	for _, s := range mergeSteps {
		for _, ref := range s.carries {
			if named[ref] != "" {
				t.Errorf("%s carried twice", ref)
			}
			named[ref] = "carried"
		}
	}
	for ref := range mergeLeft {
		if named[ref] != "" {
			t.Errorf("%s both carried and left", ref)
		}
		named[ref] = "left"
	}
	for ref := range refs {
		if named[ref] == "" {
			t.Errorf("%s refers to a player: Merge must carry it from a guest to the account (a step in mergeSteps "+
				"naming it), or say why it's left to go with the guest (mergeLeft)", ref)
		}
	}
	for ref := range named {
		if !refs[ref] {
			t.Errorf("%s, named in Merge, isn't in the schema", ref)
		}
	}
}

// What else of a guest comes to the account: the questions they reported, their notifications on the way, their look
// and what they've been told, and when they came.
func TestMergeCarriesTheRest(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	guest, owner := w.user(), w.user()
	for _, q := range []string{
		`UPDATE users SET frame = 'gold', backdrop = 'waves', level_seen = 7, unlocks_known = 1, recordings_told = 50,
			systems_told = 'duel xp', streak_told = 'kept:2026-11-12', came_from = 'room', created_at = 5,
			seen_at = 900 WHERE id = ?2`,
		`UPDATE users SET level_seen = 3, recordings_told = 80, systems_told = 'royal', streak_told = 'ended:2026-11-01',
			came_from = 'home', created_at = 10, seen_at = 100 WHERE id = ?1`,
		`INSERT INTO reports (question_id, user_id, text, at) VALUES ('his-001', ?2, 'Грешен отговор', 1)`,
		`INSERT INTO push_reminded (user_id, day, at) VALUES (?2, '2026-11-11', 1), (?1, '2026-11-11', 2), (?2, '2026-11-10', 3)`,
		`INSERT INTO push_queue (user_id, kind, message, day, next_at, until) VALUES
			(?2, 'day', '{}', '2026-11-12', 1, 9), (?1, 'day', '{}', '2026-11-12', 1, 9), (?2, 'duel', '{}', NULL, 1, 9)`,
	} {
		if _, err := w.db.Write.Exec(q, owner, guest); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, guest, owner) }); err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(`DELETE FROM users WHERE id = ?`, guest); err != nil {
		t.Fatal(err)
	}

	var reports, reminded, queued int
	var frame, backdrop, systems, streak, came string
	var level, recordings, created, seen int
	if err := w.db.Read.QueryRow(`SELECT
		(SELECT count(*) FROM reports WHERE user_id = ?1), (SELECT count(*) FROM push_reminded WHERE user_id = ?1),
		(SELECT count(*) FROM push_queue WHERE user_id = ?1),
		frame, backdrop, systems_told, streak_told, came_from, level_seen, recordings_told,
		created_at, seen_at FROM users WHERE id = ?1`, owner).Scan(&reports, &reminded, &queued,
		&frame, &backdrop, &systems, &streak, &came, &level, &recordings, &created, &seen); err != nil {
		t.Fatal(err)
	}
	if reports != 1 || reminded != 2 || queued != 2 {
		t.Fatalf("%d reports, reminded on %d days, %d pushes on the way", reports, reminded, queued)
	}
	if frame != "gold" || backdrop != "waves" || level != 7 || recordings != 80 || systems != "royal duel xp" ||
		streak != "kept:2026-11-12" {
		t.Fatalf("look and told: %s %s, level %d, recordings %d, %q, %q", frame, backdrop, level, recordings, systems, streak)
	}
	if came != "room" || created != 5 || seen != 900 {
		t.Fatalf("came from %q at %d, seen %d", came, created, seen)
	}
}

// A player who deletes their account takes what's theirs, and nothing of others': the other side of each duel keeps
// it, with its result, their counts and what they've earned toward; but the player's name and address stay nowhere.
func TestForgetKeepsOthersHistory(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy := w.user(), w.user(), w.user()
	const name, email = "Боян Неповторимия", "boyan@example.bg"
	if _, err := w.db.Write.Exec(`UPDATE users SET name = ?, email = ? WHERE id = ?`, name, email, bo); err != nil {
		t.Fatal(err)
	}
	accounts := &account.Accounts{DB: w.db, Forget: []func(*sql.Tx, int64) error{Forget}}

	// Ana beats Bo live; the next day Bo beats her; a third duel between them is under way.
	l, err := w.g.StartLive(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, l.Runs[0], repeat(w.right, Length)...)
	w.play(bo, l.Runs[1], repeat(w.wrong, Length)...)
	w.wait(24 * time.Hour)
	again, err := w.g.StartLive(ctx, bo, ana)
	if err != nil {
		t.Fatal(err)
	}
	w.play(bo, again.Runs[0], repeat(w.right, Length)...)
	w.play(ana, again.Runs[1], repeat(w.wrong, Length)...)
	under, err := w.g.StartLive(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, under.Runs[0], repeat(w.right, Length)...)
	// Cy asked Bo to be friends by his address; a mail to him is on its way.
	if _, err := w.g.Request(ctx, cy, email, true); err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(`INSERT INTO outbox (message, next_at, created_at) VALUES (?, 1, 1)`,
		`{"to":"`+email+`","subject":"Серия","text":"Здравей"}`); err != nil {
		t.Fatal(err)
	}
	before, err := w.g.StatsOf(ctx, ana)
	if err != nil || before.Duels != 2 || before.Won != 1 {
		t.Fatalf("Ana's duels before: %+v (%v)", before, err)
	}

	if err := accounts.Delete(ctx, bo); err != nil {
		t.Fatal(err)
	}
	after, err := w.g.StatsOf(ctx, ana)
	if err != nil || after.Duels != before.Duels || after.Won != before.Won {
		t.Fatalf("Ana's duels after Bo went: %d won of %d, not %d of %d (%v)", after.Won, after.Duels, before.Won,
			before.Duels, err)
	}
	duels, err := w.g.DuelsOf(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	var states []string
	if n := w.count(`SELECT count(*) FROM duels WHERE id = ?`, under.DuelID); n != 0 {
		t.Fatal("the duel under way with Bo is still there")
	}
	for _, d := range duels {
		// Their game went with them: said so (their score isn't known), never a 0 they didn't score.
		if d.Opponent == nil || d.Opponent.Name != GoneName || !d.Opponent.Gone {
			t.Fatalf("the other in a duel with Bo: %+v", d.Opponent)
		}
		states = append(states, d.State)
	}
	if slices.Sort(states); !slices.Equal(states, []string{"lost", "won"}) {
		t.Fatalf("Ana's duels: %v", states)
	}
	if d, err := w.g.DuelOf(ctx, ana, l.DuelID); err != nil || d.State != "won" || d.Opponent.Name != GoneName ||
		!d.Opponent.Gone {
		t.Fatalf("the live duel: %+v (%v)", d, err)
	}
	for _, p := range after.Recent {
		if p.Outcome != "" && p.Opponent != GoneName {
			t.Fatalf("Ana's game against Bo, after: %+v", p)
		}
	}
	// Nothing anywhere has his name or address.
	for _, s := range []string{name, email} {
		if where := holding(t, w, s); len(where) > 0 {
			t.Errorf("%q is still in %v", s, where)
		}
	}
	var left int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM duels WHERE a_id IS NULL AND b_id IS NULL`).Scan(&left)
	if left != 0 {
		t.Fatalf("%d duels of nobody's", left)
	}

	// Ana goes too: what's left of the two of them goes with her.
	if err := accounts.Delete(ctx, ana); err != nil {
		t.Fatal(err)
	}
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM duels WHERE coalesce(a_id, b_id) IS NULL OR a_id IN (?1, ?2)
		OR b_id IN (?1, ?2)`, ana, bo).Scan(&left)
	if left != 0 {
		t.Fatalf("%d duels left of two players gone", left)
	}
}

// holding are the table.column where some row holds s.
func holding(t *testing.T, w *world, s string) []string {
	t.Helper()
	rows, err := w.db.Read.Query(`SELECT m.name, c.name FROM sqlite_schema m, pragma_table_info(m.name) c
		WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'`)
	if err != nil {
		t.Fatal(err)
	}
	var cols [][2]string
	for rows.Next() {
		var c [2]string
		if err := rows.Scan(&c[0], &c[1]); err != nil {
			t.Fatal(err)
		}
		cols = append(cols, c)
	}
	rows.Close()
	var where []string
	for _, c := range cols {
		var n int
		if err := w.db.Read.QueryRow(`SELECT count(*) FROM "`+c[0]+`" WHERE instr(CAST("`+c[1]+`" AS TEXT), ?) > 0`, s).
			Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			where = append(where, c[0]+"."+c[1])
		}
	}
	return where
}

// fold folds a guest into an account as signing in does: Merge, then the guest goes.
func (w *world) fold(guest, owner int64) {
	w.t.Helper()
	err := w.db.Tx(w.t.Context(), func(tx *sql.Tx) error {
		if err := Merge(tx, guest, owner); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM users WHERE id = ?`, guest)
		return err
	})
	if err != nil {
		w.t.Fatal(err)
	}
}

// since makes a player one who came d before now.
func (w *world) since(user int64, d time.Duration) {
	w.t.Helper()
	if _, err := w.db.Write.Exec(`UPDATE users SET created_at = ? WHERE id = ?`, w.now.Add(-d).UnixMilli(), user); err != nil {
		w.t.Fatal(err)
	}
}

// The day's ten played as several guests, and signed in from the best of them, races nobody: a guest's day brought
// to an account that was there already counts for the player alone, a shadow (review 2026-11-18, S4). It's theirs
// still (their streak, their board), and the account has the day: no other guest's comes after it, nor a game of its
// own. A guest's day from before the account was there is a day like any other.
func TestMergeShadowsAGuestsDay(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	day := w.g.Today()
	owner, scout, best, rival := w.user(), w.user(), w.user(), w.user()
	w.since(owner, 30*24*time.Hour)
	w.dayGame(scout, nil, repeat(w.wrong, Length)...)
	run := w.dayGame(best, nil)
	w.dayGame(rival, nil, repeat(w.wrong, Length)...)
	w.fold(best, owner)
	if w.shadow(run) != ShadowGuest {
		t.Fatalf("the guest's day brought to the account: shadow %d", w.shadow(run))
	}
	if b, err := w.g.BoardOf(ctx, day, rival); err != nil || b.Players != 2 {
		t.Fatalf("the board as another sees it: %+v %v", b, err)
	}
	if b, err := w.g.BoardOf(ctx, day, owner); err != nil || b.Place != 1 || b.Mine == nil {
		t.Fatalf("the board as the account sees it: %+v %v", b, err)
	}
	if s, err := w.g.Streak(ctx, owner); err != nil || s != 1 {
		t.Fatalf("the account's streak: %d %v", s, err)
	}
	w.fold(scout, owner)
	if n := w.count(`SELECT count(*) FROM runs WHERE user_id = ? AND kind = 'day' AND day = ?`, owner, day); n != 1 {
		t.Fatalf("the account has %d games of the day", n)
	}
	if s, err := w.g.StartDay(ctx, owner); err != nil || s.ID != run || !s.Done {
		t.Fatalf("the account's day after: %+v %v", s, err)
	}

	// A guest who played before the account was made (kept with an email elsewhere later) brings a day like any.
	early, later := w.user(), w.user()
	first := w.dayGame(early, nil)
	w.since(later, -time.Minute)
	w.fold(early, later)
	if w.shadow(first) != 0 {
		t.Fatalf("a day from before the account: shadow %d", w.shadow(first))
	}
}

// A guest's friends come to the account only as far as it has room (MaxFriends), the latest first, both ways.
func TestMergeFriendsWithinMax(t *testing.T) {
	w := setup(t)
	owner, guest := w.user(), w.user()
	befriend := func(a, b int64, since int) {
		if _, err := w.db.Write.Exec(`INSERT INTO friends (user_id, friend_id, since) VALUES (?1, ?2, ?3), (?2, ?1, ?3)`,
			a, b, since); err != nil {
			t.Fatal(err)
		}
	}
	for i := range MaxFriends - 2 {
		befriend(owner, w.user(), i)
	}
	both := w.user()
	befriend(owner, both, 0)
	befriend(guest, both, 0)
	old, newer, newest := w.user(), w.user(), w.user()
	befriend(guest, old, 1)
	befriend(guest, newer, 2)
	befriend(guest, newest, 3)
	w.fold(guest, owner)
	friends := func(a, b int64) bool {
		return w.count(`SELECT count(*) FROM friends WHERE user_id = ? AND friend_id = ?`, a, b) == 1
	}
	if n := w.count(`SELECT count(*) FROM friends WHERE user_id = ?`, owner); n != MaxFriends {
		t.Fatalf("the account has %d friends", n)
	}
	if !friends(owner, newest) || !friends(newest, owner) || friends(owner, newer) || friends(newer, owner) ||
		friends(owner, old) || !friends(owner, both) || !friends(both, owner) {
		t.Fatal("the friends the guest brought")
	}
}

// The days a player who goes played on are kept for the retention counts, as nobody's: a tombstone (review
// 2026-11-18, S15).
func TestForgetLeavesTheDaysAsNobodys(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	accounts := &account.Accounts{DB: w.db, Forget: []func(*sql.Tx, int64) error{Forget}}
	gone := w.user()
	w.playDay(gone)
	// A day played only at a script's speed doesn't count (D1): once the games are gone, nothing could tell it, so it
	// goes with them.
	w.stored(gone, "topic", "2026-11-10", true, true)
	if err := accounts.Delete(ctx, gone); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM active_days WHERE user_id = ?`, gone); n != 0 {
		t.Fatalf("%d days still the player's", n)
	}
	if n := w.count(`SELECT count(*) FROM active_days WHERE user_id = ?`, -gone); n != 1 {
		t.Fatalf("%d days kept as nobody's", n)
	}
	if a, err := w.g.Activity(ctx, w.g.Today()); err != nil || a.On(w.g.Today()) != 1 {
		t.Fatalf("played today: %v", err)
	}
}

// Every column named for a player is a reference to users (what's theirs goes with them, by the schema, or is kept
// without them), or is listed here with why not: an id kept without one could become someone else's.
func TestPlayerColumnsRefer(t *testing.T) {
	unlinked := map[string]string{
		"active_days.user_id": "kept after a player goes, for the retention counts, as a tombstone (Forget)",
	}
	w := setup(t)
	rows, err := w.db.Read.Query(`SELECT m.name || '.' || c.name FROM sqlite_schema m, pragma_table_info(m.name) c
		WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
			AND (c.name IN ('user_id', 'player_id') OR c.name LIKE '%\_user\_id' ESCAPE '\')
			AND NOT EXISTS (SELECT 1 FROM pragma_foreign_key_list(m.name) f WHERE f."from" = c.name AND f."table" = 'users')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			t.Fatal(err)
		}
		seen[col] = true
		if unlinked[col] == "" {
			t.Errorf("%s names a player without a reference to users: make it one (REFERENCES users (id)), or list "+
				"it here with why not, and see that Forget leaves nothing of the player's there", col)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for col := range unlinked {
		if !seen[col] {
			t.Errorf("%s, listed without a reference, has one or is gone", col)
		}
	}
}
