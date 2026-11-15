package play

import (
	"slices"
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

func (w *world) topic(user int64) {
	w.t.Helper()
	s, err := w.g.StartTopic(w.t.Context(), user, "history")
	if err != nil {
		w.t.Fatal(err)
	}
	w.play(user, s.ID, repeat(w.right, len(w.picks(s.ID)))...)
}

func (w *world) daysAgo(n int) string {
	return w.now.In(Bulgaria).AddDate(0, 0, -n).Format(time.DateOnly)
}

// A streak of three that ended yesterday (its reserve day spent the day before) is offered back; the day's questions
// and one more game, today, win it back: the day missed counts as kept, the streak goes on, the news says so once.
func TestRepair(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	w.daysPlayed(ana, 5, 4, 3) // three days, and the first day's reserve, spent on the 2nd day back
	s, _ := w.g.StreakOf(ctx, ana)
	if s.Days != 0 || s.Ended == nil || *s.Ended != (Ended{Days: 3, On: w.daysAgo(1)}) {
		t.Fatalf("before: %+v", s)
	}
	r, err := w.g.RepairOf(ctx, ana)
	if err != nil || r == nil || *r != (Repair{Days: 3, On: w.daysAgo(1)}) {
		t.Fatalf("offered: %+v %v", r, err)
	}
	w.playDay(ana)
	if r, _ := w.g.RepairOf(ctx, ana); r == nil || !r.Day || r.Other {
		t.Fatalf("after the day: %+v", r)
	}
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 1 {
		t.Fatalf("the day alone starts a new streak: %+v", s)
	}
	w.topic(ana)
	s, _ = w.g.StreakOf(ctx, ana)
	if s.Days != 4 || s.Ended != nil || !slices.Equal(s.Mended, []string{w.daysAgo(1)}) ||
		!slices.Equal(s.Saved, []string{w.daysAgo(2)}) {
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

// Two days missed are won back as well, the other game first; the offer waits a second day, not a third, and never
// after a day played since.
func TestRepairTwoDays(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi := w.user(), w.user(), w.user()
	w.daysPlayed(ana, 6, 5, 4) // the reserve spent 3 days ago, ended 2 days ago, missed yesterday too
	w.topic(ana)
	if r, _ := w.g.RepairOf(ctx, ana); r == nil || r.On != w.daysAgo(2) || r.Day || !r.Other {
		t.Fatalf("two days missed, the other game played: %+v", r)
	}
	w.playDay(ana)
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 4 || !slices.Equal(s.Mended, []string{w.daysAgo(2), w.daysAgo(1)}) {
		t.Fatalf("two days won back: %+v", s)
	}

	w.daysPlayed(bo, 7, 6, 5) // ended 3 days ago: too long
	if r, _ := w.g.RepairOf(ctx, bo); r != nil {
		t.Fatalf("three days missed: %+v", r)
	}

	w.daysPlayed(vi, 6, 5, 4, 1) // ended 2 days ago, but played yesterday: a new streak has begun
	if r, _ := w.g.RepairOf(ctx, vi); r != nil {
		t.Fatalf("played since: %+v", r)
	}
}

// A streak under RepairFrom isn't offered; nor is one within RepairEvery days of the last repair; nor one a reserve day
// still keeps.
func TestRepairLimits(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	w.daysPlayed(ana, 4, 3) // two days, the reserve spent, ended yesterday
	if s, _ := w.g.StreakOf(ctx, ana); s.Ended == nil || s.Ended.Days != 2 {
		t.Fatalf("a streak of two: %+v", s)
	}
	if r, _ := w.g.RepairOf(ctx, ana); r != nil {
		t.Fatalf("a streak of two offered: %+v", r)
	}

	w.daysPlayed(bo, 3, 2) // a reserve keeps yesterday: nothing ended
	if r, _ := w.g.RepairOf(ctx, bo); r != nil {
		t.Fatalf("a streak still going offered: %+v", r)
	}

	// A repair 29 days ago: none now. One 30 days ago: this one is offered.
	vi := w.user()
	w.daysPlayed(vi, 33, 32, 31, 30, 5, 4, 3)
	if _, err := w.db.Write.Exec(`INSERT INTO streak_repairs (user_id, day, told) VALUES (?, ?, 1)`, vi, w.daysAgo(29)); err != nil {
		t.Fatal(err)
	}
	if r, _ := w.g.RepairOf(ctx, vi); r != nil {
		t.Fatalf("a second repair within 30 days: %+v", r)
	}
	if _, err := w.db.Write.Exec(`UPDATE streak_repairs SET day = ? WHERE user_id = ?`, w.daysAgo(30), vi); err != nil {
		t.Fatal(err)
	}
	if r, _ := w.g.RepairOf(ctx, vi); r == nil || r.Days != 3 {
		t.Fatalf("a repair 30 days after the last: %+v", r)
	}
}

// The longest streak is kept whatever came after; a year in a row is an achievement, with a frame and a title.
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
	if got, _ := w.g.Award(ctx, bo); slices.Contains(got, "streak365") {
		t.Fatal("a year less a day earned the year")
	}
	w.playDay(bo)
	if s, _ := w.g.StreakOf(ctx, bo); s.Days != 365 || s.Best != 365 {
		t.Fatalf("a year: %+v", s)
	}
	p, err := w.g.ProgressOf(ctx, bo)
	if err != nil {
		t.Fatal(err)
	}
	year := p.Achievements[slices.IndexFunc(p.Achievements, func(e Earned) bool { return e.ID == "streak365" })]
	if year.At == 0 || year.Tier != Legendary || year.Name != "Цяла година" {
		t.Fatalf("the year's achievement: %+v", year)
	}
	sun := p.Frames[slices.IndexFunc(p.Frames, func(c Cosmetic) bool { return c.ID == "sun" })]
	title := p.Titles[slices.IndexFunc(p.Titles, func(v TitleView) bool { return v.ID == "fullYear" })]
	if sun.Locked || sun.Name != "Слънце" || title.Locked || title.Name != "Година без пропуск" || title.Tier != Legendary {
		t.Fatalf("the year's frame %+v and title %+v", sun, title)
	}
	frame := "sun"
	if err := w.g.SetLook(ctx, bo, nil, nil, &frame); err != nil {
		t.Fatalf("wearing the sun: %v", err)
	}
	if err := w.g.SetLook(ctx, ana, nil, nil, &frame); err == nil {
		t.Fatal("the sun worn without the year")
	}
}
