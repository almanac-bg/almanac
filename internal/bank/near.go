package bank

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Near-duplicates: two questions that ask one fact in other words, which the twin rule (the same options) and the
// same-identity rule (the same "who is this" answer) don't see: a choice reworded with other options, a true-or-not
// that states what a choice asks, two numbers of one quantity, one question whose words answer another („Кой
// италиански град е люлка на Ренесанса?“ for „В коя държава е Флоренция?“).
//
// Found fast and without a model (about 0.1 s for the whole bank). Each question's words — a choice's or a number's
// text with its answer, a true-or-not's statement — become tokens: stems (two forms of one word share one), numbers,
// three-letter names, not the frame words of nearStop. An inverted index of the rare tokens (NearRare) brings
// together the questions that share two of them, never every pair. A pair is flagged when:
//
//   - its tokens' weighted Jaccard (a token weighs by how rare it is) is at least NearFrom;
//   - each one's answer shows in the other (a choice's answer's words, a number's value within 10%; a false
//     true-or-not shows no answer and asks none of the other): two questions with one subject and two answers ask
//     two facts (the year Ленън was shot, his age then);
//   - one of them says nothing the other doesn't: no rare word of its own (one in fewer than NearCommon questions has
//     it) and no name (a word the bank writes with a capital inside a sentence, never in lowercase). Two that each
//     say something of their own are one frame with two facts (Норвегия и Русия, Норвегия и Германия) or one
//     subject with two facts (Хендрикс a left-hander, Хендрикс British).
//
// A "who or what is this" question (a picture, clues) is the same-identity rule's; an order, a match and a split ask
// no one fact. What it finds is a hint: how alike two questions' words are isn't whether one answers the other, so a
// person reads each pair (and waives a false one).
//
// Calibrated on the real bank (23 Nov 2026: 14 692 live questions, 10 630 of them read, 0.1 s), every pair read by
// hand: the Jaccard alone from 0.5 flagged 48 pairs, 7 of them twins (15%), the rest one subject or one frame with
// two facts; with the gates, 20 pairs from NearFrom, 10 of them twins (precision 50%: Елза and Ана sisters, QWERTY a
// keyboard's layout, Квебек in Canada, гъбите no plants, Хавай a state of the USA, бруст a swimming style, Кирил and
// Методий brothers, Флоренция in Italy twice, Мюнхен in Germany); from 0.3, 15 pairs, 7 twins. What the gates
// lose: twins that each say something of their own (a light bulb's heat said in other words; a card's length in mm
// and in cm), and 4 of the 7 the Jaccard alone found.

// nearStop are the words that say nothing of what a question asks: its frame („Кой…“, „Колко…“, „Вярно ли е…“),
// pronouns, and the small words a capital would keep (stem drops the rest under four letters).
var nearStop = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`
		кой коя кое кои какъв каква какво какви колко кога къде как защо чий чия чие чии
		който която което които какъвто каквото когато където
		този тази това тези онзи онази онова онези такъв такава такова такива там тук
		той тя то те негов нейна негова нейно нейни неговия неговият нейния нейният техен техния тяхна тяхно техни свой своя свое свои своят своята
		един една едно едни
		под над при без със във към след през преди между около като също само вече още докато защото обаче дори почти
		бил била било били съм сме сте има имат няма все
		може могат трябва
		вярно невярно наистина истина
		най повече много малко`) {
		nearStop[w] = true
	}
}

// Thresholds of the near rule. NearFrom: the weighted Jaccard a pair is flagged from; under it the pairs that pass the
// gates are mostly one long question that names another's subject in passing. NearRare: how many questions a token
// may be in to bring two together as candidates (commoner tokens still count in the score). NearCommon: a token in
// at least one question in NearCommon is a common word (България, държава, година), not something a question says of
// its own.
const (
	NearFrom   = 0.25
	NearRare   = 200
	NearCommon = 30
)

// nearToken is a word as the near rule compares it: its stem, a three-letter name too (Рим, Нил: stem drops them),
// nothing for a word of nearStop.
func nearToken(w string) string {
	lw := strings.ToLower(w)
	if nearStop[lw] {
		return ""
	}
	if r, _ := utf8.DecodeRuneInString(w); utf8.RuneCountInString(w) == 3 && unicode.IsUpper(r) {
		return lw
	}
	return stem(w)
}

