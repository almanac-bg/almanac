package bank

import (
	"maps"
	"slices"
	"strconv"
	"unicode"
)

// Reading is how much a player reads to answer a question: what the game's clock (play.Limit) gives them time for, and
// what the length rule (ruleLength) holds to the bank's usual. It counts the letters and digits of everything the
// question shows before it's answered (its text, a number's unit, a choice's options, an order's items), spaces and
// punctuation aside, and PictureReading
// for each picture to look at (over the question, or as a choice's options).
func Reading(q Question) int {
	n := len(picturesOf(q)) * PictureReading
	for _, s := range shownTexts(q) {
		for _, r := range s {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				n++
			}
		}
	}
	return n
}

// PictureReading is what a picture counts as in Reading: about two seconds' reading, to take in what it shows.
const PictureReading = 24

// shownTexts are the texts a question shows before it's answered (Reading).
func shownTexts(q Question) []string {
	out := []string{q.Base().Text}
	switch q := q.(type) {
	case *Choice:
		if len(q.Pictures) == 0 {
			out = append(out, q.options()...)
		}
	case *Number:
		out = append(out, q.Unit)
	case *Order:
		for _, it := range q.Items {
			out = append(out, it.Text)
		}
	}
	return out
}

// LengthFence is how far past the usual a question's Reading may go, for its kind, before the length rule flags it:
// past the third quartile of the kind's live questions by this many times the spread of their middle half (Tukey's
// far fence is 3; 2 flags the few that make a slow reader's clock run long, while the bank's usual stays untouched).
const LengthFence = 2.0

// lengthKind is the fewest live questions of a kind the length rule judges it by, and lengthSpread the least spread of
// their middle half: fewer (the public sample's rarer kinds), or all about as long, say nothing of what's usual.
const lengthKind, lengthSpread = 30, 8

// ruleLength flags the questions whose Reading is far past their kind's usual (LengthFence): the clock gives them
// longer than the rest, and a slow reader still reads more than the others do. The kind of a choice of pictures is
// its own (it reads its pictures).
func ruleLength(l *lintBank) []finding {
	kinds := map[string][]Question{}
	for _, q := range l.live {
		k := q.Base().Type
		if HasPictures(q) {
			k += " with a picture"
		}
		kinds[k] = append(kinds[k], q)
	}
	var out []finding
	for _, k := range slices.Sorted(maps.Keys(kinds)) {
		qs := kinds[k]
		if len(qs) < lengthKind {
			continue
		}
		lens := make([]float64, len(qs))
		for i, q := range qs {
			lens[i] = float64(Reading(q))
		}
		s := slices.Sorted(slices.Values(lens))
		q1, q3 := quantile(s, 0.25), quantile(s, 0.75)
		if q3-q1 < lengthSpread {
			continue
		}
		fence := q3 + LengthFence*(q3-q1)
		for i, q := range qs {
			if lens[i] > fence {
				out = append(out, finding{ids: []string{q.Base().ID}, msg: "it reads " + strconv.Itoa(int(lens[i])) +
					" letters, past the " + strconv.Itoa(int(fence)) + " that are far for a " + k + ": say it shorter"})
			}
		}
	}
	return out
}

// quantile is the p-quantile of sorted values, between the two nearest.
func quantile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	x := p * float64(len(sorted)-1)
	i := int(x)
	if i+1 >= len(sorted) {
		return sorted[len(sorted)-1]
	}
	return sorted[i] + (x-float64(i))*(sorted[i+1]-sorted[i])
}
