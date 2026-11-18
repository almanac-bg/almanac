package royal

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// A cut keeps everyone level on right answers with the last who goes on, up to a quarter more: past that, the time
// decides among those level, up to the cap.
func TestThrough(t *testing.T) {
	s := func(rights ...int) []play.RoyalScore {
		out := make([]play.RoyalScore, len(rights))
		for i, r := range rights {
			out[i] = play.RoyalScore{User: int64(i), Rights: r, Ms: int64(1000 * (i + 1))}
		}
		return out
	}
	for _, c := range []struct {
		scores  []play.RoyalScore
		keep    int
		through int
		timed   bool
	}{
		{s(5, 5, 4, 4, 3), 3, 4, false},       // the fourth level with the third: through, within the cap (4)
		{s(5, 4, 4, 4, 4), 3, 4, true},        // five level past the cap: the quicker, to it
		{s(5, 5, 5, 3, 3), 3, 3, false},       // nobody level at the line
		{s(4, 4, 4), 2, 3, false},             // three level of three, cap 3: all
		{s(4, 4, 4, 4), 3, 4, false},          // cap 4
		{s(2, 2), 3, 2, false},                // no more than it keeps
		{s(3, 3, 3, 3, 3, 3, 3), 4, 5, true},  // keep 4, cap 5
		{s(9, 8, 8, 8, 8, 8, 8), 2, 3, true},  // keep 2, cap 3
		{s(9, 8, 7, 7, 7, 7, 7), 2, 2, false}, // the line on a lone score
	} {
		through, timed := play.RoyalThrough(c.scores, c.keep)
		if through != c.through || timed != c.timed {
			t.Errorf("%v keeping %d: %d through (timed %v), want %d (%v)", c.scores, c.keep, through, timed, c.through, c.timed)
		}
	}
	if play.RoyalCap(30) != 38 || play.RoyalCap(3) != 4 || play.RoyalCap(2) != 3 {
		t.Error("the cap isn't a quarter more, rounded up")
	}
	// Level in time too at the cap: both, or neither.
	level := []play.RoyalScore{{Rights: 5}, {Rights: 4, Ms: 10}, {Rights: 4, Ms: 20}, {Rights: 4, Ms: 20}, {Rights: 4, Ms: 30}}
	if through, timed := play.RoyalThrough(level, 2); through != 4 || !timed {
		t.Errorf("level in time at the cap: %d (%v)", through, timed)
	}
}

// Of five, the first cut keeps three: one level with the third on right answers goes on too, however slow, and the
// line speaks of right answers alone.
func TestLevelThroughTheCut(t *testing.T) {
	w := setup(t)
	ana, bo, vi, zed, eli := w.player(), w.player(), w.player(), w.player(), w.player()
	w.start(ana, bo, vi, zed, eli)
	for n := range 5 {
		if n > 0 {
			w.onward()
		}
		w.give(ana, true)
		w.give(bo, true)
		w.give(vi, n != 0)
		w.wait(5 * time.Second)
		w.give(zed, n != 1) // as many right as Vi, much slower
		w.give(eli, n > 1)
		if n == 3 {
			v := w.view(zed.ID)
			if c := v.Cut; c == nil || c.Now || c.Keep != 3 || c.Line == nil || c.Line.Rights != 3 || c.Timed {
				t.Fatalf("the line before the cut: %+v", v.Cut)
			}
			if !v.Me.Goes || v.Me.Rank != 4 {
				t.Fatalf("Zed, level with Vi but slower, would go on: %+v", v.Me)
			}
			if m := v.mine(); !m.Right || m.Ms != 5000 || m.InRow != 2 {
				t.Fatalf("Zed's answer, its time and the row: %+v", m)
			}
		}
	}
	v := w.view(zed.ID)
	if v.Phase != play.RoyalReveal || !v.Cut.Now || v.Out || v.Left != 4 || v.WentOut != 1 {
		t.Fatalf("the cut, Zed level with the third: %+v %+v", v, v.Cut)
	}
	if v := w.view(eli.ID); !v.Out || v.Me.Rights != 3 || v.Me.Reached != 3 {
		t.Fatalf("Eli out: %+v", v)
	}
}

