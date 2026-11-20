package bank

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
)

// Give-aways across the bank: games mix topics, so one question's words can answer another's. Four rules look for
// it: a value asked (a number's answer, a year a choice asks, an order's values) that another question shows next to
// the same subject (ruleGiveaway); a choice's answer that another shows as true next to its subject
// (ruleAnswerGiveaway); both sides of a match's pair shown together by another question
// (rulePairGiveaway); two orders with items in common (ruleSharedItems).

// secret is a value a question asks, with the words that say what it is the value of.
type secret struct {
	q       Question
	value   float64
	unit    string // what it counts (кг), for a number or an order
	subject map[string]bool
	what    string // how a report names it: the text, or the order's item
}

// exposure is a value a question shows a player (before or with its answer), with the words around it.
type exposure struct {
	q       Question
	value   float64
	unit    string // the word it shows with („28 килограма“: килограма), or the question's unit
	context map[string]bool
	where   string // where it shows: "fact", "text", "item „…“", "answer"
}

// shownLine is a line a question shows a player as true, with the words around it and its words' places.
type shownLine struct {
	q       Question
	line    string
	where   string
	context map[string]bool
	at      map[string][]int
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
		return []secret{{q, q.Answer, q.Unit, stemSet(text), "the answer"}}
	case *Choice:
		if v, ok := numericAnswer(q.Answer); ok {
			return []secret{{q, v, "", stemSet(text), "the answer"}}
		}
	case *Clues:
		if v, ok := numericAnswer(q.Answer); ok {
			return []secret{{q, v, "", stemSet(append(q.Clues, text)...), "the answer"}}
		}
	case *Order:
		var out []secret
		for _, it := range q.Items {
			out = append(out, secret{q, it.Value, q.Unit, stemSet(it.Text), "„" + strings.Trim(it.Text, "„“") + "“"})
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
			out = append(out, exposure{q, n.value, unitAfter(line, n.end), stemSet(sentenceAt(line, n.start), text), where})
		}
	}
	if tf, ok := q.(*TrueFalse); !ok || tf.Answer {
		in(text, "text") // a false statement's numbers are the wrong ones
	}
	in(q.Extra().Fact, "fact")
	in(q.Extra().Day, "day's line")
	switch q := q.(type) {
	case *Number:
		out = append(out, exposure{q, q.Answer, q.Unit, stemSet(text), "answer"})
	case *Choice:
		if v, ok := numericAnswer(q.Answer); ok {
			out = append(out, exposure{q, v, "", stemSet(text), "answer"})
		}
	case *Clues:
		for _, c := range q.Clues {
			in(c, "clue")
		}
		if v, ok := numericAnswer(q.Answer); ok {
			out = append(out, exposure{q, v, "", stemSet(append(q.Clues, text)...), "answer"})
		}
	case *Order:
		for _, it := range q.Items {
			out = append(out, exposure{q, it.Value, q.Unit, stemSet(it.Text, text), "item „" + strings.Trim(it.Text, "„“") + "“"})
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

// PlainGiveawayFrom is GiveawayFrom for a small or round value (28, 2200: not distinctive), shown with its unit: such
// a value comes up for many subjects, so the words around it must say more. Measured on the real bank (18 Nov 2026):
// 49 pairs at GiveawayFrom; under 10 four in five were false (an ostrich's and a bison's 70 км/ч, two 2200 м), from 10
// most were real (Бейл's 28 кг, the 32 teams of a World Cup, Сати's 840 times).
const PlainGiveawayFrom = 10.0

// ruleGiveaway: a value one question asks shows in another next to its subject. A distinctive value (a year, 8848)
// says what it is by itself; a small or round one (28) only with its unit („28 килограма“ for an answer in кг), for
// numbers like it come up everywhere.
func ruleGiveaway(l *lintBank) []finding {
	shows := map[float64][]exposure{}
	for _, q := range l.live {
		for _, e := range exposuresOf(q) {
			shows[e.value] = append(shows[e.value], e)
		}
	}
	type pair struct{ a, b string }
	done := map[pair]bool{}
	var out []finding
	for _, q := range l.live {
		for _, s := range secretsOf(q) {
			plain := !distinctive(s.value)
			if plain && s.unit == "" {
				continue
			}
			for _, e := range shows[s.value] {
				if e.q == q || (plain && !sameUnit(s.unit, e.unit)) {
					continue
				}
				shared, w := l.common(s.subject, e.context, kindStems)
				k := pair{min(q.Base().ID, e.q.Base().ID), max(q.Base().ID, e.q.Base().ID)} // once a pair, whichever gives which away
				if w < GiveawayFrom || (plain && w < PlainGiveawayFrom) || done[k] {
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

// unitAfter is the word a number at end of s shows with („28 килограма“: „килограма“; „5,5 м“: „м“), or "".
func unitAfter(s string, end int) string {
	rest := strings.TrimLeft(s[end:], " \u00a0")
	if i := strings.IndexFunc(rest, unicode.IsSpace); i >= 0 {
		rest = rest[:i]
	}
	return strings.TrimRight(rest, ".,;:!?)“\"")
}

// unitWords are the words a unit is written in, each with the unit's short form: a number's unit is „кг“, a fact
// says „килограма“.
var unitWords = []struct{ prefix, unit string }{
	{"килограм", "кг"}, {"километ", "км"}, {"сантимет", "см"}, {"милимет", "мм"}, {"метр", "м"}, {"метър", "м"},
	{"минут", "мин"}, {"секунд", "сек"}, {"час", "ч"}, {"тон", "т"}, {"грам", "г"}, {"литр", "л"}, {"литър", "л"},
	{"милилит", "мл"}, {"процент", "%"}, {"годин", "години"}, {"дни", "дни"}, {"ден", "дни"}, {"денонощ", "дни"},
	{"градус", "°"},
}

// sameUnit is whether two units are one: the same short form („кг“, „килограма“), or two forms of one word („точки“,
// „точка“; „пъти“, „път“: the first three letters).
func sameUnit(a, b string) bool {
	norm := func(u string) string {
		u = strings.ToLower(u)
		for _, w := range unitWords {
			if strings.HasPrefix(u, w.prefix) {
				return w.unit
			}
		}
		return u
	}
	a, b = norm(a), norm(b)
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	ra, rb := []rune(a), []rune(b)
	letters := func(r []rune) bool { return !slices.ContainsFunc(r, func(c rune) bool { return !unicode.IsLetter(c) }) }
	return len(ra) >= 3 && len(rb) >= 3 && letters(ra) && letters(rb) && string(ra[:3]) == string(rb[:3])
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
	places := wordPlaces
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

// wordPlaces is each stem's word places in s. It keeps a longer word under its first four letters too, so that a word
// of four (Куче) finds its longer forms (Кучето).
func wordPlaces(s string) map[string][]int {
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

// shownLines are the lines a question shows a player as true, each with the words around it: its text (unless it
// is a false statement), its clues, its fact's sentences, its day's line, an order's items, a match's pairs, a split's
// items. Not a choice's options: a name among four says nothing.
func shownLines(q Question) []shownLine {
	text := q.Base().Text
	var out []shownLine
	add := func(line, where string) {
		out = append(out, shownLine{q: q, line: line, where: where, context: stemSet(line, text), at: wordPlaces(line)})
	}
	if tf, ok := q.(*TrueFalse); !ok || tf.Answer {
		add(text, "text")
	}
	for _, s := range strings.SplitAfter(q.Extra().Fact, ". ") {
		if s = strings.TrimSpace(s); s != "" {
			add(s, "fact")
		}
	}
	if d := q.Extra().Day; d != "" {
		add(d, "day's line")
	}
	switch q := q.(type) {
	case *Clues:
		for _, c := range q.Clues {
			add(c, "clue")
		}
	case *Order:
		for _, it := range q.Items {
			add(it.Text, "item")
		}
	case *Match:
		for _, p := range q.Pairs {
			add(p.Left+" — "+p.Right, "pair")
		}
	case *Split:
		for _, it := range q.Items {
			add(it.Text+" — "+q.Groups[it.Group], "item")
		}
	}
	return out
}

// AnswerGiveawayFrom and AnswerGiveawayRare are how much the words around an answer shown elsewhere must say of the
// asking question's subject: more than a value needs (GiveawayFrom), because a name stands in many lines that aren't
// about the same thing (Варна, Турция, Норвегия); and at least one shared word must be rare (a name, a title:
// Вестерплате, „Вчера“), not only common ones (държава, голям, българия). Measured on the real bank (16 Nov 2026):
// 549 pairs, about four in five real (Ариел in „бащата на русалката Ариел“, Тезей beside Ариадна and the Минотавър);
// at 10 and 5 it finds 1172, half of them a common name among common words; at 14 and 6, 291, losing real ones.
var (
	AnswerGiveawayFrom = 12.0
	AnswerGiveawayRare = 5.5
)

// rarest is the weight of the rarest of the stems.
func (l *lintBank) rarest(stems []string) float64 {
	best := 0.0
	for _, s := range stems {
		best = max(best, l.weight(s))
	}
	return best
}

// ruleAnswerGiveaway: a choice's or clues' answer that another question shows, as true, next to the asked answer's
// subject: „Кой композира музиката към филма „Вчера“?“ → Кирил Маричков, given away by a fact that says „…песента от
// филма „Вчера“, по музика на Кирил Маричков“. The answer's words stand together in one line of the other question,
// and that line and its question's text share with the asking question's text what GiveawayFrom asks of a value's
// subject. A number answer is ruleGiveaway's.
func ruleAnswerGiveaway(l *lintBank) []finding {
	byStem := map[string][]shownLine{}
	for _, q := range l.live {
		for _, e := range shownLines(q) {
			for s := range e.at {
				byStem[s] = append(byStem[s], e)
			}
		}
	}
	type pair struct{ a, b string }
	done := map[pair]bool{}
	var out []finding
	for _, q := range l.live {
		var answer string
		var subject map[string]bool
		switch c := q.(type) {
		case *Choice:
			if len(c.Pictures) > 0 {
				continue // the options are pictures: a name shown elsewhere doesn't pick one
			}
			answer, subject = c.Answer, stemSet(c.Text)
		case *Clues:
			answer, subject = c.Answer, stemSet(append(c.Clues, c.Text)...)
		default:
			continue
		}
		if strings.ContainsAny(answer, "0123456789") {
			continue // a number, an amount, a share: ruleGiveaway's
		}
		words := stems(answer)
		if len(words) == 0 {
			continue
		}
		for _, w := range words {
			delete(subject, w)
		}
		for _, e := range byStem[words[0]] {
			k := pair{min(q.Base().ID, e.q.Base().ID), max(q.Base().ID, e.q.Base().ID)}
			if e.q == q || done[k] || !together(e.at, words) {
				continue
			}
			shared, w := l.common(subject, e.context, kindStems)
			if w < AnswerGiveawayFrom || l.rarest(shared) < AnswerGiveawayRare {
				continue
			}
			done[k] = true
			slices.Sort(shared)
			out = append(out, finding{ids: l.newer(q, e.q), msg: fmt.Sprintf("%s's answer %s shows in %s's %s (shared: %s): %s",
				q.Base().ID, answer, e.q.Base().ID, e.where, strings.Join(shared, ", "), e.line)})
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

// TwinShared is how many options two choices (or clues) share, of their four, to be twins (ruleTwin), each of them
// offered by TwinRare questions at most: options many questions offer (the countries, the planets, the
// continents) are a kind's whole list, and two questions over them ask different things.
const (
	TwinShared = 3
	TwinRare   = 4
)

// ruleTwin: two choices (or clues) over one set of options ask one thing twice, whichever way round: the same answer
// (one reworded), or each one's answer among the other's wrong options (Карлоф or Лугоши, asked twice nine days
// apart: whoever met one has the other half answered). The same-identity rule holds "who is this" answers asked
// twice whatever their options.
func ruleTwin(l *lintBank) []finding {
	type asking struct {
		q       Question
		answer  string
		options map[string]bool
	}
	var qs []asking
	by := map[string][]int{} // an option's key: the questions that offer it
	for _, q := range l.live {
		var opts []string
		switch q := q.(type) {
		case *Choice:
			opts = q.options()
		case *Clues:
			opts = q.options()
		default:
			continue
		}
		a := asking{q: q, answer: subjectKey(opts[0]), options: map[string]bool{}}
		for _, o := range opts {
			k := subjectKey(o)
			if !a.options[k] {
				a.options[k] = true
				by[k] = append(by[k], len(qs))
			}
		}
		qs = append(qs, a)
	}
	var out []finding
	for i, a := range qs {
		shared := map[int]int{}
		for k := range a.options {
			if len(by[k]) > TwinRare {
				continue // an option offered everywhere (a country, a planet) makes no twin
			}
			for _, j := range by[k] {
				if j > i {
					shared[j]++
				}
			}
		}
		for j, n := range shared {
			b := qs[j]
			if n < TwinShared || !b.options[a.answer] || !a.options[b.answer] {
				continue
			}
			how := "mirrored: each one's answer is a wrong option of the other"
			if a.answer == b.answer {
				how = "the same answer"
			}
			out = append(out, finding{ids: l.newer(a.q, b.q), msg: fmt.Sprintf("%s and %s share %d options, %s: give one other options, or keep the better one",
				a.q.Base().ID, b.q.Base().ID, n, how)})
		}
	}
	slices.SortFunc(out, func(a, b finding) int { return strings.Compare(a.ids[0]+a.ids[1], b.ids[0]+b.ids[1]) })
	return out
}
