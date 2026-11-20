package play

import (
	"context"
	"maps"
	"testing"
)

// A server that starts again takes up the counts kept by the one before (the hardness, the crowds, the boards of
// knowledge): nobody waits for a count over every answer after a deploy, and each is counted again in the background.
// A count is kept at most every keepEvery.
func TestCountsKeptOverARestart(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.g.CrowdMin = 1
	ana := w.user()
	s, _ := w.g.StartTopic(ctx, ana, MixTopic)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	w.wait(keepEvery) // the counts the topic's start made were kept: these are, keepEvery after them
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
	if len(first) != 3 {
		t.Fatalf("kept: %v", first)
	}
	h, _ := w.g.hardness(ctx)
	k, _ := w.g.knowledge(ctx)
	q, _ := w.b.Get(w.picks(s.ID)[0].ID)
	crowd := w.g.Crowd(q)
	if crowd == nil {
		t.Fatal("no crowd counted")
	}

	restarted := &Game{DB: w.db, Bank: w.g.Bank, Now: w.g.Now, CrowdMin: 1}
	gone, cancel := context.WithCancel(ctx)
	cancel() // a request that can't wait at all: what's kept is there at once
	h2, err := restarted.hardness(gone)
	if err != nil || !maps.Equal(h2.byID, h.byID) || len(h2.byTopic[""]) != len(h.byTopic[""]) {
		t.Fatalf("the hardness kept: %v", err)
	}
	k2, err := restarted.knowledge(gone)
	if err != nil || len(k2[""]) != 1 || k2[""][0] != k[""][0] {
		t.Fatalf("the knowledge kept: %+v %v", k2, err)
	}
	if c := restarted.Crowd(q); c == nil || c.Answers != crowd.Answers || c.Right != crowd.Right {
		t.Fatalf("the crowd kept: %+v", c)
	}
	// Taken up as stale: counted again at once, for the bank in play.
	restarted.hard.settle()
	restarted.known.settle()
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
	w.wait(keepEvery)
	if err := restarted.Count(ctx); err != nil {
		t.Fatal(err)
	}
	for name, at := range kept() {
		if at <= first[name] {
			t.Fatalf("%s not kept again after %s", name, keepEvery)
		}
	}
}
