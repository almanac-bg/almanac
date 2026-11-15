package server

import (
	"database/sql"
	"io"
	"net/http"
	"strings"
	"testing"
)

// counted is what daily_counts holds for a key, all days together.
func (g *game) counted(key string) int {
	g.t.Helper()
	var n int
	if err := g.db.Read.QueryRow(`SELECT coalesce(sum(n), 0) FROM daily_counts WHERE key = ?`, key).Scan(&n); err != nil {
		g.t.Fatal(err)
	}
	return n
}

// open loads a page as a browser that has no profile here, with a user agent.
func (g *game) open(path, agent string) {
	g.t.Helper()
	req, _ := http.NewRequest("GET", g.url+path, nil)
	req.Header.Set("User-Agent", agent)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		g.t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, res.Body)
	res.Body.Close()
}

const phoneBrowser = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"

func TestVisitsAreCounted(t *testing.T) {
	g := start(t)
	g.open("/f/abcd1234", phoneBrowser)
	g.open("/f/abcd1234", phoneBrowser) // a reload: once a half hour
	g.open("/", phoneBrowser)
	g.open("/players/nobody", phoneBrowser)
	g.open("/r/123456", phoneBrowser+" AlmanacApp") // the app, wherever it opens
	g.open("/nope", phoneBrowser)                   // not a page of the game
	// Link previews and search engines are no visitors.
	g.open("/", "WhatsApp/2.24.1 A")
	g.open("/", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")
	g.open("/", "facebookexternalhit/1.1")
	for key, want := range map[string]int{"visit:invite": 1, "visit:home": 1, "visit:player": 1, "visit:app": 1, "visit:other": 0} {
		if got := g.counted(key); got != want {
			t.Errorf("%s: %d, want %d", key, got, want)
		}
	}
	// A player with a profile isn't a visitor.
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	req, _ := http.NewRequest("GET", g.url+"/players/nobody", nil)
	req.Header.Set("User-Agent", phoneBrowser)
	if res, err := p.client.Do(req); err == nil {
		res.Body.Close()
	}
	if got := g.counted("visit:player"); got != 1 {
		t.Fatalf("a player's visit counted: %d", got)
	}
}

func TestWhereGuestsCameFrom(t *testing.T) {
	g := start(t)
	cameFrom := func(out map[string]any) string {
		t.Helper()
		id := out["user"].(map[string]any)["id"].(float64)
		var from sql.NullString
		if err := g.db.Read.QueryRow(`SELECT came_from FROM users WHERE id = ?`, id).Scan(&from); err != nil {
			t.Fatal(err)
		}
		return from.String
	}
	for path, want := range map[string]string{"/r/123456": "room", "/f/abcd1234": "invite", "/s/abcd1234": "share",
		"/": "home", "/players/ana": "player", "/royal": "other"} {
		_, out := g.player().call("POST", "/api/guest", map[string]any{"from": path})
		if got := cameFrom(out); got != want {
			t.Errorf("from %s: %q, want %q", path, got, want)
		}
	}
	if _, out := g.player().call("POST", "/api/guest", map[string]any{}); cameFrom(out) != "" {
		t.Error("a client that says nothing: something kept")
	}
	if _, out := g.player().call("POST", "/api/guest", map[string]any{"from": "https://elsewhere.example/"}); cameFrom(out) != "" {
		t.Error("not a path: kept")
	}
	// The app says so in its user agent.
	req, _ := http.NewRequest("POST", g.url+"/api/guest", strings.NewReader(`{"from": "/"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("User-Agent", phoneBrowser+" AlmanacApp")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	var app int
	_ = g.db.Read.QueryRow(`SELECT count(*) FROM users WHERE came_from = 'app'`).Scan(&app)
	if app != 1 || g.counted("guest:app") != 1 || g.counted("guest:room") != 1 {
		t.Fatalf("the app's guests: %d, counted %d", app, g.counted("guest:app"))
	}
}

func TestTheClientsCounts(t *testing.T) {
	g := start(t)
	p := g.player() // no profile needed: a notification is opened before the page knows who plays
	for key, want := range map[string]int{"share:day": 200, "pushask:yes": 200, "push:open:day": 200,
		"push:open:asked": 200, "push:open:news": 400, "visit:home": 400, "": 400} {
		if status, _ := p.call("POST", "/api/tally", map[string]string{"key": key}); status != want {
			t.Errorf("%q: %d, want %d", key, status, want)
		}
	}
	if g.counted("share:day") != 1 || g.counted("push:open:asked") != 1 || g.counted("visit:home") != 0 {
		t.Fatal("not counted")
	}
}

func TestLanding(t *testing.T) {
	for _, c := range []struct {
		path string
		app  bool
		want string
	}{{"/", false, "home"}, {"/", true, "app"}, {"/f/x", false, "invite"}, {"/s/x", false, "share"},
		{"/room", false, "room"}, {"/r/123456", false, "room"}, {"/players/x", false, "player"}, {"/duel", false, "other"}} {
		if got := landing(c.path, c.app); got != c.want {
			t.Errorf("%s (app %v): %s, want %s", c.path, c.app, got, c.want)
		}
	}
	if (rate{3, 0}).String() != "—" || (rate{1, 3}).String() != "1 · 33%" || ratio(1, 3) != "0,3" || ratio(1, 0) != "—" {
		t.Fatal("the numbers")
	}
}