// nearDoc is a question as the near rule reads it.
type nearDoc struct {
	q Question
	// text is what it asks without its answer; answer a choice's answer, or a number's with its unit.
	text, answer string
	// value is a number's answer, or a choice's that is a number (valued).
	value  float64
	valued bool
	// false is a true-or-not that isn't true: it shows no answer.
	false bool
	// tokens are its tokens' ids (sorted), answers those of its answer's words, names those of the names in its text;
	// numbers the numbers it shows, its answer's too.
	tokens, answers, names []int32
	numbers                []float64
}

// nearOf is a question as the near rule reads it, before its tokens; false for the kinds that ask no one fact and
// for "who or what is this" questions.
func nearOf(q Question) (nearDoc, bool) {
	if identity(q) {
		return nearDoc{}, false
	}
	d := nearDoc{q: q, text: q.Base().Text}
	switch q := q.(type) {
	case *Choice:
		d.answer = q.Answer
		d.value, d.valued = numericAnswer(q.Answer)
	case *TrueFalse:
		d.false = !q.Answer
	case *Number:
		d.answer = strings.TrimSpace(formatNumber(q.Answer, q.Step) + " " + q.Unit)
		d.value, d.valued = q.Answer, true
	default:
		return nearDoc{}, false
	}
	return d, true
}

// nearClose is whether two answers are one value: the same year, or two other numbers 10% apart at most.
func nearClose(a, b float64) bool {
	if a == b {
		return true
	}
	year := func(v float64) bool { return v >= 1000 && v <= 2100 && v == math.Trunc(v) }
	return !year(a) && !year(b) && math.Abs(a-b) <= 0.1*max(math.Abs(a), math.Abs(b))
}

// nearPair is two questions that may ask one fact: how alike their tokens are, and the tokens they share.
type nearPair struct {
	a, b  Question
	score float64
	share []string
}

// nearPairs are the pairs of live questions that pass the gates with a weighted Jaccard of at least from.
func nearPairs(l *lintBank, from float64) []nearPair {
	ids := map[string]int32{}
	var tokens []string
	var df []int32
	token := func(t string) int32 {
		k, ok := ids[t]
		if !ok {
			k = int32(len(tokens))
			ids[t] = k
			tokens = append(tokens, t)
			df = append(df, 0)
		}
		return k
	}
	// A name is a word the bank writes with a capital inside a sentence and never in lowercase (a sentence's first
	// word has a capital whatever it is).
	lower, inside := map[string]bool{}, map[string]bool{}
	var docs []nearDoc
	for _, q := range l.live {
		for _, s := range q.words() {
			sentenceWords(s, func(w string, first bool) {
				if r, _ := utf8.DecodeRuneInString(w); unicode.IsLower(r) {
					lower[w] = true
				} else if !first {
					inside[strings.ToLower(w)] = true
				}
			})
		}
		d, ok := nearOf(q)
		if !ok {
			continue
		}
		seen := map[int32]bool{}
		add := func(k int32) {
			if !seen[k] {
				seen[k] = true
				df[k]++
				d.tokens = append(d.tokens, k)
			}
		}
		for i, s := range []string{d.text, d.answer} {
			for _, w := range letterWords(s) {
				if t := nearToken(w); t != "" {
					add(token(t))
					if i == 1 {
						d.answers = append(d.answers, ids[t])
					}
				}
			}
			for _, n := range numbersIn(s) {
				add(token("#" + strconv.FormatFloat(n.value, 'f', -1, 64)))
				d.numbers = append(d.numbers, n.value)
			}
		}
		if d.valued {
			d.numbers = append(d.numbers, d.value)
		}
		slices.Sort(d.tokens)
		docs = append(docs, d)
	}
	for i := range docs {
		for _, w := range letterWords(docs[i].text) {
			if lw := strings.ToLower(w); inside[lw] && !lower[lw] {
				if t := nearToken(w); t != "" {
					docs[i].names = append(docs[i].names, ids[t])
				}
			}
		}
	}

	weight := make([]float64, len(tokens))
	rare := make([]bool, len(tokens)) // a token that says something of its own: not a common word
	posting := make([][]int32, len(tokens))
	for k, n := range df {
		weight[k] = math.Log(float64(len(docs)+1) / float64(n+1))
		rare[k] = int(n)*NearCommon < len(docs)
	}
	for i, d := range docs {
		for _, k := range d.tokens {
			if df[k] <= NearRare {
				posting[k] = append(posting[k], int32(i))
			}
		}
	}

	var out []nearPair
	count := make([]int32, len(docs))
	var touched []int32
	for i := range docs {
		a := &docs[i]
		for _, k := range a.tokens {
			if df[k] > NearRare {
				continue
			}
			for _, j := range posting[k] {
				if int(j) > i {
					if count[j] == 0 {
						touched = append(touched, j)
					}
					count[j]++
				}
			}
		}
		for _, j := range touched {
			b := &docs[j]
			if count[j] >= 2 && nearGates(a, b, rare) {
				var both, all float64
				var share []string
				for x, y := 0, 0; x < len(a.tokens) || y < len(b.tokens); {
					switch {
					case y == len(b.tokens) || (x < len(a.tokens) && a.tokens[x] < b.tokens[y]):
						all += weight[a.tokens[x]]
						x++
					case x == len(a.tokens) || b.tokens[y] < a.tokens[x]:
						all += weight[b.tokens[y]]
						y++
					default:
						both += weight[a.tokens[x]]
						all += weight[a.tokens[x]]
						share = append(share, tokens[a.tokens[x]])
						x, y = x+1, y+1
					}
				}
				if all > 0 && both/all >= from {
					out = append(out, nearPair{a.q, b.q, both / all, share})
				}
			}
			count[j] = 0
		}
		touched = touched[:0]
	}
	return out
}

