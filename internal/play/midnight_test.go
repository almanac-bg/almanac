package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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
	w.clock.set(time.Date(2026, 11, day, hour, minute, second, 0, Bulgaria))
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
// 2026-11-24, C-14, and its reviews): one whose time ran out in its run's time, before its day closed (DayGrace after
// midnight) or, shown before the close, after it, is finished, kept on its own day, at any later look (a tab woken on
// it, or Днес the next morning), past DayGrace too.
func TestPastDayLeftOnItsLastQuestion(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	type left struct {
		why       string
		user, run int64
		shown     time.Time
		limit     time.Duration
	}
	var all []*left
	// leave plays the nine before the tenth of Tuesday the 17th's issue, a player a minute apart.
	leave := func(why string) *left {
		l := &left{why: why, user: w.user()}
		w.at(17, 23, 40+len(all), 0)
		s, err := w.g.StartDay(ctx, l.user)
		if err != nil {
			t.Fatal(err)
		}
		l.run = s.ID
		w.playOn(l.user, s.ID, 0, repeat(w.right, Length-1)...)
		q, ok := w.b.Get(w.picks(s.ID)[Length-1].ID)
		if !ok {
			t.Fatal("the tenth gone from the bank")
		}
		l.limit = Limit(q)
		all = append(all, l)
		return l
	}
	show := func(l *left) {
		l.shown = w.clock.now()
		w.show(l.user, l.run)
	}
	look := func(l *left, today bool) {
		t.Helper()
		if today { // as Днес does: the player's runs settled, then yesterday's offered if it's open
			if err := w.g.SettleLeft(ctx, l.user); err != nil {
				t.Fatal(err)
			}
			if open, err := w.g.Unfinished(ctx, l.user); err != nil || open != nil {
				t.Fatalf("%s: offered on Днес at %v: %+v %v", l.why, w.clock.now(), open, err)
			}
		} else if s, err := w.g.State(ctx, l.user, l.run); err != nil || !s.Done {
			t.Fatalf("%s, looked at %v: done %v, %v", l.why, w.clock.now(), s.Done, err)
		}
		w.g.AftersDone(ctx)
		var finished sql.NullInt64
		var answers int
		if err := w.db.Read.QueryRow(`SELECT finished_at, (SELECT count(*) FROM answers WHERE run_id = runs.id)
			FROM runs WHERE id = ?`, l.run).Scan(&finished, &answers); err != nil {
			t.Fatal(err)
		}
		if !finished.Valid || finished.Int64 != l.shown.Add(l.limit).UnixMilli() || answers != Length {
			t.Fatalf("%s, looked at %v: finished %v (its time ran out at %v), %d answers", l.why, w.clock.now(),
				finished, l.shown.Add(l.limit), answers)
		}
		var lookDay bool
		if err := w.db.Read.QueryRow(`SELECT EXISTS (SELECT 1 FROM active_days WHERE user_id = ? AND day = ?)`,
			l.user, dayOf(w.clock.now())).Scan(&lookDay); err != nil {
			t.Fatal(err)
		}
		if lookDay && dayOf(w.clock.now()) != dayOf(l.shown.Add(l.limit)) {
			t.Fatalf("%s: the look's day kept as played, %v", l.why, w.clock.now())
		}
	}

	ranOut := []*left{leave("ran out on its day, looked at in the grace"),
		leave("ran out on its day, looked at past the grace"),
		leave("ran out on its day, looked at by Днес the next morning"),
		leave("ran out on its day, looked at two days later")}
	inGrace := leave("ran out in the grace, looked at the next morning")
	across := []*left{leave("left mid-time across the close, looked at as its time is over"),
		leave("left mid-time across the close, looked at just after"),
		leave("left mid-time across the close, looked at by Днес the next morning"),
		leave("left mid-time across the close, looked at two days later")}

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
	w.clock.set(across[0].shown.Add(across[0].limit + LateGrace + time.Second)) // its time, and its answer's LateGrace, over
	look(across[0], false)
	w.at(18, 0, 20, 0)
	look(ranOut[1], false)
	look(across[1], false)
	w.at(18, 9, 5, 0)
	look(ranOut[2], true)
	look(across[2], true)
	look(inGrace, false)
	for _, l := range []*left{ranOut[2], across[2], inGrace} { // the morning after Tuesday: its streak
		if st, err := w.g.StreakOf(ctx, l.user); err != nil || st.Days != 1 {
			t.Fatalf("%s: the streak on Wednesday morning: %+v %v", l.why, st, err)
		}
	}
	w.at(20, 12, 0, 0)
	look(ranOut[3], false)
	look(across[3], false)
}

