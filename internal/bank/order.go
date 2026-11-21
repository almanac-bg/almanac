package bank

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
)

// Order is „Подреди“: things put in order by a number each has (a year, a height), the numbers shown with the answer.
// The bank keeps four of them (OrderItems); a deal shows three (OrderDealt: Deal).
type Order struct {
	Head
	Items []OrderItem `json:"items"`
	// Direction is "asc" (smallest first) or "desc".
	Direction string `json:"direction"`
	// Unit is what the values count ("м", "км²"); none for years.
	Unit string `json:"unit,omitempty"`
	Tail
}

type OrderItem struct {
	Text  string  `json:"text"`
	Value float64 `json:"value"`
}

// OrderItems is how many items an order question has in the bank, and OrderDealt how many of them a deal shows.
const (
	OrderItems = 4
	OrderDealt = 3
)

func init() { register("order", func() Question { return &Order{} }) }

func (q *Order) Base() *Head  { return &q.Head }
func (q *Order) Extra() *Tail { return &q.Tail }

func (q *Order) check() []string {
	var p []string
	if len(q.Items) != OrderItems {
		p = append(p, "an order needs exactly 4 items")
	}
	texts, values := map[string]bool{}, map[float64]bool{}
	for _, it := range q.Items {
		p = append(p, checkLine("item", it.Text, itemMax)...)
		if texts[fold(it.Text)] {
			p = append(p, "two items are the same: "+it.Text)
		}
		if values[it.Value] {
			p = append(p, "two items share a value: "+it.Text)
		}
		texts[fold(it.Text)], values[it.Value] = true, true
	}
	if q.Direction != "asc" && q.Direction != "desc" {
		p = append(p, `direction must be "asc" or "desc"`)
	}
	return append(p, checkUnit(q.Unit)...)
}

// Measured values (a length, an area, a population, a weight) come out differently by source and by year, so
// neighbours in an order stand at least OrderGap apart (the bigger one at least 10% above the smaller): then every
// source puts them the same way round. Exact values (years, dates, counts, places on a map) only need to differ.
const OrderGap = 0.10

// measured are the units of measured values: the ones OrderGap holds for.
var measured = map[string]bool{
	"м": true, "км": true, "см": true, "мм": true, "нм": true, "км²": true, "м²": true, "см²": true, "млн. км²": true,
	"кг": true, "т": true, "г": true, "мг": true, "л": true, "мл": true, "км/ч": true, "м/с": true, "ч": true, "мин": true,
	"с": true, "дни": true, "години": true, "млн. години": true, "млрд. години": true, "св. години": true,
	"земни маси": true, "Hz": true, "kHz": true, "MHz": true, "ккал": true, "%": true, "жители": true,
	"млн. жители": true, "души": true, "млн. души": true, "млн.": true, "млрд.": true, "млн. долара": true,
	"млрд. долара": true, "долара": true, "€": true, "цента": true, "г/см³": true, "г/л": true, "мм живак": true,
}

func ruleOrderGap(q Question) []string {
	o, ok := q.(*Order)
	if !ok || !measured[o.Unit] {
		return nil
	}
	values := make([]float64, 0, len(o.Items))
	for _, it := range o.Items {
		values = append(values, it.Value)
	}
	slices.Sort(values)
	var out []string
	for i := 1; i < len(values); i++ {
		a, b := values[i-1], values[i]
		if a > 0 && b < a*(1+OrderGap) {
			out = append(out, fmt.Sprintf("%s and %s %s are under %.0f%% apart: sources may order them either way",
				sayNumber(a, 0.01), sayNumber(b, 0.01), o.Unit, 100*OrderGap))
		}
	}
	return out
}

// key: order questions often share a text („Подреди от най-ранното…“), so their items tell them apart.
func (q *Order) key() string {
	items := make([]string, len(q.Items))
	for i, it := range q.Items {
		items[i] = fold(it.Text)
	}
	slices.Sort(items)
	return fold(q.Text) + "|" + q.Image.file() + "|" + strings.Join(items, "|")
}

func (q *Order) asked() map[string]any {
	type item struct {
		Text  string  `json:"text"`
		Value float64 `json:"value"`
	}
	var items []item // null for none, [] for an empty list, as the type writes them
	if q.Items != nil {
		items = make([]item, 0, len(q.Items))
	}
	for _, it := range q.Items {
		items = append(items, item{it.Text, it.Value})
	}
	form := map[string]any{"items": items, "direction": q.Direction}
	if q.Unit != "" {
		form["unit"] = q.Unit
	}
	return form
}

