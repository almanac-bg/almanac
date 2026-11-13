package play

import (
	"math/rand/v2"
	"os"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// With the real bank (when it's there), the days keep their shape exactly for 50 days, and no question comes twice in
// a year. (The bank has about 60 medium orders: past those, a day's order is of another difficulty, then a choice.)
func TestAYearOfDays(t *testing.T) {
	if _, err := os.Stat("../../private/" + bank.CategoriesFile); err != nil {
		t.Skip("no private bank")
	}
	b, problems := bank.Load("../../private")
	if b == nil {
		t.Fatal(problems)
	}
	used := map[string]bool{}
	r := rand.New(rand.NewPCG(1, 2))
	for day := range 365 {
		picks := drawDay(b, used, r)
		topics := map[string]bool{}
		for i, p := range picks {
			if used[p.ID] {
				t.Fatalf("day %d repeats %s", day, p.ID)
			}
			used[p.ID] = true
			q, _ := b.Get(p.ID)
			s := daySlots[i]
			// While the bank has none of a slot's type, the slot takes a choice (choose).
			if day < 50 && len(b.Live("", s.typ)) > 0 && !matches(q, s, true, true) {
				t.Fatalf("day %d, place %d: %s is a %s %s (picture %v), not as planned", day, i, p.ID,
					q.Base().Difficulty, q.Base().Type, q.Extra().Image != nil)
			}
			topics[q.Base().Category] = true
		}
		if len(picks) != Length || len(topics) != Length {
			t.Fatalf("day %d: %d questions from %d topics", day, len(picks), len(topics))
		}
	}
}
