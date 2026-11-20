package bank

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Number is "Колко…?" or "През коя година…?": a number typed in on a keypad, scored by how close it is. On a linear
// scale a guess Tolerance away scores nothing; on a log scale (sizes across orders of magnitude) one Tolerance times
// too big or too small does. The player isn't told a range: knowing roughly how big is part of the question.
type Number struct {
	Head
	Answer float64 `json:"answer"`
	// Unit is what the number counts ("км", "души"); empty for a year.
	Unit string `json:"unit,omitempty"`
	// Step is the grid answers are taken on (1 for whole numbers, 0.1 for one decimal).
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
	if !finite(q.Answer) || !finite(q.Step) || !finite(q.Tolerance) {
		return []string{"a number must be finite"}
	}
	if q.Answer < 0 && !q.Signed() {
		p = append(p, "only a temperature (°C) may be below 0")
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
		if q.Answer <= 0 || q.Tolerance <= 1 {
			p = append(p, "a log scale needs an answer above 0 and a tolerance above 1 (a factor)")
		}
	default:
		p = append(p, `scale must be "linear" or "log"`)
	}
	p = append(p, checkUnit(q.Unit)...)
	return p
}

func (q *Number) key() string { return fold(q.Text) + "|" + q.Image.file() }

func (q *Number) asked() map[string]any {
	form := map[string]any{"answer": q.Answer, "step": q.Step, "scale": q.Scale, "tolerance": q.Tolerance}
	if q.Unit != "" {
		form["unit"] = q.Unit
	}
	return form
}

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

// A number question is an estimate (the owner's rule, 16 Nov 2026): a year, or a quantity of more than EstimateFrom
// steps (6,5 million on a step of 0,1 is 65 of them). A small count (4 evangelists, 7 times) is a choice in disguise:
// it is known or not, never estimated. A phone number or a place in a row isn't a quantity at all.
const EstimateFrom = 20

// yearText says the question asks for a year (and not „на колко години“, an age).
var yearText = regexp.MustCompile(`(?i)годин`)

// IsYear is whether the question asks for a year: no unit, and its text asks when.
func (q *Number) IsYear() bool {
	return q.Unit == "" && yearText.MatchString(q.Text) && !strings.Contains(strings.ToLower(q.Text), "колко")
}

var notQuantity = regexp.MustCompile(`(?i)(?:^|[^\p{L}])(?:номер\p{L}*|поред)(?:[^\p{L}]|$)`)

func ruleEstimate(q Question) []string {
	n, ok := q.(*Number)
	if !ok || n.IsYear() || n.Step <= 0 {
		return nil
	}
	if notQuantity.MatchString(n.Text) {
		return []string{"a number, a code or a place in a row is no estimate: make it a choice"}
	}
	if math.Abs(n.Answer)/n.Step <= EstimateFrom {
		return []string{fmt.Sprintf("%s is a small count, not an estimate (a year, or more than %d steps): make it a choice",
			sayNumber(n.Answer, n.Step), EstimateFrom)}
	}
	return nil
}

// noAnchor are the counts kept in archives that nobody carries a sense of: a series' episodes, a hall's seats, a
// council's members, a dictionary's words, a prize's money, a fine. An estimate needs an anchor a well-read player
// has (a year, a height, a distance, an age, a famous total) and a reveal that teaches something; a count like these
// is a guess, and the day ends on its estimate.
var noAnchor = regexp.MustCompile(`(?i)(?:^|[^\p{L}])(епизод\p{L}*|серии|съветни\p{L}*|места|документ\p{L}*|стати[ия]|думи|наградн\p{L}*|глоб\p{L}*)(?:[^\p{L}]|$)`)

// ruleAnchor (a hint): an estimate doesn't count what nobody has a sense of (noAnchor).
func ruleAnchor(q Question) []string {
	n, ok := q.(*Number)
	if !ok || n.IsYear() {
		return nil
	}
	text := strings.ReplaceAll(strings.ToLower(n.Text), "населени места", "селища") // places people live in: no seats
	if m := noAnchor.FindStringSubmatch(text + " " + n.Unit); m != nil {
		return []string{fmt.Sprintf("„%s“: a count nobody has a sense of is a guess, not an estimate: ask what a well-read player can place", m[1])}
	}
	return nil
}

