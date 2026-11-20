package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
)

// lockedBuffer is a log written from several goroutines.
type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// The request log names routes, never paths, so no token, code or tag gets into it; a player's address goes only with
// a request that failed; and what pages ask every so often isn't logged while it goes well (review 2026-11-18, S23,
// I6).
func TestRequestLog(t *testing.T) {
	g := start(t)
	var log lockedBuffer
	slog.SetDefault(slog.New(slog.NewJSONHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(slog.New(slog.DiscardHandler)) })

	token := strings.Repeat("T", 43)
	for _, c := range []struct{ path string }{
		{"/hand/" + token}, {"/players/secret_tag"},
		{"/api/players/secret_tag"}, {"/api/health"}, {"/api/royal/tonight"},
	} {
		if status, _ := g.from("203.0.113.7", "GET", c.path, ""); status == 0 {
			t.Fatal(c.path)
		}
	}
	var lines []map[string]any
	for line := range strings.SplitSeq(strings.TrimSpace(log.String()), "\n") {
		var l map[string]any
		if json.Unmarshal([]byte(line), &l) == nil && l["msg"] == "request" {
			lines = append(lines, l)
		}
	}
	routes := map[string]map[string]any{}
	for _, l := range lines {
		routes[fmt.Sprint(l["route"])] = l
	}
	for _, secret := range []string{token, "secret_tag"} {
		if strings.Contains(log.String(), secret) {
			t.Errorf("the log has %q in it:\n%s", secret, log.String())
		}
	}
	for route, ip := range map[string]bool{
		"/hand/…": false, "/players/…": false,
		"/api/players/{tag}": true, // 404s: someone may be walking them
	} {
		l, ok := routes[route]
		if !ok {
			t.Errorf("no line for %s: %v", route, lines)
			continue
		}
		if _, has := l["ip"]; has != ip {
			t.Errorf("%s (%v): an address %v, want %v", route, l["status"], has, ip)
		}
	}
	for _, route := range []string{"/api/health", "/api/royal/tonight"} {
		if l, ok := routes[route]; ok {
			t.Errorf("a poll logged: %v", l)
		}
	}
}

// A page with the player in it (the boot JSON: their email, whether they're an admin) is never kept by a cache between
// (review 2026-11-18, S25).
func TestPagesPrivate(t *testing.T) {
	g := start(t)
	for _, path := range []string{"/", "/me", "/privacy", "/nothing-here"} {
		res, err := http.Get(g.url + path)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if cc := res.Header.Get("Cache-Control"); cc != "private, no-cache" || res.Header.Get("Vary") != "Cookie" {
			t.Errorf("%s: Cache-Control %q, Vary %q", path, cc, res.Header.Get("Vary"))
		}
	}
}

// Profiles are anyone's to see, but not to walk: past a network's misses (tags nobody has) in an hour, no tag is
// looked up for it, the real ones neither; other networks go on (review 2026-11-18, S12).
func TestProfileMisses(t *testing.T) {
	g := start(t)
	_, out := g.player().call("POST", "/api/guest", nil)
	tag := out["user"].(map[string]any)["tag"].(string)
	if status, _ := g.from("203.0.113.9", "GET", "/api/players/"+tag, ""); status != 200 {
		t.Fatalf("a profile: %d", status)
	}
	for n := range profileMissesNet {
		if status, _ := g.from("203.0.113.9", "GET", fmt.Sprintf("/api/players/nobody%d", n), ""); status != 404 {
			t.Fatalf("miss %d: %d", n+1, status)
		}
	}
	if status, _ := g.from("203.0.113.9", "GET", "/api/players/"+tag, ""); status != 429 {
		t.Fatalf("a real tag past the misses: %d", status)
	}
	if status, _ := g.from("198.51.100.9", "GET", "/api/players/"+tag, ""); status != 200 {
		t.Fatalf("another network: %d", status)
	}
}
