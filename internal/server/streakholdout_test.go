package server

import (
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// /admin compares the newcomers of the streak hold-out's window, two forgiven days a week against one, by the measure
// said in advance (back on days 7 to 13); those who came in before or after the window are in neither group.
func TestStreakHoldoutMeasured(t *testing.T) {
	g := start(t)
	s := g.srv
	for _, q := range []string{
		`INSERT OR REPLACE INTO kv (key, value) VALUES ('streak_forgives_from', '2030-03-01')`,
		`INSERT OR REPLACE INTO kv (key, value) VALUES ('streak_forgives_until', '2030-04-26')`,
	} {
		if _, err := g.db.Write.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	first := time.Date(2030, 3, 4, 0, 0, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return time.Date(2030, 4, 30, 12, 0, 0, 0, bulgaria()) }
	newcomer := func(created time.Time, back bool) int64 {
		_, id := g.guest()
		if _, err := g.db.Write.Exec(`UPDATE users SET created_at = ? WHERE id = ?`, created.UnixMilli(), id); err != nil {
			t.Fatal(err)
		}
		days := []time.Time{first}
		if back {
			days = append(days, first.AddDate(0, 0, 9))
		}
		for _, d := range days {
			g.finishedDay(id, d, 10*time.Hour)
			if _, err := g.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?, ?)`, id, d.Format(time.DateOnly)); err != nil {
				t.Fatal(err)
			}
		}
		return id
	}
	held, two := 0, 0
	for held < 2 || two < 3 {
		id := newcomer(first, held+two < 3) // the first three back on day 9, the rest not
		if play.HeldOut(play.StreakHoldout, id) {
			held++
		} else {
			two++
		}
	}
	newcomer(time.Date(2030, 2, 20, 12, 0, 0, 0, bulgaria()), true) // came in before the window: in neither
	rows, from, until, err := s.streakHoldout(t.Context())
	if err != nil || from != "01.03.2030" || until != "25.04.2030" || len(rows) != 3 {
		t.Fatalf("the hold-out: %+v %q %q %v", rows, from, until, err)
	}
	m := rows[0]
	if m.Two.Of+m.One.Of != held+two || m.One.Of != held || m.Two.N+m.One.N != 3 {
		t.Fatalf("back on days 7–13: two %+v, one %+v (held %d, two %d)", m.Two, m.One, held, two)
	}
}
