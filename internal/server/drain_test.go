package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/live"
	"github.com/almanac-bg/almanac/internal/play"
)

// A deploy drains the server before it restarts it: a game under way is waited for (up to drainCap), no new one
// starts meanwhile, and a player asking for a live duel waits, told why. Around Роял there's no drain; a drain the
// deploy stops asking about ends.
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

	if st := drain(); st["ready"] != true || st["duels"] != 0.0 || st["rooms"] != 0.0 {
		t.Fatalf("with nothing under way: %v", st)
	}
	deploy.call("DELETE", "/api/drain", nil)

	// A room's game under way: the server waits for it, and starts no other meanwhile.
	ana, bo := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	_, out := ana.call("POST", "/api/rooms", map[string]any{})
	code := out["code"].(string)
	ana.follow(code)
	if status, out := ana.call("POST", "/api/rooms/"+code+"/start", nil); status != 200 {
		t.Fatalf("start: %d %v", status, out)
	}
	_, out = bo.call("POST", "/api/rooms", map[string]any{})
	other := out["code"].(string)
	bo.follow(other)
	if st := drain(); st["ready"] != false || st["rooms"] != 1.0 {
		t.Fatalf("with a room's game under way: %v", st)
	}
	if status, out := bo.call("POST", "/api/rooms/"+other+"/start", nil); status != 503 || out["error"] != "updating" {
		t.Fatalf("a game started while draining: %d %v", status, out)
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

	// Not asked again for a while: the drain ends by itself, and games start again.
	at(time.Date(2026, 11, 15, 12, 1, 1, 0, play.Bulgaria))
	g.srv.drainStep(nil)
	if status, out := bo.call("POST", "/api/rooms/"+other+"/start", nil); status != 200 {
		t.Fatalf("a game after the drain ended: %d %v", status, out)
	}

	// Asked again, and the games go on for drainCap: then it's ready all the same.
	if st := drain(); st["ready"] != false || st["rooms"] != 2.0 {
		t.Fatalf("draining again: %v", st)
	}
	for range 5 {
		at(time.UnixMilli(now.Load()).Add(time.Minute))
		drain()
	}
	if st := drain(); st["ready"] != true || st["rooms"] != 2.0 || st["waited"] != 300.0 {
		t.Fatalf("after drainCap: %v", st)
	}

	// Near Роял, no drain: the restart waits for the evening to pass, and games go on.
	deploy.call("DELETE", "/api/drain", nil)
	at(time.Date(2026, 11, 15, 20, 40, 0, 0, play.Bulgaria))
	if st := drain(); st["ready"] != false || st["royal"] != true || st["waited"] != 0.0 {
		t.Fatalf("near Роял: %v", st)
	}
	if status, _ := ana.call("POST", "/api/rooms", map[string]any{}); status != 200 {
		t.Fatalf("a room near Роял: %d", status)
	}

	// From anywhere but the machine itself, there's no such thing.
	r := httptest.NewRequest("POST", "/api/drain", nil)
	r.RemoteAddr = "203.0.113.9:4321"
	w := httptest.NewRecorder()
	g.srv.apiHandler(g.srv.drainHandler).ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("from afar: %d", w.Code)
	}
}

// A live duel under way is waited for by its own clock, past drainCap if it may still need it (the longest takes more
// than five minutes): a restart cuts no duel, however long its questions.
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
	if st["ready"] != false || st["duels"] != 1.0 || st["duelsLeft"].(float64) <= drainCap.Seconds() ||
		st["duelsLeft"].(float64) > live.Longest.Seconds() {
		t.Fatalf("a duel just begun: %v", st)
	}
	for range 6 {
		now.Store(now.Load() + time.Minute.Milliseconds())
		_, st = deploy.call("POST", "/api/drain", nil)
	}
	if st["ready"] != false || st["duels"] != 1.0 || st["waited"] != 360.0 {
		t.Fatalf("past drainCap, the duel's time not yet run: %v", st)
	}
}

// The rooms open are saved as they change (each roomsEvery) and as the server stops, and are open again when it
// starts; the file stays, for a crash before the next save to come back to.
func TestRoomsOverARestart(t *testing.T) {
	g := start(t)
	file := filepath.Join(t.TempDir(), "rooms.json")
	g.srv.cfg.RoomsFile = file
	g.srv.saveRoomsChanged()
	if _, err := os.Stat(file); err == nil {
		t.Fatal("saved with nothing to save")
	}
	ana := g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	_, out := ana.call("POST", "/api/rooms", map[string]any{})
	code := out["code"].(string)
	g.srv.saveRoomsChanged() // a room opened: saved
	if data, err := os.ReadFile(file); err != nil || !strings.Contains(string(data), code) {
		t.Fatalf("the room opened wasn't saved: %s %v", data, err)
	}
	saved := g.srv.roomsSaved.changesNow()
	g.srv.saveRoomsChanged() // nothing new: not saved again
	if g.srv.roomsSaved.changesNow() != saved {
		t.Fatal("saved again with nothing changed")
	}

	next := start(t)
	next.srv.cfg.RoomsFile = file
	next.srv.restoreRooms()
	if _, err := next.srv.rooms.Get(code); err != nil {
		t.Fatalf("the room after a restart: %v", err)
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("the rooms' file went with the restore: %v", err)
	}
}
