package bank

import (
	"fmt"
	"regexp"
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
