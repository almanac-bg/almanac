package server

import (
	"net/http"
	"net/url"
	"testing"
)

// The reminders' last word names the chapter nearest its next rank, by its name, from the player's ink.
func TestNearestStepFromInk(t *testing.T) {
	g := start(t)
	_, id := g.guest()
	if _, ok, err := g.srv.nearestStep(t.Context(), id); ok || err != nil {
		t.Fatalf("a step without ink: %v %v", ok, err)
	}
	var ids []string
	for _, q := range g.srv.bank.Load().Live("history", "") {
		if q.Extra().Fact != "" && len(ids) < 3 {
			ids = append(ids, q.Base().ID)
		}
	}
	for _, q := range ids {
		if _, err := g.db.Write.Exec(`INSERT INTO facts (user_id, question_id, ink, at) VALUES (?, ?, 1, 0)`, id, q); err != nil {
			t.Fatal(err)
		}
	}
	st, ok, err := g.srv.nearestStep(t.Context(), id)
	if err != nil || !ok || st != (Step{Chapter: "История", Left: 2, Rank: "Страница"}) {
		t.Fatalf("three in history: %+v %v %v", st, ok, err)
	}
}

// The day's issue begun in a browser that started it today already, as someone else (handoff.go: playedHere), is a
// second play: its run writes pencil.
func TestSecondPlayInABrowserIsPencil(t *testing.T) {
	g := start(t)
	p, id := g.guest()
	u, _ := url.Parse(g.url)
	p.client.Jar.SetCookies(u, []*http.Cookie{{Name: g.srv.playedCookie, Value: g.srv.game.Today(), Path: "/"}})
	if status, _ := p.call("POST", "/api/day", map[string]any{}); status != http.StatusOK {
		t.Fatalf("the day: %d", status)
	}
	var pencil bool
	if err := g.db.Read.QueryRow(`SELECT pencil FROM runs WHERE user_id = ? AND kind = 'day'`, id).Scan(&pencil); err != nil ||
		!pencil {
		t.Fatalf("the second play's run: pencil %v %v", pencil, err)
	}
	q, _ := g.guest()
	q.call("POST", "/api/day", map[string]any{})
	var n int
	if err := g.db.Read.QueryRow(`SELECT count(*) FROM runs WHERE kind = 'day' AND pencil`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("a first play is pencil: %d %v", n, err)
	}
}
