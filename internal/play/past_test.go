package play

import (
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"
)

// issueOn makes a day's ten as their day had them (drawn, kept in days), for the days a test goes back to.
func (w *world) issueOn(day string) []Pick {
	w.t.Helper()
	var picks []Pick
	err := w.db.Tx(w.t.Context(), func(tx *sql.Tx) error {
		var err error
		picks, err = w.g.day(tx, day, w.b)
		return err
	})
	if err != nil {
		w.t.Fatal(err)
	}
	return picks
}

// past plays a player's game of a past issue through, each answer as `how` says.
func (w *world) past(user int64, day string, how func(n int) func(int64, int) json.RawMessage) State {
	w.t.Helper()
	s, err := w.g.StartPast(w.t.Context(), user, day)
	if err != nil {
		w.t.Fatal(err)
	}
	for n := s.At; !s.Done; n++ {
		s = w.show(user, s.ID)
		if s.Done {
			break
		}
		w.wait(3 * time.Second)
		res, err := w.answer(user, s.ID, s.At, how(n)(s.ID, s.At))
		if err != nil {
			w.t.Fatal(err)
		}
		s = res.State
	}
	return s
}

// A past issue is the day's ten as that day played them, once, for whoever didn't finish them then; it counts for
// nothing that's the day's (its board, the streak, the goals, the league), and says how it went against that day's
// players.
func TestPastIssue(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.now = time.Date(2026, 11, 20, 10, 0, 0, 0, Bulgaria)
	day := w.g.Today()
	bo, vi, ana := w.user(), w.user(), w.user()
	allRight := func(int) func(int64, int) json.RawMessage { return w.right }
	allWrong := func(int) func(int64, int) json.RawMessage { return w.wrong }
	w.dayAs(bo, -1, allRight)
	w.dayAs(vi, -1, allWrong)
	dayPicks := w.picks(w.dayAs(bo, 0, allRight).ID)

	// Not yet: its own day, and the quarter of an hour after its midnight while its last games may still be played.
	if _, err := w.g.StartPast(ctx, ana, day); !errors.Is(err, ErrNoIssue) {
		t.Fatalf("on its day: %v", err)
	}
	w.now = time.Date(2026, 11, 21, 0, 5, 0, 0, Bulgaria)
	if _, err := w.g.StartPast(ctx, ana, day); !errors.Is(err, ErrNoIssue) {
		t.Fatalf("before its day settled: %v", err)
	}
	if l, _ := w.g.PastIssues(ctx, ana); slices.ContainsFunc(l, func(p PastIssue) bool { return p.Day == day }) {
		t.Fatalf("listed before its day settled: %+v", l)
	}
	w.now = time.Date(2026, 11, 21, 10, 0, 0, 0, Bulgaria)
	if _, err := w.g.StartPast(ctx, ana, "2026-11-11"); !errors.Is(err, ErrNoIssue) {
		t.Fatalf("before the first issue: %v", err)
	}
	if _, err := w.g.StartPast(ctx, bo, day); !errors.Is(err, ErrIssuePlayed) {
		t.Fatalf("played on its day: %v", err)
	}
	list, err := w.g.PastIssues(ctx, ana)
	if err != nil || len(list) != 1 || list[0] != (PastIssue{Day: day, Issue: 9, Players: 2}) {
		t.Fatalf("the list: %+v %v", list, err)
	}
	if p, _ := w.g.LatestPast(ctx, ana); p == nil || p.Day != day {
		t.Fatalf("the latest unplayed: %+v", p)
	}
	if p, _ := w.g.LatestPast(ctx, bo); p != nil {
		t.Fatalf("the latest unplayed of one who played it: %+v", p)
	}

	// Started and left after one answer: it waits, whenever it's come back to.
	s, err := w.g.StartPast(ctx, ana, day)
	if err != nil || s.Kind != "past" || s.Day != day {
		t.Fatalf("started: %+v %v", s, err)
	}
	got := w.picks(s.ID)
	for i := range got {
		if got[i].ID != dayPicks[i].ID || got[i].Seed != dayPicks[i].Seed {
			t.Fatalf("not the day's questions as dealt: %+v, the day's %+v", got, dayPicks)
		}
	}
	w.show(ana, s.ID)
	w.wait(3 * time.Second)
	if _, err := w.answer(ana, s.ID, 0, w.right(s.ID, 0)); err != nil {
		t.Fatal(err)
	}
	w.wait(48 * time.Hour)
	if l, _ := w.g.Left(ctx, ana); len(l) != 1 || l[0].Kind != "past" || l[0].Day != day || l[0].At != 1 {
		t.Fatalf("left: %+v", l)
	}
	again, _ := w.g.StartPast(ctx, ana, day)
	if again.ID != s.ID || again.At != 1 {
		t.Fatalf("come back to: %+v", again)
	}
	// Half right: better than Vi (none), not than Bo (all).
	end := w.past(ana, day, func(n int) func(int64, int) json.RawMessage {
		if n < 5 {
			return w.right
		}
		return w.wrong
	})
	if !end.Done || end.Rights != 5 {
		t.Fatalf("played: %+v", end)
	}
	st, err := w.g.PastStandingOf(ctx, ana, end.ID)
	if err != nil || st != (PastStanding{Players: 2, Better: 50}) {
		t.Fatalf("against the day's players: %+v %v", st, err)
	}
	if p, _ := w.g.PastIssueOf(ctx, ana, day); p.Mine == nil || p.Mine.ID != end.ID || !p.Mine.Done || p.Mine.Rights != 5 {
		t.Fatalf("the issue, played: %+v", p.Mine)
	}
	if p, _ := w.g.LatestPast(ctx, ana); p != nil {
		t.Fatalf("played, still the latest unplayed: %+v", p)
	}
	if again, _ := w.g.StartPast(ctx, ana, day); again.ID != end.ID || !again.Done {
		t.Fatalf("once: %+v", again)
	}

	// Nothing of the day's: its board, the streak, the goals, the league.
	if b, _ := w.g.BoardOf(ctx, day, ana); b.Players != 2 || b.Mine != nil {
		t.Fatalf("on the day's board: %+v", b)
	}
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 0 {
		t.Fatalf("a streak: %+v", s)
	}
	goals, err := w.g.goalsOn(ctx, ana, w.g.Today())
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range goals {
		if g.Progress != 0 {
			t.Fatalf("a goal moved: %+v", goals)
		}
	}
	if n := w.count(`SELECT count(*) FROM league_members WHERE user_id = ?`, ana); n != 0 {
		t.Fatalf("in a league: %d", n)
	}
	if xp := w.count(`SELECT xp FROM runs WHERE id = ?`, end.ID); xp >= XPDay {
		t.Fatalf("the day's XP: %d", xp)
	}
}

