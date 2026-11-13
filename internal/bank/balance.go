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

// TypeMix is the share of each kind of question the bank aims for, in every category (the owner's call, 2026-11-13),
// close to what the game draws: a run of ten has six choices and one of each other kind, and Роял adds true-or-not.
// So that no kind runs out long before the others.
var TypeMix = map[string]float64{"choice": 0.60, "truefalse": 0.15, "number": 0.10, "order": 0.075, "match": 0.075}

// TypeOrder is the kinds in the order a report shows them.
var TypeOrder = []string{"choice", "truefalse", "number", "order", "match"}

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
	// Types counts the live questions by category and kind; AddTypes is how many of each kind each category needs
	// to reach TypeSize in the TypeMix.
	Types    map[string]map[string]int
	TypeSize int
	AddTypes map[string]map[string]int
	// Full balance: every category at Target questions, its kinds in the TypeMix and each kind's difficulties in the
	// Mix. Cells counts the live questions by category, kind and difficulty; Gaps is what each cell lacks (above 0:
	// to write) or has too many of (below 0: to judge again into a neighbouring difficulty where that's honest, or
	// retire). Off is how many questions are out of place in all; 0 is a fully balanced bank.
	Target int
	Cells  map[string]map[string]map[Difficulty]int
	Gaps   map[string]map[string]map[Difficulty]int
	Off    int
}

// Want is how many questions of a kind and a difficulty a category of size questions aims for.
func Want(size int, kind string, d Difficulty) int {
	return int(math.Round(float64(size) * TypeMix[kind] * Mix[d]))
}

// BalanceOf works out where the bank stands against Mix and equal categories.
func (b *Bank) BalanceOf() Balance {
	bal := Balance{Live: map[string]map[Difficulty]int{}, Add: map[string]map[Difficulty]int{},
		Types: map[string]map[string]int{}, AddTypes: map[string]map[string]int{}}
	for _, c := range b.Categories {
		n := map[Difficulty]int{}
		types := map[string]int{}
		for _, q := range b.Live(c.ID, "") {
			n[q.Base().Difficulty]++
			types[q.Base().Type]++
			t := q.Extra()
			bal.Total++
			bal.Facts += b2i(t.Fact != "")
			bal.Added += b2i(t.Added != "")
			bal.Updated += b2i(t.Updated != "")
		}
		bal.Live[c.ID] = n
		bal.Types[c.ID] = types
		for _, d := range Difficulties {
			bal.Size = max(bal.Size, int(math.Ceil(float64(n[d])/Mix[d]-1e-9)))
		}
		for t, share := range TypeMix {
			bal.TypeSize = max(bal.TypeSize, int(math.Ceil(float64(types[t])/share-1e-9)))
		}
	}
	for _, c := range b.Categories {
		add := map[string]int{}
		for t, share := range TypeMix {
			add[t] = max(0, int(math.Round(float64(bal.TypeSize)*share))-bal.Types[c.ID][t])
		}
		bal.AddTypes[c.ID] = add
	}
	// The full balance aims at the larger of the two sizes (reachable for the kinds and for the difficulties by
	// adding), and says per cell what's missing or too much.
	bal.Target = max(bal.Size, bal.TypeSize)
	bal.Cells, bal.Gaps = map[string]map[string]map[Difficulty]int{}, map[string]map[string]map[Difficulty]int{}
	for _, c := range b.Categories {
		cells := map[string]map[Difficulty]int{}
		for _, q := range b.Live(c.ID, "") {
			t := q.Base().Type
			if cells[t] == nil {
				cells[t] = map[Difficulty]int{}
			}
			cells[t][q.Base().Difficulty]++
		}
		gaps := map[string]map[Difficulty]int{}
		for _, t := range TypeOrder {
			gaps[t] = map[Difficulty]int{}
			for _, d := range Difficulties {
				g := Want(bal.Target, t, d) - cells[t][d]
				gaps[t][d] = g
				bal.Off += max(g, -g)
			}
		}
		bal.Cells[c.ID], bal.Gaps[c.ID] = cells, gaps
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
