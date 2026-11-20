package play

import "testing"

// What's kept of a player's answers (their abilities) is worked out again as soon as they answer, a game ends, or a
// game of theirs comes from another account: never a step behind their games.
func TestKeptWhileTheGamesStand(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	first, _ := w.g.StartTopic(ctx, ana, MixTopic)
	w.play(ana, first.ID, repeat(w.wrong, Length)...)
	mastery := func(finished bool) int {
		t.Helper()
		h, err := w.g.hardness(ctx)
		if err != nil {
			t.Fatal(err)
		}
		m, _, err := w.g.abilities(ctx, w.db.Read, h, ana, 0, finished)
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, x := range m {
			n += x.answers
		}
		return n
	}
	if n := mastery(false); n != Length {
		t.Fatalf("answers in the mastery: %d", n)
	}

	// One wrong answer in a game under way: it's in at once (its game unfinished: not in what others see).
	next, _ := w.g.StartTopic(ctx, ana, w.b.Categories[1].ID)
	w.play(ana, next.ID, w.wrong)
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
	if n := mastery(false); n != before+Length {
		t.Fatalf("the mastery after a merge: %d", n)
	}
}
