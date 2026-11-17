package play

import (
	"math/rand/v2"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// With the real bank (when it's there), the days keep their shape (each band's places, in an order drawn with the
// day) for 50 days while the bank has questions
// for each place (it has only so many medium orders and matches: past those, a day's order is of another
// difficulty, then a choice), no question comes twice in a year, and no subject twice in a day.
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
		// Where each place sits in its band is drawn with the day (inBands): a question fits some place of its band
		// not yet taken by another.
		taken := make([]bool, len(daySlots))
		picks, _ := drawDay(b, time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, day).Format(time.DateOnly), used, nil, r)
		topics := map[string]bool{}
		named := map[string]string{}
		for i, p := range picks {
			if used[p.ID] {
				t.Fatalf("day %d repeats %s", day, p.ID)
			}
			used[p.ID] = true
			q, _ := b.Get(p.ID)
			fits, short := -1, false
			for j, s := range daySlots {
				if taken[j] || s.difficulty != daySlots[i].difficulty || (i == 0) != (j == 0) {
					continue // the first place stays first; the others move within their band
				}
				if s.typ == newKinds[0] && slices.Contains(newKinds, q.Base().Type) {
					s.typ = q.Base().Type // the new kinds' place: either of them
				}
				if matches(q, s, true, true) {
					fits = j
					break
				}
				short = short || !plenty[j]
			}
			for _, k := range bank.Subjects(q) {
				if other, ok := named[k]; ok {
					t.Fatalf("day %d: %s and %s both name %q", day, other, p.ID, k)
				}
				named[k] = p.ID
			}
			// While the bank has none of a slot's type, the slot takes a choice (choose).
			if fits >= 0 {
				taken[fits] = true
			} else if day < 50 && !short {
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
