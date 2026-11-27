package play

import (
	"testing"
	"time"
)

// dayPlayed puts a finished game of a day's ten straight in the database, with its right answers, ended at 10:00 in
// Bulgaria on its day.
func (w *world) dayPlayed(user int64, day string, rights int) int64 {
	w.t.Helper()
	at, _ := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	at = at.Add(10 * time.Hour)
	res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, rights, started_at, finished_at)
		VALUES (?, 'day', ?, '[{"id":""},{"id":""},{"id":""},{"id":""},{"id":""},{"id":""},{"id":""},{"id":""},{"id":""},{"id":""}]',
		?, ?, ?)`, user, day, rights, at.Add(-3*time.Minute).UnixMilli(), at.UnixMilli())
	if err != nil {
		w.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

// A player back after days away is welcomed by the last day they played; one who played yesterday isn't away.
func TestAway(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.clock.set(time.Date(2026, 11, 20, 12, 0, 0, 0, Bulgaria))
	ana, bo, cy := w.user(), w.user(), w.user()
	w.dayPlayed(ana, "2026-11-14", 5)
	w.dayPlayed(ana, "2026-11-17", 5)
	w.dayPlayed(ana, "2026-11-20", 5) // today's doesn't count: the last before today is what's said
	w.dayPlayed(bo, "2026-11-19", 5)
	for _, c := range []struct {
		who  int64
		last string
		away bool
	}{{ana, "2026-11-17", true}, {bo, "2026-11-19", false}, {cy, "", false}} {
		last, err := w.g.LastDay(ctx, c.who)
		if err != nil || last != c.last || w.g.Away(last) != c.away {
			t.Fatalf("player %d: last %q (want %q), away %v (want %v), %v", c.who, last, c.last, w.g.Away(last), c.away, err)
		}
	}
}
