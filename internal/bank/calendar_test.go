package bank

import (
	"slices"
	"strings"
	"testing"
)

// A national day counts the live questions about Bulgaria that belong to it, every year's or a year's; not one about
// elsewhere, nor a retired one.
func TestNational(t *testing.T) {
	dated := func(id string, bg, retired bool, on ...string) *Choice {
		q := choice(id, "Кой?", "А", "Б", "В", "Г")
		q.On, q.BG, q.Retired = on, bg, retired
		return q
	}
	b := bankOf(
		dated("a", true, false, "09-06"),
		dated("b", true, false, "2027-09-06"),
		dated("c", false, false, "09-06"),
		dated("d", true, true, "09-06"),
		dated("e", true, false, "03-03", "09-22"),
	)
	n := map[string]int{}
	for _, d := range b.National() {
		n[d.On] = d.N
	}
	if n["09-06"] != 2 || n["03-03"] != 1 || n["09-22"] != 1 || n["02-19"] != 0 {
		t.Errorf("counted %v", n)
	}
	for _, d := range NationalDays {
		if len(d.On) != 5 || d.What == "" {
			t.Errorf("%+v: a day is MM-DD, and says what it marks", d)
		}
	}
	if !slices.IsSortedFunc(NationalDays, func(x, y NationalDay) int { return strings.Compare(x.On, y.On) }) {
		t.Error("the national days are in the year's order")
	}
}
