package bank

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
)

// Match is „Свържи“: four pairs (a country and its capital, a book and its writer), shown as two columns, each in an
// order of its own; the player joins each thing on the left to its pair on the right. The right column has a decoy
// too, one more than the pairs: without it, whoever knows three pairs gets the fourth for nothing.
type Match struct {
	Head
	Pairs []MatchPair `json:"pairs"`
	// Decoy is a right that belongs to no left, near enough to tempt („Сидни“ among capitals).
	Decoy string `json:"decoy,omitempty"`
	Tail
}

type MatchPair struct {
	Left  string `json:"left"`
	Right string `json:"right"`
}

// MatchPairs is how many pairs a match question has.
const MatchPairs = 4

// DecoysFrom is when a match's decoy became a rule: a match added since then has one. (Older ones get theirs as
// they're gone over; until then they're dealt without, and the bank's check reminds whoever keeps it.)
const DecoysFrom = "2026-11-15"

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
	if q.Decoy != "" {
		p = append(p, checkLine("decoy", q.Decoy, pairMax)...)
		if rights[fold(q.Decoy)] {
			p = append(p, "the decoy is one of the rights: "+q.Decoy)
		}
	}
	return p
}

// rights is the right column as the bank has it: each pair's right, then the decoy if there is one.
func (q *Match) rights() []string {
	r := make([]string, 0, len(q.Pairs)+1)
	for _, pr := range q.Pairs {
		r = append(r, pr.Right)
	}
	if q.Decoy != "" {
		r = append(r, q.Decoy)
	}
	return r
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

func (q *Match) asked() map[string]any {
	type pair struct {
		Left  string `json:"left"`
		Right string `json:"right"`
	}
	var pairs []pair // null for none, [] for an empty list, as the type writes them
	if q.Pairs != nil {
		pairs = make([]pair, 0, len(q.Pairs))
	}
	for _, p := range q.Pairs {
		pairs = append(pairs, pair{p.Left, p.Right})
	}
	form := map[string]any{"pairs": pairs}
	if q.Decoy != "" {
		form["decoy"] = q.Decoy
	}
	return form
}

func (q *Match) words() []string {
	w := []string{q.Text}
	for _, pr := range q.Pairs {
		w = append(w, pr.Left, pr.Right)
	}
	if q.Decoy != "" {
		w = append(w, q.Decoy)
	}
	return w
}

// Deal shows the lefts in one order and the rights (the decoy among them) in another, so that no pair sits side by
// side by chance of the bank's order.
func (q *Match) Deal(seed uint64) Dealt {
	return &dealtMatch{q: q, left: shuffle(seed, len(q.Pairs)), right: shuffle(seed^0x5bd1e995, len(q.rights()))}
}

// dealtMatch shows the bank's pair left[i] on the left as row i, and the bank's right right[j] (a pair's right side,
// or the decoy: the one past the pairs) as row j.
type dealtMatch struct {
	q           *Match
	left, right []int
}

func (d *dealtMatch) Question() Question { return d.q }

func (d *dealtMatch) View() any {
	rights := d.q.rights()
	left, right := make([]string, len(d.left)), make([]string, len(d.right))
	for i, b := range d.left {
		left[i] = d.q.Pairs[b].Left
	}
	for j, b := range d.right {
		right[j] = rights[b]
	}
	return struct {
		view
		Left  []string `json:"left"`
		Right []string `json:"right"`
	}{viewOf(&d.q.Head, &d.q.Tail), left, right}
}

// MatchAnswer joins each left to a right: Pairs[i] is the right joined to left i (-1 for none), by their places as
// shown (as given) or in the bank (as logged: a pair's place, or the number of pairs for the decoy).
type MatchAnswer struct {
	Pairs []int `json:"pairs"`
}

func (d *dealtMatch) Grade(answer json.RawMessage) (Graded, error) {
	var a MatchAnswer
	if err := strictJSON(answer, &a); err != nil {
		return Graded{}, err
	}
	n, m := len(d.left), len(d.right)
	bad := errors.New("a match joins each left to one right at most")
	if len(a.Pairs) != n {
		return Graded{}, bad
	}
	used := make([]bool, m)
	bank := make([]int, n) // for each bank pair (its left), the bank pair whose right it was joined to
	for i := range bank {
		bank[i] = -1
	}
	right := 0
	for i, shown := range a.Pairs {
		if shown == -1 {
			continue
		}
		if shown < 0 || shown >= m || used[shown] {
			return Graded{}, bad
		}
		used[shown] = true
		l, r := d.left[i], d.right[shown]
		bank[l] = r
		if l == r {
			right++
		}
	}
	// Right or not, like an order: every pair joined right, and none wrong (DECISIONS.md: „близо“ is the number's
	// alone; a puzzle is all or nothing).
	g := Graded{Given: mustJSON(MatchAnswer{Pairs: bank}), Shown: mustJSON(MatchAnswer{Pairs: a.Pairs})}
	if right == n {
		g.Score, g.Right = 1, true
	}
	return g, nil
}

func (d *dealtMatch) Reveal(c *Crowd) any {
	shownAt := make([]int, len(d.right)) // where each bank pair's right is shown
	for j, b := range d.right {
		shownAt[b] = j
	}
	pairs := make([]int, len(d.left))
	for i, b := range d.left {
		pairs[i] = shownAt[b]
	}
	var decoy *int
	if len(d.right) > len(d.left) {
		decoy = &shownAt[len(d.left)]
	}
	return &struct {
		Pairs []int `json:"pairs"`
		// Decoy is where the decoy is shown, if there is one.
		Decoy *int `json:"decoy,omitempty"`
		reveal
	}{pairs, decoy, revealOf(&d.q.Head, &d.q.Tail, c.view(nil))}
}
