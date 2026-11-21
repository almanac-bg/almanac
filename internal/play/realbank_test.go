package play

import (
	"math/rand/v2"
	"os"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// With the real bank (when it's there), the days keep their shape (each band's places, in an order drawn with the
// day) for 50 days while the bank has questions
// for each place (it has only so many medium orders: past those, a day's order is of another
// difficulty, then a choice), no question comes twice in a year, no subject twice in a day, and every day ends on its
// hard number. And while every place of a day has questions (its shortest runway), no subject comes back within a week
// (recentSubjects), but a date's own question on its date: past it, a place takes what it has left.
func TestAYearOfDays(t *testing.T) {
	t.Parallel() // a long simulation: alongside the other one, after the quick tests
	if _, err := os.Stat("../../private/" + bank.CategoriesFile); err != nil {
		t.Skip("no private bank")
	}
	b, problems := bank.Load("../../private")
	if b == nil {
		t.Fatal(problems)
	}
	used := map[string]bool{}
	drawn := map[string][]Pick{}
	repeats, runway := 0, 365
	for _, p := range DayRunway(b, Used{}, "2027-01-01") {
		runway = min(runway, p.Days)
	}
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
		date := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, day).Format(time.DateOnly)
		recent := recentSubjects(b, drawn, date)
		picks, _ := drawDay(b, date, used, nil, recent, r)
		drawn[date] = picks
		if last, _ := b.Get(picks[len(picks)-1].ID); last.Base().Type != "number" && plenty[len(daySlots)-1] {
			t.Fatalf("day %d ends on %s, a %s: the day ends on its hard number", day, last.Base().ID, last.Base().Type)
		}
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
				if matches(q, s, true, true) {
					fits = j
					break
				}
				short = short || !plenty[j]
			}
			for _, k := range bank.Subjects(q) {
				if recent[k] && !q.Extra().OnDay(date) && day < runway { // a date's own question comes on its date
					repeats++
					t.Logf("%s: %s names %q, which the week before named", date, p.ID, k)
				}
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
	if repeats > 0 {
		t.Fatalf("%d subjects again within a week, in the %d days every place has questions for", repeats, runway)
	}
}
