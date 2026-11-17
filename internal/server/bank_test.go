package server

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// A reload while Роял is on is held until the evening is over; /api/health tells which bank is played, which is held
// and which was refused.
func TestBankReload(t *testing.T) {
	g := start(t)
	var now atomic.Int64
	at := func(t time.Time) { now.Store(t.UnixMilli()) }
	at(time.Date(2026, 11, 15, 12, 0, 0, 0, play.Bulgaria)) // a Sunday: Роял in the evening
	g.srv.game.Now = func() time.Time { return time.UnixMilli(now.Load()) }
	p := g.player()
	health := func() map[string]any {
		t.Helper()
		status, out := p.call("GET", "/api/health", nil)
		if status != 200 {
			t.Fatalf("health: %d %v", status, out)
		}
		return out["bank"].(map[string]any)
	}
	version := func(commit string) {
		t.Helper()
		b := *g.srv.Bank()
		b.Commit = commit
		g.srv.OfferBank(&b)
	}

	version("aaa")
	if h := health(); h["commit"] != "aaa" || h["questions"].(float64) < 100 || h["held"] != nil || h["refused"] != nil {
		t.Fatalf("in the afternoon, at once: %v", h)
	}

	g.srv.RefuseBank("bad", 3)
	if h := health(); h["commit"] != "aaa" || h["refused"].(map[string]any)["commit"] != "bad" || h["refused"].(map[string]any)["errors"] != 3.0 {
		t.Fatalf("refused: %v", h)
	}

	// From the lobby on, a new bank waits; the newest one offered is the one held.
	at(time.Date(2026, 11, 15, 20, 50, 0, 0, play.Bulgaria))
	version("bbb")
	version("ccc")
	if h := health(); h["commit"] != "aaa" || h["held"] != "ccc" || h["refused"] != nil {
		t.Fatalf("during Роял: %v", h)
	}
	if bs := g.srv.Banks(); len(bs) != 2 || bs[0].Commit != "aaa" || bs[1].Commit != "ccc" {
		t.Fatalf("the banks held: %v", bs)
	}
	g.srv.bankStep()
	if h := health(); h["commit"] != "aaa" {
		t.Fatalf("in play before Роял is over: %v", h)
	}

	// The evening over, the held bank goes in.
	at(time.Date(2026, 11, 15, 23, 0, 0, 0, play.Bulgaria))
	g.srv.bankStep()
	if h := health(); h["commit"] != "ccc" || h["held"] != nil {
		t.Fatalf("after Роял: %v", h)
	}
	if bs := g.srv.Banks(); len(bs) != 1 {
		t.Fatalf("still held: %v", bs)
	}
}
