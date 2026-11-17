package play

import (
	"slices"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// played makes a player one who finished a game on each of the days days before today (a game of nothing, worth
// nothing): one who has met what those days open.
func (w *world) played(user int64, days int) {
	w.t.Helper()
	for d := 1; d <= days; d++ {
		at := store.Ms(w.now.AddDate(0, 0, -d))
		if _, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, category, questions, started_at, finished_at)
			VALUES (?, 'topic', '', '[{"id":""}]', ?, ?)`, user, at, at); err != nil {
			w.t.Fatal(err)
		}
	}
}

func TestOpenTo(t *testing.T) {
	for _, c := range []struct {
		days, rated int
		want        Open
	}{
		{0, 0, Open{}},
		{1, 0, Open{Points: true}},
		{2, 0, Open{Points: true, XP: true}},
		{3, 0, Open{Points: true, XP: true, League: true}},
		{30, 0, Open{Points: true, XP: true, League: true}},
		{1, 1, Open{Points: true, Rating: true}},
	} {
		if got := OpenTo(c.days, c.rated); got != c.want {
			t.Errorf("%d days, %d rated: %+v, not %+v", c.days, c.rated, got, c.want)
		}
	}
	if got := opened(Open{Points: true, XP: true, Rating: true}, "points rating"); !slices.Equal(got, []string{"xp"}) {
		t.Errorf("opened: %v", got)
	}
}

// A new player meets the game one system at a time, by the days they play: on the first, the points and what the
// game's achievements gave; on the second, XP, its level and goals, with what was held for them; on the third, the
// league; with a rated game, the rating. Each is told once, as it opens; nothing earned is lost.
func TestUnfolding(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	if o, _ := w.g.OpenOf(ctx, ana); o != (Open{}) {
		t.Fatalf("before a game: %+v", o)
	}

	// Day 1: the day's ten, then a topic, enough for a level that isn't told yet.
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	n, err := w.g.NewsOf(ctx, ana, s.ID)
	if err != nil || !slices.Equal(n.Opened, []string{"points"}) || n.Open != (Open{Points: true}) || len(n.Goals) != 0 ||
		n.LevelUp || n.League != nil {
		t.Fatalf("the first day's news: %+v %v", n, err)
	}
	if len(n.Achievements) == 0 {
		t.Fatal("the first day's achievements are told")
	}
	for _, u := range n.Unlocks {
		if u.byLevel > 0 {
			t.Fatalf("a level's unlock on the first day: %+v", u)
		}
	}
	// A day's goal done is let go untold; a goals' achievement waits.
	if _, err := w.db.Write.Exec(`INSERT INTO achievements (user_id, id, at, xp) VALUES (?, 'fullDay', 1, 50)`, ana); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		ts, _ := w.g.StartTopic(ctx, ana, "")
		w.play(ana, ts.ID, repeat(w.right, Length)...)
	}
	n, _ = w.g.NewsOf(ctx, ana, 0)
	if n.Level < 2 || n.LevelUp || len(n.Opened) != 0 || slices.ContainsFunc(n.Achievements, func(a Earned) bool {
		return a.ID == "fullDay"
	}) {
		t.Fatalf("a level reached on the first day: %+v", n)
	}
	level := n.Level

	// Day 2: XP opens, and what waited for it is told: the level, its unlocks (but the first level's, which everyone
	// has from the start), the goals' achievement.
	w.wait(24 * time.Hour)
	s, _ = w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.wrong, Length)...)
	n, _ = w.g.NewsOf(ctx, ana, s.ID)
	if !slices.Equal(n.Opened, []string{"xp"}) || !n.Open.XP || n.Open.League || !n.LevelUp || n.Level < level ||
		slices.ContainsFunc(n.Unlocks, func(u Unlock) bool { return u.ID == "spark" || u.byLevel == 1 }) ||
		!slices.ContainsFunc(n.Achievements, func(a Earned) bool { return a.ID == "fullDay" }) ||
		!slices.Contains(n.Goals, DoneGoal{Name: "Изиграй въпросите на деня", XP: GoalXP[0]}) {
		t.Fatalf("the second day's news: %+v", n)
	}
	if again, _ := w.g.NewsOf(ctx, ana, 0); len(again.Opened) != 0 || again.LevelUp || len(again.Unlocks) != 0 {
		t.Fatalf("told twice: %+v", again)
	}

	// Day 3: the league.
	w.wait(24 * time.Hour)
	ts, _ := w.g.StartTopic(ctx, ana, "")
	w.play(ana, ts.ID, repeat(w.right, Length)...)
	if n, _ = w.g.NewsOf(ctx, ana, ts.ID); !slices.Equal(n.Opened, []string{"league"}) || !n.Open.League || n.Open.Rating {
		t.Fatalf("the third day's news: %+v", n)
	}

	// A game that moves the rating opens it.
	if _, err := w.db.Write.Exec(`UPDATE users SET rated = 1 WHERE id = ?`, ana); err != nil {
		t.Fatal(err)
	}
	if n, _ = w.g.NewsOf(ctx, ana, 0); !slices.Equal(n.Opened, []string{"rating"}) || !n.Open.Rating {
		t.Fatalf("a rated game's news: %+v", n)
	}
	if p, _ := w.g.ProgressOf(ctx, ana); p.Open != (Open{Points: true, XP: true, League: true, Rating: true}) {
		t.Fatalf("Профил's open: %+v", p.Open)
	}
}

// A week of the league that ends before the league is open is let go untold: its XP is the player's all the same.
func TestUnfoldingLeagueWeek(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	_, _ = w.g.NewsOf(ctx, ana, s.ID)
	if _, err := w.db.Write.Exec(`INSERT INTO league_results (user_id, week, tier, place, of, points, moved, xp, seen)
		VALUES (?, '2026-11-02', 0, 1, 5, 900, 1, 300, 0)`, ana); err != nil {
		t.Fatal(err)
	}
	before, _ := w.g.totalXP(ctx, ana)
	n, err := w.g.NewsOf(ctx, ana, 0)
	if err != nil || n.League != nil || slices.ContainsFunc(n.Achievements, func(a Earned) bool { return a.ID == "leagueUp" }) {
		t.Fatalf("a week told before the league: %+v %v", n, err)
	}
	// Its XP is kept, and so are the achievements it earned, which wait for the league.
	if after, _ := w.g.totalXP(ctx, ana); after != before+AchievementXP[Common]+AchievementXP[Rare] { // leagueUp, leagueFirst
		t.Fatalf("the week's XP: %d, then %d", before, after)
	}
	w.played(ana, 2)
	n, _ = w.g.NewsOf(ctx, ana, 0)
	if n.League != nil || !n.Open.League || !slices.ContainsFunc(n.Achievements, func(a Earned) bool { return a.ID == "leagueUp" }) {
		t.Fatalf("the league opened: %+v", n)
	}
}
