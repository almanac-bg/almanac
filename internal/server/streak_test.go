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

// Начало hears of a streak just ended: offered back when it can be (play/repair.go), else only that it ended.
func TestStreakEndedOnTheDay(t *testing.T) {
	g := start(t)
	ana, anaID := g.guest()
	g.daysPlayed(anaID, 5, 4, 3) // three days; the reserve kept the 2nd day back, the 1st ended it
	_, today := ana.call("GET", "/api/day", nil)
	if want := play.Issue(g.srv.game.Today()); want < 1 || today["issue"] != float64(want) {
		t.Fatalf("the day's issue: %v, want %d", today["issue"], want)
	}
	repair, _ := today["repair"].(map[string]any)
	if repair == nil || repair["days"] != 3.0 || repair["day"] != false || repair["other"] != false || today["ended"] != nil {
		t.Fatalf("a streak of three, ended yesterday: %v, %v", today["repair"], today["ended"])
	}
	// The day's reminder says how to win it back.
	if m := g.srv.reminder(t.Context(), g.srv.game.Today(), anaID); m.Body !=
		"Серията ти от 3 дни прекъсна. Върни я днес: въпросите на деня и още една игра." {
		t.Fatalf("the reminder of a streak to win back: %+v", m)
	}
	// Начало shows the offer and says so: counted as offered once, on whichever device.
	on := "ended:" + repair["on"].(string)
	for i, want := range []bool{true, false} {
		if status, out := ana.call("POST", "/api/me/streak-told", map[string]any{"key": on, "repair": true}); status != 200 ||
			out["fresh"] != want {
			t.Fatalf("told the offer, time %d: %d %v", i+1, status, out)
		}
	}
	if c, _ := g.srv.game.Tallies(t.Context(), g.srv.game.Today(), g.srv.game.Today()); c["repair:offered"] != 1 {
		t.Fatalf("the offer counted: %v", c)
	}
	if status, _ := ana.call("POST", "/api/me/streak-told", map[string]any{"key": "ended:soon"}); status != 400 {
		t.Fatalf("a notice that isn't one: %d", status)
	}

	// Won back (as if the day's ten and another game were played today): Начало says nothing more of the days missed,
	// not even of the reserve day spent before the streak ended.
	g.daysPlayed(anaID, 0)
	if _, err := g.db.Write.Exec(`INSERT INTO streak_repairs (user_id, day) VALUES (?, ?)`, anaID, g.srv.game.Today()); err != nil {
		t.Fatal(err)
	}
	_, today = ana.call("GET", "/api/day", nil)
	if today["streak"] != 4.0 || today["repair"] != nil || today["ended"] != nil || today["kept"] != nil {
		t.Fatalf("won back: streak %v, repair %v, ended %v, kept %v", today["streak"], today["repair"], today["ended"], today["kept"])
	}

	bo, boID := g.guest()
	g.daysPlayed(boID, 4, 3) // two days: too short to win back
	_, today = bo.call("GET", "/api/day", nil)
	ended, _ := today["ended"].(map[string]any)
	if today["repair"] != nil || ended == nil || ended["days"] != 2.0 {
		t.Fatalf("a streak of two, ended yesterday: %v, %v", today["repair"], today["ended"])
	}
	// Told once: Начало, on another device, doesn't tell it again.
	bo.call("POST", "/api/me/streak-told", map[string]any{"key": "ended:" + ended["on"].(string)})
	if _, today = bo.call("GET", "/api/day", nil); today["ended"] != nil {
		t.Fatalf("told again: %v", today["ended"])
	}
}
