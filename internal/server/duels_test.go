package server

import (
	"fmt"
	"net/http"
	"testing"
)

// A duel with a friend over HTTP: started, played as any run, sent (the friend told by a push and a dot in
// Приятели), played back (the first told the result); only theirs to see and play. Against a recording, too.
func TestADuelOverHTTP(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	bo, boID := g.guest()
	cy, _ := g.guest()
	subscribe(ana, "/ana")
	subscribe(bo, "/bo")
	pushes := func(path string, want int) {
		t.Helper()
		s.sendQueued(t.Context())
		if got := fake.count(path); got != want {
			t.Fatalf("%s: %d pushes, want %d", path, got, want)
		}
	}

	if status, out := ana.call("POST", "/api/duels", map[string]any{"friend": boID}); status != 404 ||
		out["error"] != "not_friends" {
		t.Fatalf("a duel with someone not a friend: %d %v", status, out)
	}
	if status, _ := ana.call("POST", "/api/duels", map[string]any{}); status != 400 {
		t.Fatalf("a duel with nobody: %d", status)
	}
	if _, err := g.db.Write.Exec(`INSERT INTO friends (user_id, friend_id, since, asked) VALUES (?1, ?2, 0, 1), (?2, ?1, 0, 0)`,
		anaID, boID); err != nil {
		t.Fatal(err)
	}
	status, out := ana.call("POST", "/api/duels", map[string]any{"friend": boID})
	duel, _ := out["duel"].(map[string]any)
	if status != 200 || duel["state"] != "yours" || duel["runId"] == nil {
		t.Fatalf("Ana's duel: %d %v", status, out)
	}
	id := int64(duel["id"].(float64))
	pushes("/bo", 0) // not sent before Ana has played it
	playRun(ana, map[string]any{"id": duel["runId"]})
	pushes("/bo", 1)

	// Bo hears of it: a dot in Приятели, the duel his to play.
	if _, w := bo.call("GET", "/api/friends/requests", nil); w["duels"] != 1.0 || w["requests"] != 0.0 {
		t.Fatalf("waiting for Bo: %v", w)
	}
	if _, list := bo.call("GET", "/api/duels", nil); len(list["yours"].([]any)) != 1 {
		t.Fatalf("Bo's duels: %v", list)
	}
	if _, list := ana.call("GET", "/api/duels", nil); len(list["theirs"].([]any)) != 1 {
		t.Fatalf("Ana's duels: %v", list)
	}

	// Signed out, its link asks to sign in; one that isn't there is said so, and its page is a 404.
	outside := g.player()
	if status, out := outside.call("GET", fmt.Sprintf("/api/duels/%d", id), nil); status != 401 || out["error"] != "signed_out" {
		t.Errorf("a duel there, signed out: %d %v", status, out)
	}
	if status, out := outside.call("GET", fmt.Sprintf("/api/duels/%d", id+1000), nil); status != 404 || out["error"] != "duel_gone" {
		t.Errorf("a duel not there, signed out: %d %v", status, out)
	}
	// Signed in (a guest too): a duel there but not theirs may be theirs in another profile; one not there is gone.
	guest := g.player()
	guest.call("POST", "/api/guest", map[string]any{})
	if status, out := guest.call("GET", fmt.Sprintf("/api/duels/%d", id), nil); status != 404 || out["error"] != "no_duel" {
		t.Errorf("another's duel: %d %v", status, out)
	}
	if status, out := guest.call("GET", fmt.Sprintf("/api/duels/%d", id+1000), nil); status != 404 || out["error"] != "duel_gone" {
		t.Errorf("a duel not there, signed in: %d %v", status, out)
	}
	for at, want := range map[string]int{fmt.Sprint(id): 200, fmt.Sprint(id + 1000): 404, "new": 200} {
		res, err := http.Get(g.url + "/duel/" + at)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != want {
			t.Errorf("/duel/%s: %d, want %d", at, res.StatusCode, want)
		}
	}
	// Nobody else plays it.
	if status, out := cy.call("POST", fmt.Sprintf("/api/duels/%d/play", id), map[string]any{}); status != 404 {
		t.Fatalf("Cy plays Ana's duel: %d %v", status, out)
	}

	status, out = bo.call("POST", fmt.Sprintf("/api/duels/%d/play", id), map[string]any{})
	duel, _ = out["duel"].(map[string]any)
	if status != 200 || duel["runId"] == nil {
		t.Fatalf("Bo's side: %d %v", status, out)
	}
	playRun(bo, map[string]any{"id": duel["runId"]})
	pushes("/ana", 1)
	_, out = ana.call("GET", fmt.Sprintf("/api/duels/%d", id), nil)
	duel, _ = out["duel"].(map[string]any)
	if st := duel["state"]; (st != "won" && st != "lost" && st != "draw") || duel["record"] == nil || duel["friend"] != true {
		t.Fatalf("the result: %v", out)
	}
	if status, out := bo.call("POST", fmt.Sprintf("/api/duels/%d/play", id), map[string]any{}); status != 410 {
		t.Fatalf("played again: %d %v", status, out)
	}

	// Cy against a recording: Ana's game, or Bo's.
	status, out = cy.call("POST", "/api/duels", map[string]any{"recording": true})
	if duel, _ = out["duel"].(map[string]any); status != 200 || duel["recorded"] != true || duel["opponent"] == nil {
		t.Fatalf("against a recording: %d %v", status, out)
	}
}