// tuesdayLeft makes a player one who finished Sunday's and Monday's issues (22 and 23 November), and plays Tuesday's
// nine before its tenth, which shows on the given day and time and is left to run out, the phone locked (the review
// of #783). It says the run, and when the tenth's time runs out.
func (w *world) tuesdayLeft(user int64, day, hour, minute, second int) (int64, time.Time) {
	w.t.Helper()
	w.at(24, 23, 30, 0)
	w.daysPlayed(user, 2, 1)
	s, err := w.g.StartDay(w.t.Context(), user)
	if err != nil {
		w.t.Fatal(err)
	}
	w.playOn(user, s.ID, 0, repeat(w.right, Length-1)...)
	w.at(day, hour, minute, second)
	if shown := w.show(user, s.ID); shown.Question == nil || shown.Done {
		w.t.Fatalf("the tenth not showing: %+v", shown)
	}
	q, ok := w.b.Get(w.picks(s.ID)[Length-1].ID)
	if !ok {
		w.t.Fatal("the tenth gone from the bank")
	}
	return s.ID, w.clock.now().Add(Limit(q))
}

// A day whose tenth ran out in its time counts as the day closes, by the minute's sweep alone (SettleLeft), with
// nobody looking: the streak, the day's board and the friends' board have it, kept as its time ran out. A tenth shown
// just before the close, whose time runs out after it, counts the same with the phone locked (the sweep) as with the
// tab open (the screen's null as its countdown ends): both close at the same moment (lastClose).
func TestDayClosedCountsWithoutALook(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy, dan := w.user(), w.user(), w.user(), w.user()
	w.befriend(ana, bo)
	aRun, ranOut := w.tuesdayLeft(ana, 24, 23, 58, 0)
	w.at(24, 23, 50, 0)
	w.dayGame(bo, nil)                              // Bo played Tuesday's through
	cRun, cOut := w.tuesdayLeft(cy, 25, 0, 14, 50)  // the phone locked
	dRun, dOut := w.tuesdayLeft(dan, 25, 0, 14, 50) // the tab open
	w.at(25, 0, 1, 0)                               // a minute after Ana's tenth ran out, and its LateGrace
	if err := w.g.SettleLeft(ctx, 0); err != nil {
		t.Fatal(err)
	}
	w.clock.set(dOut)
	if res, err := w.answer(dan, dRun, Length-1, json.RawMessage("null")); err != nil || !res.State.Done {
		t.Fatalf("Dan's null as the tenth ran out, at %v: %+v %v", w.clock.now(), res, err)
	}
	w.at(25, 0, 20, 0) // Cy's ran out past the close: the sweep settles it as Dan's screen did
	if err := w.g.SettleLeft(ctx, 0); err != nil {
		t.Fatal(err)
	}
	w.g.AftersDone(ctx)
	for _, f := range []struct {
		who string
		run int64
		out time.Time
	}{{"Ana", aRun, ranOut}, {"Cy", cRun, cOut}, {"Dan", dRun, dOut}} {
		var finished sql.NullInt64
		if err := w.db.Read.QueryRow(`SELECT finished_at FROM runs WHERE id = ?`, f.run).Scan(&finished); err != nil ||
			finished.Int64 != f.out.UnixMilli() {
			t.Fatalf("%s's Tuesday finished at %v, its time ran out at %v (%v)", f.who, finished, f.out, err)
		}
	}
	w.at(25, 9, 5, 0)
	for _, u := range []int64{ana, cy, dan} {
		if st, err := w.g.StreakOf(ctx, u); err != nil || st.Days != 3 || len(st.Forgiven) != 0 {
			t.Fatalf("player %d's streak on Wednesday: %+v %v", u, st, err)
		}
	}
	if b, err := w.g.BoardOf(ctx, "2026-11-24", ana); err != nil || b.Players != 4 || b.Place == 0 {
		t.Fatalf("Tuesday's board: %d players, Ana's place %d (%v)", b.Players, b.Place, err)
	}
	if f, err := w.g.FriendsBoard(ctx, "2026-11-24", bo); err != nil || len(f) != 2 {
		t.Fatalf("Bo's friends' board of Tuesday: %+v %v", f, err)
	}
}

