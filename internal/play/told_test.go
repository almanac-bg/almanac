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
	if err != nil || n.Ink == 0 {
		t.Fatalf("the day's news: %d in ink, %v", n.Ink, err)
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
	if n, _ := w.g.NewsOf(ctx, ana, b.ID); n.Ink != 0 || n.Pencil {
		t.Fatalf("a game of wrong answers: %+v", n)
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

// A game's news counts the facts it put in the almanac (a question's first right answer, once), says of the player's
// first game that it's the first, and tells a bad game nothing it didn't bring.
func TestNewsFacts(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	right, wrong := w.right, w.wrong
	s, _ := w.g.StartTopic(ctx, ana, "history")
	w.play(ana, s.ID, right, right, right, wrong, wrong, wrong, wrong, wrong, wrong, wrong)
	n, err := w.g.NewsOf(ctx, ana, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if n.Ink != 0 || !n.Pencil || len(n.Notes) != 0 {
		t.Fatalf("a first game, three right: %+v", n)
	}
	s, _ = w.g.StartTopic(ctx, ana, "history")
	w.play(ana, s.ID, repeat(wrong, Length)...)
	n, _ = w.g.NewsOf(ctx, ana, s.ID)
	if n.Pencil || n.Mastery != nil && n.Mastery.To.Known < n.Mastery.From.Known || len(n.Notes) != 0 {
		t.Fatalf("a second game, all wrong: %+v", n)
	}
}
