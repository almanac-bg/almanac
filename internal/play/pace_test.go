package play

import (
	"testing"
	"time"
)

// evening holds a Роял on day with players in it (they came; those in the lobby only don't count).
func (w *world) evening(day time.Time, players []int64) {
	w.t.Helper()
	ctx := w.t.Context()
	start := time.Date(day.Year(), day.Month(), day.Day(), 21, 0, 0, 0, Bulgaria)
	if err := w.g.HeldRoyal(ctx, start); err != nil {
		w.t.Fatal(err)
	}
	if len(players) == 0 {
		return
	}
	picks, err := w.g.DrawRoyal(ctx)
	if err != nil {
		w.t.Fatal(err)
	}
	id, err := w.g.NewRoyal(ctx, start, picks)
	if err != nil {
		w.t.Fatal(err)
	}
	for _, u := range players {
		if err := w.g.JoinRoyal(ctx, id, u); err != nil {
			w.t.Fatal(err)
		}
	}
	if _, err := w.g.StartRoyal(ctx, id, players); err != nil {
		w.t.Fatal(err)
	}
}

// Роял plays Friday to Sunday until the median of the last fourteen evenings held has eight players or more; then
// every evening. Each day goes by the evenings before it.
func TestRoyalPace(t *testing.T) {
	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	day := func(d int) time.Time { return time.Date(2026, 11, d, 21, 0, 0, 0, Bulgaria) }
	for d, on := range map[int]bool{12: false, 13: true, 14: true, 15: true, 16: false} {
		if w.g.RoyalOn(day(d)) != on {
			t.Errorf("with no evenings yet, on the %d-th: %v", d, !on)
		}
	}
	var many []int64
	for range 9 {
		many = append(many, w.user())
	}
	// Thirteen full evenings and one of eight: not yet fourteen before today counted, as today was worked out.
	for i := range 14 {
		n := 9
		if i%2 == 0 {
			n = 8
		}
		w.evening(time.Date(2026, 10, 29+i, 21, 0, 0, 0, Bulgaria), many[:n])
	}
	if p, err := w.g.RoyalPaceOf(ctx); err != nil || p.Nightly || p.Evenings != 0 {
		t.Fatalf("today's pace changed during the day: %+v %v", p, err)
	}
	w.wait(24 * time.Hour) // Friday
	p, err := w.g.RoyalPaceOf(ctx)
	if err != nil || !p.Nightly || p.Evenings != 14 || p.Median != 8.5 {
		t.Fatalf("fourteen full evenings: %+v %v", p, err)
	}
	if !w.g.RoyalOn(day(16)) || !w.g.RoyalOn(day(19)) {
		t.Fatal("not every evening once they filled")
	}
	// A week of evenings of two (one with nobody at all) brings the median under eight: back to Friday to Sunday.
	w.evening(day(13), nil)
	for d := 14; d <= 19; d++ {
		w.evening(day(d), many[:2])
	}
	w.now = time.Date(2026, 11, 20, 10, 0, 0, 0, Bulgaria)
	if p, err := w.g.RoyalPaceOf(ctx); err != nil || p.Nightly || p.Evenings != 14 || p.Median != 5 {
		t.Fatalf("after a week of evenings of two: %+v %v", p, err)
	}
	if w.g.RoyalOn(day(23)) || !w.g.RoyalOn(day(20)) {
		t.Fatal("not back to Friday to Sunday")
	}
}
