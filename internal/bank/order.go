package bank

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
)

// Order is „Подреди“: four things put in order by a number each has (a year, a height), the numbers shown with the
// answer.
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

// OrderItems is how many items an order question has.
const OrderItems = 4

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

// Deal shows the items in an order the seed decides, but never one that is already worth much as it stands: between
// a third and two thirds of its pairs the wrong way round (2 to 4 of 4 items' 6), so that „Готово“ untouched earns
// a third at most, and so does the dealt order turned round. A plain shuffle deals the right order one time in 24 —
// for everyone at once on the day, whose deal is the same for all. A seed whose shuffle fits keeps that deal; one
// whose doesn't takes the next that does, still from the seed alone.
func (q *Order) Deal(seed uint64) Dealt {
	right, n := q.right(), len(q.Items)
	pairs := n * (n - 1) / 2
	for try := uint64(0); ; try++ {
		order := shuffle(seed+try*0x9e3779b97f4a7c15, n)
		if wrong := inversions(order, right); n < 3 || (3*wrong >= pairs && 3*wrong <= 2*pairs) {
			return &dealtOrder{q: q, order: order}
		}
	}
}

// inversions is how many pairs of given stand the wrong way round against right.
func inversions(given, right []int) int {
	rank := make(map[int]int, len(right))
	for i, b := range right {
		rank[b] = i
	}
	wrong := 0
	for i := range given {
		for j := i + 1; j < len(given); j++ {
			if rank[given[i]] > rank[given[j]] {
				wrong++
			}
		}
	}
	return wrong
}

// dealtOrder shows the bank's item order[i] as item i.
type dealtOrder struct {
	q     *Order
	order []int
}

func (d *dealtOrder) Question() Question { return d.q }

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
	return Graded{
		Score: orderScore(bank, d.q.right()),
		Right: slices.Equal(bank, d.q.right()),
		Given: mustJSON(OrderAnswer{Order: bank}),
		Shown: mustJSON(OrderAnswer{Order: a.Order}),
	}, nil
}

func (d *dealtOrder) Reveal(c *Crowd) any {
	shownAt := make([]int, len(d.order))
	for i, b := range d.order {
		shownAt[b] = i
	}
	right := d.q.right()
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

// orderScore is what an order is worth: how many of its pairs stand the right way round, less how many stand the
// wrong way, out of all of them (Kendall's tau), and nothing below 0. One pair of neighbours swapped is worth 2/3 of
// a right order, where counting the places that are exactly right would give it half; and an order put down at
// random is worth almost nothing (0.19 on average, against 0.25 for the places), so luck earns little.
func orderScore(given, right []int) float64 {
	rank := make(map[int]int, len(right))
	for i, b := range right {
		rank[b] = i
	}
	n, sum := len(given), 0
	for i := range n {
		for j := i + 1; j < n; j++ {
			if rank[given[i]] < rank[given[j]] {
				sum++
			} else {
				sum--
			}
		}
	}
	if n < 2 {
		return 1
	}
	return max(0, float64(sum)/float64(n*(n-1)/2))
}
