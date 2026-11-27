package play

import (
	"context"
	"maps"
	"testing"
	"time"
)

// A server that starts again takes up the counts kept by the one before (the hardness, the crowds): nobody waits for
// a count over every answer after a deploy, and each is counted again in the background. A count is kept at most
// every keepEvery.
func TestCountsKeptOverARestart(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.g.CrowdMin = 1
	ana := w.user()
	s, _ := w.g.startChapter(ctx, ana, MixChapter)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	w.wait(CrowdFresh) // the counts the chapter's start made were kept: these are, both stale by then
	if err := w.g.Count(ctx); err != nil {
		t.Fatal(err)
	}
	kept := func() map[string]int64 {
		t.Helper()
		rows, err := w.db.Read.Query(`SELECT name, at FROM counts`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		out := map[string]int64{}
		for rows.Next() {
			var name string
			var at int64
			if err := rows.Scan(&name, &at); err != nil {
				t.Fatal(err)
			}
			out[name] = at
		}
		return out
	}
	first := kept()
	if len(first) != 2 {
		t.Fatalf("kept: %v", first)
	}
	h, _ := w.g.hardness(ctx)
	q, _ := w.b.Get(w.picks(s.ID)[0].ID)
	crowd := w.g.Crowd(q)
	if crowd == nil {
		t.Fatal("no crowd counted")
	}

	restarted := w.newGame()
	restarted.CrowdMin = 1
	gone, cancel := context.WithCancel(ctx)
	cancel() // a request that can't wait at all: what's kept is there at once
	h2, err := restarted.hardness(gone)
	if err != nil || !maps.Equal(h2.byID, h.byID) || len(h2.byChapter[""]) != len(h.byChapter[""]) {
		t.Fatalf("the hardness kept: %v", err)
	}
	if c := restarted.Crowd(q); c == nil || c.Answers != crowd.Answers || c.Right != crowd.Right {
		t.Fatalf("the crowd kept: %+v", c)
	}
	// Taken up as stale (the bank's commit isn't known): counted again at once, for the bank in play.
	restarted.hard.settle()
	restarted.crowds.settle()
	if h3, _ := restarted.hardness(ctx); h3 == h2 {
		t.Fatal("not counted again")
	}

	// Counted again within keepEvery: not written again; after it, written.
	w.wait(keepEvery / 2)
	if err := restarted.Count(ctx); err != nil {
		t.Fatal(err)
	}
	if !maps.Equal(kept(), first) {
		t.Fatalf("kept again within %s: %v, %v", keepEvery, kept(), first)
	}
	w.wait(CrowdFresh)
	if err := restarted.Count(ctx); err != nil {
		t.Fatal(err)
	}
	for name, at := range kept() {
		if at <= first[name] {
			t.Fatalf("%s not kept again after %s", name, keepEvery)
		}
	}
}

// A server that starts again on the bank its kept counts were counted for (its commit) takes them up as its own: not
// counted again as it starts, only once they're stale; on another bank, counted again at once (audit 2026-11-24, Н5).
func TestCountsKeptOfTheBank(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	b := editedSample(t, func(string, map[string]any) {})
	b.Commit = "one"
	w.use(b)
	if err := w.g.Count(ctx); err != nil {
		t.Fatal(err)
	}
	counted := w.clock.now()
	w.wait(time.Minute)

	same := w.newGame()
	if err := same.Count(ctx); err != nil {
		t.Fatal(err)
	}
	if h, c := same.hard.last, same.crowds.last; !h.at.Equal(counted) || h.bank != b || !c.at.Equal(counted) || c.bank != b {
		t.Fatalf("on the same bank, counted again: hardness at %v, crowds at %v (kept at %v)", h.at, c.at, counted)
	}
	w.wait(hardnessFresh)
	if err := same.Count(ctx); err != nil {
		t.Fatal(err)
	}
	if h, c := same.hard.last, same.crowds.last; !h.at.Equal(w.clock.now()) || !c.at.Equal(counted) {
		t.Fatalf("stale, not counted again: hardness at %v, crowds at %v", h.at, c.at)
	}

	other := editedSample(t, func(string, map[string]any) {})
	other.Commit = "two"
	w.use(other)
	next := w.newGame()
	if err := next.Count(ctx); err != nil {
		t.Fatal(err)
	}
	if h, c := next.hard.last, next.crowds.last; !h.at.Equal(w.clock.now()) || h.bank != other || !c.at.Equal(w.clock.now()) || c.bank != other {
		t.Fatalf("on another bank, not counted again: hardness at %v, crowds at %v", h.at, c.at)
	}
}
