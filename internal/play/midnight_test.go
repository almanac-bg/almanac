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

// What follows a run is judged by the run, not by when it's done: the sweep's retry after midnight still counts the
// ranks from the Sunday issue's ink, however late it comes.
func TestAfterRetryAcrossMidnight(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	ana, bo := w.user(), w.user()
	w.at(15, 23, 50, 0)
	// What follows their Sunday runs fails (a rank can't be kept), as if the server had stopped there.
	if _, err := w.db.Write.Exec(`CREATE TEMP TRIGGER stop BEFORE INSERT ON ranks
		BEGIN SELECT RAISE(ABORT, 'stopped'); END`); err != nil {
		t.Fatal(err)
	}
	w.dayGame(ana, nil)
	w.dayGame(bo, nil)
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
	ranked := func(user int64) int { return w.count(`SELECT count(*) FROM ranks WHERE user_id = ?`, user) }
	// Ana's is retried at 00:05, Bo's an hour after midnight.
	w.at(16, 0, 5, 0)
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	w.at(16, 1, 0, 0)
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	for _, u := range []int64{ana, bo} {
		if ranked(u) == 0 {
			t.Fatalf("player %d: no ranks from Sunday's issue", u)
		}
	}
	if n := w.count(`SELECT count(*) FROM runs_after`); n != 0 {
		t.Fatalf("%d runs still to follow up", n)
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
	w.daysPlayed(cy, 6, 5, 4, 2) // Thursday and Saturday missed: the week's two forgiven
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
	// Cy left Sunday's run unfinished: past the grace, Sunday is missed, the week's third, and the streak ends.
	w.at(16, 0, 30, 0)
	if s := streak(cy); s.Days != 0 || s.Ended == nil || s.Ended.On != "2026-11-15" || s.Ended.Days != 4 {
		t.Fatalf("Cy, Sunday left past the grace: %+v", s)
	}
}

// Yesterday's issue left half-way just before midnight is Днес's to finish while the game lets it (DayGrace): offered
// where it stopped, and finished, it counts for its own day; past the grace, or finished, it isn't offered.
func TestUnfinishedAfterMidnight(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	w.at(15, 23, 58, 0)
	s, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if open, err := w.g.Unfinished(ctx, ana); err != nil || open != nil {
		t.Fatalf("today's own issue offered as yesterday's: %+v %v", open, err)
	}
	w.playOn(ana, s.ID, 0, repeat(w.right, 4)...)
	w.at(16, 0, 5, 0)
	open, err := w.g.Unfinished(ctx, ana)
	if err != nil || open == nil || open.ID != s.ID || open.Day != "2026-11-15" || open.At != 4 {
		t.Fatalf("Sunday's issue at 00:05: %+v %v", open, err)
	}
	w.playOn(ana, s.ID, 4, repeat(w.right, Length-4)...)
	if open, _ := w.g.Unfinished(ctx, ana); open != nil {
		t.Fatalf("finished, offered still: %+v", open)
	}
	if done := w.show(ana, s.ID); !done.Done || done.Day != "2026-11-15" {
		t.Fatalf("Sunday's issue, finished after midnight: %+v", done)
	}
	// Bo left his half-way too, and comes back past the grace: nothing to offer.
	bo := w.user()
	w.at(16, 23, 58, 0)
	b, err := w.g.StartDay(ctx, bo)
	if err != nil {
		t.Fatal(err)
	}
	w.playOn(bo, b.ID, 0, repeat(w.right, 3)...)
	w.at(17, 0, 30, 0)
	if open, err := w.g.Unfinished(ctx, bo); err != nil || open != nil {
		t.Fatalf("Monday's issue past the grace: %+v %v", open, err)
	}
}

// A day's run left with its last question showing stays as it was left once its day is over: a look at it the next
// morning (a tab woken on it) doesn't finish it, and the day it missed stays missed (audit 2026-11-24, C-14).
func TestPastDayLeftOnItsLastQuestion(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	w.at(17, 23, 58, 0)
	s, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	w.playOn(ana, s.ID, 0, repeat(w.right, Length-1)...)
	w.at(17, 23, 59, 30)
	w.show(ana, s.ID) // the tenth, left showing; its time runs out before midnight
	w.at(18, 9, 0, 0)
	look, err := w.g.State(ctx, ana, s.ID)
	if err != nil || look.Done {
		t.Fatalf("Tuesday's run, looked at on Wednesday: %+v %v", look, err)
	}
	w.g.AftersDone(ctx)
	if st, err := w.g.StreakOf(ctx, ana); err != nil || st.Days != 0 {
		t.Fatalf("Tuesday's run, left on its tenth, counts after a look: %+v %v", st, err)
	}
	var finished, answers int
	if err := w.db.Read.QueryRow(`SELECT finished_at IS NOT NULL, (SELECT count(*) FROM answers WHERE run_id = runs.id)
		FROM runs WHERE id = ?`, s.ID).Scan(&finished, &answers); err != nil || finished != 0 || answers != Length-1 {
		t.Fatalf("the look wrote to Tuesday's run: finished %d, answers %d, %v", finished, answers, err)
	}
}
