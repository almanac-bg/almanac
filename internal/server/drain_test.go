package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/live"
	"github.com/almanac-bg/almanac/internal/play"
)

// A deploy drains the server before it restarts it: with nothing under way it's ready at once, and a player asking
// for a live duel meanwhile waits, told why; a drain the deploy stops asking about ends.
func TestDrain(t *testing.T) {
	g := start(t)
	var now atomic.Int64
	at := func(t time.Time) { now.Store(t.UnixMilli()) }
	at(time.Date(2026, 11, 15, 12, 0, 0, 0, play.Bulgaria))
	g.srv.game.Now = func() time.Time { return time.UnixMilli(now.Load()) }
	deploy := g.player()
	drain := func() map[string]any {
		t.Helper()
		status, out := deploy.call("POST", "/api/drain", nil)
		if status != 200 {
			t.Fatalf("drain: %d %v", status, out)
		}
		return out
	}

	if st := drain(); st["ready"] != true || st["duels"] != 0.0 {
		t.Fatalf("with nothing under way: %v", st)
	}

	// A player asking for a live duel waits, held.
	cy := g.player()
	cy.call("POST", "/api/guest", map[string]any{})
	s := cy.stream("/api/duels/live/events")
	if line, _ := s.r.ReadString('\n'); line != "event: waiting\n" {
		t.Fatalf("Cy isn't waiting: %q", line)
	}
	if line, _ := s.r.ReadString('\n'); !strings.Contains(line, `"held":true`) {
		t.Fatalf("Cy isn't told why: %q", line)
	}

	// Not asked again for a while: the drain ends by itself, and duels start again: Cy meets the next who comes.
	at(time.Date(2026, 11, 15, 12, 1, 1, 0, play.Bulgaria))
	g.srv.drainStep(nil)
	dee := g.player()
	dee.call("POST", "/api/guest", map[string]any{})
	dee.stream("/api/duels/live/events")
	s.until(func(v map[string]any) bool { return v["phase"] == "intro" })

	// From anywhere but the machine itself, there's no such thing.
	r := httptest.NewRequest("POST", "/api/drain", nil)
	r.RemoteAddr = "203.0.113.9:4321"
	w := httptest.NewRecorder()
	g.srv.apiHandler(g.srv.drainHandler).ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("from afar: %d", w.Code)
	}
}

// A live duel under way is waited for by its own clock, past five minutes if it may still need it (the longest takes
// more than that): a restart cuts no duel, however long its questions.
func TestDrainWaitsForADuel(t *testing.T) {
	g := start(t)
	var now atomic.Int64
	now.Store(time.Date(2026, 11, 15, 12, 0, 0, 0, play.Bulgaria).UnixMilli())
	g.srv.game.Now = func() time.Time { return time.UnixMilli(now.Load()) }
	deploy := g.player()
	ana, bo := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	as := ana.stream("/api/duels/live/events")
	bo.stream("/api/duels/live/events")
	as.until(func(v map[string]any) bool { return v["phase"] == "intro" })

	_, st := deploy.call("POST", "/api/drain", nil)
	if st["ready"] != false || st["duels"] != 1.0 || st["duelsLeft"].(float64) <= 5*60 ||
		st["duelsLeft"].(float64) > live.Longest.Seconds() {
		t.Fatalf("a duel just begun: %v", st)
	}
	for range 6 {
		now.Store(now.Load() + time.Minute.Milliseconds())
		_, st = deploy.call("POST", "/api/drain", nil)
	}
	if st["ready"] != false || st["duels"] != 1.0 || st["waited"] != 360.0 {
		t.Fatalf("six minutes on, the duel's time not yet run: %v", st)
	}
}
