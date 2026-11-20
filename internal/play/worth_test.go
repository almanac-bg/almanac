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
		q             bank.Question
		score         float64
		took          time.Duration
		points, speed int
	}{
		{choice, 1, 0, 1000, 250},
		{choice, 1, 5 * time.Second, 1000, 250},
		{choice, 1, 12500 * time.Millisecond, 880, 130},
		{choice, 1, 20 * time.Second, 750, 0},
		{choice, 1, 21 * time.Second, 750, 0}, // within the grace
		{choice, 0, 0, 0, 0},
		{q("choice", bank.Easy), 1, 0, 800, 200},
		{q("choice", bank.Hard), 1, 0, 1200, 300},
		{q("truefalse", bank.Medium), 1, 0, 500, 120},
		{q("number", bank.Hard), 0.5, 30 * time.Second, 450, 0},
	} {
		w := WorthOf(c.q, c.score, c.took)
		if w.Points != c.points || w.Speed != c.speed {
			t.Errorf("%s %s, %v after %v: %+v, want %d (%d for speed)", c.q.Base().Type, c.q.Base().Difficulty,
				c.score, c.took, w, c.points, c.speed)
		}
	}
	// A guess at a true-or-not is worth what one at a choice of four is.
	if tf, ch := 0.5*float64(WorthOf(q("truefalse", bank.Medium), 1, 0).Points), 0.25*float64(WorthOf(choice, 1, 0).Points); tf != ch {
		t.Errorf("a guess: %v at a true-or-not, %v at a choice", tf, ch)
	}
}

// A run counts right answers in a row, for the climb's feel only: a wrong one starts the row again, the row earns no
// more points than the same answers apart (worth.go), and a game right throughout earns AllRight.
func TestRowsInARun(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	bo := w.user()
	answer := func(runID int64, n int, how func(int64, int) json.RawMessage) Result {
		t.Helper()
		w.show(bo, runID)
		w.wait(time.Second)
		res, err := w.g.Answer(ctx, bo, runID, n, how(runID, n))
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	s, _ := w.g.StartTopic(ctx, bo, MixTopic)
	for n, c := range []struct {
		how   func(int64, int) json.RawMessage
		inRow int
	}{{w.right, 0}, {w.right, 2}, {w.right, 3}, {w.wrong, 0}, {w.right, 0}, {w.right, 2}} {
		res := answer(s.ID, n, c.how)
		if res.InRow != c.inRow {
			t.Fatalf("answer %d: %d in a row; want %d", n, res.InRow, c.inRow)
		}
		if want := w.picks(s.ID)[n].worth(w.question(s.ID, n), 1, time.Second).Points; res.Right && res.Points != want {
			t.Fatalf("answer %d, %d in a row: %d points, want %d as any right answer", n, res.InRow, res.Points, want)
		}
	}
	for n := 6; n < Length; n++ {
		answer(s.ID, n, w.right)
	}
	if st, _ := w.g.State(ctx, bo, s.ID); st.AllRight != 0 {
		t.Fatalf("a game with a wrong answer earned %d for all right", st.AllRight)
	}

	s, _ = w.g.StartTopic(ctx, bo, MixTopic)
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
