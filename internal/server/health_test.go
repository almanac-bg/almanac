package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Health writes to know the database takes writes, at most every probeEvery; a server that can't answers 503, and
// that's a problem told.
func TestHealthProbesWrites(t *testing.T) {
	g := start(t)
	health := func() (int, map[string]any) {
		t.Helper()
		res, err := http.Get(g.url + "/api/health")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}
	status, out := health()
	if status != 200 || out["ok"] != true || out["writes"] != true || out["disk"] != nil || out["mail"] != nil {
		t.Fatalf("%d %v", status, out)
	}
	var at string
	if err := g.db.Read.QueryRow(`SELECT value FROM kv WHERE key = 'health'`).Scan(&at); err != nil || at == "" {
		t.Fatalf("the probe's row: %q %v", at, err)
	}
	// Within probeEvery, the last answer holds: no write.
	if _, err := g.db.Write.Exec(`DELETE FROM kv WHERE key = 'health'`); err != nil {
		t.Fatal(err)
	}
	if status, _ := health(); status != 200 {
		t.Fatal(status)
	}
	var n int
	if err := g.db.Read.QueryRow(`SELECT count(*) FROM kv WHERE key = 'health'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("probed again within probeEvery: %d %v", n, err)
	}

	// Writes refused (the database read-only, as a full disk or a broken file would leave it).
	if _, err := g.db.Write.Exec(`PRAGMA query_only = ON`); err != nil {
		t.Fatal(err)
	}
	defer g.db.Write.Exec(`PRAGMA query_only = OFF`)
	g.srv.probe.mu.Lock()
	g.srv.probe.at = time.Time{}
	g.srv.probe.mu.Unlock()
	status, out = health()
	if status != 503 || out["ok"] != false || out["writes"] != false || out["version"] != "test" {
		t.Fatalf("%d %v", status, out)
	}
	news, _ := g.srv.problems.take()
	found := false
	for k := range news {
		found = found || strings.HasPrefix(k, "health: the database takes no writes")
	}
	if !found {
		t.Fatalf("not told: %v", news)
	}
}
