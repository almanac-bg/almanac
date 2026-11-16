package bank

import (
	"fmt"
	"slices"
	"strings"
)

// Give-aways across the bank: games mix topics, so one question's words can answer another's. Three rules look for
// it: a value asked (a number's answer, a year a choice asks, an order's values) that another question shows next to
// the same subject (ruleGiveaway); both sides of a match's pair shown together by another question
// (rulePairGiveaway); two orders with items in common (ruleSharedItems).

// secret is a value a question asks, with the words that say what it is the value of.
type secret struct {
	q       Question
	value   float64
	subject map[string]bool
	what    string // how a report names it: the text, or the order's item
}

// exposure is a value a question shows a player (before or with its answer), with the words around it.
type exposure struct {
	q       Question
	value   float64
	context map[string]bool
	where   string // where it shows: "fact", "text", "item „…“", "answer"
}

// numericAnswer is an answer that is a number and nothing more (1877, „1 600“), as a value.
func numericAnswer(a string) (float64, bool) {
	ns := numbersIn(a)
	if len(ns) != 1 || strings.TrimSpace(strings.Trim(a[:ns[0].start]+a[ns[0].end:], " г.")) != "" {
		return 0, false
	}
	return ns[0].value, true
}

func secretsOf(q Question) []secret {
	text := q.Base().Text
	switch q := q.(type) {
	case *Number:
		return []secret{{q, q.Answer, stemSet(text), "the answer"}}
	case *Choice:
		if v, ok := numericAnswer(q.Answer); ok {
			return []secret{{q, v, stemSet(text), "the answer"}}
		}
	case *Clues:
		if v, ok := numericAnswer(q.Answer); ok {
			return []secret{{q, v, stemSet(append(q.Clues, text)...), "the answer"}}
		}
	case *Order:
		var out []secret
		for _, it := range q.Items {
			out = append(out, secret{q, it.Value, stemSet(it.Text), "„" + strings.Trim(it.Text, "„“") + "“"})
		}
		return out
	}
	return nil
}

func exposuresOf(q Question) []exposure {
	text := q.Base().Text
	var out []exposure
	// in: every number a line shows, with its sentence and the question's text around it.
	in := func(line, where string) {
		for _, n := range numbersIn(line) {
			out = append(out, exposure{q, n.value, stemSet(sentenceAt(line, n.start), text), where})
		}
	}
	if tf, ok := q.(*TrueFalse); !ok || tf.Answer {
		in(text, "text") // a false statement's numbers are the wrong ones
	}
	in(q.Extra().Fact, "fact")
	in(q.Extra().Day, "day's line")
	switch q := q.(type) {
	case *Number:
		out = append(out, exposure{q, q.Answer, stemSet(text), "answer"})
	case *Choice:
		if v, ok := numericAnswer(q.Answer); ok {
			out = append(out, exposure{q, v, stemSet(text), "answer"})
		}
	case *Clues:
		for _, c := range q.Clues {
			in(c, "clue")
		}
		if v, ok := numericAnswer(q.Answer); ok {
			out = append(out, exposure{q, v, stemSet(append(q.Clues, text)...), "answer"})
		}
	case *Order:
		for _, it := range q.Items {
			out = append(out, exposure{q, it.Value, stemSet(it.Text, text), "item „" + strings.Trim(it.Text, "„“") + "“"})
		}
	case *Match:
		for _, p := range q.Pairs {
			in(p.Left+" "+p.Right, "pair")
		}
	case *Split:
		for _, it := range q.Items {
			in(it.Text, "item")
		}
	}
	return out
}

// GiveawayFrom is how much the words a value shows with must say of the asked value's subject (the summed weight of
// their shared stems) for it to give the value away: one rare name (Леонардо) or a few telling words (Втората
// световна война), not „година“ and „през“. Measured on the real bank (16 Nov 2026): 201 pairs, about three in four
// of them real; 10 of the 12 a review found by hand (the other two name the subject in other words: ГДР и ФРГ for
// Германия, „Зелената миля“ for „Зеленият път“). At 9 it misses real ones („Обединението на Италия“), at 7 the
// false ones grow (one shared first name).
const GiveawayFrom = 8.0

func ruleGiveaway(l *lintBank) []finding {
	shows := map[float64][]exposure{}
	for _, q := range l.live {
		for _, e := range exposuresOf(q) {
			if distinctive(e.value) {
				shows[e.value] = append(shows[e.value], e)
			}
		}
	}
	type pair struct{ a, b string }
	done := map[pair]bool{}
	var out []finding
	for _, q := range l.live {
		for _, s := range secretsOf(q) {
			if !distinctive(s.value) {
				continue
			}
			for _, e := range shows[s.value] {
				if e.q == q {
					continue
				}
				shared, w := l.common(s.subject, e.context, kindStems)
				k := pair{min(q.Base().ID, e.q.Base().ID), max(q.Base().ID, e.q.Base().ID)} // once a pair, whichever gives which away
				if w < GiveawayFrom || done[k] {
					continue
				}
				done[k] = true
				slices.Sort(shared)
				ids := l.newer(q, e.q)
				out = append(out, finding{ids: ids, msg: fmt.Sprintf("%s of %s (%s) shows in %s's %s (shared: %s)",
					say(s.value), q.Base().ID, s.what, e.q.Base().ID, e.where, strings.Join(shared, ", "))})
			}
		}
	}
	return out
}

