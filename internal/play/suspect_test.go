package play

import (
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A key players' answers speak against: a wrong option picked more than the answer, a true-or-not most say the
// opposite of, a number most type far to one side of. Not a hard question most miss in all directions.
func TestSuspect(t *testing.T) {
	choice := &bank.Choice{Answer: "Канбера", Wrong: []string{"Сидни", "Мелбърн", "Пърт"}}
	if got := suspect(choice, &bank.Crowd{Answers: 40, Picks: []float64{0.3, 0.55, 0.1, 0.05}}); !strings.Contains(got, "„Сидни“") {
		t.Errorf("choice: %q", got)
	}
	if got := suspect(choice, &bank.Crowd{Answers: 40, Picks: []float64{0.3, 0.25, 0.25, 0.2}}); got != "" {
		t.Errorf("hard, no option ahead: %q", got)
	}
	tf := &bank.TrueFalse{Answer: true}
	if got := suspect(tf, &bank.Crowd{Answers: 40, Right: 0.2}); !strings.Contains(got, "false") {
		t.Errorf("true-or-not: %q", got)
	}
	n := &bank.Number{}
	if got := suspect(n, &bank.Crowd{Answers: 40, Guesses: &bank.Spread{Hi: 120, Above: 0.7}}); !strings.Contains(got, "more") {
		t.Errorf("number: %q", got)
	}
	if got := suspect(n, &bank.Crowd{Answers: 40, Guesses: &bank.Spread{Below: 0.4, Above: 0.4}}); got != "" {
		t.Errorf("number, both sides: %q", got)
	}
}