func (q *Order) words() []string {
	w := []string{q.Text}
	for _, it := range q.Items {
		w = append(w, it.Text)
	}
	return w
}

// right is the bank's items in their right order.
func (q *Order) right() []int {
	order := make([]int, len(q.Items))
	for i := range order {
		order[i] = i
	}
	slices.SortStableFunc(order, func(a, b int) int {
		va, vb := q.Items[a].Value, q.Items[b].Value
		if q.Direction == "desc" {
			va, vb = vb, va
		}
		switch {
		case va < vb:
			return -1
		case va > vb:
			return 1
		}
		return 0
	})
	return order
}


// Deal shows OrderDealt of the bank's items, which of them and in what order as the seed decides (as a choice's options
// are dealt), but never in their right order already: „Готово“ untouched is never right. An order is right or not
// („близо“ is the number's alone), so it shows three: one chronology or ranking still, with two relations to judge and
// six arrangements, where four were all or nothing over 24. A seed whose deal is in order takes the next that isn't,
// still from the seed alone, so the day's deal is the same for everyone.
func (q *Order) Deal(seed uint64) Dealt {
	n, right := min(OrderDealt, len(q.Items)), q.right()
	for try := uint64(0); ; try++ {
		order := shuffle(seed+try*0x9e3779b97f4a7c15, len(q.Items))[:n]
		if n < 2 || !slices.Equal(order, inRight(order, right)) {
			return &dealtOrder{q: q, order: order}
		}
	}
}

// inRight is some of the bank's items (by their place in it) in their right order, as right has them all.
func inRight(some, right []int) []int {
	out := make([]int, 0, len(some))
	for _, b := range right {
		if slices.Contains(some, b) {
			out = append(out, b)
		}
	}
	return out
}

// dealtOrder shows the bank's item order[i] as item i: OrderDealt of them.
type dealtOrder struct {
	q     *Order
	order []int
}

func (d *dealtOrder) Question() Question { return d.q }

// right is the items dealt, by their place in the bank, in their right order.
func (d *dealtOrder) right() []int { return inRight(d.order, d.q.right()) }

func (d *dealtOrder) View() any {
	items := make([]string, len(d.order))
	for i, b := range d.order {
		items[i] = d.q.Items[b].Text
	}
	return struct {
		view
		Items     []string `json:"items"`
		Direction string   `json:"direction"`
		Unit      string   `json:"unit,omitempty"`
	}{viewOf(&d.q.Head, &d.q.Tail), items, d.q.Direction, d.q.Unit}
}

// OrderAnswer is an order: the items, first to last, by their place as shown (as given) or in the bank (as logged).
type OrderAnswer struct {
	Order []int `json:"order"`
}

// Grade: an order is right with every item dealt in its place, and wrong otherwise (Score 1 or 0): never „близо“.
func (d *dealtOrder) Grade(answer json.RawMessage) (Graded, error) {
	var a OrderAnswer
	if err := strictJSON(answer, &a); err != nil {
		return Graded{}, err
	}
	n := len(d.order)
	if len(a.Order) != n {
		return Graded{}, errors.New("an order lists every item once")
	}
	seen := make([]bool, n)
	bank := make([]int, n)
	for i, shown := range a.Order {
		if shown < 0 || shown >= n || seen[shown] {
			return Graded{}, errors.New("an order lists every item once")
		}
		seen[shown] = true
		bank[i] = d.order[shown]
	}
	g := Graded{Given: mustJSON(OrderAnswer{Order: bank}), Shown: mustJSON(OrderAnswer{Order: a.Order})}
	if slices.Equal(bank, d.right()) {
		g.Score, g.Right = 1, true
	}
	return g, nil
}

func (d *dealtOrder) Reveal(c *Crowd) any {
	shownAt := make(map[int]int, len(d.order))
	for i, b := range d.order {
		shownAt[b] = i
	}
	right := d.right()
	order := make([]int, len(right))
	for i, b := range right {
		order[i] = shownAt[b]
	}
	values := make([]float64, len(d.order))
	for i, b := range d.order {
		values[i] = d.q.Items[b].Value
	}
	return &struct {
		Order  []int     `json:"order"`
		Values []float64 `json:"values"`
		Unit   string    `json:"unit,omitempty"`
		reveal
	}{order, values, d.q.Unit, revealOf(&d.q.Head, &d.q.Tail, c.view(nil))}
}

// lines are the items dealt in their right order, each with its value (AnswerLines, as this deal showed them).
func (d *dealtOrder) lines() []string { return orderLines(d.q, d.right()) }
