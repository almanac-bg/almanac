package play

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

func TestWorth(t *testing.T) {
	q := func(typ string, d bank.Difficulty) bank.Question {
		h := bank.Head{Type: typ, Difficulty: d}
		switch typ {
		case "truefalse":
			return &bank.TrueFalse{Head: h}
		case "number":
			return &bank.Number{Head: h}
		}
		return &bank.Choice{Head: h}
	}
	choice := q("choice", bank.Medium) // 20 s: all the speed in the first 5
	for _, c := range []struct {
		q                  bank.Question
		score              float64
		took               time.Duration
		inRow              int
		points, speed, row int
	}{
		{choice, 1, 0, 1, 1000, 250, 0},
		{choice, 1, 5 * time.Second, 1, 1000, 250, 0},
		{choice, 1, 12500 * time.Millisecond, 1, 880, 130, 0},
		{choice, 1, 20 * time.Second, 1, 750, 0, 0},
		{choice, 1, 21 * time.Second, 1, 750, 0, 0}, // within the grace
		{choice, 0, 0, 0, 0, 0, 0},
		{q("choice", bank.Easy), 1, 0, 1, 800, 200, 0},
		{q("choice", bank.Hard), 1, 0, 1, 1200, 300, 0},
		{q("truefalse", bank.Medium), 1, 0, 1, 500, 120, 0},
		{q("number", bank.Hard), 0.5, 30 * time.Second, 0, 450, 0, 0},
		// Right answers in a row: a tenth more from the second, up to a half more.
		{choice, 1, 0, 2, 1100, 250, 100},
		{choice, 1, 20 * time.Second, 3, 900, 0, 150},
		{choice, 1, 0, 6, 1500, 250, 500},
		{choice, 1, 0, 9, 1500, 250, 500},
	} {
		w := WorthOf(c.q, c.score, c.took, c.inRow)
		if w.Points != c.points || w.Speed != c.speed || w.Row != c.row {
			t.Errorf("%s %s, %v after %v, %d in a row: %+v, want %d (%d for speed, %d for the row)", c.q.Base().Type,
				c.q.Base().Difficulty, c.score, c.took, c.inRow, w, c.points, c.speed, c.row)
		}
	}
	// A guess at a true-or-not is worth what one at a choice of four is.
	if tf, ch := 0.5*float64(WorthOf(q("truefalse", bank.Medium), 1, 0, 1).Points), 0.25*float64(WorthOf(choice, 1, 0, 1).Points); tf != ch {
		t.Errorf("a guess: %v at a true-or-not, %v at a choice", tf, ch)
	}
}

func TestXP(t *testing.T) {
	given := json.RawMessage(`{}`)
	xp_ := func(score float64) int { return xp(bank.Graded{Given: given, Score: score, Right: score == 1}) }
	for _, c := range []struct {
		gr   bank.Graded
		want int
	}{
		{bank.Graded{}, 0}, // the time ran out, or given up on
		{bank.Graded{Given: given}, 2}, // wrong: a little for playing
		{bank.Graded{Given: given, Score: 0.5}, 11},
		{bank.Graded{Given: given, Score: 1, Right: true}, 20},
	} {
		if got := xp(c.gr); got != c.want {
			t.Errorf("%+v earned %d XP, want %d", c.gr, got, c.want)
		}
	}
	for _, c := range []struct {
		kind          string
		rights, total int
		want          int
	}{{"topic", 10, 10, 50}, {"topic", 3, 10, 15}, {"topic", 0, 10, 0}, {"day", 10, 10, 100}, {"day", 0, 10, 50},
		{"mistakes", 5, 5, 50}, {"royal", 0, 15, 0}} {
		if got := finishXP(c.kind, c.rights, c.total); got != c.want {
			t.Errorf("a %s game's end, %d of %d right: %d XP, want %d", c.kind, c.rights, c.total, got, c.want)
		}
	}
	// Knowing pays: a game answered at random (a quarter right) earns well under half what one mostly known does.
	game := func(right int) int {
		xp := finishXP("topic", right, 10)
		for i := range 10 {
			if i < right {
				xp += xp_(1)
			} else {
				xp += xp_(0)
			}
		}
		return xp
	}
	if random, known := game(3), game(7); 2*random >= known {
		t.Errorf("a random game earns %d XP, a known one %d", random, known)
	}
}

// A run counts right answers in a row: a wrong one starts the row again, and a game right throughout earns AllRight.
func TestRowsInARun(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	bo := w.user()
	answer := func(runID int64, n int, how func(int64, int) json.RawMessage) Result {
		t.Helper()
		if _, err := w.g.Show(ctx, bo, runID); err != nil {
			t.Fatal(err)
		}
		w.wait(time.Second)
		res, err := w.g.Answer(ctx, bo, runID, n, how(runID, n))
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	s, _ := w.g.StartTopic(ctx, bo, "")
	for n, c := range []struct {
		how   func(int64, int) json.RawMessage
		inRow int
	}{{w.right, 0}, {w.right, 2}, {w.right, 3}, {w.wrong, 0}, {w.right, 0}, {w.right, 2}} {
		res := answer(s.ID, n, c.how)
		if res.InRow != c.inRow || (c.inRow > 0) != (res.Row > 0) {
			t.Fatalf("answer %d: %d in a row, %d points for it; want %d in a row", n, res.InRow, res.Row, c.inRow)
		}
	}
	for n := 6; n < Length; n++ {
		answer(s.ID, n, w.right)
	}
	if st, _ := w.g.State(ctx, bo, s.ID); st.AllRight != 0 {
		t.Fatalf("a game with a wrong answer earned %d for all right", st.AllRight)
	}

	s, _ = w.g.StartTopic(ctx, bo, "")
	sum := 0
	var last Result
	for n := range Length {
		last = answer(s.ID, n, w.right)
		sum += last.Points
	}
	if !last.State.Done || last.State.AllRight != AllRight || last.State.Points != sum+AllRight || last.InRow != Length {
		t.Fatalf("a game right throughout: %+v, %d in a row; answers earned %d", last.State, last.InRow, sum)
	}
}
