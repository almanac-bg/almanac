package bank

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
)

// Match is „Свържи“: four pairs (a country and its capital, a book and its writer), shown as two columns, each in an
// order of its own; the player joins each thing on the left to its pair on the right.
type Match struct {
	Head
	Pairs []MatchPair `json:"pairs"`
	Tail
}

type MatchPair struct {
	Left  string `json:"left"`
	Right string `json:"right"`
}

// MatchPairs is how many pairs a match question has.
const MatchPairs = 4

func init() { register("match", func() Question { return &Match{} }) }

func (q *Match) Base() *Head  { return &q.Head }
func (q *Match) Extra() *Tail { return &q.Tail }

func (q *Match) check() []string {
	var p []string
	if len(q.Pairs) != MatchPairs {
		p = append(p, "a match needs exactly 4 pairs")
	}
	lefts, rights := map[string]bool{}, map[string]bool{}
	for _, pr := range q.Pairs {
		p = append(p, checkLine("left", pr.Left, pairMax)...)
		p = append(p, checkLine("right", pr.Right, pairMax)...)
		if lefts[fold(pr.Left)] {
			p = append(p, "two lefts are the same: "+pr.Left)
		}
		if rights[fold(pr.Right)] {
			p = append(p, "two rights are the same: "+pr.Right)
		}
		lefts[fold(pr.Left)], rights[fold(pr.Right)] = true, true
	}
	return p
}

// key: match questions often share a text („Свържи държавата със столицата ѝ:“), so their pairs tell them apart.
func (q *Match) key() string {
	lefts := make([]string, len(q.Pairs))
	for i, pr := range q.Pairs {
		lefts[i] = fold(pr.Left)
	}
	slices.Sort(lefts)
	return fold(q.Text) + "|" + q.Image.file() + "|" + strings.Join(lefts, "|")
}

func (q *Match) words() []string {
	w := []string{q.Text}
	for _, pr := range q.Pairs {
		w = append(w, pr.Left, pr.Right)
	}
	return w
}

// Deal shows the lefts in one order and the rights in another, so that no pair sits side by side by chance of the
// bank's order.
func (q *Match) Deal(seed uint64) Dealt {
	return &dealtMatch{q: q, left: shuffle(seed, len(q.Pairs)), right: shuffle(seed^0x5bd1e995, len(q.Pairs))}
}

// dealtMatch shows the bank's pair left[i] on the left as row i, and the bank's pair right[j]'s right side as row j.
type dealtMatch struct {
	q           *Match
	left, right []int
}

func (d *dealtMatch) Question() Question { return d.q }

func (d *dealtMatch) View() any {
	left, right := make([]string, len(d.left)), make([]string, len(d.right))
	for i, b := range d.left {
		left[i] = d.q.Pairs[b].Left
	}
	for j, b := range d.right {
		right[j] = d.q.Pairs[b].Right
	}
	return struct {
		view
		Left  []string `json:"left"`
		Right []string `json:"right"`
	}{viewOf(&d.q.Head, &d.q.Tail), left, right}
}

// MatchAnswer joins each left to a right: Pairs[i] is the right joined to left i (-1 for none), by their places as
// shown (as given) or in the bank (as logged).
type MatchAnswer struct {
	Pairs []int `json:"pairs"`
}

func (d *dealtMatch) Grade(answer json.RawMessage) (Graded, error) {
	var a MatchAnswer
	if err := strictJSON(answer, &a); err != nil {
		return Graded{}, err
	}
	n := len(d.left)
	bad := errors.New("a match joins each left to one right at most")
	if len(a.Pairs) != n {
		return Graded{}, bad
	}
	used := make([]bool, n)
	bank := make([]int, n) // for each bank pair (its left), the bank pair whose right it was joined to
	for i := range bank {
		bank[i] = -1
	}
	right, wrong := 0, 0
	for i, shown := range a.Pairs {
		if shown == -1 {
			continue
		}
		if shown < 0 || shown >= n || used[shown] {
			return Graded{}, bad
		}
		used[shown] = true
		l, r := d.left[i], d.right[shown]
		bank[l] = r
		if l == r {
			right++
		} else {
			wrong++
		}
	}
	return Graded{
		Score: matchScore(right, wrong, n),
		Right: right == n,
		Given: mustJSON(MatchAnswer{Pairs: bank}),
		Shown: mustJSON(MatchAnswer{Pairs: a.Pairs}),
	}, nil
}

func (d *dealtMatch) Reveal() any {
	shownAt := make([]int, len(d.right)) // where each bank pair's right is shown
	for j, b := range d.right {
		shownAt[b] = j
	}
	pairs := make([]int, len(d.left))
	for i, b := range d.left {
		pairs[i] = shownAt[b]
	}
	return struct {
		Pairs []int `json:"pairs"`
		reveal
	}{pairs, revealOf(&d.q.Head, &d.q.Tail)}
}

// matchScore is what a match is worth: a share for each pair joined right, less a third of one for each joined wrong
// (with four pairs; 1/(n-1) of one in general), and nothing below 0. A pair left out costs nothing, so a player who
// joins only what they know keeps it all; pairs joined at random are worth nothing on average (one of four comes out
// right by luck, the other three take it back).
func matchScore(right, wrong, n int) float64 {
	if n < 2 {
		return float64(right)
	}
	return max(0, (float64(right)-float64(wrong)/float64(n-1))/float64(n))
}
