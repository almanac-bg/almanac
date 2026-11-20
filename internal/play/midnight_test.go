package play

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"
)

// playOn answers a run's questions from n on, three seconds each, as its player does.
func (w *world) playOn(user, runID int64, from int, answers ...func(int64, int) json.RawMessage) {
	w.t.Helper()
	for i, a := range answers {
		n := from + i
		w.show(user, runID)
		w.wait(3 * time.Second)
		if _, err := w.answer(user, runID, n, a(runID, n)); err != nil {
			w.t.Fatalf("answer %d: %v", n, err)
		}
	}
}

// at sets the clock to a moment of November 2026, in Bulgaria.
func (w *world) at(day, hour, minute, second int) {
	w.now = time.Date(2026, 11, day, hour, minute, second, 0, Bulgaria)
}

// sundayLate starts a player's day on Sunday 15 November at 23:58, answers half of it right before midnight, and the
// other half right at 00:02 (review 2026-11-18, A2, A3).
func (w *world) sundayLate(user int64) int64 {
	w.t.Helper()
	w.at(15, 23, 58, 0)
	s, err := w.g.StartDay(w.t.Context(), user)
	if err != nil {
		w.t.Fatal(err)
	}
	w.playOn(user, s.ID, 0, repeat(w.right, Length/2)...)
	w.at(16, 0, 2, 0)
	w.playOn(user, s.ID, Length/2, repeat(w.right, Length-Length/2)...)
	return s.ID
}

// What follows a run is judged by the run, not by when it's done: the sweep's retry after midnight notes a streak's
// week on the run's day, not the next one, however late it comes.
func TestAfterRetryAcrossMidnight(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	ana, bo := w.user(), w.user()
	w.at(15, 23, 50, 0)
	w.daysPlayed(ana, 6, 5, 4, 3, 2, 1) // Monday to Saturday: Sunday's day is the seventh in a row
	w.daysPlayed(bo, 6, 5, 4, 3, 2, 1)
	// What follows their Sunday runs fails (a note can't be kept), as if the server had stopped there.
	if _, err := w.db.Write.Exec(`CREATE TEMP TRIGGER stop BEFORE INSERT ON notes
		BEGIN SELECT RAISE(ABORT, 'stopped'); END`); err != nil {
		t.Fatal(err)
	}
	w.dayGame(ana, nil, repeat(w.wrong, Length)...)
	w.dayGame(bo, nil, repeat(w.wrong, Length)...)
	if _, err := w.db.Write.Exec(`DROP TRIGGER stop`); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM runs_after`); n != 2 {
		t.Fatalf("%d runs left to follow up", n)
	}
	if _, err := w.db.Write.Exec(`UPDATE runs_after SET due = ? WHERE run_id = ?`,
		time.Date(2026, 11, 16, 1, 0, 0, 0, Bulgaria).UnixMilli(), dayRun(t, w, bo)); err != nil {
		t.Fatal(err)
	}
	week := func(user int64, day string) int {
		return w.count(`SELECT count(*) FROM notes WHERE user_id = ? AND kind = 'streak' AND n = 7 AND day = ?`, user, day)
	}
	// Ana's is retried at 00:05, Bo's an hour after midnight: Sunday's week, both.
	w.at(16, 0, 5, 0)
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	w.at(16, 1, 0, 0)
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	for _, u := range []int64{ana, bo} {
		if week(u, "2026-11-15") != 1 || week(u, "2026-11-16") != 0 {
			t.Fatalf("player %d: the week noted on Sunday %d, on Monday %d", u, week(u, "2026-11-15"),
				week(u, "2026-11-16"))
		}
	}
}

// Yesterday's run still being played just after midnight (within DayGrace) leaves yesterday open: the streak isn't
// told as forgiven or ended at 00:03 for a day that counts once it's finished at 00:05; once the grace is over, it's
// missed.
func TestStreakWaitsForYesterdaysRun(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy := w.user(), w.user(), w.user()
	w.at(15, 23, 50, 0)
	w.daysPlayed(ana, 6, 5, 4, 3, 2) // Monday to Friday; Saturday missed: the week's day forgiven
	w.daysPlayed(bo, 6, 5, 4, 3, 2, 1)
	w.daysPlayed(cy, 6, 5, 4, 3, 2)
	half := func(user int64) int64 {
		w.at(15, 23, 58, 0)
		s, err := w.g.StartDay(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		w.playOn(user, s.ID, 0, repeat(w.right, Length/2)...)
		return s.ID
	}
	aRun, bRun := half(ana), half(bo)
	half(cy)
	streak := func(user int64) StreakNow {
		t.Helper()
		s, err := w.g.StreakOf(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	w.at(16, 0, 3, 0)
	if s := streak(ana); s.Days != 5 || s.Ended != nil || !slices.Equal(s.Forgiven, []string{"2026-11-14"}) {
		t.Fatalf("Ana at 00:03, Sunday's run under way: %+v", s)
	}
	if s := streak(bo); s.Days != 6 || s.Ended != nil || len(s.Forgiven) != 0 {
		t.Fatalf("Bo at 00:03, Sunday's run under way: %+v", s)
	}
	w.at(16, 0, 5, 0)
	w.playOn(ana, aRun, Length/2, repeat(w.right, Length-Length/2)...)
	w.playOn(bo, bRun, Length/2, repeat(w.right, Length-Length/2)...)
	if s := streak(ana); s.Days != 6 || s.Ended != nil {
		t.Fatalf("Ana, Sunday finished at 00:05: %+v", s)
	}
	if s := streak(bo); s.Days != 7 || len(s.Forgiven) != 0 {
		t.Fatalf("Bo, Sunday finished at 00:05: %+v", s)
	}
	// Cy left Sunday's run unfinished: past the grace, Sunday is missed, the week's second, and the streak ends.
	w.at(16, 0, 30, 0)
	if s := streak(cy); s.Days != 0 || s.Ended == nil || s.Ended.On != "2026-11-15" || s.Ended.Days != 5 {
		t.Fatalf("Cy, Sunday left past the grace: %+v", s)
	}
}
