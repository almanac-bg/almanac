package server

import (
	"fmt"
	"testing"

	"github.com/almanac-bg/almanac/internal/play"
)

// Минали броеве over the API: the issues open to play, one of them started and gone on with by its number, and what
// isn't one (today's, one not drawn, a number that's none) not found; one played on its day isn't played again.
func TestIssuesAPI(t *testing.T) {
	g := start(t)
	ana, _ := g.guest()
	bo, boID := g.guest()
	today := g.srv.game.Today()
	past := play.DayShift(today, -2) // settled, whatever the hour
	g.issueOn(past)
	n := play.Issue(past)
	if _, err := g.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, started_at, finished_at, rights)
		VALUES (?, 'day', ?, '[{"id":""}]', 0, 1, 7)`, boID, past); err != nil {
		t.Fatal(err)
	}

	status, out := ana.call("GET", "/api/issues", nil)
	list, _ := out["issues"].([]any)
	if status != 200 || len(list) != 1 {
		t.Fatalf("the list: %d %v", status, out)
	}
	if it := list[0].(map[string]any); it["day"] != past || it["issue"] != float64(n) || it["players"] != 1.0 ||
		it["mine"] != nil {
		t.Fatalf("the issue listed: %v", it)
	}
	status, s := ana.call("POST", fmt.Sprintf("/api/issues/%d", n), map[string]any{})
	if status != 200 || s["kind"] != "past" || s["day"] != past || s["total"] != float64(play.Length) {
		t.Fatalf("started: %d %v", status, s)
	}
	if _, again := ana.call("POST", fmt.Sprintf("/api/issues/%d", n), map[string]any{}); again["id"] != s["id"] {
		t.Fatalf("gone on with: %v, first %v", again["id"], s["id"])
	}
	_, one := ana.call("GET", fmt.Sprintf("/api/issues/%d", n), nil)
	mine, _ := one["issue"].(map[string]any)["mine"].(map[string]any)
	if mine == nil || mine["id"] != s["id"] || mine["done"] != false || one["standing"] != nil {
		t.Fatalf("the issue, begun: %v", one)
	}
	for _, path := range []string{
		fmt.Sprintf("/api/issues/%d", play.Issue(today)), // today's: not past
		fmt.Sprintf("/api/issues/%d", n-1),               // never drawn
		"/api/issues/0", "/api/issues/x",
	} {
		if status, _ := ana.call("POST", path, map[string]any{}); status != 404 {
			t.Errorf("%s: %d", path, status)
		}
	}
	if status, out := bo.call("POST", fmt.Sprintf("/api/issues/%d", n), map[string]any{}); status != 409 ||
		out["error"] == nil {
		t.Fatalf("played on its day: %d %v", status, out)
	}
	// The day's ten point to it once played: „Още десет“ after the day goes to the newest issue not played.
	if _, day := bo.call("GET", "/api/day", nil); day["past"] != nil {
		t.Fatalf("Bo's next past issue: %v", day["past"])
	}
	if _, day := ana.call("GET", "/api/day", nil); day["past"] == nil || day["past"].(map[string]any)["issue"] != float64(n) {
		t.Fatalf("Ana's next past issue: %v", day["past"])
	}
}
