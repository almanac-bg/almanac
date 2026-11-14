package bank

import (
	"encoding/json"
	"errors"
	"time"
)

// Clues is „Подсказки“: three clues to one answer, from the hardest to the easiest, and four options from the start.
// The clues come one at a time as the question's time runs (ClueEvery apart), and a right answer is worth more the
// fewer clues it took: knowing it from the first clue is knowing it well. A wrong answer ends the question, as any
// answer does.
type Clues struct {
	Head
	// Clues go from the hardest to the easiest; the last one alone should give it away to most.
	Clues  []string `json:"clues"`
	Answer string   `json:"answer"`
	Wrong  []string `json:"wrong"`
	Tail
}

const (
	// ClueCount is how many clues a question has.
	ClueCount = 3
	// ClueEvery is the time between clues: the first shows with the question, the next ClueEvery later, and so on.
	ClueEvery = 10 * time.Second
	// clueSlack is how late an answer may arrive and still count as given before the next clue showed: the trip
	// from the player's screen (the next clue takes as long to get there).
	clueSlack = time.Second
	clueMax   = 110 // a clue: three of them, one under another, on a phone
)

// ClueWorth is what a right answer is worth after each number of clues: all of it from the first, less from each next.
var ClueWorth = [ClueCount]float64{1, 0.6, 0.3}

func init() { register("clues", func() Question { return &Clues{} }) }

func (q *Clues) Base() *Head  { return &q.Head }
func (q *Clues) Extra() *Tail { return &q.Tail }

// options lists the bank's options: the answer first, then the wrong ones.
func (q *Clues) options() []string { return append([]string{q.Answer}, q.Wrong...) }

func (q *Clues) check() []string {
	var p []string
	if len(q.Clues) != ClueCount {
		p = append(p, "a clues question needs exactly 3 clues")
	}
	seen := map[string]bool{}
	for _, c := range q.Clues {
		p = append(p, checkLine("clue", c, clueMax)...)
		if seen[fold(c)] {
			p = append(p, "two clues are the same: "+c)
		}
		seen[fold(c)] = true
	}
	if len(q.Wrong) != ChoiceOptions-1 {
		p = append(p, "a clues question needs exactly 3 wrong options")
	}
	opts := map[string]bool{}
	for _, o := range q.options() {
		p = append(p, checkLine("option", o, optionMax)...)
		if opts[fold(o)] {
			p = append(p, "two options are the same: "+o)
		}
		opts[fold(o)] = true
	}
	return p
}

// key: clues questions often share a text („Кой съм аз?“), so their clues and answer tell them apart.
func (q *Clues) key() string {
	k := fold(q.Text) + "|" + q.Image.file() + "|" + fold(q.Answer)
	for _, c := range q.Clues {
		k += "|" + fold(c)
	}
	return k
}

func (q *Clues) words() []string {
	return append(append([]string{q.Text}, q.Clues...), q.options()...)
}

func (q *Clues) Deal(seed uint64) Dealt {
	return &dealtClues{q: q, order: shuffle(seed, ChoiceOptions)}
}

// dealtClues shows the bank's option order[i] as option i.
type dealtClues struct {
	q     *Clues
	order []int
}

func (d *dealtClues) Question() Question { return d.q }

// View is the question as it first shows: the first clue only.
func (d *dealtClues) View() any { return d.ViewAt(0) }

// Steps are when each clue shows, from when the question does.
func (d *dealtClues) Steps() []time.Duration {
	steps := make([]time.Duration, len(d.q.Clues))
	for i := range steps {
		steps[i] = time.Duration(i) * ClueEvery
	}
	return steps
}

// ViewAt is the question as it shows after since: the clues out by then, never the ones still to come.
func (d *dealtClues) ViewAt(since time.Duration) any {
	options := d.q.options()
	shown := make([]string, len(d.order))
	for i, b := range d.order {
		shown[i] = options[b]
	}
	out := 1
	for out < len(d.q.Clues) && since >= time.Duration(out)*ClueEvery {
		out++
	}
	steps := make([]int64, len(d.q.Clues))
	for i, s := range d.Steps() {
		steps[i] = s.Milliseconds()
	}
	return struct {
		view
		Clues   []string `json:"clues"`
		Total   int      `json:"total"`
		StepsMs []int64  `json:"stepsMs"`
		// SinceMs is how long the question had shown when this view was made: the screen counts to the next clue.
		SinceMs int64    `json:"sinceMs"`
		Choices []string `json:"choices"`
	}{viewOf(&d.q.Head, &d.q.Tail), d.q.Clues[:min(out, len(d.q.Clues))], len(d.q.Clues), steps, since.Milliseconds(), shown}
}

// Grade is the answer as if it came with the first clue: GradeAt knows when it came.
func (d *dealtClues) Grade(answer json.RawMessage) (Graded, error) { return d.GradeAt(answer, 0) }

// GradeAt scores a pick that came after took: a right one is worth ClueWorth of the clues out by then.
func (d *dealtClues) GradeAt(answer json.RawMessage, took time.Duration) (Graded, error) {
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
	g := Graded{Right: bank == 0, Given: mustJSON(ChoiceAnswer{Pick: bank}), Shown: mustJSON(ChoiceAnswer{Pick: *a.Pick})}
	if g.Right {
		g.Score = ClueWorth[d.cluesBy(took)-1]
	}
	return g, nil
}

// cluesBy is how many clues were out when an answer that took took was given (allowing for its trip).
func (d *dealtClues) cluesBy(took time.Duration) int {
	n := 1 + int(max(0, took-clueSlack)/ClueEvery)
	return min(n, len(d.q.Clues), ClueCount)
}

func (d *dealtClues) Reveal(c *Crowd) any {
	right := 0
	for i, b := range d.order {
		if b == 0 {
			right = i
		}
	}
	return struct {
		Pick  int      `json:"pick"`
		Clues []string `json:"clues"`
		reveal
	}{right, d.q.Clues, revealOf(&d.q.Head, &d.q.Tail, c.view(d.order))}
}

// Paced is a deal whose view grows as its time runs: more of it shows at each of Steps, counted from when it shows.
// The game sends ViewAt as the time comes, so that nothing shows before its time, not even to a player who reads
// what the server sends.
type Paced interface {
	Steps() []time.Duration
	ViewAt(since time.Duration) any
}

// Timed is a deal whose answer is worth more or less by when it came (a clue's worth).
type Timed interface {
	GradeAt(answer json.RawMessage, took time.Duration) (Graded, error)
}

// GradeAt grades an answer that came after took: by its time where that counts (Timed), else as any answer.
func GradeAt(d Dealt, answer json.RawMessage, took time.Duration) (Graded, error) {
	if t, ok := d.(Timed); ok {
		return t.GradeAt(answer, took)
	}
	return d.Grade(answer)
}

// ViewAt is a deal's view after since: a paced one's grown by then, any other as it is.
func ViewAt(d Dealt, since time.Duration) any {
	if p, ok := d.(Paced); ok {
		return p.ViewAt(since)
	}
	return d.View()
}

// NextStep is how long after since a paced deal shows more (0 for none: nothing more to show, or not paced).
func NextStep(d Dealt, since time.Duration) time.Duration {
	if p, ok := d.(Paced); ok {
		for _, s := range p.Steps() {
			if s > since {
				return s - since
			}
		}
	}
	return 0
}
