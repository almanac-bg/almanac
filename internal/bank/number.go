package bank

import (
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
)

// Number is "Колко…?" or "През коя година…?": a number typed in, scored by how close it is. On a linear scale a guess
// Tolerance away scores nothing; on a log scale (sizes across orders of magnitude) one Tolerance times too big or too
// small does.
type Number struct {
	Head
	Answer float64 `json:"answer"`
	// Unit is what the number counts ("км", "души"); empty for a year.
	Unit string `json:"unit,omitempty"`
	// Min, Max and Step are the range and grid the input allows.
	Min       float64 `json:"min"`
	Max       float64 `json:"max"`
	Step      float64 `json:"step"`
	Scale     string  `json:"scale"`
	Tolerance float64 `json:"tolerance"`
	Tail
}

// RightFrom is how close a number must be to count as a right answer.
const RightFrom = 0.8

func init() { register("number", func() Question { return &Number{} }) }

func (q *Number) Base() *Head  { return &q.Head }
func (q *Number) Extra() *Tail { return &q.Tail }

func (q *Number) check() []string {
	var p []string
	finite := func(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
	if !finite(q.Answer) || !finite(q.Min) || !finite(q.Max) || !finite(q.Step) || !finite(q.Tolerance) {
		return []string{"a number must be finite"}
	}
	if q.Min > q.Answer || q.Answer > q.Max {
		p = append(p, "the answer is outside min–max")
	}
	if q.Step <= 0 {
		p = append(p, "step must be above 0")
	} else if q.snap(q.Answer) != q.Answer {
		p = append(p, "the answer isn't on the step grid")
	}
	switch q.Scale {
	case "linear":
		if q.Tolerance <= 0 {
			p = append(p, "tolerance must be above 0")
		}
	case "log":
		if q.Min <= 0 || q.Tolerance <= 1 {
			p = append(p, "a log scale needs min above 0 and a tolerance above 1 (a factor)")
		}
	default:
		p = append(p, `scale must be "linear" or "log"`)
	}
	p = append(p, checkUnit(q.Unit)...)
	return p
}

func (q *Number) key() string { return fold(q.Text) + "|" + q.Image.file() }

func (q *Number) words() []string { return []string{q.Text, formatNumber(q.Answer, q.Step)} }

// Closeness is how close a guess is: 1 spot on, down to 0 a tolerance away (on a log scale, a tolerance-fold).
func (q *Number) Closeness(guess float64) float64 {
	var off float64
	if q.Scale == "log" {
		off = math.Abs(math.Log(guess/q.Answer)) / math.Log(q.Tolerance)
	} else {
		off = math.Abs(guess-q.Answer) / q.Tolerance
	}
	if math.IsNaN(off) || math.IsInf(off, 0) {
		return 0
	}
	return math.Max(0, 1-off)
}

// Exact is whether a guess is the number itself: within half a step of it.
func (q *Number) Exact(guess float64) bool { return math.Abs(guess-q.Answer) <= q.Step/2+1e-9 }

// snap brings a typed number onto the question's grid: inside its range, in whole steps, without float noise.
func (q *Number) snap(v float64) float64 {
	v = math.Min(q.Max, math.Max(q.Min, v))
	snapped := math.Round(v/q.Step) * q.Step
	out, _ := strconv.ParseFloat(strconv.FormatFloat(snapped, 'f', decimals(q.Step), 64), 64)
	return out
}

// decimals is how many decimals a step has (0.5 → 1, 0.25 → 2, 10 → 0).
func decimals(step float64) int {
	s := strconv.FormatFloat(step, 'f', -1, 64)
	if i := strings.IndexByte(s, '.'); i >= 0 {
		return len(s) - i - 1
	}
	return 0
}

func formatNumber(v, step float64) string { return strconv.FormatFloat(v, 'f', decimals(step), 64) }

func (q *Number) Deal(uint64) Dealt { return &dealtNumber{q} }

type dealtNumber struct{ q *Number }

func (d *dealtNumber) Question() Question { return d.q }

func (d *dealtNumber) View() any {
	q := d.q
	return struct {
		view
		Unit  string  `json:"unit,omitempty"`
		Min   float64 `json:"min"`
		Max   float64 `json:"max"`
		Step  float64 `json:"step"`
		Scale string  `json:"scale"`
	}{viewOf(&q.Head, &q.Tail), q.Unit, q.Min, q.Max, q.Step, q.Scale}
}

// NumberAnswer is a typed number.
type NumberAnswer struct {
	Value float64 `json:"value"`
}

func (d *dealtNumber) Grade(answer json.RawMessage) (Graded, error) {
	var a struct {
		Value *float64 `json:"value"`
	}
	if err := strictJSON(answer, &a); err != nil {
		return Graded{}, err
	}
	if a.Value == nil || math.IsNaN(*a.Value) || math.IsInf(*a.Value, 0) {
		return Graded{}, errors.New("not a number")
	}
	guess := d.q.snap(*a.Value)
	score := d.q.Closeness(guess)
	return Graded{
		Score: score,
		Right: score >= RightFrom,
		Exact: d.q.Exact(guess),
		Given: mustJSON(NumberAnswer{Value: guess}),
	}, nil
}

func (d *dealtNumber) Reveal() any {
	return struct {
		Value float64 `json:"value"`
		Unit  string  `json:"unit,omitempty"`
		reveal
	}{d.q.Answer, d.q.Unit, revealOf(&d.q.Tail)}
}
