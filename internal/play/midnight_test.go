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

// What follows a run is judged by the run, not by when it's done: the sweep's retry after midnight keeps the goals of
// the run's day, not the next one's, however late it comes.
func TestAfterRetryAcrossMidnight(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	ana, bo := w.user(), w.user()
	// What follows their Sunday runs fails (a goal can't be kept), as if the server had stopped there.
	if _, err := w.db.Write.Exec(`CREATE TEMP TRIGGER stop BEFORE INSERT ON goals_done
		BEGIN SELECT RAISE(ABORT, 'stopped'); END`); err != nil {
		t.Fatal(err)
	}
	w.at(15, 23, 50, 0)
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

	// Ana's is retried at 00:05: Sunday's goals.
	w.at(16, 0, 5, 0)
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM goals_done WHERE user_id = ? AND day = '2026-11-15' AND goal = 'day'`, ana); n != 1 {
		t.Fatal("the retry after midnight didn't keep Sunday's goal")
	}
	if n := w.count(`SELECT count(*) FROM goals_done WHERE user_id = ? AND day = '2026-11-16'`, ana); n != 0 {
		t.Fatal("Sunday's run counted for Monday's goals")
	}
	// Bo's comes an hour after midnight: Sunday's goals still.
	w.at(16, 1, 0, 0)
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM goals_done WHERE user_id = ? AND day = '2026-11-16'`, bo); n != 0 {
		t.Fatal("Sunday's run counted for Monday's goals")
	}
	if n := w.count(`SELECT count(*) FROM goals_done WHERE user_id = ? AND day = '2026-11-15' AND goal = 'day'`, bo); n != 1 {
		t.Fatal("Bo's late retry didn't keep Sunday's goal")
	}
}

// The day's goals are the day's game's, though its last answers came after midnight: all ten answers count on its own
// day (a row, eight of ten), and its goals are kept.
func TestGoalsAcrossMidnight(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	w.at(15, 12, 0, 0)
	w.daysPlayed(ana, 3, 2, 1) // Thursday to Saturday
	w.setGoals(ana, "day", "row5", "eight")
	w.sundayLate(ana)
	var done []string
	rows, err := w.db.Read.Query(`SELECT goal FROM goals_done WHERE user_id = ? AND day = '2026-11-15' ORDER BY goal`, ana)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		done = append(done, id)
	}
	rows.Close()
	if !slices.Equal(done, []string{"day", "eight", "row5"}) {
		t.Fatalf("Sunday's goals done: %v", done)
	}
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 4 {
		t.Fatalf("Sunday's game, finished after midnight, isn't Sunday's: %+v", s)
	}
	// Monday's goals are Monday's: Sunday's game moved none of them.
	if goals := w.goalsOf(ana); goals["day"].Done || goals["day"].Progress != 0 {
		t.Fatalf("Monday's goals: %+v", goals)
	}
	if moved, err := w.g.GoalsMoved(ctx, ana, dayRun(t, w, ana)); err != nil || len(moved) != 0 {
		t.Fatalf("Sunday's game told as moving goals: %+v %v", moved, err)
	}
}
