package play

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A topic run's shape: a true-or-not second, an order and a match in the middle, a number last; easy to hard by
// skill.
func TestTopicShape(t *testing.T) {
	for skill, want := range map[float64]string{
		0.3:  "c:e t:e c:e c:e c:e c:m c:m o:m m:m n:h",
		0.6:  "c:e t:e c:e c:m c:m o:m c:m m:m c:h n:h",
		0.8:  "c:e t:e c:m c:m o:m m:m c:h c:h c:h n:h",
		0.95: "c:e t:m c:m o:m m:m c:h c:h c:h c:h n:h",
	} {
		var got []string
		for _, s := range topicSlots(skill) {
			got = append(got, s.typ[:1]+":"+string(s.difficulty[:1]))
		}
		if strings.Join(got, " ") != want {
			t.Errorf("skill %v: %s, want %s", skill, strings.Join(got, " "), want)
		}
	}
}

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
		{choice, 1, 0, 100, 25},
		{choice, 1, 5 * time.Second, 100, 25},
		{choice, 1, 12500 * time.Millisecond, 88, 13},
		{choice, 1, 20 * time.Second, 75, 0},
		{choice, 1, 21 * time.Second, 75, 0}, // within the grace
		{choice, 0, 0, 0, 0},
		{q("choice", bank.Easy), 1, 0, 60, 15},
		{q("choice", bank.Hard), 1, 0, 140, 35},
		{q("truefalse", bank.Medium), 1, 0, 50, 12},
		{q("number", bank.Hard), 0.5, 30 * time.Second, 53, 0},
	} {
		if w := WorthOf(c.q, c.score, c.took); w.Points != c.points || w.Speed != c.speed {
			t.Errorf("%s %s, %v after %v: %+v, want %d (%d for speed)", c.q.Base().Type, c.q.Base().Difficulty,
				c.score, c.took, w, c.points, c.speed)
		}
	}
	// A guess at a true-or-not is worth what one at a choice of four is.
	if tf, ch := 0.5*float64(WorthOf(q("truefalse", bank.Medium), 1, 0).Points), 0.25*float64(WorthOf(choice, 1, 0).Points); tf != ch {
		t.Errorf("a guess: %v at a true-or-not, %v at a choice", tf, ch)
	}
}

func TestXP(t *testing.T) {
	given := json.RawMessage(`{}`)
	for _, c := range []struct {
		gr   bank.Graded
		want int
	}{
		{bank.Graded{}, 0}, // the time ran out, or given up on
		{bank.Graded{Given: given}, 10},
		{bank.Graded{Given: given, Score: 0.5}, 15},
		{bank.Graded{Given: given, Score: 1, Right: true}, 20},
	} {
		if got := xp(c.gr); got != c.want {
			t.Errorf("%+v earned %d XP, want %d", c.gr, got, c.want)
		}
	}
	if finishXP("topic") != 50 || finishXP("day") != 100 {
		t.Error("a game's end")
	}
}
