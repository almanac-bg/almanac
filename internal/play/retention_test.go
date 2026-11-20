package play

import (
	"database/sql"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

// shadowed puts a game straight in the database, as stored does, a shadow for the reason given.
func (w *world) shadowed(user int64, day string, shadow int) {
	w.t.Helper()
	w.stored(user, "topic", day, true, false)
	if _, err := w.db.Write.Exec(`UPDATE runs SET shadow = ? WHERE id = (SELECT max(id) FROM runs WHERE user_id = ?)`,
		shadow, user); err != nil {
		w.t.Fatal(err)
	}
}

// /admin counts people (review 2026-11-18, D1): not a player at a script's speed, nor an admin; a gone player's days
// still, as nobody's. A throwaway guest's day counts whether they come back or not: counted only once back, the
// newcomers would seem to come back more than they do.
func TestPeopleDays(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, script, admin, throwaway := w.user(), w.user(), w.user(), w.user()
	w.stored(ana, "topic", "2026-11-11", true, false)
	w.stored(ana, "day", "2026-11-12", true, false)
	w.stored(script, "day", "2026-11-12", true, true)
	w.stored(admin, "day", "2026-11-12", true, false)
	_, _ = w.db.Write.Exec(`UPDATE users SET admin = 1 WHERE id = ?`, admin)
	w.shadowed(throwaway, "2026-11-12", ShadowThrowaway)
	_, _ = w.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (-999, '2026-11-12')`) // one gone
	// A day kept with no game that day to tell it by (a game begun the evening before, say, long before): not counted.
	_, _ = w.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?, '2026-11-10')`, ana)

	act, err := w.g.Activity(ctx, "2026-11-01")
	if err != nil {
		t.Fatal(err)
	}
	if n := act.On("2026-11-12"); n != 3 {
		t.Fatalf("people on the 12th: %d, want Ана, the guest and the one gone", n)
	}
	if n := act.Within("2026-11-01", "2026-11-12"); n != 3 {
		t.Fatalf("people in the days: %d", n)
	}
	if act.On("2026-11-10") != 0 || act.first(ana) != "2026-11-11" {
		t.Fatalf("Ана's first day: %q", act.first(ana))
	}
	// The guest comes back (JudgeNets lets their day out): counted as before.
	_, _ = w.db.Write.Exec(`UPDATE runs SET shadow = 0 WHERE user_id = ?`, throwaway)
	act, _ = w.g.Activity(ctx, "2026-11-01")
	if n := act.On("2026-11-12"); n != 3 {
		t.Fatalf("with the guest back: %d", n)
	}
	// Who played before the days read isn't new in them.
	act, _ = w.g.Activity(ctx, "2026-11-12")
	if act.first(ana) != "" || act.first(throwaway) != "2026-11-12" {
		t.Fatal("played before the days read")
	}
}

// A guest who signs in to an account that played the same day is one new player, not two.
func TestNewcomersMerged(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	guest, owner := w.user(), w.user()
	w.stored(guest, "topic", "2026-11-12", true, false)
	w.stored(owner, "topic", "2026-11-12", true, false)
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return w.g.Merge(tx, guest, owner) }); err != nil {
		t.Fatal(err)
	}
	act, _ := w.g.Activity(ctx, "2026-11-01")
	news, err := w.g.Newcomers(ctx, act, "2026-11-01")
	if err != nil || len(news) != 1 {
		t.Fatalf("newcomers: %+v %v", news, err)
	}
}

// The weeks' players: new, kept, back after a pause, lost (D11); and one window for how many play on a day of those
// who play in a month.
func TestGrowthAndStickiness(t *testing.T) {
	w := setup(t)
	w.now = time.Date(2026, 11, 25, 10, 0, 0, 0, Bulgaria) // a Wednesday
	ctx := t.Context()
	kept, back, lost, fresh := w.user(), w.user(), w.user(), w.user()
	// Weeks from Monday: 2–8, 9–15, 16–22 November.
	w.stored(kept, "day", "2026-11-05", true, false)
	w.stored(back, "day", "2026-11-04", true, false)
	w.stored(lost, "day", "2026-11-12", true, false)
	w.stored(kept, "day", "2026-11-13", true, false)
	w.stored(kept, "day", "2026-11-17", true, false)
	w.stored(back, "day", "2026-11-18", true, false)
	w.stored(fresh, "day", "2026-11-20", true, false)
	act, err := w.g.Activity(ctx, "2026-10-26")
	if err != nil {
		t.Fatal(err)
	}
	g := act.Growth("2026-11-25", 3)
	if len(g) != 3 || g[0].Week != "2026-11-16" {
		t.Fatalf("the weeks: %+v", g)
	}
	if x := g[0]; x.New != 1 || x.Kept != 1 || x.Back != 1 || x.Lost != 1 {
		t.Fatalf("16–22: %+v", x)
	}
	if x := g[1]; x.New != 1 || x.Kept != 1 || x.Back != 0 || x.Lost != 1 {
		t.Fatalf("9–15: %+v", x)
	}
	daily, month := act.Stickiness("2026-11-24")
	if month != 4 || daily != 7.0/28 {
		t.Fatalf("stickiness: %v of %d", daily, month)
	}
}

