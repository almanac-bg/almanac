package bank

import (
	"encoding/json"
	"math"
)

// Crowd is how players have answered a question so far, in the bank's own terms (so that it adds up across deals). It
// is shown with the answer, so that a player sees how the question went for everyone else: a hard one for most, or a
// trap many fell into. The game counts it from its answer log; a deal shows it in its own terms (Dealt.Reveal).
type Crowd struct {
	// Answers is how many answers it counts, the ones left to run out of time too.
	Answers int
	// Right is the share of them that were right.
	Right float64
	// Picks is, for a choice (or clues), the share of the answers that picked each option, as the bank keeps them (the answer
	// first); for a true-or-not, the share that said true, then false. Shares of all the answers, like Right, so that
	// the answer's share is the share right (the ones that ran out of time picked nothing).
	Picks []float64
	// Guesses is, for a number, where the typed numbers fell.
	Guesses *Spread
}

// Spread is where typed numbers fell around a number's answer: in SpreadBins equal parts of the range where a guess
// scores anything (a tolerance either side of the answer, on the question's scale; from 0 up for what can't be below
// it), and the shares beyond it on either side.
type Spread struct {
	Lo    float64   `json:"lo"`
	Hi    float64   `json:"hi"`
	Log   bool      `json:"log,omitempty"`
	Bins  []float64 `json:"bins"`
	Below float64   `json:"below"`
	Above float64   `json:"above"`
}

// SpreadBins is how many parts a spread has.
const SpreadBins = 12

// Tally is a line of the answer log, counted: an answer as the log keeps it (nil for none), how many gave it, and how
// many of them were right.
type Tally struct {
	Given json.RawMessage
	N     int
	Right int
}

// CrowdOf counts a question's tallies into its crowd.
func CrowdOf(q Question, tallies []Tally) *Crowd {
	c := &Crowd{}
	right := 0
	for _, t := range tallies {
		c.Answers += t.N
		right += t.Right
	}
	if c.Answers == 0 {
		return c
	}
	c.Right = float64(right) / float64(c.Answers)
	switch q := q.(type) {
	case *Choice, *Clues:
		c.Picks = shares(ChoiceOptions, c.Answers, tallies, func(given json.RawMessage) int {
			var a ChoiceAnswer
			if json.Unmarshal(given, &a) != nil {
				return -1
			}
			return a.Pick
		})
	case *TrueFalse:
		c.Picks = shares(2, c.Answers, tallies, func(given json.RawMessage) int {
			var a TrueFalseAnswer
			if json.Unmarshal(given, &a) != nil {
				return -1
			}
			if a.Truth {
				return 0
			}
			return 1
		})
	case *Number:
		c.Guesses = q.spread(tallies)
	}
	return c
}

// shares is what share of all the answers went to each of n places.
func shares(n, all int, tallies []Tally, place func(json.RawMessage) int) []float64 {
	counts := make([]float64, n)
	for _, t := range tallies {
		if t.Given == nil {
			continue
		}
		if i := place(t.Given); i >= 0 && i < n {
			counts[i] += float64(t.N) / float64(all)
		}
	}
	return counts
}

// spread is where the typed guesses at a number fell (none, when nobody typed one).
func (q *Number) spread(tallies []Tally) *Spread {
	s := &Spread{Bins: make([]float64, SpreadBins), Log: q.Scale == "log"}
	if s.Log {
		s.Lo, s.Hi = q.Answer/q.Tolerance, q.Answer*q.Tolerance
	} else {
		s.Lo, s.Hi = q.Answer-q.Tolerance, q.Answer+q.Tolerance
		if !q.Signed() {
			s.Lo = max(s.Lo, 0)
		}
	}
	all := 0.0
	for _, t := range tallies {
		var a NumberAnswer
		if t.Given == nil || json.Unmarshal(t.Given, &a) != nil {
			continue
		}
		n := float64(t.N)
		all += n
		switch at := s.At(a.Value); {
		case at < 0:
			s.Below += n
		case at > 1:
			s.Above += n
		default:
			s.Bins[min(SpreadBins-1, int(at*SpreadBins))] += n
		}
	}
	if all == 0 {
		return nil
	}
	s.Below, s.Above = s.Below/all, s.Above/all
	for i := range s.Bins {
		s.Bins[i] /= all
	}
	return s
}

// At is where a value sits in the spread's range: 0 at its low end, 1 at its high end, beyond them outside it.
func (s *Spread) At(v float64) float64 {
	if s.Log {
		if v <= 0 {
			return -1
		}
		return math.Log(v/s.Lo) / math.Log(s.Hi/s.Lo)
	}
	return (v - s.Lo) / (s.Hi - s.Lo)
}

// CrowdView is a crowd as a deal shows it: a choice's picks in the order its options are shown.
type CrowdView struct {
	Answers int       `json:"answers"`
	Right   float64   `json:"right"`
	Picks   []float64 `json:"picks,omitempty"`
	Guesses *Spread   `json:"guesses,omitempty"`
}

// view is the crowd as shown, its picks put in the deal's order (order[i] is the bank's place of what's shown at i;
// nil keeps the bank's order).
func (c *Crowd) view(order []int) *CrowdView {
	if c == nil || c.Answers == 0 {
		return nil
	}
	v := &CrowdView{Answers: c.Answers, Right: c.Right, Picks: c.Picks, Guesses: c.Guesses}
	if order != nil && len(c.Picks) == len(order) {
		v.Picks = make([]float64, len(order))
		for i, b := range order {
			v.Picks[i] = c.Picks[b]
		}
	}
	return v
}
