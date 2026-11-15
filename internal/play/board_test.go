package play

import (
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A day's board is counted once for a while, for everyone; the viewer's own game is in it at once, finished since or
// not.
func TestBoardKeptAWhile(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	patience, stale := boardPatience, boardStale
	t.Cleanup(func() { boardPatience, boardStale = patience, stale })
	boardPatience, boardStale = 1<<30, time.Hour

	ana, bo, vi := w.user(), w.user(), w.user()
	day := func(user int64, rights int) {
		s, err := w.g.StartDay(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		w.play(user, s.ID, append(repeat(w.right, rights), repeat(w.wrong, Length-rights)...)...)
	}
	today := w.g.Today()
	day(ana, 5)
	if b, err := w.g.BoardOf(ctx, today, vi); err != nil || b.Players != 1 || len(b.Top) != 1 || b.Place != 0 {
		t.Fatalf("the first count: %+v %v", b, err)
	}
	// Bo finishes ahead of Ana after the count: Bo sees their game first, and their place, at once.
	day(bo, 9)
	b, err := w.g.BoardOf(ctx, today, bo)
	if err != nil || b.Players != 2 || len(b.Top) != 2 || !b.Top[0].Me || b.Top[0].Rights != 9 || b.Place != 1 ||
		b.Mine == nil || b.Top[1].Me {
		t.Fatalf("the day as Bo sees it, just played: %+v %v", b, err)
	}
	if b, _ := w.g.BoardOf(ctx, today, ana); b.Players != 1 || b.Place != 1 || !b.Top[0].Me {
		t.Fatalf("the day as Ana sees it, from the count kept: %+v", b)
	}
	// Once it's due, it's counted again, for all.
	boardStale = 0
	if b, _ := w.g.BoardOf(ctx, today, ana); b.Players != 2 || b.Place != 2 || !b.Top[1].Me || b.Top[0].Me {
		t.Fatalf("the day as Ana sees it, counted again: %+v", b)
	}
	if b, _ := w.g.BoardOf(ctx, today, bo); b.Players != 2 || b.Place != 1 || !b.Top[0].Me || len(b.Top) != 2 {
		t.Fatalf("the day as Bo sees it, counted again: %+v", b)
	}
}

// A day's crowd kept is shown fresh for a while; then one answer at a time counts it again, the others shown the
// last count meanwhile; one too old, or of another bank, isn't shown.
func TestDayCrowdCountedByOne(t *testing.T) {
	var d dayCrowdCache
	now, b, c := time.Date(2026, 11, 12, 10, 0, 0, 0, Bulgaria), &bank.Bank{}, &bank.Crowd{Answers: 300}
	d.put("k", c, now, b)
	if got, again := d.get("k", now.Add(time.Second), b); got != c || again {
		t.Fatalf("fresh: %v %v", got, again)
	}
	later := now.Add(dayCrowdFresh)
	if got, again := d.get("k", later, b); got != c || !again {
		t.Fatalf("due, the first: %v %v", got, again)
	}
	if got, again := d.get("k", later, b); got != c || again {
		t.Fatalf("due, while it's counted: %v %v", got, again)
	}
	d.put("k", c, later, b)
	if _, again := d.get("k", later.Add(time.Second), b); again {
		t.Fatal("counted again, still due")
	}
	if got, _ := d.get("k", later.Add(dayCrowdUsable), b); got != nil {
		t.Fatal("shown too old")
	}
	if got, _ := d.get("k", later, &bank.Bank{}); got != nil {
		t.Fatal("shown for another bank")
	}
	d.drop("k")
	if got, _ := d.get("k", later, b); got != nil {
		t.Fatal("shown once dropped")
	}
}
