package play

import (
	"database/sql"
	"testing"
	"time"
)

// stored puts a game straight in the database: begun at 10:00 in Bulgaria on its day, with a question answered.
func (w *world) stored(user int64, kind, day string, finished, scripted bool) {
	w.t.Helper()
	at, _ := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	at = at.Add(10 * time.Hour)
	var end any
	if finished {
		end = at.Add(5 * time.Minute).UnixMilli()
	}
	var dayCol any
	if kind == "day" {
		dayCol = day
	}
	if _, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, at, started_at, finished_at, shadow)
		VALUES (?, ?, ?, '[]', 1, ?, ?, ?)`, user, kind, dayCol, at.UnixMilli(), end, scripted); err != nil {
		w.t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(`INSERT OR IGNORE INTO active_days (user_id, day) VALUES (?, ?)`, user, day); err != nil {
		w.t.Fatal(err)
	}
}

// /admin counts people (review 2026-11-18, D1): not a player at a script's speed, nor an admin; a gone player's days
// still, as nobody's.
func TestPeopleDays(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, script, admin, bo := w.user(), w.user(), w.user(), w.user()
	w.stored(ana, "chapter", "2026-11-11", true, false)
	w.stored(ana, "day", "2026-11-12", true, false)
	w.stored(script, "day", "2026-11-12", true, true)
	w.stored(admin, "day", "2026-11-12", true, false)
	_, _ = w.db.Write.Exec(`UPDATE users SET admin = 1 WHERE id = ?`, admin)
	w.stored(bo, "chapter", "2026-11-12", true, false)
	_, _ = w.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (-999, '2026-11-12')`) // one gone
	// A day kept with no game that day to tell it by (a game begun the evening before, say, long before): not counted.
	_, _ = w.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?, '2026-11-10')`, ana)

	act, err := w.g.Activity(ctx, "2026-11-01")
	if err != nil {
		t.Fatal(err)
	}
	if n := playedOn(act, "2026-11-12"); n != 3 {
		t.Fatalf("people on the 12th: %d, want Ана, Бо and the one gone", n)
	}
	if playedOn(act, "2026-11-10") != 0 || act.first(ana) != "2026-11-11" {
		t.Fatalf("Ана's first day: %q", act.first(ana))
	}
	// Who played before the days read isn't new in them.
	act, _ = w.g.Activity(ctx, "2026-11-12")
	if act.first(ana) != "" || act.first(bo) != "2026-11-12" {
		t.Fatal("played before the days read")
	}
}

// A guest who signs in to an account that played the same day is one new player, not two.
func TestNewcomersMerged(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	guest, owner := w.user(), w.user()
	w.stored(guest, "chapter", "2026-11-12", true, false)
	w.stored(owner, "chapter", "2026-11-12", true, false)
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return w.g.Merge(tx, guest, owner) }); err != nil {
		t.Fatal(err)
	}
	act, _ := w.g.Activity(ctx, "2026-11-01")
	for _, c := range act.DayCounts() {
		if c.Day == "2026-11-12" && (c.New != 1 || c.Played != 1) {
			t.Fatalf("the 12th: %+v", c)
		}
	}
}

// /admin's table: a day's players, those new on it, and of those, who played again 1, 7 and 30 days after, told only
// once that day is over; one who played before the days read is never new in them.
func TestDayCounts(t *testing.T) {
	w := setup(t)
	w.now = time.Date(2026, 12, 20, 10, 0, 0, 0, Bulgaria)
	ana, bo, old := w.user(), w.user(), w.user()
	w.stored(old, "day", "2026-10-01", true, false)
	w.stored(old, "day", "2026-11-12", true, false)
	w.stored(ana, "day", "2026-11-12", true, false)
	w.stored(ana, "day", "2026-11-13", true, false)
	w.stored(ana, "chapter", "2026-12-12", true, false)
	w.stored(bo, "day", "2026-11-12", true, false)
	w.stored(bo, "day", "2026-11-19", true, false)
	w.stored(bo, "day", "2026-12-19", true, false)
	act, err := w.g.Activity(t.Context(), "2026-11-01")
	if err != nil {
		t.Fatal(err)
	}
	days := act.DayCounts()
	if len(days) != 50 || days[0].Day != "2026-12-20" || days[49].Day != "2026-11-01" {
		t.Fatalf("the days: %d, %s to %s", len(days), days[0].Day, days[len(days)-1].Day)
	}
	byDay := map[string]DayCount{}
	for _, d := range days {
		byDay[d.Day] = d
	}
	if d := byDay["2026-11-12"]; d.Played != 3 || d.New != 2 || d.Back != [3]int{1, 1, 1} || d.Due != [3]bool{true, true, true} {
		t.Fatalf("the 12th: %+v", d)
	}
	if d := byDay["2026-12-19"]; d.Played != 1 || d.New != 0 || d.Due != [3]bool{} {
		t.Fatalf("yesterday: %+v", d)
	}
	if d := byDay["2026-11-25"]; d.Due != [3]bool{true, true, false} {
		t.Fatalf("the 25th: %+v", d)
	}
}

// playedOn is how many played on a day, as /admin's table counts them.
func playedOn(a *Activity, day string) int {
	for _, d := range a.DayCounts() {
		if d.Day == day {
			return d.Played
		}
	}
	return 0
}
