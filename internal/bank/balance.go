package bank

import "math"

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
	// Facts, Added and Updated count the live questions that have one.
	Facts, Added, Updated, Total int
	// Types counts the live questions by category and kind.
	Types map[string]map[string]int
	// Full balance: every category at Target questions (the steady size), its kinds in the TypeMix and each kind's
	// difficulties in the Mix. Cells counts the live questions by category, kind and difficulty; Gaps is what each cell lacks (above 0:
	// to write) or has too many of (below 0: to judge again into a neighbouring difficulty where that's honest, or
	// retire). Off is how many questions are out of place in all; 0 is a fully balanced bank.
	Target int
	Cells  map[string]map[string]map[Difficulty]int
	Gaps   map[string]map[string]map[Difficulty]int
	Off    int
}

// Want is how many questions of a kind and a difficulty a category of size questions aims for (the share rounded,
// halves up: the tiny nudge keeps a share like 660 × 0.075 = 49.5 from rounding down by a float's last bit).
func Want(size int, kind string, d Difficulty) int {
	return int(math.Round(float64(size)*TypeMix[kind]*Mix[d] + 1e-9))
}

// steady is the smallest size at which, in every category, each kind's aims and each difficulty's aims (rounded as
// Want rounds them) add up to at least what the category has of it. Reachable by adding questions, and steady: a
// bank filled to its aims has that same size, so the aims don't run ahead of the questions written for them (the
// unrounded sizes did: aims rounded up per cell add up to more than a kind's share, which then asked for a bigger
// size). A single cell may still be above its aim: that's a question to judge again or retire, not more to write.
func steady(cells map[string]map[string]map[Difficulty]int) int {
	fits := func(size int) bool {
		for _, kinds := range cells {
			for _, t := range TypeOrder {
				has, aim := 0, 0
				for _, d := range Difficulties {
					has += kinds[t][d]
					aim += Want(size, t, d)
				}
				if has > aim {
					return false
				}
			}
			for _, d := range Difficulties {
				has, aim := 0, 0
				for _, t := range TypeOrder {
					has += kinds[t][d]
					aim += Want(size, t, d)
				}
				if has > aim {
					return false
				}
			}
		}
		return true
	}
	size := 1
	for !fits(size) {
		size++
	}
	return size
}

// BalanceOf works out where the bank stands against full balance: every category the same size, with the same
// number of questions in every kind and difficulty (as many hard number questions in music as in geography).
func (b *Bank) BalanceOf() Balance {
	bal := Balance{Live: map[string]map[Difficulty]int{}, Types: map[string]map[string]int{}}
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
	}
	// The full balance aims at the steady size (every kind and every difficulty reachable by adding), and says per
	// cell what's missing or too much.
	bal.Cells, bal.Gaps = map[string]map[string]map[Difficulty]int{}, map[string]map[string]map[Difficulty]int{}
	for _, c := range b.Categories {
		cells := map[string]map[Difficulty]int{}
		for _, t := range TypeOrder {
			cells[t] = map[Difficulty]int{}
		}
		for _, q := range b.Live(c.ID, "") {
			t := q.Base().Type
			if cells[t] == nil {
				cells[t] = map[Difficulty]int{}
			}
			cells[t][q.Base().Difficulty]++
		}
		bal.Cells[c.ID] = cells
	}
	bal.Target = steady(bal.Cells)
	for _, c := range b.Categories {
		cells := bal.Cells[c.ID]
		gaps := map[string]map[Difficulty]int{}
		for _, t := range TypeOrder {
			gaps[t] = map[Difficulty]int{}
			for _, d := range Difficulties {
				g := Want(bal.Target, t, d) - cells[t][d]
				gaps[t][d] = g
				bal.Off += max(g, -g)
			}
		}
		bal.Gaps[c.ID] = gaps
	}
	return bal
}

func b2i(ok bool) int {
	if ok {
		return 1
	}
	return 0
}