// nearGates is whether two questions can ask one fact, by what they ask rather than how alike they read: each one's
// answer shows in the other, and one of them says nothing of its own (a rare word, or a name in its text) that the
// other doesn't.
func nearGates(a, b *nearDoc, rare []bool) bool {
	has := func(d *nearDoc, k int32) bool { _, ok := slices.BinarySearch(d.tokens, k); return ok }
	shows := func(x, y *nearDoc) bool { // x shows y's answer
		switch {
		case x.false:
			return true
		case y.valued:
			return slices.ContainsFunc(x.numbers, func(v float64) bool { return nearClose(v, y.value) })
		}
		return !slices.ContainsFunc(y.answers, func(k int32) bool { return !has(x, k) })
	}
	adds := func(x, y *nearDoc) bool { // x says something of its own that y doesn't
		return slices.ContainsFunc(x.tokens, func(k int32) bool { return (rare[k] || slices.Contains(x.names, k)) && !has(y, k) })
	}
	return shows(a, b) && shows(b, a) && !(adds(a, b) && adds(b, a))
}

// ruleNear: two questions may ask one fact in other words.
func ruleNear(l *lintBank) []finding {
	var out []finding
	for _, p := range nearPairs(l, NearFrom) {
		slices.Sort(p.share)
		ids := l.newer(p.a, p.b)
		out = append(out, finding{ids: ids, msg: fmt.Sprintf("%s and %s may ask one fact (%.0f%% alike, sharing %s): keep the better one, or ask another fact",
			ids[0], ids[1], 100*p.score, strings.Join(p.share, ", "))})
	}
	slices.SortFunc(out, func(a, b finding) int { return strings.Compare(a.ids[0]+a.ids[1], b.ids[0]+b.ids[1]) })
	return out
}

// sentenceWords calls f with each word of s (a run of letters) and whether it begins a sentence: the first, or the
// first after „.“, „?“ or „!“.
func sentenceWords(s string, f func(w string, first bool)) {
	first, from := true, -1
	for i, r := range s {
		if unicode.IsLetter(r) {
			if from < 0 {
				from = i
			}
			continue
		}
		if from >= 0 {
			f(s[from:i], first)
			first, from = false, -1
		}
		if r == '.' || r == '?' || r == '!' {
			first = true
		}
	}
	if from >= 0 {
		f(s[from:], first)
	}
}
