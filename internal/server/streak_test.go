package server

import (
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// daysPlayed makes a player one who finished the day's questions on each of these days (counted back from today).
func (g *game) daysPlayed(userID int64, back ...int) {
	g.t.Helper()
	for _, d := range back {
		at := time.Now().AddDate(0, 0, -d)
		if _, err := g.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, started_at, finished_at)
			VALUES (?, 'day', ?, '[{"id":""}]', ?, ?)`, userID, at.In(play.Bulgaria).Format(time.DateOnly), at.UnixMilli(),
			at.UnixMilli()); err != nil {
			g.t.Fatal(err)
		}
	}
}

// Начало hears of a streak just ended, once, on whichever device; the day's reminder then only asks for today's.
func TestStreakEndedOnTheDay(t *testing.T) {
	g := start(t)
	ana, anaID := g.guest()
	g.daysPlayed(anaID, 5, 4, 3) // three days; the reserve kept the 2nd day back, the 1st ended it
	_, today := ana.call("GET", "/api/day", nil)
	if want := play.Issue(g.srv.game.Today()); want < 1 || today["issue"] != float64(want) {
		t.Fatalf("the day's issue: %v, want %d", today["issue"], want)
	}
	ended, _ := today["ended"].(map[string]any)
	if ended == nil || ended["days"] != 3.0 || ended["on"] != play.DayShift(g.srv.game.Today(), -1) {
		t.Fatalf("a streak of three, ended yesterday: %v", today["ended"])
	}
	if m := g.srv.reminder(t.Context(), g.srv.game.Today(), anaID); m.Body != "Десет въпроса, един опит. До полунощ." {
		t.Fatalf("the reminder after a streak ended: %+v", m)
	}
	on := "ended:" + ended["on"].(string)
	for i, want := range []bool{true, false} {
		if status, out := ana.call("POST", "/api/me/streak-told", map[string]any{"key": on}); status != 200 ||
			out["fresh"] != want {
			t.Fatalf("told the end, time %d: %d %v", i+1, status, out)
		}
	}
	if status, _ := ana.call("POST", "/api/me/streak-told", map[string]any{"key": "ended:soon"}); status != 400 {
		t.Fatalf("a notice that isn't one: %d", status)
	}
	// Told once: Начало, on another device, doesn't tell it again.
	if _, today = ana.call("GET", "/api/day", nil); today["ended"] != nil {
		t.Fatalf("told again: %v", today["ended"])
	}
}
