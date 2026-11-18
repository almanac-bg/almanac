package bank

import (
	"slices"
	"strings"
	"testing"
)

// A national day counts the live questions about Bulgaria that belong to it, every year's or a year's still ahead; not
// one about elsewhere, a retired one, nor one a day has had.
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
	count := func(used map[string]bool, today string) map[string]int {
		n := map[string]int{}
		for _, d := range b.National(used, today) {
			n[d.On] = d.N
		}
		return n
	}
	if n := count(nil, "2026-11-18"); n["09-06"] != 2 || n["03-03"] != 1 || n["09-22"] != 1 || n["02-19"] != 0 {
		t.Errorf("counted %v", n)
	}
	// Only what a day can still deal: none a day has had, and a year's date only while it's ahead.
	if n := count(map[string]bool{"a": true}, "2027-09-07"); n["09-06"] != 0 || n["03-03"] != 1 {
		t.Errorf("counted %v, with a used and b's 2027 passed", n)
	}
	if n := count(map[string]bool{"e": true}, "2027-09-06"); n["09-06"] != 2 || n["03-03"] != 0 || n["09-22"] != 0 {
		t.Errorf("counted %v, with e used and b's day today", n)
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
