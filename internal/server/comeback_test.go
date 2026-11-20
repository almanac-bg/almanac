package server

import (
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// dayOf puts a finished game of a day's ten straight in the database, with its right answers.
func (g *game) dayOf(userID int64, day string, rights int) {
	g.t.Helper()
	at, _ := time.ParseInLocation(time.DateOnly, day, play.Bulgaria)
	at = at.Add(10 * time.Hour)
	if _, err := g.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, rights, points, ms, started_at, finished_at)
		VALUES (?, 'day', ?, '[{"id":""}]', ?, ?, 60000, ?, ?)`, userID, day, rights, 100*rights, at.UnixMilli(),
		at.UnixMilli()); err != nil {
		g.t.Fatal(err)
	}
}

// A player who comes back after days away is welcomed, once; one who played yesterday isn't.
func TestComeBack(t *testing.T) {
	g := start(t)
	g.srv.game.Now = func() time.Time { return time.Date(2026, 11, 20, 12, 0, 0, 0, play.Bulgaria) }
	ana, anaID := g.guest()
	g.dayOf(anaID, "2026-11-19", 7)

	_, today := ana.call("GET", "/api/day", nil)
	if today["back"] != nil {
		t.Fatalf("played yesterday, welcomed back: %v", today["back"])
	}
	// Cy played five days in a row, then went away: welcomed back, once, with the longest streak.
	cy, cyID := g.guest()
	for d := 5; d <= 9; d++ {
		g.dayOf(cyID, time.Date(2026, 11, d, 0, 0, 0, 0, play.Bulgaria).Format(time.DateOnly), 6)
	}
	_, today = cy.call("GET", "/api/day", nil)
	back, _ := today["back"].(map[string]any)
	if back == nil || back["last"] != "2026-11-09" || back["best"] != 5.0 || today["ended"] != nil {
		t.Fatalf("back after days away: %v (ended %v)", today["back"], today["ended"])
	}
	if status, _ := cy.call("POST", "/api/me/streak-told", map[string]any{"key": "back:2026-11-09"}); status != 200 {
		t.Fatalf("told: %d", status)
	}
	if _, today = cy.call("GET", "/api/day", nil); today["back"] != nil {
		t.Fatalf("told again: %v", today["back"])
	}
}

// Профил's „Всички игри“: the player's games a page at a time, of a kind.
func TestAllGames(t *testing.T) {
	g := start(t)
	ana, anaID := g.guest()
	g.daysPlayed(anaID, 3, 2, 1)
	status, out := ana.call("GET", "/api/me/games?kind=day", nil)
	games, _ := out["games"].([]any)
	if status != 200 || len(games) != 3 || out["next"] != nil {
		t.Fatalf("the day's ten: %d %v", status, out)
	}
	if first := games[0].(map[string]any); first["kind"] != "day" || first["issue"] == nil {
		t.Fatalf("a day's game names its issue: %v", first)
	}
	if status, out = g.player().call("GET", "/api/me/games", nil); status != 401 {
		t.Fatalf("nobody's games: %d %v", status, out)
	}
}
