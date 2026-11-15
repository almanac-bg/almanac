package bank

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Subjects: what a question is about, so that the same subjects don't keep coming back. A player who plays every day
// meets the same handful of subjects in new clothes (Наполеон, „Титаник“, Disney) and feels the bank run dry, though
// no two questions are the same. Two tools keep it in hand: a day holds one question of each subject (Subjects, read
// by the day's draw), and `bank check` lists the subjects many questions name and the "who is this" questions that
// share an answer (Repeats, SameIdentity), for whoever keeps the bank. What a question names is read from what a
// player sees of it before the answer — its text, options, clues, items and pairs — never from its fact.

// quotedTitle is a title in Bulgarian quotes: „Под игото“.
var quotedTitle = regexp.MustCompile(`„([^„“]+)“`)

// wordPattern is a word: letters, with an inner hyphen or apostrophe (Жолио-Кюри, O'Neill).
var wordPattern = regexp.MustCompile(`\p{L}+(?:[-'’]\p{L}+)*`)

// subjectKey is how two names of one subject compare: lowercase, without quotes, spaces collapsed.
func subjectKey(s string) string {
	s = strings.Trim(strings.TrimSpace(s), `„“"'`)
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// answerOf is a question's answer as one name (a choice's, clues', a number's with its unit), "" for the kinds whose
// answer isn't one (true or not, an order, a match, a split).
func answerOf(q Question) string {
	switch q := q.(type) {
	case *Choice:
		return q.Answer
	case *Clues:
		return q.Answer
	case *Number:
		return AnswerText(q)
	}
	return ""
}

// Subjects are what a question names as its subject, for a day to hold one question of each: its answer, and every
// title it quotes („Под игото“) where a player sees it — compared without quotes or case, so that a choice answered
// „Титаник“ and a true-or-not about „Титаник“ are one subject. A loaded bank has them worked out already.
func Subjects(q Question) []string {
	if s := q.Base().subjects; s != nil {
		return s
	}
	return subjectsOf(q)
}

func subjectsOf(q Question) []string {
	out := []string{}
	if a := subjectKey(answerOf(q)); a != "" {
		out = append(out, a)
	}
	for _, line := range q.words() {
		for _, m := range quotedTitle.FindAllStringSubmatch(line, -1) {
			if k := subjectKey(m[1]); k != "" && !slices.Contains(out, k) {
				out = append(out, k)
			}
		}
	}
	return out
}

// asked is what a player sees of a question before the answer, as sentences (the text, the clues) and labels (the
// options, items, pairs, groups): a label is a name as a whole, a sentence names things inside it.
func asked(q Question) (sentences, labels []string) {
	sentences = []string{q.Base().Text}
	switch q := q.(type) {
	case *Choice:
		labels = q.options()
	case *Clues:
		sentences = append(sentences, q.Clues...)
		labels = q.options()
	case *Order:
		for _, it := range q.Items {
			labels = append(labels, it.Text)
		}
	case *Match:
		for _, p := range q.Pairs {
			labels = append(labels, p.Left, p.Right)
		}
		if q.Decoy != "" {
			labels = append(labels, q.Decoy)
		}
	case *Split:
		labels = append(labels, q.Groups[0], q.Groups[1])
		for _, it := range q.Items {
			labels = append(labels, it.Text)
		}
	}
	return sentences, labels
}

// particles join the words of a name in lower case: Леонардо да Винчи, Лудвиг ван Бетовен.
var particles = map[string]bool{"да": true, "де": true, "ди": true, "дьо": true, "ван": true, "фон": true, "ла": true, "ле": true, "дел": true}

// romanNumeral is a number in Roman figures (Симеон I, XIX век): part of a name, never one alone.
var romanNumeral = regexp.MustCompile(`^[IVXLCDM]+$`)

// named calls name with every subject a question names, by key and as written: its answer; every quoted title; every
// label (an option, an item: a name as a whole); and in its sentences every name, the words with capitals in a row
// (Ню Йорк, Леонардо да Винчи), but for the capital a sentence starts with (Наполеон Бонапарт at the start is
// Бонапарт). A number is no subject (10, 1878: many questions have them without being about one thing). A key may
// come more than once.
func named(q Question, name func(key, as string)) {
	add := func(s string) {
		s = strings.Trim(strings.TrimSpace(s), `„“"'`)
		k := subjectKey(s)
		if utf8.RuneCountInString(k) > 1 && strings.IndexFunc(k, unicode.IsLetter) >= 0 && !romanNumeral.MatchString(s) {
			name(k, s)
		}
	}
	add(answerOf(q))
	sentences, labels := asked(q)
	for _, line := range append(sentences, labels...) {
		for _, m := range quotedTitle.FindAllStringSubmatch(line, -1) {
			add(m[1])
		}
	}
	for _, l := range labels {
		add(l)
	}
	for _, line := range sentences {
		words := wordPattern.FindAllStringIndex(line, -1)
		for i := 0; i < len(words); i++ {
			if !capital(line, words[i]) {
				continue
			}
			from, to := words[i][0], words[i][1]
			for j := i + 1; j < len(words) && line[to:words[j][0]] == " "; j++ {
				w := words[j]
				if !capital(line, w) && !(particles[line[w[0]:w[1]]] && j+1 < len(words) && capital(line, words[j+1])) {
					break
				}
				to, i = w[1], j
			}
			if sentenceStart(line[:from]) {
				// A sentence's first word has its capital for its place: the name, if any, is the rest.
				_, rest, ok := strings.Cut(line[from:to], " ")
				if !ok {
					continue
				}
				add(rest)
				continue
			}
			add(line[from:to])
		}
	}
}

// abbreviation is a word cut short before its dot (1804 г., в. „Труд“, ок. 300): no sentence ends there.
var abbreviation = regexp.MustCompile(`(?:^|[^\p{L}])\p{Ll}{1,3}\.$`)

// sentenceStart is whether what comes before a word leaves it at the start of a sentence.
func sentenceStart(before string) bool {
	before = strings.TrimRight(before, " „“\"'(")
	last, _ := utf8.DecodeLastRuneInString(before)
	return before == "" || strings.ContainsRune("?!:…", last) || (last == '.' && !abbreviation.MatchString(before))
}

// capital is whether a word (its place in line) starts with a capital letter.
func capital(line string, at []int) bool {
	r, _ := utf8.DecodeRuneInString(line[at[0]:at[1]])
	return unicode.IsUpper(r)
}

// Subject is a subject the bank comes back to: its name as first written, and the live questions that name it.
type Subject struct {
	Name string
	IDs  []string
}

// Repeats are the subjects that more than most live questions name, the most named first (then by name).
func (b *Bank) Repeats(most int) []Subject {
	ids := map[string][]string{}
	names := map[string]string{}
	for _, q := range b.Live("", "") {
		id := q.Base().ID
		named(q, func(k, as string) {
			if l := ids[k]; len(l) == 0 || l[len(l)-1] != id {
				ids[k] = append(l, id)
			}
			if _, ok := names[k]; !ok {
				names[k] = as
			}
		})
	}
	var out []Subject
	for k, l := range ids {
		if len(l) > most {
			out = append(out, Subject{Name: names[k], IDs: l})
		}
	}
	slices.SortFunc(out, func(x, y Subject) int {
		if len(x.IDs) != len(y.IDs) {
			return len(y.IDs) - len(x.IDs)
		}
		return strings.Compare(x.Name, y.Name)
	})
	return out
}

// identity is a "who or what is this" question: a choice with a picture, or clues. Two of them with one answer ask
// the same thing twice, whatever their wording.
func identity(q Question) bool {
	switch q.(type) {
	case *Choice:
		return HasPictures(q)
	case *Clues:
		return true
	}
	return false
}

// SameIdentity are the live "who or what is this" questions (identity) that share an answer: each group the answer,
// then its questions, in the bank's order.
func (b *Bank) SameIdentity() []Subject {
	ids := map[string][]string{}
	var order []string
	names := map[string]string{}
	for _, q := range b.Live("", "") {
		if !identity(q) {
			continue
		}
		k := subjectKey(answerOf(q))
		if _, ok := ids[k]; !ok {
			order = append(order, k)
			names[k] = answerOf(q)
		}
		ids[k] = append(ids[k], q.Base().ID)
	}
	var out []Subject
	for _, k := range order {
		if len(ids[k]) > 1 {
			out = append(out, Subject{Name: names[k], IDs: ids[k]})
		}
	}
	return out
}

// Spread is how a subject's questions fall into the categories, the most first: "movies 50, music 4".
func (b *Bank) Spread(s Subject) []CategoryCount {
	n := map[string]int{}
	for _, id := range s.IDs {
		if q, ok := b.Get(id); ok {
			n[q.Base().Category]++
		}
	}
	var out []CategoryCount
	for _, c := range b.Categories {
		if n[c.ID] > 0 {
			out = append(out, CategoryCount{c.ID, n[c.ID]})
		}
	}
	slices.SortStableFunc(out, func(x, y CategoryCount) int { return y.N - x.N })
	return out
}

// CategoryCount is how many of something a category has.
type CategoryCount struct {
	Category string
	N        int
}

func (c CategoryCount) String() string { return c.Category + " " + strconv.Itoa(c.N) }
