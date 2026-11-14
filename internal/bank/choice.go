package bank

import (
	"encoding/json"
	"errors"
	"strings"
)

// Choice is four options, one of them right: the answer and three wrong ones. A deal shows them in an order of its own.
// The options may be pictures (a flag, a painting, an animal): then the player picks a picture, and the names show
// only with the answer.
type Choice struct {
	Head
	Answer string   `json:"answer"`
	Wrong  []string `json:"wrong"`
	// Pictures, if set, are the options themselves, one for each in the bank's order (the answer's first).
	Pictures []Image `json:"pictures,omitempty"`
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
	if len(q.Pictures) > 0 {
		if len(q.Pictures) != ChoiceOptions {
			p = append(p, "a choice of pictures needs one picture for each of its 4 options")
		}
		if q.Image != nil {
			p = append(p, "a choice of pictures has no picture over the question too")
		}
		files := map[string]bool{}
		for i := range q.Pictures {
			p = append(p, q.Pictures[i].check()...)
			if files[q.Pictures[i].File] {
				p = append(p, "two options are the same picture: "+q.Pictures[i].File)
			}
			files[q.Pictures[i].File] = true
		}
	}
	return p
}

// pictures are the question's pictures: the one over it, and its options' if they are pictures.
func (q *Choice) pictures() []*Image {
	out := make([]*Image, 0, len(q.Pictures))
	for i := range q.Pictures {
		out = append(out, &q.Pictures[i])
	}
	return out
}

func (q *Choice) key() string {
	k := fold(q.Text) + "|" + q.Image.file()
	for i := range q.Pictures {
		k += "|" + q.Pictures[i].File
	}
	return k
}

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
	if len(d.q.Pictures) > 0 {
		// The pictures only: their names would give the answer away.
		pics := make([]*ImageView, len(d.order))
		for i, b := range d.order {
			pics[i] = d.q.Pictures[b].view()
		}
		return struct {
			view
			Pictures []*ImageView `json:"pictures"`
		}{viewOf(&d.q.Head, &d.q.Tail), pics}
	}
	return struct {
		view
		Choices []string `json:"choices"`
	}{viewOf(&d.q.Head, &d.q.Tail), d.shown()}
}

// shown is the options' names in the deal's order.
func (d *dealtChoice) shown() []string {
	options := d.q.options()
	shown := make([]string, len(d.order))
	for i, b := range d.order {
		shown[i] = options[b]
	}
	return shown
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
	g := Graded{Right: bank == 0, Given: mustJSON(ChoiceAnswer{Pick: bank}), Shown: mustJSON(ChoiceAnswer{Pick: *a.Pick})}
	if g.Right {
		g.Score = 1
	}
	return g, nil
}

func (d *dealtChoice) Reveal(c *Crowd) any {
	right := 0
	for i, b := range d.order {
		if b == 0 {
			right = i
		}
	}
	out := struct {
		Pick int `json:"pick"`
		// Names and Credits are a choice of pictures' options' names and their pictures' credits, as shown.
		Names   []string       `json:"names,omitempty"`
		Credits []*ImageCredit `json:"credits,omitempty"`
		reveal
	}{Pick: right, reveal: revealOf(&d.q.Head, &d.q.Tail, c.view(d.order))}
	if len(d.q.Pictures) > 0 {
		out.Names = d.shown()
		for _, b := range d.order {
			out.Credits = append(out.Credits, d.q.Pictures[b].credit())
		}
	}
	return out
}

// fold makes two texts compare the same when they differ only in case or spacing.
func fold(s string) string { return strings.Join(strings.Fields(strings.ToLower(s)), " ") }
