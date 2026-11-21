package play

import (
	"testing"
	"time"
)

// The nouns used in a week: a part only looked at counts once a week for each player, however often it's opened, and
// again the next week; the day's issue, its ink and the streak come from what the game keeps.
func TestNounUse(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	for range 3 {
		if err := w.g.Used(ctx, ana, "almanac"); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.g.Used(ctx, bo, "almanac"); err != nil {
		t.Fatal(err)
	}
	if err := w.g.Used(ctx, ana, "seal"); err != nil {
		t.Fatal(err)
	}
	if err := w.g.Used(ctx, ana, "nothing"); err != nil {
		t.Fatal(err)
	}
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	today := w.g.Today()
	// Reminded by a notification: one that reached a device counts; one never delivered doesn't.
	dee := w.user()
	for _, r := range []struct {
		user      int64
		delivered bool
	}{{ana, true}, {dee, false}} {
		if _, err := w.db.Write.Exec(`INSERT INTO push_reminded (user_id, day, at, delivered) VALUES (?, ?, 0, ?)`,
			r.user, today, r.delivered); err != nil {
			t.Fatal(err)
		}
	}
	week := WeekOf(today)
	use, err := w.g.NounUse(ctx, week, today)
	if err != nil {
		t.Fatal(err)
	}
	if use["almanac"] != 2 || use["seal"] != 1 || use["friends"] != 0 || use["day"] != 1 || use["ink"] != 1 ||
		use["streak"] != 0 || use["reminder"] != 1 {
		t.Fatalf("this week: %v", use)
	}
	// The next week: marked anew.
	w.wait(7 * 24 * time.Hour)
	if err := w.g.Used(ctx, ana, "almanac"); err != nil {
		t.Fatal(err)
	}
	next := w.g.Today()
	if use, _ := w.g.NounUse(ctx, WeekOf(next), next); use["almanac"] != 1 || use["seal"] != 0 {
		t.Fatalf("the next week: %v", use)
	}
}
