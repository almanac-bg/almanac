package bank

import (
	"cmp"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// The rules of a choice's options (a choice's, clues'): the answer must not stand out by its form, only by being
// right. A player who doesn't know picks the odd one out: the one with a regnal numeral (Карл V among plain names),
// the one in Latin letters among Cyrillic ones, the one in quotes, the long one with a qualifier the others lack. And
// no word of the answer may be in the text or a clue unless the wrong options have it too.

// namedOptions are a question's options as a player reads them before answering (nil for a choice of pictures,
// whose names show only with the answer), the answer first.
func namedOptions(q Question) []string {
	switch q := q.(type) {
	case *Choice:
		if len(q.Pictures) == 0 {
			return q.options()
		}
	case *Clues:
		return q.options()
	}
	return nil
}

// regnal is a name with a regnal numeral (Карл V, Симеон I, Луи XIV), outside quotes.
var regnal = regexp.MustCompile(`\p{L}+ [IVX]{1,6}(?:[^\p{L}]|$)`)

// script says which letters a line is written in: "latin", "cyrillic", or "" (both, or neither: a number).
func script(s string) string {
	latin, cyrillic := false, false
	for _, r := range s {
		latin = latin || unicode.In(r, unicode.Latin)
		cyrillic = cyrillic || unicode.In(r, unicode.Cyrillic)
	}
	switch {
	case latin && !cyrillic:
		return "latin"
	case cyrillic && !latin:
		return "cyrillic"
	}
	return ""
}

func ruleOptions(q Question) []string {
	opts := namedOptions(q)
	if len(opts) < 2 {
		return nil
	}
	answer, wrong := opts[0], opts[1:]
	var out []string
	has := func(o string) bool { return regnal.MatchString(outsideQuotes(o)) }
	if has(answer) && !anyOf(wrong, has) {
		out = append(out, "only the answer has a regnal numeral: "+answer)
	}
	if s := script(answer); s != "" {
		other := script(wrong[0])
		same := other != "" && other != s
		for _, w := range wrong[1:] {
			same = same && script(w) == other
		}
		if same {
			out = append(out, "only the answer is in "+map[string]string{"latin": "Latin", "cyrillic": "Cyrillic"}[s]+" letters: "+answer)
		}
	}
	quoted := 0
	for _, o := range opts {
		if strings.HasPrefix(o, "„") {
			quoted++
		}
	}
	if quoted > 0 && quoted < len(opts) {
		out = append(out, fmt.Sprintf("%d of the %d options are in quotes: all or none", quoted, len(opts)))
	}
	return out
}

func anyOf(xs []string, f func(string) bool) bool {
	for _, x := range xs {
		if f(x) {
			return true
		}
	}
	return false
}

// LongAnswer is how much longer than every wrong option an answer may be before it stands out: half again as long,
// and at least LongAnswerBy letters more.
const (
	LongAnswer   = 1.5
	LongAnswerBy = 10
)

func ruleLongAnswer(q Question) []string {
	opts := namedOptions(q)
	if len(opts) < 2 {
		return nil
	}
	a, most := utf8.RuneCountInString(opts[0]), 0
	for _, w := range opts[1:] {
		most = max(most, utf8.RuneCountInString(w))
	}
	if float64(a) > LongAnswer*float64(most) && a-most >= LongAnswerBy {
		return []string{fmt.Sprintf("the answer (%d letters) is much longer than every wrong option (%d at most): %s", a, most, opts[0])}
	}
	return nil
}

// ruleAnswerWord: a word of the answer that the text or a clue has, and no wrong option, gives the answer away
// („френски лекари“ in a clue to „Лекари без граници“).
func ruleAnswerWord(q Question) []string {
	opts := namedOptions(q)
	if len(opts) < 2 {
		return nil
	}
	tell := stemSet(opts[0])
	for s := range stemSet(opts[1:]...) {
		delete(tell, s)
	}
	lines := []string{q.Base().Text}
	if c, ok := q.(*Clues); ok {
		lines = append(lines, c.Clues...)
	}
	var out []string
	for i, line := range lines {
		for _, s := range stems(line) {
			if tell[s] {
				where := "the text"
				if i > 0 {
					where = fmt.Sprintf("clue %d", i)
				}
				out = append(out, fmt.Sprintf("%s shares „%s…“ with the answer %s: %s", where, s, opts[0], line))
				break
			}
		}
	}
	return out
}

func ruleDecoy(q Question) []string {
	if m, ok := q.(*Match); ok && m.Decoy == "" && m.Added < DecoysFrom {
		return []string{"a match without a decoy: whoever knows three pairs gets the fourth"}
	}
	return nil
}

// NumberRankAt is how many choices of numbers the rank rule judges at the least (ruleNumberRank), in the bank or a
// topic: fewer say nothing about where the answers sit.
const NumberRankAt = 40

// numberRank is where a choice's answer stands among its four options when they are numbers and nothing else tells
// them apart („15%“ among „10%“, „18%“, „25%“): 1 for the smallest to 4 for the largest; 0 for any other choice.
func numberRank(q Question) int {
	opts := namedOptions(q)
	if len(opts) != ChoiceOptions {
		return 0
	}
	vals, shape := make([]float64, len(opts)), ""
	for i, o := range opts {
		ns := numbersIn(o)
		if len(ns) != 1 {
			return 0
		}
		s := o[:ns[0].start] + "#" + o[ns[0].end:]
		if i > 0 && s != shape {
			return 0
		}
		vals[i], shape = ns[0].value, s
	}
	s := slices.Sorted(slices.Values(vals))
	if len(slices.Compact(slices.Clone(s))) != len(s) {
		return 0
	}
	return slices.Index(s, vals[0]) + 1
}

// ruleNumberRank: across the bank, and within a topic, the answer of a choice of numbers sits about as often at
// each of the four ranks. Writers put the right number between plausible ones, so it ends up second or third, and a
// player who picks a middle number wins. A group is skewed when a rank's share is off a quarter by more than three
// standard deviations of chance; the finding names the questions at the rank that has the most, the newest first:
// the ones whose wrong options to move.
func ruleNumberRank(l *lintBank) []finding {
	groups := map[string][]Question{}
	topics := []string{""}
	for _, q := range l.live {
		if numberRank(q) == 0 {
			continue
		}
		c := q.Base().Category
		if _, ok := groups[c]; !ok {
			topics = append(topics, c)
		}
		groups[""] = append(groups[""], q)
		groups[c] = append(groups[c], q)
	}
	var out []finding
	for _, g := range topics {
		qs := groups[g]
		if len(qs) < NumberRankAt {
			continue
		}
		var at [ChoiceOptions][]Question
		for _, q := range qs {
			r := numberRank(q) - 1
			at[r] = append(at[r], q)
		}
		n := float64(len(qs))
		margin := 3 * math.Sqrt(0.25*0.75/n)
		skewed, most := false, 0
		shares := make([]string, ChoiceOptions)
		for r := range at {
			share := float64(len(at[r])) / n
			skewed = skewed || math.Abs(share-0.25) > margin
			if len(at[r]) > len(at[most]) {
				most = r
			}
			shares[r] = fmt.Sprintf("%.0f", 100*share)
		}
		if !skewed {
			continue
		}
		slices.SortFunc(at[most], func(a, b Question) int {
			return cmp.Or(strings.Compare(b.Extra().Added, a.Extra().Added), strings.Compare(b.Base().ID, a.Base().ID))
		})
		ids := make([]string, len(at[most]))
		for i, q := range at[most] {
			ids[i] = q.Base().ID
		}
		where := "the bank"
		if g != "" {
			where = g
		}
		out = append(out, finding{ids: ids, msg: fmt.Sprintf("the answers of the %d choices of numbers in %s are the smallest, second, third, largest of the four %s%% of the time (25 ± %.0f by chance): give some of the %d at the %s other wrong options",
			len(qs), where, strings.Join(shares, "/"), 100*margin, len(ids), rankName[most])})
	}
	return out
}

var rankName = [ChoiceOptions]string{"smallest", "second", "third", "largest"}
