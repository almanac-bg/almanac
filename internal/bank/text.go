package bank

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// What the rules read in a question's words: the stems of its words (two forms of one word share one), the numbers it
// shows, its sentences. Bulgarian bends a word at its end (война, войната; обединение, обединяват), so a stem is a
// word's first stemLen letters: rough, but enough to tell that two texts name the same thing, and what a rule finds
// with it a person reads before acting on.

// stemLen is how many letters of a word its stem keeps.
const stemLen = 5

// stem is a word's stem: lowercase, its first stemLen letters; "" for a word too short to say much (under 4 letters),
// unless it is an abbreviation (МОК, ГДР: capitals only).
func stem(w string) string {
	n := utf8.RuneCountInString(w)
	if n < 4 {
		if n < 2 || strings.ToUpper(w) != w || strings.ToLower(w) == w {
			return ""
		}
		return strings.ToLower(w)
	}
	r := []rune(strings.ToLower(w))
	return string(r[:min(len(r), stemLen)])
}

// letterWords are the runs of letters in s: a hyphen splits a word (Руско-турската is руско and турската).
func letterWords(s string) []string {
	return strings.FieldsFunc(s, func(r rune) bool { return !unicode.IsLetter(r) })
}

// stems are the stems of a text's words, each once, in the order they come.
func stems(s string) []string {
	var out []string
	seen := map[string]bool{}
	for _, w := range letterWords(s) {
		if st := stem(w); st != "" && !seen[st] {
			seen[st] = true
			out = append(out, st)
		}
	}
	return out
}

// stemSet is stems as a set.
func stemSet(texts ...string) map[string]bool {
	set := map[string]bool{}
	for _, t := range texts {
		for _, s := range stems(t) {
			set[s] = true
		}
	}
	return set
}

// numberPattern is a number as the bank writes it: digits, maybe thousands apart by a space (10 000, also no-break),
// maybe a decimal comma (9,58).
var numberPattern = regexp.MustCompile(`\d{1,3}(?:[ \x{a0}]\d{3})+(?:,\d+)?|\d+(?:,\d+)?`)

// numberAt is a number a text shows, and where.
type numberAt struct {
	value      float64
	start, end int
}

// numbersIn finds the numbers a text shows (not inside a word: COVID-19's 19 is a number, a Roman numeral isn't).
func numbersIn(s string) []numberAt {
	var out []numberAt
	for _, m := range numberPattern.FindAllStringIndex(s, -1) {
		if r, _ := utf8.DecodeLastRuneInString(s[:m[0]]); unicode.IsLetter(r) {
			continue
		}
		t := strings.NewReplacer(" ", "", " ", "", ",", ".").Replace(s[m[0]:m[1]])
		if v, err := strconv.ParseFloat(t, 64); err == nil {
			out = append(out, numberAt{v, m[0], m[1]})
		}
	}
	return out
}

// distinctive is whether a value says something by itself when it shows: a year (1000–2100), or a number of three
// figures or more past its trailing zeros (8848, 9,58). Small and round numbers (7, 24, 100, 5000) come up everywhere.
func distinctive(v float64) bool {
	if v >= 1000 && v <= 2100 && v == math.Trunc(v) {
		return true
	}
	s := strings.TrimLeft(strings.ReplaceAll(strconv.FormatFloat(math.Abs(v), 'f', -1, 64), ".", ""), "0")
	s = strings.TrimRight(s, "0")
	return len(s) >= 3
}

// sentenceAt is the sentence of s that holds position i: from after the last „. “, „? “ or „! “ before it to the next.
func sentenceAt(s string, i int) string {
	from := 0
	for _, sep := range []string{". ", "? ", "! ", "; "} {
		if j := strings.LastIndex(s[:i], sep); j >= 0 && j+len(sep) > from && !abbreviation.MatchString(s[:j+1]) {
			from = j + len(sep)
		}
	}
	to := len(s)
	for _, sep := range []string{". ", "? ", "! ", "; "} {
		if j := strings.Index(s[i:], sep); j >= 0 && i+j < to && !abbreviation.MatchString(s[:i+j+1]) {
			to = i + j
		}
	}
	return s[from:to]
}

// outsideQuotes is a text with what's in „…“ blanked out (its length kept): a quoted title keeps its own spelling.
func outsideQuotes(s string) string {
	var b strings.Builder
	depth := 0
	for _, r := range s {
		switch {
		case r == '„':
			depth++
		case r == '“' && depth > 0:
			depth--
			b.WriteRune(' ')
			continue
		}
		if depth > 0 {
			b.WriteString(strings.Repeat(" ", utf8.RuneLen(r)))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// lintBank is the live bank as the rules over it read it: the questions, and how common each stem is (a stem most
// questions have, like „година“, says little when two questions share it).
type lintBank struct {
	live []Question
	df   map[string]int
}

func newLintBank(b *Bank) *lintBank {
	l := &lintBank{live: b.Live("", ""), df: map[string]int{}}
	for _, q := range l.live {
		for s := range stemSet(append(q.words(), q.Extra().Fact)...) {
			l.df[s]++
		}
	}
	return l
}

// weight is how much a shared stem says: rare ones much, common ones little (inverse document frequency).
func (l *lintBank) weight(s string) float64 {
	return math.Log(float64(len(l.live)+1) / float64(l.df[s]+1))
}

// common is what a and b share (but the stems in skip), and how much it says.
func (l *lintBank) common(a, b, skip map[string]bool) (shared []string, w float64) {
	for s := range a {
		if b[s] && !skip[s] {
			shared = append(shared, s)
			w += l.weight(s)
		}
	}
	return shared, w
}
