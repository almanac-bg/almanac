package play

import (
	"context"
	"database/sql"
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

// A day's run left with its last question showing counts by its own clock, never by when it's next looked at (audit
// 2026-11-24, C-14, and its review): one whose time ran out before its day closed (DayGrace after midnight) is
// finished, kept on its own day, at any later look (a tab woken on it, or Днес the next morning), past DayGrace too;
// one shown just before the close, whose time would run out after it, is left as it was, unfinished, at any look.
func TestPastDayLeftOnItsLastQuestion(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	type left struct {
		why       string
		user, run int64
		shown     time.Time
		counts    bool
	}
	var all []*left
	// leave plays the nine before the tenth of Tuesday the 17th's issue, a player a minute apart.
	leave := func(why string, counts bool) *left {
		l := &left{why: why, user: w.user(), counts: counts}
		w.at(17, 23, 40+len(all), 0)
		s, err := w.g.StartDay(ctx, l.user)
		if err != nil {
			t.Fatal(err)
		}
		l.run = s.ID
		w.playOn(l.user, s.ID, 0, repeat(w.right, Length-1)...)
		all = append(all, l)
		return l
	}
	show := func(l *left) {
		l.shown = w.now
		w.show(l.user, l.run)
	}
	look := func(l *left, today bool) {
		t.Helper()
		if today {
			if open, err := w.g.Unfinished(ctx, l.user); err != nil || open != nil {
				t.Fatalf("%s: offered on Днес at %v: %+v %v", l.why, w.now, open, err)
			}
		} else if s, err := w.g.State(ctx, l.user, l.run); err != nil || s.Done != l.counts {
			t.Fatalf("%s, looked at %v: done %v, %v", l.why, w.now, s.Done, err)
		}
		w.g.AftersDone(ctx)
		var finished sql.NullInt64
		var answers int
		if err := w.db.Read.QueryRow(`SELECT finished_at, (SELECT count(*) FROM answers WHERE run_id = runs.id)
			FROM runs WHERE id = ?`, l.run).Scan(&finished, &answers); err != nil {
			t.Fatal(err)
		}
		if !l.counts {
			if finished.Valid || answers != Length-1 {
				t.Fatalf("%s, looked at %v: finished %v, %d answers", l.why, w.now, finished, answers)
			}
			return
		}
		q, ok := w.b.Get(w.picks(l.run)[Length-1].ID)
		if !ok {
			t.Fatal("the tenth gone from the bank")
		}
		limit := Limit(q)
		if !finished.Valid || finished.Int64 != l.shown.Add(limit).UnixMilli() || answers != Length {
			t.Fatalf("%s, looked at %v: finished %v (its time ran out at %v), %d answers", l.why, w.now,
				finished, l.shown.Add(limit), answers)
		}
		var lookDay bool
		if err := w.db.Read.QueryRow(`SELECT EXISTS (SELECT 1 FROM active_days WHERE user_id = ? AND day = ?)`,
			l.user, dayOf(w.now)).Scan(&lookDay); err != nil {
			t.Fatal(err)
		}
		if lookDay && dayOf(w.now) != dayOf(l.shown.Add(limit)) {
			t.Fatalf("%s: the look's day kept as played, %v", l.why, w.now)
		}
	}

	ranOut := []*left{leave("ran out on its day, looked at in the grace", true),
		leave("ran out on its day, looked at past the grace", true),
		leave("ran out on its day, looked at by Днес the next morning", true),
		leave("ran out on its day, looked at two days later", true)}
	inGrace := leave("ran out in the grace, looked at the next morning", true)
	across := []*left{leave("left mid-time across the close, looked at as its time runs on", false),
		leave("left mid-time across the close, looked at just after", false),
		leave("left mid-time across the close, looked at by Днес the next morning", false),
		leave("left mid-time across the close, looked at two days later", false)}

	w.at(17, 23, 58, 50) // a minute before midnight: the longest time runs out on Tuesday
	for _, l := range ranOut {
		show(l)
	}
	w.at(18, 0, 5, 0)
	show(inGrace)
	look(ranOut[0], false)
	w.at(18, 0, 14, 50) // ten seconds before the close: its time runs out after it, whatever the question
	for _, l := range across {
		show(l)
	}
	w.at(18, 0, 15, 59) // its time, and its answer's LateGrace, over for all but the longest questions
	look(across[0], false)
	w.at(18, 0, 20, 0)
	look(ranOut[1], false)
	look(across[1], false)
	w.at(18, 9, 5, 0)
	look(ranOut[2], true)
	look(across[2], true)
	look(inGrace, false)
	for _, l := range []*left{ranOut[2], across[2], inGrace} { // the morning after Tuesday: its streak
		if st, err := w.g.StreakOf(ctx, l.user); err != nil || st.Days != map[bool]int{true: 1}[l.counts] {
			t.Fatalf("%s: the streak on Wednesday morning: %+v %v", l.why, st, err)
		}
	}
	w.at(20, 12, 0, 0)
	look(ranOut[3], false)
	look(across[3], false)
}
