package server

import (
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// daysPlayed makes a player one who finished the day's questions on each of these days (counted back from the game's
// today, on its clock).
func (g *game) daysPlayed(userID int64, back ...int) {
	g.t.Helper()
	for _, d := range back {
		at := g.srv.game.Now().AddDate(0, 0, -d)
		if _, err := g.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, started_at, finished_at)
			VALUES (?, 'day', ?, '[{"id":""}]', ?, ?)`, userID, at.In(play.Bulgaria).Format(time.DateOnly), at.UnixMilli(),
			at.UnixMilli()); err != nil {
			g.t.Fatal(err)
		}
	}
}

// Начало hears of a streak just ended, once, on whichever device; the day's reminder then only asks for today's. The
// same at noon and in the minutes after midnight, while yesterday's runs can still be finished (play.DayGrace).
func TestStreakEndedOnTheDay(t *testing.T) {
	for name, now := range map[string]time.Time{
		"noon":           time.Date(2026, 12, 10, 12, 0, 0, 0, play.Bulgaria),
		"after midnight": time.Date(2026, 12, 10, 0, 5, 0, 0, play.Bulgaria),
	} {
		t.Run(name, func(t *testing.T) { streakEndedOnTheDay(t, now) })
	}
}

func streakEndedOnTheDay(t *testing.T, now time.Time) {
	g := start(t)
	g.srv.game.Now = func() time.Time { return now }
	ana, anaID := g.guest()
	g.daysPlayed(anaID, 6, 5, 4) // three days to Sunday; Monday and Tuesday forgiven, Wednesday (yesterday) ended it
	_, today := ana.call("GET", "/api/day", nil)
	if want := play.Issue(g.srv.game.Today()); want < 1 || today["issue"] != float64(want) {
		t.Fatalf("the day's issue: %v, want %d", today["issue"], want)
	}
	ended, _ := today["ended"].(map[string]any)
	if ended == nil || ended["days"] != nil || ended["on"] != "2026-12-09" { // its number never said
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

// Yesterday's questions, finished in the minutes after midnight (play.DayGrace), count for yesterday: the streak goes
// on, and Начало tells of no day missed.
func TestStreakFinishedAfterMidnight(t *testing.T) {
	g := start(t)
	now := time.Date(2026, 12, 10, 0, 5, 0, 0, play.Bulgaria)
	g.srv.game.Now = func() time.Time { return now }
	ana, anaID := g.guest()
	g.daysPlayed(anaID, 4, 3, 2)
	g.finishedDay(anaID, time.Date(2026, 12, 9, 0, 0, 0, 0, play.Bulgaria), 24*time.Hour+3*time.Minute) // at 00:03
	_, today := ana.call("GET", "/api/day", nil)
	if today["streak"] != 4.0 || today["ended"] != nil || today["forgiven"] != nil {
		t.Fatalf("yesterday's, finished after midnight: streak %v, ended %v, forgiven %v", today["streak"],
			today["ended"], today["forgiven"])
	}
	if m := g.srv.reminder(t.Context(), g.srv.game.Today(), anaID); m.Body !=
		"Серията ти е 4 дни. Не я прекъсвай: десет въпроса, до полунощ." {
		t.Fatalf("the reminder of a streak kept over midnight: %+v", m)
	}
}