// A question that counted for nobody on its day counts for nobody in its past issue either, nor does one found untrue
// since; the issue's players are compared on the questions it counts.
func TestPastIssueVoids(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.reload(w.b)
	w.now = time.Date(2026, 11, 20, 10, 0, 0, 0, Bulgaria)
	day := w.g.Today()
	bo, ana := w.user(), w.user()
	allRight := func(int) func(int64, int) json.RawMessage { return w.right }
	sb := w.dayAs(bo, -1, allRight)
	picks := w.picks(sb.ID)
	if _, err := w.db.Write.Exec(`UPDATE days SET questions = json_set(questions, '$[2].void', json('true')) WHERE day = ?`,
		day); err != nil {
		t.Fatal(err)
	}
	untrue := picks[6].ID
	w.reload(editedSample(t, func(id string, q map[string]any) {
		if id == untrue {
			q["retired"], q["retiredWhy"] = true, "wrong"
		}
	}))
	w.now = time.Date(2026, 11, 22, 10, 0, 0, 0, Bulgaria)
	s := w.past(ana, day, allRight)
	if !s.Done || s.Void != 2 || s.Rights != Length-2 || s.AllRight != AllRight || !s.Trail[2].Void || !s.Trail[6].Void {
		t.Fatalf("eight of eight: %+v", s)
	}
	if n := w.count(`SELECT count(*) FROM answers WHERE run_id = ? AND n IN (2, 6)`, s.ID); n != 0 {
		t.Fatalf("shown a void question: %d", n)
	}
	// Bo had all ten (the day's nine) right, as fast: level with Ana on the eight, not behind.
	if st, _ := w.g.PastStandingOf(ctx, ana, s.ID); st.Players != 1 || st.Better != 0 {
		t.Fatalf("against Bo: %+v", st)
	}
}

