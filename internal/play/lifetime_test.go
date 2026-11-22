package play

import (
	"errors"
	"testing"
	"time"
)

// A run of the day's questions ends with its day, DayGrace after: one started and left (no question shown), or left
// half-way, can't be played on the next day, its answers known by then, to keep a streak or move a past board
// (review 2026-11-18, A4). It stays as it was, counting for nothing. One begun before midnight is finished after it,
// and a question shown before the grace ends keeps its time.
func TestDayRunEndsWithItsDay(t *testing.T) {
	w := setup(t) // Thursday, 12 November, 10:00
	ctx := t.Context()
	day := w.g.Today()
	ana, bo := w.user(), w.user()
	left, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	half, err := w.g.StartDay(ctx, bo)
	if err != nil {
		t.Fatal(err)
	}
	w.play(bo, half.ID, repeat(w.right, 2)...)

	w.now = time.Date(2026, 11, 13, 10, 0, 0, 0, Bulgaria)
	for _, c := range []struct {
		user, run int64
		n         int
	}{{ana, left.ID, 0}, {bo, half.ID, 2}} {
		if _, err := w.g.Show(ctx, c.user, c.run); !errors.Is(err, ErrDayOver) {
			t.Fatalf("shown the next day: %v", err)
		}
		if _, err := w.g.Start(ctx, c.user, c.run, c.n); !errors.Is(err, ErrDayOver) {
			t.Fatalf("started the next day: %v", err)
		}
		if _, err := w.g.Answer(ctx, c.user, c.run, c.n, w.right(c.run, c.n)); !errors.Is(err, ErrDayOver) {
			t.Fatalf("answered the next day: %v", err)
		}
		if s, err := w.g.State(ctx, c.user, c.run); err != nil || s.Done || s.At != c.n || s.Question != nil {
			t.Fatalf("the run left: %+v %v", s, err)
		}
	}
	if b, err := w.g.BoardOf(ctx, day, 0); err != nil || b.Players != 0 {
		t.Fatalf("the day's board: %+v %v", b, err)
	}
	if n := w.count(`SELECT count(*) FROM runs WHERE finished_at IS NOT NULL`); n != 0 {
		t.Fatalf("%d runs finished", n)
	}
	// The next day is a day of its own.
	if s, err := w.g.StartDay(ctx, ana); err != nil || s.ID == left.ID || s.Day != w.g.Today() {
		t.Fatalf("the next day's run: %+v %v", s, err)
	}

	// Begun at 23:58, half before midnight and half after: finished, and the day's.
	cy := w.user()
	w.now = time.Date(2026, 11, 13, 23, 58, 0, 0, Bulgaria)
	late, err := w.g.StartDay(ctx, cy)
	if err != nil {
		t.Fatal(err)
	}
	w.play(cy, late.ID, repeat(w.right, Length/2)...)
	w.now = time.Date(2026, 11, 14, 0, 5, 0, 0, Bulgaria)
	for n := Length / 2; n < Length; n++ {
		w.show(cy, late.ID)
		w.wait(3 * time.Second)
		if _, err := w.g.Answer(ctx, cy, late.ID, n, w.right(late.ID, n)); err != nil {
			t.Fatalf("answer %d after midnight: %v", n, err)
		}
	}
	if s, err := w.g.Streak(ctx, cy); err != nil || s != 1 {
		t.Fatalf("the day finished after midnight: streak %d %v", s, err)
	}

	// A question shown just before the grace ends is answered in its time; the next isn't shown.
	dan := w.user()
	w.now = time.Date(2026, 11, 14, 23, 59, 0, 0, Bulgaria)
	edge, err := w.g.StartDay(ctx, dan)
	if err != nil {
		t.Fatal(err)
	}
	w.now = time.Date(2026, 11, 15, 0, 0, 0, 0, Bulgaria).Add(DayGrace - 5*time.Second)
	w.show(dan, edge.ID)
	w.wait(8 * time.Second)
	if _, err := w.g.Answer(ctx, dan, edge.ID, 0, w.right(edge.ID, 0)); err != nil {
		t.Fatalf("answered in its time, past the grace: %v", err)
	}
	if _, err := w.g.Show(ctx, dan, edge.ID); !errors.Is(err, ErrDayOver) {
		t.Fatalf("the next question, past the grace: %v", err)
	}
}

// A duel played to its end whose result wasn't kept (the server stopped between the last answer and the result) is
// settled by the sweep, with its result (review 2026-11-18, A13); so is a friend's duel whose sending wasn't.
func TestDuelsSettledAfterAStop(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, gal := w.user(), w.user(), w.user()
	s, err := w.g.StartTopic(ctx, bo, MixTopic)
	if err != nil {
		t.Fatal(err)
	}
	w.play(bo, s.ID, repeat(w.wrong, Length)...)
	w.wait(time.Minute)
	w.befriend(ana, bo)
	// Gal against a recording, all right, and Ana's side of a duel with Bo: neither is kept past its last answer.
	rec, err := w.g.DuelRecording(ctx, gal)
	if err != nil {
		t.Fatal(err)
	}
	sent, err := w.g.DuelFriend(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(`CREATE TEMP TRIGGER stop BEFORE UPDATE OF ended_at, sent_at ON duels
		BEGIN SELECT RAISE(ABORT, 'stopped'); END`); err != nil {
		t.Fatal(err)
	}
	w.playSide(gal, rec, repeat(w.right, Length))
	w.playSide(ana, sent, repeat(w.right, Length))
	if _, err := w.db.Write.Exec(`DROP TRIGGER stop`); err != nil {
		t.Fatal(err)
	}
	w.wait(time.Hour)
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	if d, _ := w.g.DuelOf(ctx, gal, rec); d.State != DuelWon {
		t.Fatalf("the duel finished before the stop: %+v", d)
	}
	if d, _ := w.g.DuelOf(ctx, bo, sent); d.State != DuelYours {
		t.Fatalf("the duel sent before the stop: %+v", d)
	}
	if n := w.count(`SELECT count(*) FROM runs_after`); n != 0 {
		t.Fatalf("%d runs still to follow up", n)
	}
}