// The tolerance follows one formula at every difficulty (the owner's rule, 16 Nov 2026): a well-read guess scores
// about half. Closeness falls from 1 to 0 over the tolerance, so half is half the tolerance away, and the tolerance is
// twice how far off a well-read guess is:
//
//   - a quantity on a linear scale: 3/10 of the answer (a guess 15% off scores half; within 6% counts right);
//   - a year: 3·∛(years since it), at least 3 (1939: 13; 1519: 24; 681: 33): a well-read person knows the recent
//     closer than the distant;
//   - a log scale: a factor of 3 (a guess √3 times off scores half);
//   - a temperature (°C, linear): none, a degree's worth has no proportion to the answer; set by the rubric.
//
// A tolerance within ToleranceSlack of the formula holds: the formula rounded the way a person rounds it.
const ToleranceSlack = 1.5

// Tolerance is what the formula says a number question's tolerance is, two figures kept; 0 for a temperature.
func Tolerance(q *Number) float64 {
	switch {
	case q.Signed():
		return 0
	case q.Scale == "log":
		return 3
	case q.IsYear():
		since := max(float64(time.Now().Year())-q.Answer, 1)
		return max(3, math.Round(3*math.Cbrt(since)))
	}
	return twoFigures(0.3 * q.Answer)
}

// twoFigures rounds a number to two significant figures (2 600, 0,26).
func twoFigures(v float64) float64 {
	if v == 0 {
		return 0
	}
	p := math.Pow(10, math.Floor(math.Log10(math.Abs(v)))-1)
	return math.Round(v/p) * p
}

func ruleTolerance(q Question) []string {
	n, ok := q.(*Number)
	if !ok || ruleEstimate(q) != nil {
		return nil // a small count is to become a choice: its tolerance goes with it
	}
	want := Tolerance(n)
	if want <= 0 || n.Tolerance <= 0 {
		return nil
	}
	ratio := n.Tolerance / want
	if n.Scale == "log" {
		if n.Tolerance <= 1 {
			return nil // an error of the format
		}
		ratio = math.Log(n.Tolerance) / math.Log(want)
	}
	if ratio > ToleranceSlack || ratio < 1/ToleranceSlack {
		return []string{fmt.Sprintf("tolerance %s, the formula says %s", sayNumber(n.Tolerance, 0.01), sayNumber(want, 0.01))}
	}
	return nil
}

// Signed is whether the answer may be below 0, so the keypad has a minus: for a temperature (whichever way it is, so
// that the key gives nothing away).
func (q *Number) Signed() bool { return q.Unit == "°C" }

// Exact is whether a guess is the number itself: within half a step of it.
func (q *Number) Exact(guess float64) bool { return math.Abs(guess-q.Answer) <= q.Step/2+1e-9 }

// snap brings a typed number onto the question's grid: in whole steps, without float noise.
func (q *Number) snap(v float64) float64 {
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

// sayNumber is a number as the game writes it to players (web/src/ui.ts formatNumber): a decimal comma, no more
// decimals than step has and none trailing, a space between thousands from 10 000 up, and the minus sign „−“ (never a
// hyphen) before one below zero.
func sayNumber(v, step float64) string {
	s := formatNumber(v, step)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	sign, s := "", strings.TrimPrefix(s, "-")
	if v < 0 && s != "0" {
		sign = "−"
	}
	whole, frac, _ := strings.Cut(s, ".")
	if len(whole) > 4 {
		var b strings.Builder
		for i, c := range whole {
			if i > 0 && (len(whole)-i)%3 == 0 {
				b.WriteRune('\u00a0')
			}
			b.WriteRune(c)
		}
		whole = b.String()
	}
	if frac != "" {
		return sign + whole + "," + frac
	}
	return sign + whole
}

func (q *Number) Deal(uint64) Dealt { return &dealtNumber{q} }

type dealtNumber struct{ q *Number }

func (d *dealtNumber) Question() Question { return d.q }

func (d *dealtNumber) View() any {
	q := d.q
	return struct {
		view
		Unit   string  `json:"unit,omitempty"`
		Step   float64 `json:"step"`
		Signed bool    `json:"signed,omitempty"`
	}{viewOf(&q.Head, &q.Tail), q.Unit, q.Step, q.Signed()}
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
	if a.Value == nil || math.IsNaN(*a.Value) || math.IsInf(*a.Value, 0) || math.Abs(*a.Value) > 1e12 {
		return Graded{}, errors.New("not a number")
	}
	guess := d.q.snap(*a.Value)
	score := d.q.Closeness(guess)
	given := mustJSON(NumberAnswer{Value: guess})
	return Graded{Score: score, Right: score >= RightFrom, Exact: d.q.Exact(guess), Given: given, Shown: given}, nil
}

func (d *dealtNumber) Reveal(c *Crowd) any {
	return &struct {
		Value float64 `json:"value"`
		Unit  string  `json:"unit,omitempty"`
		reveal
	}{d.q.Answer, d.q.Unit, revealOf(&d.q.Head, &d.q.Tail, c.view(nil))}
}
