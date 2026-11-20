package play

import (
	"testing"
	"time"
)

// Fair play by network (review 2026-11-18, S4).

// netDay is a player's day's ten, played from a network (fair.go, FromNet): all right, or all wrong.
func (w *world) netDay(user int64, net string, right bool) int64 {
	w.t.Helper()
	s, err := w.g.StartDay(FromNet(w.t.Context(), user, []byte(net)), user)
	if err != nil {
		w.t.Fatal(err)
	}
	answer := w.wrong
	if right {
		answer = w.right
	}
	w.play(user, s.ID, repeat(answer, Length)...)
	return s.ID
}

// fresh makes a guest made just now (a throwaway one, if it plays only the day).
func (w *world) fresh() int64 {
	id := w.user()
	w.since(id, 0)
	return id
}

// The day played as throwaway guests from one network before a player plays it there: the guests' days leave the
// others' boards, the player's is a signal for /admin, never a shadow. A guest who comes back is let out; a crowd
// (a class) and a single guest are left alone; so are guests who play after the player.
func TestThrowawayGuestsBeforeAPlayer(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	day := w.g.Today()
	owner := w.user() // an account from before today
	if _, err := w.db.Write.Exec(`UPDATE users SET email = 'ana@example.com' WHERE id = ?`, owner); err != nil {
		t.Fatal(err)
	}
	scout, second := w.fresh(), w.fresh()
	a := w.netDay(scout, "home", false)
	w.wait(time.Minute)
	b := w.netDay(second, "home", false)
	w.wait(time.Minute)
	mine := w.netDay(owner, "home", true)
	other := w.user() // someone elsewhere, to see the board as others do
	w.netDay(other, "away", true)

	n, err := w.g.JudgeNets(ctx)
	if err != nil || n != 1 {
		t.Fatalf("signals: %d %v", n, err)
	}
	if w.shadow(a) != ShadowThrowaway || w.shadow(b) != ShadowThrowaway || w.shadow(mine) != 0 {
		t.Fatalf("shadows: scout %d, second %d, the player %d", w.shadow(a), w.shadow(b), w.shadow(mine))
	}
	if board, err := w.g.BoardOf(ctx, day, other); err != nil || board.Players != 2 {
		t.Fatalf("the board as others see it: %+v %v", board, err)
	}
	if board, err := w.g.BoardOf(ctx, day, scout); err != nil || board.Mine == nil {
		t.Fatalf("the board as the guest sees it: %+v %v", board, err)
	}
	signals, err := w.g.FairSignals(ctx, 10)
	if err != nil || len(signals) != 1 || signals[0].Guests != 2 || signals[0].Best != 0 || signals[0].Rights != Length ||
		signals[0].Shadow || signals[0].Day != day {
		t.Fatalf("the signal: %+v %v", signals, err)
	}
	if n, _ := w.g.JudgeNets(ctx); n != 0 {
		t.Fatalf("told again: %d", n)
	}

	// The scout comes back and plays a topic: a player now, out of the shadow; the second guest alone is no pattern.
	s, err := w.g.StartTopic(ctx, scout, MixTopic)
	if err != nil {
		t.Fatal(err)
	}
	w.play(scout, s.ID, repeat(w.wrong, Length)...)
	if _, err := w.g.JudgeNets(ctx); err != nil {
		t.Fatal(err)
	}
	if w.shadow(a) != 0 || w.shadow(b) != ShadowThrowaway {
		t.Fatalf("after the scout came back: %d, %d", w.shadow(a), w.shadow(b))
	}

	// A class: more than ThrowawayMost new guests on the school's network, then the teacher. Nobody is touched.
	teacher := w.user()
	var class []int64
	for range ThrowawayMost + 1 {
		class = append(class, w.netDay(w.fresh(), "school", false))
	}
	w.wait(time.Minute)
	w.netDay(teacher, "school", true)
	// One guest on a friend's wifi, then the friend; and two guests who play after the player who lives there.
	w.netDay(w.fresh(), "visit", false)
	w.netDay(w.user(), "visit", true)
	w.netDay(w.user(), "flat", true)
	w.wait(time.Minute)
	later := []int64{w.netDay(w.fresh(), "flat", false), w.netDay(w.fresh(), "flat", false)}
	if n, err := w.g.JudgeNets(ctx); err != nil || n != 0 {
		t.Fatalf("signals for ordinary play: %d %v", n, err)
	}
	for _, run := range append(class, later...) {
		if w.shadow(run) != 0 {
			t.Fatalf("an ordinary guest's day is a shadow: run %d", run)
		}
	}

	// A throwaway guest's day brought into an account that hasn't played it (signing in from the guest) is the
	// account's shadow (ShadowGuest), not let out as a guest's who came back.
	elsewhere := w.user()
	w.fold(second, elsewhere)
	if _, err := w.g.JudgeNets(ctx); err != nil {
		t.Fatal(err)
	}
	if w.shadow(b) != ShadowGuest {
		t.Fatalf("folded: %d", w.shadow(b))
	}

	// The networks go after NetsKept.
	w.wait(NetsKept + time.Hour)
	if _, err := w.g.JudgeNets(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM run_nets`); n != 0 {
		t.Fatalf("%d networks kept past their time", n)
	}
}