// Fewer than two there at the start: the lobby waits for more, five minutes at most; one who comes in that time
// starts the game, and one who leaves may. A restart in the wait waits on.
func TestTooFew(t *testing.T) {
	w := setup(t)
	w.hub(Evening)
	ctx := t.Context()
	type call struct {
		start, until time.Time
		away, in     []int64
	}
	calls := make(chan call, 4)
	short := func(_ context.Context, start, until time.Time, away, in []int64) {
		calls <- call{start, until, away, in}
	}
	w.h.Short = short
	ana, bo, vi := w.player(), w.player(), w.player()
	w.at(20, 50, 0)
	w.follow(ana.ID)
	if err := w.h.Join(ctx, ana); err != nil {
		t.Fatal(err)
	}
	w.at(21, 0, 0)
	v := w.view(ana.ID)
	start := time.Date(2026, 11, 14, 21, 0, 0, 0, play.Bulgaria)
	if v.Phase != play.RoyalLobby || !v.In || v.Wait != start.Add(5*time.Minute).UnixMilli() || v.Least != 2 {
		t.Fatalf("alone at the start: %+v", v)
	}
	if c := <-calls; !c.until.Equal(start.Add(5*time.Minute)) || len(c.away) != 0 || len(c.in) != 1 {
		t.Fatalf("the call: %+v", c)
	}
	if !w.h.Near(0) {
		t.Fatal("not near while the lobby waits")
	}
	// A restart in the wait: still waiting.
	w.hub(Evening)
	w.h.Short = short
	if err := w.h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	w.follow(ana.ID)
	w.at(21, 1, 0)
	if v := w.view(ana.ID); v.Phase != play.RoyalLobby || v.Wait == 0 {
		t.Fatalf("after a restart in the wait: %+v", v)
	}
	// Bo comes and goes; Vi comes and stays: the game begins with two.
	w.follow(bo.ID)
	if err := w.h.Join(ctx, bo); err != nil {
		t.Fatalf("in while the lobby waits: %v", err)
	}
	if err := w.h.Leave(ctx, bo.ID); err != nil {
		t.Fatalf("out while the lobby waits: %v", err)
	}
	w.wait(time.Second)
	if v := w.view(ana.ID); v.Phase != play.RoyalLobby {
		t.Fatalf("begun with one who left: %+v", v)
	}
	w.follow(vi.ID)
	if err := w.h.Join(ctx, vi); err != nil {
		t.Fatal(err)
	}
	w.wait(time.Second)
	if v := w.view(vi.ID); v.Phase != play.RoyalQuestion || v.Entered != 2 || !v.In {
		t.Fatalf("begun with two: %+v", v)
	}
	// The door is open from the late start.
	if v := w.view(bo.ID); !v.Late {
		t.Fatalf("Bo can't come in late: %+v", v)
	}
}

// Still too few once the wait is over: the evening is off, its tournament ended with nobody in it, and those of its
// lobby told so until the next evening's.
func TestCalledOff(t *testing.T) {
	w := setup(t)
	w.hub(Evening)
	ctx := t.Context()
	ana, bo := w.player(), w.player()
	w.at(20, 50, 0)
	w.follow(ana.ID)
	if err := w.h.Join(ctx, ana); err != nil {
		t.Fatal(err)
	}
	w.at(21, 4, 59)
	if v := w.view(ana.ID); v.Phase != play.RoyalLobby || v.Off {
		t.Fatalf("the wait's last second: %+v", v)
	}
	w.at(21, 5, 0)
	v := w.view(ana.ID)
	tomorrow := time.Date(2026, 11, 15, 21, 0, 0, 0, play.Bulgaria).UnixMilli()
	if v.Phase != "soon" || !v.Off || v.In || v.Next != tomorrow || v.StartsAt != tomorrow {
		t.Fatalf("called off: %+v", v)
	}
	if v := w.view(bo.ID); v.Off {
		t.Fatalf("Bo, not in it, told it's off: %+v", v)
	}
	var ended, rows int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM royals WHERE ended_at IS NOT NULL`).Scan(&ended)
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM royal_players`).Scan(&rows)
	if ended != 1 || rows != 0 {
		t.Fatalf("the tournament: %d ended, %d in it", ended, rows)
	}
	if w.h.Near(0) {
		t.Fatal("near after it was called off")
	}
	if err := w.h.Join(ctx, bo); !errors.Is(err, ErrShut) {
		t.Fatalf("in after it was called off: %v", err)
	}
	// Told until the next evening's lobby opens.
	w.at(23, 0, 0)
	if v := w.view(ana.ID); !v.Off {
		t.Fatalf("not told later: %+v", v)
	}
	w.wait(21*time.Hour + 46*time.Minute)
	if v := w.view(ana.ID); v.Phase != play.RoyalLobby || v.Off {
		t.Fatalf("the next evening: %+v", v)
	}
}
