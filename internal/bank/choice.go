package bank

import (
	"encoding/json"
	"errors"
	"strings"
)

// Choice is four options, one of them right: the answer and three wrong ones. A deal shows them in an order of its own.
type Choice struct {
	Head
	Answer string   `json:"answer"`
	Wrong  []string `json:"wrong"`
	Tail
}

// ChoiceOptions is how many options a choice question has.
const ChoiceOptions = 4

func init() { register("choice", func() Question { return &Choice{} }) }

func (q *Choice) Base() *Head  { return &q.Head }
func (q *Choice) Extra() *Tail { return &q.Tail }

// options lists the bank's options: the answer first, then the wrong ones.
func (q *Choice) options() []string { return append([]string{q.Answer}, q.Wrong...) }

func (q *Choice) check() []string {
	var p []string
	if len(q.Wrong) != ChoiceOptions-1 {
		p = append(p, "a choice needs exactly 3 wrong options")
	}
	seen := map[string]bool{}
	for _, o := range q.options() {
		p = append(p, checkLine("option", o, optionMax)...)
		k := fold(o)
		if seen[k] {
			p = append(p, "two options are the same: "+o)
		}
		seen[k] = true
	}
	return p
}

func (q *Choice) key() string { return fold(q.Text) + "|" + q.Image.file() }

func (q *Choice) words() []string { return append([]string{q.Text}, q.options()...) }

func (q *Choice) Deal(seed uint64) Dealt {
	return &dealtChoice{q: q, order: shuffle(seed, ChoiceOptions)}
}

// dealtChoice shows the bank's option order[i] as option i.
type dealtChoice struct {
	q     *Choice
	order []int
}

func (d *dealtChoice) Question() Question { return d.q }

func (d *dealtChoice) View() any {
	options := d.q.options()
	shown := make([]string, len(d.order))
	for i, b := range d.order {
		shown[i] = options[b]
	}
	return struct {
		view
		Choices []string `json:"choices"`
	}{viewOf(&d.q.Head, &d.q.Tail), shown}
}

// ChoiceAnswer is a pick: the option's place as shown.
type ChoiceAnswer struct {
	Pick int `json:"pick"`
}

func (d *dealtChoice) Grade(answer json.RawMessage) (Graded, error) {
	var a struct {
		Pick *int `json:"pick"`
	}
	if err := strictJSON(answer, &a); err != nil {
		return Graded{}, err
	}
	if a.Pick == nil || *a.Pick < 0 || *a.Pick >= len(d.order) {
		return Graded{}, errors.New("no such option")
	}
	bank := d.order[*a.Pick]
	g := Graded{Right: bank == 0, Given: mustJSON(ChoiceAnswer{Pick: bank})}
	if g.Right {
		g.Score = 1
	}
	return g, nil
}

func (d *dealtChoice) Reveal() any {
	right := 0
	for i, b := range d.order {
		if b == 0 {
			right = i
		}
	}
	return struct {
		Pick int `json:"pick"`
		reveal
	}{right, revealOf(&d.q.Tail)}
}

// fold makes two texts compare the same when they differ only in case or spacing.
func fold(s string) string { return strings.Join(strings.Fields(strings.ToLower(s)), " ") }