// A broken streak is won back by the day missed, played as its past issue, and today's: not by any other game.
func TestRepairByTheMissedIssue(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.now = time.Date(2026, 11, 25, 10, 0, 0, 0, Bulgaria)
	ana := w.user()
	w.daysPlayed(ana, 5, 4, 3) // three days, a reserve spent on the 2nd day back, yesterday missed: ended
	missed := w.daysAgo(1)
	w.issueOn(missed)
	r, err := w.g.RepairOf(ctx, ana)
	if err != nil || r == nil || r.Days != 3 || r.On != missed ||
		!slices.Equal(r.Missed, []MissedIssue{{Day: missed, Issue: Issue(missed), Open: true}}) {
		t.Fatalf("offered: %+v %v", r, err)
	}
	if got := r.MissedWords(); got != "пропуснатия брой от 24 ноември" {
		t.Fatalf("its words: %q", got)
	}
	w.topic(ana) // another game: not the repair
	w.playDay(ana)
	if r, _ := w.g.RepairOf(ctx, ana); r == nil || !r.Day || r.Missed[0].Done {
		t.Fatalf("after the day and a topic: %+v", r)
	}
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 1 {
		t.Fatalf("not won back yet: %+v", s)
	}
	w.past(ana, missed, func(int) func(int64, int) json.RawMessage { return w.wrong }) // how it went doesn't matter
	s, _ := w.g.StreakOf(ctx, ana)
	if s.Days != 4 || s.Ended != nil || !slices.Equal(s.Mended, []string{missed}) {
		t.Fatalf("won back: %+v", s)
	}
	if r, _ := w.g.RepairOf(ctx, ana); r != nil {
		t.Fatalf("offered again once done: %+v", r)
	}
	if n, _ := w.g.NewsOf(ctx, ana, 0); n.Mended != 4 {
		t.Fatalf("news: mended %d", n.Mended)
	}
	if n, _ := w.g.NewsOf(ctx, ana, 0); n.Mended != 0 {
		t.Fatalf("told twice: %d", n.Mended)
	}
	if c, _ := w.g.Tallies(ctx, w.g.Today(), w.g.Today()); c["repair:done"] != 1 {
		t.Fatalf("counted: %v", c)
	}
	// It goes on as any streak: tomorrow's day makes five.
	w.wait(24 * time.Hour)
	w.playDay(ana)
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 5 || len(s.Mended) != 1 {
		t.Fatalf("the day after: %+v", s)
	}
}

// Two days missed: both issues, in any order, on any day of the offer, and today's.
func TestRepairTwoIssues(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.now = time.Date(2026, 11, 25, 10, 0, 0, 0, Bulgaria)
	ana := w.user()
	w.daysPlayed(ana, 6, 5, 4) // the reserve spent 3 days ago, ended 2 days ago, missed yesterday too
	first, second := w.daysAgo(2), w.daysAgo(1)
	w.issueOn(first)
	w.issueOn(second)
	r, _ := w.g.RepairOf(ctx, ana)
	if r == nil || len(r.Missed) != 2 || r.MissedWords() != "пропуснатите броеве от 23 и 24 ноември" {
		t.Fatalf("two missed: %+v", r)
	}
	right := func(int) func(int64, int) json.RawMessage { return w.right }
	w.past(ana, second, right)
	if r, _ := w.g.RepairOf(ctx, ana); r == nil || r.Missed[0].Done || !r.Missed[1].Done ||
		r.MissedWords() != "пропуснатия брой от 23 ноември" {
		t.Fatalf("one of two played: %+v", r)
	}
	w.playDay(ana)
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 1 {
		t.Fatalf("one issue still missed: %+v", s)
	}
	w.past(ana, first, right)
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 4 || !slices.Equal(s.Mended, []string{first, second}) {
		t.Fatalf("two days won back: %+v", s)
	}
}
