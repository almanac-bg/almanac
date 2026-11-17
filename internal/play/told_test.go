package play

import (
	"testing"
	"time"
)

// A game that ended without its news on screen waits for Начало, once; news told with a game tells every game
// finished before it too, and one too old is let go.
func TestUntold(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	untold := func() int64 {
		t.Helper()
		id, err := w.g.Untold(ctx, ana)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	if id := untold(); id != 0 {
		t.Fatalf("before a game: %d", id)
	}
	// The day, its last question let run out (its result never shown): its news waits, and isn't told by news of no
	// game.
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	if id := untold(); id != s.ID {
		t.Fatalf("the day untold: %d, not %d", id, s.ID)
	}
	w.g.NewsOf(ctx, ana, 0)
	if id := untold(); id != s.ID {
		t.Fatalf("told by news of no game: %d", id)
	}
	n, err := w.g.NewsOf(ctx, ana, s.ID)
	if err != nil || n.Kind != "day" || n.Facts == 0 {
		t.Fatalf("the day's news: kind %q, %d facts, %v", n.Kind, n.Facts, err)
	}
	if id := untold(); id != 0 {
		t.Fatalf("told, still untold: %d", id)
	}
	// Two games, the news of the second: both told.
	a, _ := w.g.StartTopic(ctx, ana, "history")
	w.play(ana, a.ID, repeat(w.wrong, Length)...)
	w.wait(time.Minute)
	b, _ := w.g.StartTopic(ctx, ana, "history")
	w.play(ana, b.ID, repeat(w.wrong, Length)...)
	if id := untold(); id != b.ID {
		t.Fatalf("the latest untold: %d, not %d", id, b.ID)
	}
	if n, _ := w.g.NewsOf(ctx, ana, b.ID); n.Facts != 0 || n.Kind != "topic" {
		t.Fatalf("a game of wrong answers: %d facts, kind %q", n.Facts, n.Kind)
	}
	if id := untold(); id != 0 {
		t.Fatalf("the earlier game still untold: %d", id)
	}
	// A game too long ago is let go.
	c, _ := w.g.StartTopic(ctx, ana, "history")
	w.play(ana, c.ID, repeat(w.wrong, Length)...)
	w.wait(UntoldWithin + time.Hour)
	if id := untold(); id != 0 {
		t.Fatalf("an old game untold: %d", id)
	}
}

// A game's news counts the facts it put in the almanac: a question's first right answer, once; the goals it moved
// without finishing them are told with how far along they are.
func TestNewsFactsAndGoals(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	w.played(ana, XPFromDay-1)
	day := w.g.Today()
	for n, goal := range []string{"day", "know:history", "right30"} {
		if _, err := w.db.Write.Exec(`INSERT INTO day_goals (user_id, day, n, goal) VALUES (?, ?, ?, ?)`,
			ana, day, n, goal); err != nil {
			t.Fatal(err)
		}
	}
	right, wrong := w.right, w.wrong
	s, _ := w.g.StartTopic(ctx, ana, "history")
	w.play(ana, s.ID, right, right, right, wrong, wrong, wrong, wrong, wrong, wrong, wrong)
	n, err := w.g.NewsOf(ctx, ana, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	moved := map[string]int{}
	for _, d := range n.Moved {
		moved[d.ID] = d.Progress
	}
	if len(moved) != 2 || moved["know:history"] != 3 || moved["right30"] != 3 {
		t.Fatalf("goals moved: %+v", n.Moved)
	}
	if n.Facts > 3 || n.Facts == 0 {
		t.Fatalf("facts of three right answers: %d", n.Facts)
	}
	// A second game finishing one goal and moving the other: the finished one is told as done, not as moved.
	s, _ = w.g.StartTopic(ctx, ana, "history")
	w.play(ana, s.ID, right, right, right, wrong, wrong, wrong, wrong, wrong, wrong, wrong)
	n, _ = w.g.NewsOf(ctx, ana, s.ID)
	if len(n.Moved) != 1 || n.Moved[0].ID != "right30" || n.Moved[0].Progress != 6 || len(n.Goals) != 1 {
		t.Fatalf("one done, one moved: moved %+v, done %+v", n.Moved, n.Goals)
	}
}

// The day's result says how many of its questions will wait for a second chance: those got wrong and never right.
func TestMisses(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	right, wrong := w.right, w.wrong
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, right, right, right, wrong, wrong, wrong, wrong, wrong, wrong, wrong)
	if missed, all, err := w.g.Misses(ctx, ana, s.ID); err != nil || missed != 7 || all != 7 {
		t.Fatalf("the day's misses: %d of %d, %v", missed, all, err)
	}
	// A topic's misses wait too; the day's own are still the day's.
	ts, _ := w.g.StartTopic(ctx, ana, "history")
	w.play(ana, ts.ID, repeat(wrong, Length)...)
	missed, all, _ := w.g.Misses(ctx, ana, s.ID)
	if topic, _, _ := w.g.Misses(ctx, ana, ts.ID); missed != 7 || all != 7+topic || topic == 0 {
		t.Fatalf("after a topic: the day's %d, the topic's %d, %d in all", missed, topic, all)
	}
}

// A question missed in two games waits once, and one put right in another game waits no more, in either.
func TestMissesAcrossGames(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, w.right, w.right, w.right, w.wrong, w.wrong, w.wrong, w.wrong, w.wrong, w.wrong, w.wrong)
	w.wait(MistakesAfter)
	m, err := w.g.StartMistakes(ctx, ana)
	if err != nil || m.Total != 7 {
		t.Fatalf("the second chance: %+v, %v", m, err)
	}
	w.play(ana, m.ID, w.right, w.wrong, w.wrong, w.wrong, w.wrong, w.wrong, w.wrong)
	for _, id := range []int64{s.ID, m.ID} {
		if missed, all, err := w.g.Misses(ctx, ana, id); err != nil || missed != 6 || all != 6 {
			t.Fatalf("run %d: %d of %d, %v; want 6 of 6", id, missed, all, err)
		}
	}
}
