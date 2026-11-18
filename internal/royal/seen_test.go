package royal

import (
	"errors"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// A player's time runs from when their own screen showed the question (Seen), within bounds, so that a slow line costs
// nobody a place at a cut: of as many right answers, the one quicker on their own screen stands ahead. A screen that
// never says is waited for to the latest it could have shown the question; one whose own time is up can't answer
// while another's still runs (review 2026-11-18, M1).
func TestTimedFromTheScreen(t *testing.T) {
	w := setup(t)
	ana, bo, vi := w.player(), w.player(), w.player()
	w.start(ana, bo, vi)
	q := w.h.night.dealt[0].Question()
	lag, limit := play.LagOf(q), play.Limit(q)

	// Ana's screen shows the first question at once, Bo's a second later (a slow line); both answer three seconds
	// after the evening showed it.
	w.h.Seen(ana.ID, 0)
	w.wait(time.Second)
	w.h.Seen(bo.ID, 0)
	if v := w.view(bo.ID); v.LeftMs != v.Question.LimitMs {
		t.Fatalf("Bo's time left as his screen shows it: %d of %d ms", v.LeftMs, v.Question.LimitMs)
	}
	w.wait(2 * time.Second)
	w.give(ana, true)
	w.give(bo, true)
	// Vi's screen never says, nor does she answer: the answer waits for her time, from the latest it could have.
	w.wait(limit + play.Grace - 3*time.Second + 100*time.Millisecond)
	if v := w.view(ana.ID); v.Phase != play.RoyalQuestion {
		t.Fatalf("the answer shown before Vi's time is up: %+v", v)
	}
	w.wait(lag)
	a, b := w.view(ana.ID), w.view(bo.ID)
	if a.Phase != play.RoyalReveal || a.mine().Ms != 3000 || b.mine().Ms != 2000 {
		t.Fatalf("Ana's three seconds, Bo's two: %+v / %+v", a.Mine, b.Mine)
	}
	if b.Me.Rank != 1 || a.Me.Rank != 2 || b.Me.Ms != 2000 {
		t.Fatalf("Bo ahead, quicker on his own screen: %+v / %+v", b.Me, a.Me)
	}

	// The second: Ana's screen shows it at once, Bo's LagOf later (a word sent later still counts no more). Ana's
	// time is up first: her answer then is too late, while the question waits for Bo's.
	w.onward()
	q = w.h.night.dealt[1].Question()
	lag, limit = play.LagOf(q), play.Limit(q)
	w.h.Seen(ana.ID, 1)
	w.wait(lag + time.Second)
	w.h.Seen(bo.ID, 1)
	w.wait(limit - lag - time.Second + play.Grace + lag/2)
	if err := w.h.Answer(t.Context(), ana.ID, 1, w.answer(ana, true)); !errors.Is(err, ErrNotNow) {
		t.Fatalf("Ana's answer after her time: %v", err)
	}
	w.give(bo, true)
	w.give(vi, true)
	if v := w.view(ana.ID); v.Phase != play.RoyalReveal || !v.mine().Missed || !w.view(bo.ID).mine().Right {
		t.Fatalf("the second answer: %+v / %+v", v.Mine, w.view(bo.ID).Mine)
	}
}
