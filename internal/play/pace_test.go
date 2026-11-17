package play

import (
	"slices"
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
	if _, _, err := w.g.StartRoyal(ctx, id, players); err != nil {
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

// A player in their first week isn't pointed at Роял while its last seven evenings were thin: no goal of it, no card
// on Начало. One who has played longer is, and so is one who has found it; once the evenings fill, everyone is.
func TestNudgeRoyal(t *testing.T) {
	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	w.g.RoyalAt = func(now time.Time) time.Time {
		return time.Date(now.Year(), now.Month(), now.Day(), 21, 0, 0, 0, Bulgaria)
	}
	fresh := func() int64 {
		u := w.user()
		if _, err := w.db.Write.Exec(`UPDATE users SET created_at = ? WHERE id = ?`, w.now.UnixMilli(), u); err != nil {
			t.Fatal(err)
		}
		return u
	}
	nudged := func(u int64) bool {
		t.Helper()
		yes, err := w.g.NudgeRoyal(ctx, u)
		if err != nil {
			t.Fatal(err)
		}
		return yes
	}
	// Of many players' goals for the evening, how many are Роял's.
	royalGoals := func(players []int64) int {
		t.Helper()
		n := 0
		for _, u := range players {
			ids, err := w.g.dayGoals(ctx, u, w.g.Today())
			if err != nil {
				t.Fatal(err)
			}
			if slices.Contains(ids, "royal") {
				n++
			}
		}
		return n
	}
	players := func(n int, one func() int64) []int64 {
		var us []int64
		for range n {
			us = append(us, one())
		}
		return us
	}
	newcomers, regulars := players(100, fresh), players(100, w.user) // w.user's are of long ago

	if nudged(newcomers[0]) || !nudged(regulars[0]) {
		t.Fatal("with no evenings held, a new player is pointed at Роял, or one of long ago isn't")
	}
	if n, m := royalGoals(newcomers), royalGoals(regulars); n != 0 || m == 0 {
		t.Fatalf("Роял's goal drawn for %d new players (none, while thin) and %d of long ago (some)", n, m)
	}
	// One who said they'd come has found it.
	if _, err := w.db.Write.Exec(`INSERT INTO royal_plans (day, user_id) VALUES (?, ?)`, w.g.Today(), newcomers[1]); err != nil {
		t.Fatal(err)
	}
	if !nudged(newcomers[1]) {
		t.Fatal("one who said they'd come isn't shown Роял")
	}
	// A week on, the first week is over.
	w.wait(RoyalNewDays * 24 * time.Hour)
	if !nudged(newcomers[0]) {
		t.Fatal("after a first week, still not pointed at Роял")
	}
	// Seven evenings of eight before today: no longer thin, even for one who came today.
	eight := players(RoyalTurnout, w.user)
	for d := 1; d <= RoyalRecent; d++ {
		w.evening(w.now.AddDate(0, 0, -d), eight)
	}
	w.wait(24 * time.Hour) // the pace is worked out once a day
	if !nudged(fresh()) || royalGoals(players(100, fresh)) == 0 {
		t.Fatal("full evenings, and a new player still isn't pointed at Роял")
	}
	if p, _ := w.g.RoyalPaceOf(ctx); p.Recent != RoyalTurnout || p.Nightly {
		t.Fatalf("the pace after seven full evenings: %+v", p)
	}
}

// A start tried again (its answer lost: an error back, the server stopped) deals nobody a second run; the first
// question shows with the runs, in the same write.
func TestStartRoyalAgain(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	a, b := w.user(), w.user()
	picks, err := w.g.DrawRoyal(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id, err := w.g.NewRoyal(ctx, w.now, picks)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []int64{a, b} {
		if err := w.g.JoinRoyal(ctx, id, u); err != nil {
			t.Fatal(err)
		}
	}
	first, _, err := w.g.StartRoyal(ctx, id, []int64{a})
	if err != nil {
		t.Fatal(err)
	}
	var phase string
	var shown int
	_ = w.db.Read.QueryRow(`SELECT phase FROM royals WHERE id = ?`, id).Scan(&phase)
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM runs WHERE id = ? AND shown_at IS NOT NULL`, first[a]).Scan(&shown)
	if phase != RoyalQuestion || shown != 1 {
		t.Fatalf("started: %s, the first question shown to %d", phase, shown)
	}
	again, _, err := w.g.StartRoyal(ctx, id, []int64{a, b})
	if err != nil {
		t.Fatal(err)
	}
	var runs int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM runs WHERE kind = 'royal'`).Scan(&runs)
	if again[a] != first[a] || again[b] == 0 || runs != 2 {
		t.Fatalf("started again: %v then %v, %d runs", first, again, runs)
	}
}
