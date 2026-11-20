package server

import "testing"

// A reload goes into play at once; /api/health tells which bank is played and which was refused.
func TestBankReload(t *testing.T) {
	g := start(t)
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
	if h := health(); h["commit"] != "aaa" || h["questions"].(float64) < 100 || h["refused"] != nil {
		t.Fatalf("at once: %v", h)
	}

	g.srv.RefuseBank("bad", 3)
	if h := health(); h["commit"] != "aaa" || h["refused"].(map[string]any)["commit"] != "bad" || h["refused"].(map[string]any)["errors"] != 3.0 {
		t.Fatalf("refused: %v", h)
	}

	// A good bank after it clears the refusal.
	version("bbb")
	if h := health(); h["commit"] != "bbb" || h["refused"] != nil {
		t.Fatalf("after the refusal: %v", h)
	}
}
