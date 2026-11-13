package play

import (
	"strings"
	"testing"

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
	q := func(d bank.Difficulty) bank.Question {
		return &bank.Choice{Head: bank.Head{Type: "choice", Difficulty: d}}
	}
	if worth(q(bank.Easy), 1) != 60 || worth(q(bank.Medium), 1) != 100 || worth(q(bank.Hard), 1) != 140 ||
		worth(q(bank.Hard), 0.5) != 70 || worth(q(bank.Medium), 0) != 0 {
		t.Error("what answers are worth")
	}
	// A day (three easy, four medium, three hard) earns what ten answers at 100 would.
	if 3*worth(q(bank.Easy), 1)+4*worth(q(bank.Medium), 1)+3*worth(q(bank.Hard), 1) != Length*MaxPoints {
		t.Error("a day's worth")
	}
}
