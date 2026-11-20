package play

import (
	"fmt"
	"math/rand/v2"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// hardNumbers are a bank's live hard numbers, in the bank's order.
func hardNumbers(b *bank.Bank) []*bank.Number {
	var out []*bank.Number
	for _, q := range b.Live("", "number") {
		if q.Base().Difficulty == bank.Hard {
			out = append(out, q.(*bank.Number))
		}
	}
	return out
}

func placeOf(t *testing.T, places []Runway, name string) Runway {
	t.Helper()
	i := slices.IndexFunc(places, func(r Runway) bool { return r.Place == name })
	if i < 0 {
		t.Fatalf("no place %q in %+v", name, places)
	}
	return places[i]
}

// The runway counts what a day can take: of the hard numbers only the estimates, never a dated question (it waits for
// its date), one due for review, or one a day has had; and the days drawn ahead count as covered.
func TestRunwayCountsWhatTheDayTakes(t *testing.T) {
	b := biggerSample(t, 5)
	today := "2026-11-16"
	nums := hardNumbers(b)
	if len(nums) != 6 || !slices.ContainsFunc(nums, func(n *bank.Number) bool { return b.Estimate(n) }) {
		t.Fatalf("%d hard numbers in the sample, 6 estimates wanted", len(nums))
	}
	nums[0].Unit = ""               // a year: not an estimate
	nums[1].On = []string{"03-03"}  // dated
	nums[2].ReviewBy = today        // due for review
	nums[3].ReviewBy = "2027-06-01" // due later: counts until then
	used := Used{IDs: map[string]bool{nums[4].ID: true}}
	r := placeOf(t, DayRunway(b, used, today), "hard number (estimate)")
	if r.Questions != 2 || r.PerDay != 1 || r.Days != 2 || r.Out != "2026-11-18" {
		t.Fatalf("hard numbers: %+v, want 2 questions, out on 2026-11-18", r)
	}
	// Ten days drawn ahead (today's included) count as covered: the place runs out two days after them.
	used.Through = "2026-11-25"
	if r := placeOf(t, DayRunway(b, used, today), "hard number (estimate)"); r.Days != 12 || r.Out != "2026-11-28" {
		t.Fatalf("drawn through the 25th: %+v, want 12 days, out on 2026-11-28", r)
	}
	// A place the day has twice lasts half as long.
	hard := placeOf(t, DayRunway(b, Used{}, today), "hard choice")
	if hard.PerDay != 2 || hard.Days != hard.Questions/2 {
		t.Fatalf("hard choices: %+v", hard)
	}
	// After a batch: its questions on top, from the same first day.
	if a := r.After(3, today); a.Questions != 5 || a.Days != r.Days+3 {
		t.Fatalf("after 3 more: %+v, from %+v", a, r)
	}
}

// The questions about Bulgaria have a runway of their own: those that fit a place of a day, BGFloor a day.
func TestBulgariaRunway(t *testing.T) {
	b := biggerSample(t, 5)
	today := "2026-11-16"
	for _, q := range b.Live("", "") {
		q.Extra().BG = false
	}
	n := 0
	for i, q := range b.Live("", "choice") {
		if q.Base().Difficulty == bank.Easy && !bank.HasPictures(q) && i%2 == 0 {
			q.Extra().BG = true
			n++
		}
	}
	if r := BulgariaRunway(b, Used{}, today); r.Questions != n || r.PerDay != BGFloor || r.Days != n/BGFloor {
		t.Fatalf("%+v for %d easy choices about Bulgaria", r, n)
	}
	var some bank.Question
	for _, q := range b.Live("", "") {
		if q.Extra().BG {
			some = q
			break
		}
	}
	if r := BulgariaRunway(b, Used{IDs: map[string]bool{some.Base().ID: true}}, today); r.Questions != n-1 {
		t.Fatalf("%+v with one of %d used", r, n)
	}
}

// The day's number comes from a topic that still has an estimate, though every topic has a hard number: a year or a
// small count is a choice in disguise. With the estimates spent, the day still ends on a hard number, and says the
// place is short.
func TestDayNumberIsAnEstimate(t *testing.T) {
	b := biggerSample(t, 20)
	day := "2026-11-20"
	var estimates []string
	for _, n := range hardNumbers(b) {
		if n.Category == "science" {
			estimates = append(estimates, n.ID)
		} else {
			n.Unit = "" // every other topic's: a year
		}
	}
	if len(estimates) == 0 {
		t.Fatal("no hard number in science")
	}
	for seed := range uint64(30) {
		picks, short := drawDay(b, day, map[string]bool{}, nil, nil, rand.New(rand.NewPCG(seed, 3)))
		last := dayNumber(t, b, picks)
		if len(short) > 0 || !slices.Contains(estimates, last.Base().ID) {
			t.Fatalf("seed %d: the day's number is %s (short %v), not science's estimate", seed, last.Base().ID, short)
		}
	}
	used := map[string]bool{}
	for _, id := range estimates {
		used[id] = true
	}
	picks, short := drawDay(b, day, used, nil, nil, rand.New(rand.NewPCG(1, 3)))
	last := dayNumber(t, b, picks)
	if !slices.Equal(short, []string{"hard number (estimate)"}) || last.Base().Type != "number" {
		t.Fatalf("with the estimates spent: the number is %s, short %v", last.Base().ID, short)
	}
}

// A topic's game finishes on an estimate too, where its topic has one left.
func TestTopicNumberIsAnEstimate(t *testing.T) {
	b := biggerSample(t, 20)
	var estimates []string
	for i, n := range hardNumbers(b) {
		if n.Category != "history" {
			continue
		}
		if i%2 == 0 {
			n.Unit = ""
		} else {
			estimates = append(estimates, n.ID)
		}
	}
	if len(estimates) == 0 {
		t.Fatal("no estimate left in history")
	}
	for seed := range uint64(30) {
		picks := Draw(b, "history", 0, nil, nil, rand.New(rand.NewPCG(seed, 5)))
		for _, p := range picks {
			if q, _ := b.Get(p.ID); q.Base().Type == "number" && q.Base().Difficulty == bank.Hard && !slices.Contains(estimates, p.ID) {
				t.Fatalf("seed %d: the number is %s, not an estimate", seed, p.ID)
			}
		}
	}
}

// No day takes a question due for review on or before it; a day before its date may.
func TestDayPassesOverdueQuestions(t *testing.T) {
	b := biggerSample(t, 20)
	day := "2026-11-20"
	due := map[string]bool{}
	for i, q := range b.Live("", "") {
		if i%3 == 0 {
			q.Extra().ReviewBy = day
			due[q.Base().ID] = true
		}
	}
	if !overdue(b.Live("", "")[0], day) || overdue(b.Live("", "")[0], "2026-11-19") {
		t.Fatal("due for review on its day, not before")
	}
	if got := Overdue(b, day); len(got) != len(due) {
		t.Fatalf("%d overdue, want %d", len(got), len(due))
	}
	before := false
	for seed := range uint64(30) {
		picks, _ := drawDay(b, day, map[string]bool{}, nil, nil, rand.New(rand.NewPCG(seed, 9)))
		for _, p := range picks {
			if due[p.ID] {
				t.Fatalf("seed %d: %s is due for review", seed, p.ID)
			}
		}
		picks, _ = drawDay(b, "2026-11-19", map[string]bool{}, nil, nil, rand.New(rand.NewPCG(seed, 9)))
		before = before || slices.ContainsFunc(picks, func(p Pick) bool { return due[p.ID] })
	}
	if !before {
		t.Fatal("the day before, none of a third of the bank")
	}
}

// With the real bank (when it's there), the runway tells the truth: drawn day after day, the days stay whole until
// about the day the shortest place's runway says, and then that place is the one short.
func TestTheRunwayIsTrue(t *testing.T) {
	t.Parallel() // a long simulation: alongside the other one, after the quick tests
	if _, err := os.Stat("../../private/" + bank.CategoriesFile); err != nil {
		t.Skip("no private bank")
	}
	b, problems := bank.Load("../../private")
	if b == nil {
		t.Fatal(problems)
	}
	start := time.Date(2026, 11, 17, 0, 0, 0, 0, time.UTC)
	places := DayRunway(b, Used{}, start.Format(time.DateOnly))
	shortest := slices.MinFunc(places, func(x, y Runway) int { return x.Days - y.Days })
	for seed := range uint64(3) {
		t.Run(fmt.Sprint("seed ", seed), func(t *testing.T) {
			t.Parallel() // each seed draws its own days
			used := map[string]bool{}
			r := rand.New(rand.NewPCG(seed, 2))
			for day := range shortest.Days * 2 {
				picks, short := drawDay(b, start.AddDate(0, 0, day).Format(time.DateOnly), used, nil, nil, r)
				if len(short) > 0 {
					if day < shortest.Days*9/10 || day > shortest.Days*5/4 || !slices.Contains(short, shortest.Place) {
						t.Fatalf("short on day %d (%v); the runway said %s, %d days", day, short, shortest.Place, shortest.Days)
					}
					t.Logf("short on day %d (%v); the runway said %d days", day, short, shortest.Days)
					return
				}
				for _, p := range picks {
					used[p.ID] = true
				}
			}
		})
	}
}