// kindStems say what kind of value a question asks („През коя година излиза филмът…“, „Кога е роден…“), not whose:
// two questions about different films share them, so a give-away is never judged by them.
var kindStems = stemSet("през коя кой която който които колко кога тези подреди година годината излиза филмът филми " +
	"песента песни първия първата първото започва умира роден става основан печели открит провежда поред края един " +
	"една певец група сериал албум книга роман издаден публикуван създаден получава награда живее завършва")

// say is a value as a report writes it.
func say(v float64) string { return sayNumber(v, 0.01) }

// PairWindow is how close the two sides of a match's pair must stand in another question's line to give it away:
// within this many words („Кучето Лайка“, „Харон, спътникът на Плутон“), not merely somewhere in one long sentence.
const PairWindow = 4

// rulePairGiveaway: a match's pair is given away by another question that shows both sides close together, in one
// label or one sentence („Кучето Лайка“ for Лайка — Куче). A pair whose sides share a word (Германий — Германия) is
// left out: it shows itself wherever the word comes.
func rulePairGiveaway(l *lintBank) []finding {
	type line struct {
		q     Question
		at    map[string][]int // each stem's word places
		where string
	}
	// places keeps a longer word under its first four letters too, so that a side of four (Куче) finds its longer
	// forms (Кучето).
	places := func(s string) map[string][]int {
		at := map[string][]int{}
		for i, w := range letterWords(s) {
			if st := stem(w); st != "" {
				at[st] = append(at[st], i)
				if r := []rune(st); len(r) == stemLen {
					at[string(r[:stemLen-1])] = append(at[string(r[:stemLen-1])], i)
				}
			}
		}
		return at
	}
	var lines []line
	for _, q := range l.live {
		sentences, labels := asked(q)
		for _, s := range append(sentences, labels...) {
			lines = append(lines, line{q, places(s), "„" + s + "“"})
		}
		if f := q.Extra().Fact; f != "" {
			for _, s := range strings.SplitAfter(f, ". ") {
				lines = append(lines, line{q, places(s), "its fact: " + strings.TrimSpace(s)})
			}
		}
		if d := q.Extra().Day; d != "" {
			lines = append(lines, line{q, places(d), "its day's line: " + d})
		}
	}
	byStem := map[string][]int{}
	for i, ln := range lines {
		for s := range ln.at {
			byStem[s] = append(byStem[s], i)
		}
	}
	var out []finding
	for _, q := range l.live {
		m, ok := q.(*Match)
		if !ok || m.Difficulty == Easy {
			continue // an easy pair is what everyone associates already: seeing it elsewhere tells nothing new
		}
		for _, p := range m.Pairs {
			left, right := stems(p.Left), stems(p.Right)
			if len(left) == 0 || len(right) == 0 || slices.ContainsFunc(left, func(s string) bool { return slices.Contains(right, s) }) {
				continue
			}
			both := append(left, right...)
			seen := map[string]bool{}
			for _, i := range byStem[left[0]] {
				ln := lines[i]
				id := ln.q.Base().ID
				if ln.q == q || seen[id] || !together(ln.at, both) {
					continue
				}
				if other, ok := ln.q.(*Match); ok && hasPair(other, p) {
					continue // the same pair in two matches: shared-items' business
				}
				seen[id] = true
				out = append(out, finding{ids: l.newer(q, ln.q), msg: fmt.Sprintf("%s's pair %s — %s shows together in %s: %s",
					m.ID, p.Left, p.Right, id, ln.where)})
			}
		}
	}
	return out
}

// together is whether every one of the stems has a place in at, all within PairWindow words of each other.
func together(at map[string][]int, all []string) bool {
	for _, a := range at[all[0]] {
		lo, hi := a, a
		for _, s := range all[1:] {
			best, found := 0, false
			for _, p := range at[s] {
				if !found || abs(p-a) < abs(best-a) {
					best, found = p, true
				}
			}
			if !found {
				return false
			}
			lo, hi = min(lo, best), max(hi, best)
		}
		if hi-lo <= PairWindow {
			return true
		}
	}
	return false
}

func hasPair(m *Match, p MatchPair) bool {
	return slices.ContainsFunc(m.Pairs, func(o MatchPair) bool { return fold(o.Left) == fold(p.Left) && fold(o.Right) == fold(p.Right) })
}

