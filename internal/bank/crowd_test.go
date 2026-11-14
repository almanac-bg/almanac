package bank

import (
	"encoding/json"
	"math"
	"testing"
)

func TestCrowd(t *testing.T) {
	q := &Choice{Head: Head{Type: "choice", Text: "Кой е най-високият връх на Балканите?"}, Answer: "Мусала",
		Wrong: []string{"Олимп", "Вихрен", "Кораб"}}
	pick := func(i int) json.RawMessage { return mustJSON(ChoiceAnswer{Pick: i}) }
	c := CrowdOf(q, []Tally{{pick(0), 6, 6}, {pick(1), 3, 0}, {pick(2), 1, 0}, {nil, 2, 0}})
	if c.Answers != 12 || math.Abs(c.Right-0.5) > 1e-9 {
		t.Fatalf("counted %+v", c)
	}
	// The picks are shares of all the answers (the answer's is the share right), in the bank's order.
	if want := []float64{0.5, 0.25, 1.0 / 12, 0}; !near(c.Picks, want) {
		t.Fatalf("picks %v, want %v", c.Picks, want)
	}
	// A deal shows each share beside its option.
	for seed := range uint64(10) {
		d := q.Deal(seed)
		var view struct{ Choices []string }
		var rev struct {
			Pick  int
			Crowd *CrowdView
		}
		_ = json.Unmarshal(mustJSON(d.View()), &view)
		_ = json.Unmarshal(mustJSON(d.Reveal(c)), &rev)
		share := map[string]float64{"Мусала": 0.5, "Олимп": 0.25, "Вихрен": 1.0 / 12, "Кораб": 0}
		for i, o := range view.Choices {
			if math.Abs(rev.Crowd.Picks[i]-share[o]) > 1e-9 {
				t.Fatalf("seed %d: %s shown with %v", seed, o, rev.Crowd.Picks[i])
			}
		}
	}
	if v := (*Crowd)(nil).view(nil); v != nil {
		t.Fatal("no crowd showed one")
	}

	tf := &TrueFalse{Head: Head{Type: "truefalse", Text: "Китът е бозайник."}, Answer: true}
	truth := func(b bool) json.RawMessage { return mustJSON(TrueFalseAnswer{Truth: b}) }
	if c := CrowdOf(tf, []Tally{{truth(true), 3, 3}, {truth(false), 1, 0}}); !near(c.Picks, []float64{0.75, 0.25}) {
		t.Fatalf("true or not: %v", c.Picks)
	}
}

func TestSpread(t *testing.T) {
	value := func(v float64) json.RawMessage { return mustJSON(NumberAnswer{Value: v}) }
	q := &Number{Head: Head{Type: "number"}, Answer: 2925, Step: 1, Scale: "linear", Tolerance: 600}
	s := CrowdOf(q, []Tally{{value(2925), 2, 2}, {value(2000), 1, 0}, {value(4000), 1, 0}, {nil, 5, 0}}).Guesses
	if s.Lo != 2325 || s.Hi != 3525 || s.Below != 0.25 || s.Above != 0.25 {
		t.Fatalf("spread %+v", s)
	}
	if s.Bins[SpreadBins/2] != 0.5 {
		t.Fatalf("the answer's part has %v", s.Bins)
	}
	// Nothing can be below 0 but a temperature: the range starts at 0.
	small := &Number{Head: Head{Type: "number"}, Answer: 2, Step: 1, Scale: "linear", Tolerance: 5, Unit: "пъти"}
	if s := CrowdOf(small, []Tally{{value(2), 1, 1}}).Guesses; s.Lo != 0 || s.Hi != 7 {
		t.Fatalf("small spread %+v", s)
	}
	// On a log scale the range is a tolerance-fold either side, and the parts are equal on it.
	big := &Number{Head: Head{Type: "number"}, Answer: 1000, Step: 1, Scale: "log", Tolerance: 10}
	s = CrowdOf(big, []Tally{{value(1000), 1, 1}, {value(100), 1, 0}, {value(0), 1, 0}}).Guesses
	if s.Lo != 100 || s.Hi != 10000 || !s.Log || math.Abs(s.At(1000)-0.5) > 1e-9 || s.Below != 1.0/3 {
		t.Fatalf("log spread %+v", s)
	}
}

func near(a, b []float64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if math.Abs(a[i]-b[i]) > 1e-9 {
			return false
		}
	}
	return true
}
