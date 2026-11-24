package bank

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"unicode"
)

// The public sample (PublicDir) is on GitHub with its answers, and a search finds it: a live question of the private
// bank that the sample asks too has its answer public, and a player can look it up during the day's issue. So
// `almanac bank check` and `bank add`, run from the repository's root, hold the private bank against the sample
// (Public), and a question both ask is retired in the private bank (retiredWhy „public“). The sample had been written
// from the bank: on 24 Nov 2026, 141 of its 198 questions were live there (133 found by Public, 8 more read by hand,
// each in other words with a word of its own: „Коя студена супа се прави от…“ and „Как се нарича студената супа
// от…“). The server has no sample beside its bank, and doesn't check this: it is the writing side's.

// PublicDir is the public sample, from the repository's root.
const PublicDir = "bank/sample"

// RulePublic is the rule a live question breaks when the public sample asks it too.
const RulePublic = "public"

// Public lists the live questions of b that the public sample asks too, each an error (whatever its age): one with
// the same answer (a number asked as a choice too) whose text says nothing the other's doesn't (all of one text's
// stems, three or more, but the frame's words, in the other: „Кой монах написва „История славянобългарска“?“ and
// „…през 1762 г.?“); a "who or what is this" with the same answer and the same picture or a clue of the sample's; and
// an order, a match or a split with all but one of the sample's items (each with its value, its pair, its group): the
// rest follows. Two that each say something of their own ask two facts (Стоичков's „Златната топка“ and his
// nickname; the borders of България and of Румъния) and don't match: the near rule's reading (near.go).
func (b *Bank) Public(sample *Bank) []Problem {
	var out []Problem
	for _, q := range b.Questions {
		if q.Extra().Retired {
			continue
		}
		for _, s := range sample.Questions {
			if publicMatch(q, s) {
				out = append(out, Problem{ID: q.Base().ID, Rule: RulePublic, Msg: fmt.Sprintf(
					"the public sample asks it too (%s, „%s“): its answer is public; retire it (retiredWhy %s)",
					s.Base().ID, s.Base().Text, RulePublic)})
				break
			}
		}
	}
	return out
}

// publicMatch is whether q asks what s does (Public).
func publicMatch(q, s Question) bool {
	if a, b := publicItems(q), publicItems(s); a != nil || b != nil {
		if a == nil || b == nil || q.Base().Type != s.Base().Type {
			return false
		}
		shared := 0
		for _, x := range a {
			if slices.Contains(b, x) {
				shared++
			}
		}
		return shared >= min(len(a), len(b))-1
	}
	qa, qok := publicAnswer(q)
	sa, sok := publicAnswer(s)
	if !qok || !sok || qa != sa {
		return false
	}
	if identity(q) || identity(s) {
		return sharesPicture(q, s) || sharesClue(q, s)
	}
	if publicText(q) == publicText(s) {
		return true
	}
	x, y := publicStems(q), publicStems(s)
	both := 0
	for st := range x {
		if y[st] {
			both++
		}
	}
	return both >= 3 && (both == len(x) || both == len(y))
}

// publicStems are the stems of a question's text, but the words of its frame (nearStop: „Кой“, „Колко“).
func publicStems(q Question) map[string]bool {
	out := map[string]bool{}
	for _, w := range letterWords(q.Base().Text) {
		if st := stem(w); st != "" && !nearStop[strings.ToLower(w)] {
			out[st] = true
		}
	}
	return out
}

// publicText is a question's text as Public compares it: lowercase, its words and numbers only.
func publicText(q Question) string {
	return strings.Join(strings.FieldsFunc(strings.ToLower(q.Base().Text), func(r rune) bool {
		return !strings.ContainsRune("0123456789", r) && !unicode.IsLetter(r)
	}), " ")
}

// publicAnswer is a question's answer as Public compares it: a choice's (a number as its value, so that one asked as
// a number matches), a number's value, a true-or-not's truth apart from the rest; false for the kinds of items.
func publicAnswer(q Question) (string, bool) {
	value := func(v float64) string { return "#" + strconv.FormatFloat(v, 'f', -1, 64) }
	switch q := q.(type) {
	case *Choice:
		if v, ok := numericAnswer(q.Answer); ok {
			return value(v), true
		}
		return strings.ToLower(strings.Trim(q.Answer, "„“ ")), true
	case *Clues:
		return strings.ToLower(strings.Trim(q.Answer, "„“ ")), true
	case *Number:
		return value(q.Answer), true
	case *TrueFalse:
		return "?" + strconv.FormatBool(q.Answer), true
	}
	return "", false
}

// publicItems are an order's items with their values, a match's pairs, a split's items with their groups, each as
// one string; nil for the other kinds.
func publicItems(q Question) []string {
	low := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
	var out []string
	switch q := q.(type) {
	case *Order:
		for _, it := range q.Items {
			out = append(out, low(it.Text)+"="+strconv.FormatFloat(it.Value, 'f', -1, 64))
		}
	case *Match:
		for _, p := range q.Pairs {
			out = append(out, low(p.Left)+"="+low(p.Right))
		}
	case *Split:
		for _, it := range q.Items {
			if it.Group >= 0 && it.Group < len(q.Groups) {
				out = append(out, low(it.Text)+"="+low(q.Groups[it.Group]))
			}
		}
	}
	return out
}

// sharesPicture is whether two questions show a picture from the same page.
func sharesPicture(q, s Question) bool {
	for _, a := range picturesOf(q) {
		for _, b := range picturesOf(s) {
			if a.Source != "" && a.Source == b.Source {
				return true
			}
		}
	}
	return false
}

// sharesClue is whether two clues questions have a clue in common.
func sharesClue(q, s Question) bool {
	a, ok1 := q.(*Clues)
	b, ok2 := s.(*Clues)
	return ok1 && ok2 && slices.ContainsFunc(a.Clues, func(c string) bool { return slices.Contains(b.Clues, c) })
}