// A question's time run out is kept as it ran out, however it's told: the screen's own null, sent as its countdown
// ends, from a tab woken in the grace after midnight, keeps Tuesday's tenth on Tuesday, as the sweep or a look would.
func TestTimedOutAnswerKeptAsItRanOut(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	run, ranOut := w.tuesdayLeft(ana, 24, 23, 58, 0)
	w.at(25, 0, 5, 0)
	res, err := w.answer(ana, run, Length-1, json.RawMessage("null"))
	if err != nil || !res.TimedOut || !res.State.Done {
		t.Fatalf("the tenth's null at 00:05: %+v %v", res, err)
	}
	var finished, at int64
	var wednesday bool
	if err := w.db.Read.QueryRow(`SELECT r.finished_at, a.at, EXISTS (SELECT 1 FROM active_days WHERE user_id = ?
		AND day = '2026-11-25') FROM runs r JOIN answers a ON a.run_id = r.id AND a.n = ? WHERE r.id = ?`,
		ana, Length-1, run).Scan(&finished, &at, &wednesday); err != nil {
		t.Fatal(err)
	}
	if finished != ranOut.UnixMilli() || at != ranOut.UnixMilli() || wednesday {
		t.Fatalf("kept at %v, finished at %v, Wednesday played %v; its time ran out at %v", time.UnixMilli(at),
			time.UnixMilli(finished), wednesday, ranOut)
	}
	if st, err := w.g.StreakOf(ctx, ana); err != nil || st.Days != 3 {
		t.Fatalf("the streak: %+v %v", st, err)
	}
}

// A game is gone over on its own day, and DayGrace after it at least, however it ended (reviewOpen): Ana's Tuesday,
// its last question run out just before midnight and settled by the sweep after it, closes for review as Bo's,
// finished by its answers at 23:59, does; and with it how her friends did (FriendsOn).
func TestReviewOfADayThatRanOut(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	aRun, _ := w.tuesdayLeft(ana, 24, 23, 58, 50)
	w.at(24, 23, 58, 30)
	bRun := w.dayGame(bo, nil) // three seconds a question: finished at 23:59
	w.at(25, 0, 2, 0)
	if err := w.g.SettleLeft(ctx, 0); err != nil {
		t.Fatal(err)
	}
	w.g.AftersDone(ctx)
	review := func(user, run int64) error {
		t.Helper()
		_, err := w.g.Review(ctx, user, run)
		if _, ferr := w.g.FriendsOn(ctx, user, run); ferr != err {
			t.Fatalf("how friends did at %v: %v, the review %v", w.clock.now(), ferr, err)
		}
		return err
	}
	w.at(25, 0, 10, 0)
	if err := review(ana, aRun); err != nil {
		t.Fatalf("Ana's Tuesday, run out at 23:59, at 00:10: %v", err)
	}
	if err := review(bo, bRun); err != nil {
		t.Fatalf("Bo's Tuesday, finished at 23:59, at 00:10: %v", err)
	}
	w.at(25, 0, 20, 0)
	if err := review(ana, aRun); !errors.Is(err, ErrReviewOver) {
		t.Fatalf("Ana's Tuesday, run out at 23:59, at 00:20: %v", err)
	}
	if err := review(bo, bRun); !errors.Is(err, ErrReviewOver) {
		t.Fatalf("Bo's Tuesday, finished at 23:59, at 00:20: %v", err)
	}
}
