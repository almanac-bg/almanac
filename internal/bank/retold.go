package bank

import (
	"fmt"
	"slices"
	"strings"
)

// Retold: one thing told twice. A writer reaches for the best-known fact about a subject, so two questions about it
// end up with one „Знаеше ли?“ (Баку the lowest capital, under two questions; the Panama Canal's locks, under three),
// or a fact tells what another question asks (a fact about the sculpture of a mother over Дебелянов's grave, which
// another question asks as a true-or-not). A player who plays daily reads the same fact again, or is handed an answer;
// the giveaway rules don't see it, as nothing in it is a value or an answer's name alone. The audit of a sample of the
// bank (24 Nov 2026) found it the commonest fault by far.
//
// Two lines are compared by their stems, each weighing by how rare it is in the bank (lintBank.weight): their weighted
// Jaccard, the shared stems' weight over all the stems' weight. The pairs:
//
//   - a fact and another question's fact;
//   - a fact and another question's claim: what it asks, as a line (a choice's text with its answer, a number's with
//     its answer and unit, a true-or-not's statement, true or false: a fact that says the opposite of a false one
//     answers it as well). An order's, a match's and a split's text is a frame, not a claim: their items are the
//     giveaway rules'.
//
// A pair is flagged from RetoldFrom alike, with at least two shared stems that say something (fewer than
// RetoldCommon questions have them), so that one frame with two facts („…е вписан в списъка на ЮНЕСКО“) isn't.
// Measured on the real bank (24 Nov 2026, 14 014 live questions dealt), every pair read by hand: facts with facts, 108
// pairs from 0.45, nearly all one fact twice (from 0.6, all 36); a fact with a claim, 38 pairs, about three in four
// real (the rest one subject, two facts: a waiver says so).
const (
	RetoldFrom   = 0.45
	RetoldCommon = 60
)

// RetoldSince is when the retold rule became an error for new questions.
const RetoldSince = "2026-11-24"

// retoldLine is a line the retold rule compares: a question's fact or its claim, as sorted stem ids.
type retoldLine struct {
	q     Question
	fact  bool
	stems []int32
}

// claimOf is what a question asks, as one line; "" for the kinds whose text is a frame.
func claimOf(q Question) string {
	switch q := q.(type) {
	case *Choice:
		if len(q.Pictures) > 0 {
			return "" // the options are pictures: the text only names what to find
		}
		return q.Text + " " + q.Answer
	case *Clues:
		return q.Text + " " + q.Answer
	case *Number:
		return q.Text + " " + formatNumber(q.Answer, q.Step) + " " + q.Unit
	case *TrueFalse:
		return q.Text
	}
	return ""
}

// ruleRetold: a fact that another fact tells, or that tells what another question asks.
func ruleRetold(l *lintBank) []finding {
	ids := map[string]int32{}
	var names []string
	var weight []float64
	var common []bool
	token := func(s string) int32 {
		k, ok := ids[s]
		if !ok {
			k = int32(len(names))
			ids[s] = k
			names = append(names, s)
			weight = append(weight, l.weight(s))
			common = append(common, l.df[s] >= RetoldCommon)
		}
		return k
	}
	var lines []retoldLine
	add := func(q Question, fact bool, text string) {
		var st []int32
		for _, s := range stems(text) {
			st = append(st, token(s))
		}
		if len(st) == 0 {
			return
		}
		slices.Sort(st)
		lines = append(lines, retoldLine{q, fact, slices.Compact(st)})
	}
	for _, q := range l.live {
		add(q, true, q.Extra().Fact)
		add(q, false, claimOf(q))
	}

	// The candidates share two stems that say something: an inverted index of those, as the near rule's.
	posting := make([][]int32, len(names))
	for i, ln := range lines {
		for _, k := range ln.stems {
			if !common[k] {
				posting[k] = append(posting[k], int32(i))
			}
		}
	}
	var out []finding
	count := make([]int32, len(lines))
	var touched []int32
	for i := range lines {
		a := &lines[i]
		if !a.fact {
			continue // every pair holds a fact: with a fact, or with a claim
		}
		for _, k := range a.stems {
			if common[k] {
				continue
			}
			for _, j := range posting[k] {
				if int(j) != i {
					if count[j] == 0 {
						touched = append(touched, j)
					}
					count[j]++
				}
			}
		}
		for _, j := range touched {
			b := &lines[j]
			n := count[j]
			count[j] = 0
			if n < 2 || b.q == a.q || (b.fact && int(j) < i) {
				continue // a fact with a fact is found once, from the first of the two
			}
			var both, all float64
			var share []string
			for x, y := 0, 0; x < len(a.stems) || y < len(b.stems); {
				switch {
				case y == len(b.stems) || (x < len(a.stems) && a.stems[x] < b.stems[y]):
					all += weight[a.stems[x]]
					x++
				case x == len(a.stems) || b.stems[y] < a.stems[x]:
					all += weight[b.stems[y]]
					y++
				default:
					both += weight[a.stems[x]]
					all += weight[a.stems[x]]
					if !common[a.stems[x]] {
						share = append(share, names[a.stems[x]])
					}
					x, y = x+1, y+1
				}
			}
			if all == 0 || both/all < RetoldFrom {
				continue
			}
			slices.Sort(share)
			what := fmt.Sprintf("%s's fact and %s's tell one thing", a.q.Base().ID, b.q.Base().ID)
			if !b.fact {
				what = fmt.Sprintf("%s's fact tells what %s asks", a.q.Base().ID, b.q.Base().ID)
			}
			out = append(out, finding{ids: l.newer(a.q, b.q), msg: fmt.Sprintf("%s (%.0f%% alike, sharing %s): tell another fact, or ask another thing",
				what, 100*both/all, strings.Join(share, ", "))})
		}
		touched = touched[:0]
	}
	slices.SortFunc(out, func(a, b finding) int { return strings.Compare(a.ids[0]+a.ids[1], b.ids[0]+b.ids[1]) })
	return out
}
