package bank

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
)

// Split is „Раздели“: six things, each of one of two groups („Ботев или Вазов?“, „Член на ЕС или не?“), dealt one by
// one; the player sends each to its group, a swipe left or right.
type Split struct {
	Head
	// Groups are the two groups, as the player sees them: left, then right.
	Groups [2]string   `json:"groups"`
	Items  []SplitItem `json:"items"`
	Tail
}

type SplitItem struct {
	Text string `json:"text"`
	// Group is the group it belongs to: 0 (left) or 1 (right).
	Group int `json:"group"`
}

const (
	// SplitItems is how many things a split has.
	SplitItems = 6
	// SplitLeast is how few of them a group may have: a group of one would be told by the others.
	SplitLeast = 2
)

func init() { register("split", func() Question { return &Split{} }) }

func (q *Split) Base() *Head  { return &q.Head }
func (q *Split) Extra() *Tail { return &q.Tail }

func (q *Split) check() []string {
	var p []string
	if len(q.Items) != SplitItems {
		p = append(p, "a split needs exactly 6 items")
	}
	for _, g := range q.Groups {
		p = append(p, checkLine("group", g, groupMax)...)
	}
	if fold(q.Groups[0]) == fold(q.Groups[1]) {
		p = append(p, "the two groups are the same")
	}
	seen, in := map[string]bool{}, [2]int{}
	for _, it := range q.Items {
		p = append(p, checkLine("item", it.Text, itemMax)...)
		if seen[fold(it.Text)] {
			p = append(p, "two items are the same: "+it.Text)
		}
		seen[fold(it.Text)] = true
		if it.Group != 0 && it.Group != 1 {
			p = append(p, "an item's group must be 0 or 1: "+it.Text)
			continue
		}
		in[it.Group]++
	}
	if len(q.Items) == SplitItems && (in[0] < SplitLeast || in[1] < SplitLeast) {
		p = append(p, "each group needs at least 2 of the items")
	}
	return p
}

// key: splits may share a text („Ботев или Вазов?“), so their items tell them apart.
func (q *Split) key() string {
	items := make([]string, len(q.Items))
	for i, it := range q.Items {
		items[i] = fold(it.Text)
	}
	slices.Sort(items)
	return fold(q.Text) + "|" + q.Image.file() + "|" + strings.Join(items, "|")
}

func (q *Split) words() []string {
	w := []string{q.Text, q.Groups[0], q.Groups[1]}
	for _, it := range q.Items {
		w = append(w, it.Text)
	}
	return w
}

func (q *Split) Deal(seed uint64) Dealt { return &dealtSplit{q: q, order: shuffle(seed, len(q.Items))} }

// dealtSplit shows the bank's item order[i] as item i.
type dealtSplit struct {
	q     *Split
	order []int
}

func (d *dealtSplit) Question() Question { return d.q }

func (d *dealtSplit) View() any {
	items := make([]string, len(d.order))
	for i, b := range d.order {
		items[i] = d.q.Items[b].Text
	}
	return struct {
		view
		Groups [2]string `json:"groups"`
		Items  []string  `json:"items"`
	}{viewOf(&d.q.Head, &d.q.Tail), d.q.Groups, items}
}

// SplitAnswer sends each item to a group: Sides[i] is the group of item i (-1 for none), by the items' places as
// shown (as given) or in the bank (as logged).
type SplitAnswer struct {
	Sides []int `json:"sides"`
}

func (d *dealtSplit) Grade(answer json.RawMessage) (Graded, error) {
	var a SplitAnswer
	if err := strictJSON(answer, &a); err != nil {
		return Graded{}, err
	}
	n := len(d.order)
	if len(a.Sides) != n {
		return Graded{}, errors.New("a split sends each item to one side at most")
	}
	bank := make([]int, n)
	right, wrong := 0, 0
	for i, side := range a.Sides {
		if side < -1 || side > 1 {
			return Graded{}, errors.New("a split sends each item to one side at most")
		}
		b := d.order[i]
		bank[b] = side
		switch side {
		case -1:
		case d.q.Items[b].Group:
			right++
		default:
			wrong++
		}
	}
	return Graded{
		Score: splitScore(right, wrong, n),
		Right: right == n,
		Given: mustJSON(SplitAnswer{Sides: bank}),
		Shown: mustJSON(SplitAnswer{Sides: a.Sides}),
	}, nil
}

func (d *dealtSplit) Reveal(c *Crowd) any {
	sides := make([]int, len(d.order))
	for i, b := range d.order {
		sides[i] = d.q.Items[b].Group
	}
	return struct {
		Sides []int `json:"sides"`
		reveal
	}{sides, revealOf(&d.q.Head, &d.q.Tail, c.view(nil))}
}

// splitScore is what a split of n items is worth: a share for each item sent right, less as much for each sent
// wrong, and nothing below 0. An item left where it is costs nothing, so a player who sends only what they know keeps
// it all; an item sent at random is worth nothing on average (right half the time, and the other half takes it back).
func splitScore(right, wrong, n int) float64 {
	if n == 0 {
		return 0
	}
	return max(0, float64(right-wrong)/float64(n))
}
