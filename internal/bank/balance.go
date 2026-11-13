package bank

import (
	"math"
	"slices"
)

// Mix is the share of each difficulty the bank aims for, in every category (the owner's call, 2026-11-13): half
// easy, a third medium, the rest hard. Every category also aims for the same size: no topic outweighs another.
var Mix = map[Difficulty]float64{Easy: 0.50, Medium: 0.35, Hard: 0.15}

// Difficulties in order, easy first.
var Difficulties = []Difficulty{Easy, Medium, Hard}

// Balance is how a bank stands against its aims: what it has, and what it takes to reach them by adding questions
// (never by dropping any).
type Balance struct {
	// Live counts the questions played, by category and difficulty.
	Live map[string]map[Difficulty]int
	// Size is the size every category grows to: the smallest at which no category has too many of a difficulty.
	Size int
	// Add is how many questions of each difficulty each category needs to reach Size in the Mix.
	Add map[string]map[Difficulty]int
	// Facts, Added and Updated count the live questions that have one.
	Facts, Added, Updated, Total int
}

// BalanceOf works out where the bank stands against Mix and equal categories.
func (b *Bank) BalanceOf() Balance {
	bal := Balance{Live: map[string]map[Difficulty]int{}, Add: map[string]map[Difficulty]int{}}
	for _, c := range b.Categories {
		n := map[Difficulty]int{}
		for _, q := range b.Live(c.ID, "") {
			n[q.Base().Difficulty]++
			t := q.Extra()
			bal.Total++
			bal.Facts += b2i(t.Fact != "")
			bal.Added += b2i(t.Added != "")
			bal.Updated += b2i(t.Updated != "")
		}
		bal.Live[c.ID] = n
		for _, d := range Difficulties {
			bal.Size = max(bal.Size, int(math.Ceil(float64(n[d])/Mix[d]-1e-9)))
		}
	}
	// Split the size by the mix, rounding so the parts add up to it (the largest remainders get the spare ones).
	want := map[Difficulty]int{}
	left := bal.Size
	for _, d := range Difficulties {
		want[d] = int(float64(bal.Size) * Mix[d])
		left -= want[d]
	}
	byRest := slices.Clone(Difficulties)
	slices.SortStableFunc(byRest, func(a, c Difficulty) int {
		ra := float64(bal.Size)*Mix[a] - math.Floor(float64(bal.Size)*Mix[a])
		rc := float64(bal.Size)*Mix[c] - math.Floor(float64(bal.Size)*Mix[c])
		switch {
		case ra > rc:
			return -1
		case ra < rc:
			return 1
		}
		return 0
	})
	for i := 0; i < left; i++ {
		want[byRest[i%len(byRest)]]++
	}
	for _, c := range b.Categories {
		add := map[Difficulty]int{}
		for _, d := range Difficulties {
			add[d] = max(0, want[d]-bal.Live[c.ID][d])
		}
		bal.Add[c.ID] = add
	}
	return bal
}

func b2i(ok bool) int {
	if ok {
		return 1
	}
	return 0
}