// The habit: the day's ten on 3 of the last 7 days.
func TestHabit(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	for _, d := range []string{"2026-11-06", "2026-11-09", "2026-11-11"} {
		w.stored(ana, "day", d, true, false)
		w.stored(bo, "day", d, true, d == "2026-11-11") // the last at a script's speed: two days, not three
	}
	if n, err := w.g.Habit(ctx, "2026-11-11"); err != nil || n != 1 {
		t.Fatalf("habit: %d %v", n, err)
	}
}

// The version a player met is kept on their first day played, and stays (D3).
func TestFirstVersion(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.g.Version = "v3.9.0"
	ana := w.user()
	s, err := w.g.StartTopic(ctx, ana, "science")
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, w.right)
	w.g.Version = "v3.9.1"
	w.wait(24 * time.Hour)
	s, _ = w.g.StartTopic(ctx, ana, "science")
	w.play(ana, s.ID, w.right)
	var v string
	if err := w.db.Read.QueryRow(`SELECT first_version FROM users WHERE id = ?`, ana).Scan(&v); err != nil || v != "v3.9.0" {
		t.Fatalf("first version: %q %v", v, err)
	}
	// One who played before versions were kept met none of them: not the version of their next day.
	bo := w.user()
	if _, err := w.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?, '2026-01-01')`, bo); err != nil {
		t.Fatal(err)
	}
	s, _ = w.g.StartTopic(ctx, bo, "science")
	w.play(bo, s.ID, w.right)
	var none sql.NullString
	if err := w.db.Read.QueryRow(`SELECT first_version FROM users WHERE id = ?`, bo).Scan(&none); err != nil || none.Valid {
		t.Fatalf("an old player's first version: %v %v", none, err)
	}
}

// Migration 0069 takes back the versions stamped on players from before 0068 first served, and keeps the
// hold-out's first whole day.
func TestFirstVersionsTakenBack(t *testing.T) {
	w := setup(t)
	old, fresh := w.user(), w.user()
	for _, q := range []string{
		`INSERT INTO releases (version, at) VALUES ('v3.9.0', 1795015380000)`, // 18 Nov 2026, 17:23 in Bulgaria
		`INSERT INTO active_days (user_id, day) VALUES (` + strconv.FormatInt(old, 10) + `, '2026-11-10'), (` +
			strconv.FormatInt(old, 10) + `, '2026-11-19'), (` + strconv.FormatInt(fresh, 10) + `, '2026-11-18')`,
		`UPDATE users SET first_version = 'v3.9.0'`,
		`DELETE FROM kv WHERE key = 'reminders_from'`,
	} {
		if _, err := w.db.Write.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	body, err := os.ReadFile("../store/migrations/0069_measures_set_right.sql")
	if err != nil {
		t.Fatal(err)
	}
	// Its parts that set data right (the column it drops is gone already).
	for q := range strings.SplitSeq(string(body), ";\n") {
		if strings.Contains(q, "day_mails") {
			continue
		}
		if _, err := w.db.Write.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	version := func(id int64) string {
		var v sql.NullString
		_ = w.db.Read.QueryRow(`SELECT first_version FROM users WHERE id = ?`, id).Scan(&v)
		return v.String
	}
	if version(old) != "" || version(fresh) != "v3.9.0" {
		t.Fatalf("old %q, fresh %q", version(old), version(fresh))
	}
	if from, err := w.g.ExperimentFrom(t.Context(), HeldReminders); err != nil || from != "2026-11-19" {
		t.Fatalf("the hold-out from %q, %v", from, err)
	}
}

// A game keeps the device it was started on, where ctx says it (D5).
func TestGameKeepsItsDevice(t *testing.T) {
	w := setup(t)
	ana, bo := w.user(), w.user()
	a, err := w.g.StartTopic(FromDevice(t.Context(), ana, "phone"), ana, "science")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := w.g.StartTopic(FromDevice(t.Context(), ana, "phone"), bo, "science") // someone else's device
	var da, db sql.NullString
	_ = w.db.Read.QueryRow(`SELECT device FROM runs WHERE id = ?`, a.ID).Scan(&da)
	_ = w.db.Read.QueryRow(`SELECT device FROM runs WHERE id = ?`, b.ID).Scan(&db)
	if da.String != "phone" || db.Valid {
		t.Fatalf("devices: %v %v", da, db)
	}
}

// A player's bucket is theirs for good, a tenth of players held out (D4).
func TestHoldout(t *testing.T) {
	held := 0
	for id := range int64(20000) {
		if HeldOut(HeldReminders, id) {
			held++
		}
		if Bucket(HeldReminders, id) != Bucket(HeldReminders, id) {
			t.Fatal("a bucket changed")
		}
	}
	if held < 1800 || held > 2200 {
		t.Fatalf("held out: %d of 20000", held)
	}
	same := 0
	for id := range int64(1000) {
		if Bucket(HeldReminders, id) == Bucket("other", id) {
			same++
		}
	}
	if same > 40 {
		t.Fatalf("two experiments' buckets agree for %d of 1000", same)
	}
}

// personRun names the shadow by its number.
func TestPeopleShadows(t *testing.T) {
	if personRun != "shadow <> "+strconv.Itoa(ShadowScript) || ShadowGuest == ShadowScript || ShadowThrowaway == ShadowScript {
		t.Fatalf("personRun: %s", personRun)
	}
}