// Two orders give each other away when one's reveal (every value shown) orders the other's items: when they share
// SharedValues items with the same values (a pair already put in order), or SharedOrder items in the same order,
// whatever they measure (Cessna 172 → Boeing 747 → Ан-225 by wingspan, then by weight).
const (
	SharedValues = 2
	SharedOrder  = 3
)

// itemKey is how two orders' items are the same item: the stems of its words and its numbers (Boeing 747 isn't
// Boeing 737); "" for one without words („1 кг“).
func itemKey(text string) string {
	key := stems(text)
	if len(key) == 0 {
		return ""
	}
	for _, n := range numbersIn(text) {
		key = append(key, text[n.start:n.end])
	}
	return strings.Join(key, " ")
}

// ruleSharedItems: two orders that share items (shared values, or the same order), and two matches that share a pair.
func ruleSharedItems(l *lintBank) []finding {
	type place struct {
		rank  int
		value float64
	}
	var orders []*Order
	ranks := map[*Order]map[string]place{}
	byItem := map[string][]*Order{}
	pairs := map[string][]*Match{}
	for _, q := range l.live {
		switch q := q.(type) {
		case *Order:
			at := map[string]place{}
			for rank, i := range q.right() {
				if k := itemKey(q.Items[i].Text); k != "" {
					at[k] = place{rank, q.Items[i].Value}
					byItem[k] = append(byItem[k], q)
				}
			}
			orders, ranks[q] = append(orders, q), at
		case *Match:
			for _, p := range q.Pairs {
				k := fold(p.Left) + " — " + fold(p.Right)
				pairs[k] = append(pairs[k], q)
			}
		}
	}
	var out []finding
	for _, a := range orders {
		done := map[*Order]bool{}
		for k := range ranks[a] {
			for _, b := range byItem[k] {
				if b == a || done[b] || slices.Index(orders, b) < slices.Index(orders, a) {
					continue
				}
				done[b] = true
				var same, items []string
				var ra, rb []int
				for k, pa := range ranks[a] {
					if pb, ok := ranks[b][k]; ok {
						items = append(items, k)
						ra, rb = append(ra, pa.rank), append(rb, pb.rank)
						if pa.value == pb.value {
							same = append(same, k)
						}
					}
				}
				slices.Sort(same)
				slices.Sort(items)
				switch {
				case len(same) >= SharedValues:
					out = append(out, finding{ids: l.newer(a, b), msg: fmt.Sprintf("%s and %s share %d items with their values: %s",
						a.ID, b.ID, len(same), strings.Join(same, "; "))})
				case len(items) >= SharedOrder && sameOrder(ra, rb):
					out = append(out, finding{ids: l.newer(a, b), msg: fmt.Sprintf("%s and %s share %d items in the same order: %s",
						a.ID, b.ID, len(items), strings.Join(items, "; "))})
				}
			}
		}
	}
	both := map[[2]Question][]string{}
	for k, qs := range pairs {
		for _, b := range qs[1:] {
			if b != qs[0] {
				both[[2]Question{qs[0], b}] = append(both[[2]Question{qs[0], b}], k)
			}
		}
	}
	for ab, ps := range both {
		slices.Sort(ps)
		out = append(out, finding{ids: l.newer(ab[0], ab[1]), msg: fmt.Sprintf("%s and %s share %d pairs: %s",
			ab[0].Base().ID, ab[1].Base().ID, len(ps), strings.Join(ps, "; "))})
	}
	slices.SortFunc(out, func(a, b finding) int { return strings.Compare(a.ids[0]+a.ids[1], b.ids[0]+b.ids[1]) })
	return out
}

// sameOrder is whether two rankings of the same items put every pair of them the same way round.
func sameOrder(a, b []int) bool {
	for i := range a {
		for j := i + 1; j < len(a); j++ {
			if (a[i] < a[j]) != (b[i] < b[j]) {
				return false
			}
		}
	}
	return true
}

// ruleSameIdentity: two "who or what is this" questions with one answer ask the same thing.
func ruleSameIdentity(l *lintBank) []finding {
	ids := map[string][]Question{}
	var keys []string
	for _, q := range l.live {
		if identity(q) {
			k := subjectKey(answerOf(q))
			if _, ok := ids[k]; !ok {
				keys = append(keys, k)
			}
			ids[k] = append(ids[k], q)
		}
	}
	var out []finding
	for _, k := range keys {
		qs := ids[k]
		for _, q := range qs[1:] {
			out = append(out, finding{ids: l.newer(qs[0], q), msg: fmt.Sprintf("%s and %s both ask who or what is %s: keep the better one",
				qs[0].Base().ID, q.Base().ID, answerOf(q))})
		}
	}
	return out
}
