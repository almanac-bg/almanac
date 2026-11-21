package server

import (
	"database/sql"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/play"
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
	// A player with a profile, whose page visitors open: a link they were sent.
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	page := "/players/" + tagOf(p)
	g.open(page, phoneBrowser)
	g.open(page, phoneBrowser) // a reload: once a half hour
	// Another phone behind the same address (a carrier's): a visit of its own.
	g.open(page, strings.Replace(phoneBrowser, "Android 14", "Android 13", 1))
	g.open("/", phoneBrowser)
	g.open("/nope", phoneBrowser)           // not a page of the game
	g.open("/players/nobody", phoneBrowser) // nor a player who isn't
	// Link previews and search engines are no visitors.
	g.open("/", "WhatsApp/2.24.1 A")
	g.open("/", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")
	g.open("/", "facebookexternalhit/1.1")
	for key, want := range map[string]int{"visit:home": 1, "visit:player": 2, "visit:other": 0} {
		if got := g.counted(key); got != want {
			t.Errorf("%s: %d, want %d", key, got, want)
		}
	}
	// A player with a profile isn't a visitor.
	req, _ := http.NewRequest("GET", g.url+page, nil)
	req.Header.Set("User-Agent", phoneBrowser)
	if res, err := p.client.Do(req); err == nil {
		res.Body.Close()
	}
	if got := g.counted("visit:player"); got != 2 {
		t.Fatalf("a player's visit counted: %d", got)
	}
}

// One home counts at most visitsHome visits a half hour, however many browsers it says it is; reloads take none of
// them.
func TestVisitsOfOneHome(t *testing.T) {
	g := start(t)
	for range 5 {
		g.open("/", phoneBrowser) // reloads
	}
	for i := range 2 * visitsHome {
		g.open("/", strings.Replace(phoneBrowser, "Chrome/130.0", "Chrome/130."+strconv.Itoa(i+1), 1))
	}
	if got := g.counted("visit:home"); got != visitsHome {
		t.Fatalf("one home counted %d visits, want %d", got, visitsHome)
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
	for path, want := range map[string]string{"/f/abcd1234": "invite", "/": "home",
		"/players/ana": "player", "/duel": "other"} {
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
	if g.counted("guest:player") != 1 || g.counted("guest:home") != 1 {
		t.Fatalf("the guests counted: player %d, home %d", g.counted("guest:player"), g.counted("guest:home"))
	}
}

func TestTheClientsCounts(t *testing.T) {
	g := start(t)
	p := g.player() // no profile needed: a notification is opened before the page knows who plays
	for key, want := range map[string]int{"share:day": 400, "pushask:yes": 200, "push:open:day": 200,
		"push:open:friends": 200, "push:open:asked": 400, "push:open:royal": 400, "push:open:news": 400, "visit:home": 400, "": 400} {
		if status, _ := p.call("POST", "/api/tally", map[string]string{"key": key}); status != want {
			t.Errorf("%q: %d, want %d", key, status, want)
		}
	}
	if g.counted("share:day") != 0 || g.counted("push:open:friends") != 1 || g.counted("visit:home") != 0 {
		t.Fatal("not counted")
	}
}

// The funnel's week: its visits, guests made, newcomers, and from the first game on, of the newcomers whose day is over.
func TestFunnelWeek(t *testing.T) {
	cells := funnelWeek(10, 4, []play.Newcomer{{FirstFinished: true, Over: 2}, {Over: 2}, {Over: 0}})
	if cells[2] != (rate{3, 4}).HTML() || cells[3] != (rate{1, 2}).HTML() {
		t.Fatalf("the week: %v", cells[:4])
	}
	if len(cells) != 4+len(funnelSteps) {
		t.Fatalf("%d cells", len(cells))
	}
}

func TestLanding(t *testing.T) {
	for path, want := range map[string]string{"/": "home", "/f/x": "invite", "/players/x": "player",
		"/duel": "other"} {
		if got := landing(path); got != want {
			t.Errorf("%s: %s, want %s", path, got, want)
		}
	}
	if ratio(1, 3) != "0,3" || ratio(1, 0) != "—" {
		t.Fatal("the numbers")
	}
}

// A share is rounded, not cut, and told with its 90 % interval (Wilson's), grey under fewer (review 2026-11-18, D2).
func TestRate(t *testing.T) {
	for r, want := range map[rate]string{{3, 0}: "—", {2, 3}: "67% (25–92)", {50, 100}: "50% (42–58)", {0, 40}: "0% (0–6)",
		{40, 40}: "100% (94–100)"} {
		if got := r.String(); got != want {
			t.Errorf("%d of %d: %s, want %s", r.N, r.Of, got, want)
		}
	}
	if h := string(rate{5, 10}.HTML()); !strings.Contains(h, `class="rate few"`) || !strings.Contains(h, "5/10") {
		t.Errorf("a small count: %s", h)
	}
	if h := string(rate{50, 100}.HTML()); strings.Contains(h, "few") {
		t.Errorf("enough: %s", h)
	}
	if (rate{12, 10}).capped() != (rate{10, 10}) {
		t.Error("capped")
	}
}

// What a game is played on, as the request tells it (D5).
func TestClientDevice(t *testing.T) {
	for ua, want := range map[string]string{
		phoneBrowser: "phone",
		"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1":          "tablet",
		"Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36":                              "tablet",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1": "phone",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15":                      "desktop",
		"": "",
	} {
		r, _ := http.NewRequest("GET", "/", nil)
		r.Header.Set("User-Agent", ua)
		if got := clientDevice(r); got != want {
			t.Errorf("%q: %q, want %q", ua, got, want)
		}
	}
}
