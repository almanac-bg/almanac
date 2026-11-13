package play

import (
	"math/rand/v2"
	"os"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// With the real bank (when it's there), the days keep their shape exactly for 50 days while the bank has questions
// for each place (it has only so many medium orders and matches: past those, a day's order is of another
// difficulty, then a choice), and no question comes twice in a year.
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
	// left is how many questions not yet dealt fit a place.
	left := func(s slot) int {
		n := 0
		for _, q := range b.Live("", "") {
			if !used[q.Base().ID] && matches(q, s, true, true) {
				n++
			}
		}
		return n
	}
	for day := range 365 {
		var plenty []bool // whether each place has a question left in most topics
		for _, s := range daySlots {
			plenty = append(plenty, left(s) >= Length)
		}
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
			if day < 50 && plenty[i] && !matches(q, s, true, true) {
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
