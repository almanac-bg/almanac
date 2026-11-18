package play

import "testing"

// What's kept of a player's answers (their mistakes, their abilities) is worked out again as soon as they answer, a
// game ends, or a game of theirs comes from another account: never a step behind their games.
func TestKeptWhileTheGamesStand(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	first, _ := w.g.StartTopic(ctx, ana, "")
	w.play(ana, first.ID, repeat(w.wrong, Length)...)
	missed, all, err := w.g.Misses(ctx, ana, first.ID)
	if err != nil || missed != Length || all != Length {
		t.Fatalf("missed %d of %d: %v", missed, all, err)
	}
	mastery := func(finished bool) int {
		t.Helper()
		m, err := w.g.knownMastery(ctx, ana, finished)
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, x := range m {
			n += x.Answers
		}
		return n
	}
	if n := mastery(false); n != Length {
		t.Fatalf("answers in the mastery: %d", n)
	}

	// One wrong answer in a game under way: it's in at once (its game unfinished: not in what others see).
	next, _ := w.g.StartTopic(ctx, ana, w.b.Categories[1].ID)
	w.play(ana, next.ID, w.wrong)
	if _, all, _ := w.g.Misses(ctx, ana, first.ID); all != Length+1 {
		t.Fatalf("the mistakes after an answer: %d", all)
	}
	if n := mastery(false); n != Length+1 {
		t.Fatalf("the mastery after an answer: %d", n)
	}
	if n := mastery(true); n != Length {
		t.Fatalf("the finished games' mastery, one under way: %d", n)
	}
	// The game ends (the rest let go): what others see has it now.
	w.playOn(ana, next.ID, 1, repeat(w.wrong, Length-1)...)
	if n := mastery(true); n != 2*Length {
		t.Fatalf("the finished games' mastery, the game ended: %d", n)
	}

	// A guest's game, merged into the account: what's kept is what going over the answers again makes of them.
	guest := w.user()
	other, _ := w.g.StartTopic(ctx, guest, w.b.Categories[2].ID)
	w.play(guest, other.ID, repeat(w.wrong, Length)...)
	before := mastery(false)
	w.fold(guest, ana)
	_, all, _ = w.g.Misses(ctx, ana, first.ID)
	if _, fresh, _ := w.g.countMisses(ctx, w.b, ana, first.ID); all != fresh || all <= Length+1 {
		t.Fatalf("the mistakes after a merge: %d, going over them %d", all, fresh)
	}
	if n := mastery(false); n != before+Length {
		t.Fatalf("the mastery after a merge: %d", n)
	}
}
