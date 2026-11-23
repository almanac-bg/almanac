package bank

import (
	"math"
	"slices"
)

// The bank's balance. Since 16 Nov 2026 there is no aim for the difficulties (the owner's call: batches are written
// by the day's runway, which spends hard places about three times faster than easy ones, so no fixed mix could
// follow it). What stays: every category about the same size (within SizeSlack of the mean: no topic outweighs
// another), and each category's kinds near TypeMix, so that the topic games have every kind.

// Difficulties in order, easy first.
var Difficulties = []Difficulty{Easy, Medium, Hard}

// typeAim is the share of each kind of question the bank aims for, in every category, with every kind dealt (the
// owner's call, 2026-11-13; splits and clues since 2026-11-14), close to what the game draws: a run of ten has five
// choices, one of each other kind, and a split or clues. So that no kind runs out long before the others.
var typeAim = map[string]float64{"choice": 0.50, "truefalse": 0.15, "number": 0.10, "order": 0.075, "match": 0.075, "split": 0.05, "clues": 0.05}

// TypeMix is typeAim of the kinds the game deals (KindOn), scaled to add up to 1 again: a kind Off is neither written
// nor counted.
var TypeMix = func() map[string]float64 {
	out, sum := map[string]float64{}, 0.0
	for k, share := range typeAim {
		if KindOn(k) {
			out[k] = share
			sum += share
		}
	}
	for k := range out {
		out[k] /= sum
	}
	return out
}()

// TypeOrder is the kinds the game deals (KindOn), in the order a report shows them.
var TypeOrder = slices.DeleteFunc([]string{"choice", "truefalse", "number", "order", "match", "split", "clues"},
	func(k string) bool { return !KindOn(k) })

// SizeSlack is how far a category's live size may stand from the mean of all of them, as a share of the mean: about
// the same size, not exactly (a batch whose checks drop a question here and there still goes in).
const SizeSlack = 0.02

// Balance is how a bank stands against its aims: what it has, and what it takes to reach them by adding questions
// (never by dropping any).
type Balance struct {
	// Live counts the questions played, by category and difficulty.
	Live map[string]map[Difficulty]int
	// Facts, Added and Updated count the live questions that have one.
	Facts, Added, Updated, Total int
	// Types counts the live questions by category and kind.
	Types map[string]map[string]int
	// Gaps is, by category and kind, how far the kind is from its TypeMix share of the category (above 0: to
	// write; below 0: more than its share). Off adds up the questions to write.
	Gaps map[string]map[string]int
	Off  int
}

// Want is how many questions of a kind a category of size questions aims for (the share rounded, halves up: the tiny
// nudge keeps a share like 660 × 0.075 = 49.5 from rounding down by a float's last bit).
func Want(size int, kind string) int {
	return int(math.Round(float64(size)*TypeMix[kind] + 1e-9))
}

// BalanceOf works out where the bank stands: its kinds against TypeMix in every category, its facts and dates.
func (b *Bank) BalanceOf() Balance {
	bal := Balance{Live: map[string]map[Difficulty]int{}, Types: map[string]map[string]int{}, Gaps: map[string]map[string]int{}}
	for _, c := range b.Categories {
		n := map[Difficulty]int{}
		types := map[string]int{}
		live := b.Live(c.ID, "")
		for _, q := range live {
			n[q.Base().Difficulty]++
			types[q.Base().Type]++
			t := q.Extra()
			bal.Total++
			bal.Facts += b2i(t.Fact != "")
			bal.Added += b2i(t.Added != "")
			bal.Updated += b2i(t.Updated != "")
		}
		bal.Live[c.ID], bal.Types[c.ID] = n, types
		gaps := map[string]int{}
		for _, t := range TypeOrder {
			gaps[t] = Want(len(live), t) - types[t]
			bal.Off += max(gaps[t], 0)
		}
		bal.Gaps[c.ID] = gaps
	}
	return bal
}

// Uneven lists the categories whose live size is more than SizeSlack off the mean (none in a balanced bank), with
// the mean.
func (b *Bank) Uneven() (off []CategoryCount, mean float64) {
	if len(b.Categories) == 0 {
		return nil, 0
	}
	sizes := make([]CategoryCount, 0, len(b.Categories))
	for _, c := range b.Categories {
		sizes = append(sizes, CategoryCount{c.ID, len(b.Live(c.ID, ""))})
		mean += float64(sizes[len(sizes)-1].N)
	}
	mean /= float64(len(sizes))
	for _, s := range sizes {
		if math.Abs(float64(s.N)-mean) > SizeSlack*mean {
			off = append(off, s)
		}
	}
	slices.SortStableFunc(off, func(x, y CategoryCount) int { return x.N - y.N })
	return off, mean
}

func b2i(ok bool) int {
	if ok {
		return 1
	}
	return 0
}
