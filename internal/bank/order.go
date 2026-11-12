package bank

import (
	"encoding/json"
	"errors"
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

func (q *Order) Deal(seed uint64) Dealt { return &dealtOrder{q: q, order: shuffle(seed, len(q.Items))} }

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
	placed := 0
	for i, b := range d.q.right() {
		if bank[i] == b {
			placed++
		}
	}
	return Graded{
		Score: float64(placed) / float64(n),
		Right: placed == n,
		Given: mustJSON(OrderAnswer{Order: bank}),
	}, nil
}

func (d *dealtOrder) Reveal() any {
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
	return struct {
		Order  []int     `json:"order"`
		Values []float64 `json:"values"`
		Unit   string    `json:"unit,omitempty"`
		reveal
	}{order, values, d.q.Unit, revealOf(&d.q.Tail)}
}
