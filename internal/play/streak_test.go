package play

import (
	"testing"
	"time"
)

// daysPlayed makes a player one who finished the day's questions on each of these days (counted back from today: 1
// is yesterday): games of nothing, worth nothing, for the streak only.
func (w *world) daysPlayed(user int64, back ...int) {
	w.t.Helper()
	for _, d := range back {
		at := w.now.AddDate(0, 0, -d)
		if _, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, started_at, finished_at)
			VALUES (?, 'day', ?, '[{"id":""}]', ?, ?)`, user, at.In(Bulgaria).Format(time.DateOnly), at.UnixMilli(),
			at.UnixMilli()); err != nil {
			w.t.Fatal(err)
		}
	}
}

// playDay plays today's ten, and topic plays a game of a topic: each a game played through, as a player plays it.
func (w *world) playDay(user int64) {
	w.t.Helper()
	s, err := w.g.StartDay(w.t.Context(), user)
	if err != nil {
		w.t.Fatal(err)
	}
	w.play(user, s.ID, repeat(w.right, Length)...)
}

// The longest streak is kept whatever came after, a year in a row too.
func TestTheLongestStreakAndAYear(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	for d := 40; d >= 29; d-- { // twelve days, long ago
		w.daysPlayed(ana, d)
	}
	w.daysPlayed(ana, 3, 2, 1)
	if s, _ := w.g.StatsOf(ctx, ana); s.Streak != 3 || s.Best != 12 {
		t.Fatalf("a streak of 3 after one of 12: streak %d, best %d", s.Streak, s.Best)
	}

	bo := w.user()
	for d := 364; d >= 1; d-- {
		w.daysPlayed(bo, d)
	}
	w.playDay(bo)
	w.g.AftersDone(ctx)
	if s, _ := w.g.StreakOf(ctx, bo); s.Days != 365 || s.Best != 365 {
		t.Fatalf("a year: %+v", s)
	}
}
