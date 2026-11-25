package server

import (
	"testing"

	"github.com/almanac-bg/almanac/internal/play"
)

// /admin's days pooled are the sums of its rows: the new, the days shared and the new by a link over every day, and
// each back over the days it's due on only, of those days' new (audit 2026-11-24, C-97).
func TestPooledIsTheSums(t *testing.T) {
	counts := []play.DayCount{
		{Day: "2026-11-25", Played: 9, New: 4, ByLink: 1}, // today: nothing due
		{Day: "2026-11-24", Played: 7, New: 2, Back: [3]int{1, 0, 0}, Due: [3]bool{true, false, false}},
		{Day: "2026-11-17", Played: 5, New: 3, ByLink: 2, Back: [3]int{2, 1, 0}, Due: [3]bool{true, true, false}},
		{Day: "2026-10-25", Played: 3, New: 5, Back: [3]int{1, 3, 2}, Due: [3]bool{true, true, true}},
		{Day: "2026-10-24", Played: 1},
	}
	shared := map[string]int{"2026-11-24": 2, "2026-10-25": 1, "2026-10-01": 9}
	got := pooled(counts, shared)
	want := dayRow{Day: "Общо", New: 14, Shared: 3, ByLink: 3, Back: [3]string{
		"40 % (4 от 10)", // 1 + 2 + 1 of 2 + 3 + 5
		"50 % (4 от 8)",  // 1 + 3 of 3 + 5
		"40 % (2 от 5)",
	}}
	if got != want {
		t.Fatalf("pooled\n %+v, want\n %+v", got, want)
	}
	if none := pooled(counts[:1], nil); none.Back != [3]string{"—", "—", "—"} || none.New != 4 {
		t.Fatalf("nothing due yet: %+v", none)
	}
}
