package bank

import (
	"encoding/json"
	"errors"
	"strings"
)

// TrueFalse is „Вярно или невярно“: a statement, true or not. Quick to read and to answer, so its time is short.
type TrueFalse struct {
	Head
	// Answer is whether the statement (the text) is true.
	Answer bool `json:"answer"`
	Tail
}

func init() { register("truefalse", func() Question { return &TrueFalse{} }) }

func (q *TrueFalse) Base() *Head  { return &q.Head }
func (q *TrueFalse) Extra() *Tail { return &q.Tail }

func (q *TrueFalse) check() []string {
	if !strings.HasSuffix(q.Text, ".") {
		return []string{"a true/false is a statement: it ends with a period"}
	}
	return nil
}

func (q *TrueFalse) key() string { return fold(q.Text) + "|" + q.Image.file() }

func (q *TrueFalse) words() []string { return []string{q.Text} }

func (q *TrueFalse) Deal(uint64) Dealt { return &dealtTrueFalse{q} }

type dealtTrueFalse struct{ q *TrueFalse }

func (d *dealtTrueFalse) Question() Question { return d.q }

func (d *dealtTrueFalse) View() any { return viewOf(&d.q.Head, &d.q.Tail) }

// TrueFalseAnswer is a player's word on a statement: true or not.
type TrueFalseAnswer struct {
	Truth bool `json:"truth"`
}

func (d *dealtTrueFalse) Grade(answer json.RawMessage) (Graded, error) {
	var a struct {
		Truth *bool `json:"truth"`
	}
	if err := strictJSON(answer, &a); err != nil {
		return Graded{}, err
	}
	if a.Truth == nil {
		return Graded{}, errors.New("true or not?")
	}
	given := mustJSON(TrueFalseAnswer{Truth: *a.Truth})
	g := Graded{Given: given, Shown: given}
	if *a.Truth == d.q.Answer {
		g.Score, g.Right = 1, true
	}
	return g, nil
}

func (d *dealtTrueFalse) Reveal(c *Crowd) any {
	return struct {
		Truth bool `json:"truth"`
		reveal
	}{d.q.Answer, revealOf(&d.q.Head, &d.q.Tail, c.view(nil))}
}
