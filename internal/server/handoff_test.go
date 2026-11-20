package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Phones, as their browsers say: an app's own browser says the phone's system, as the phone's browser does.
const (
	messengerOnAndroid = "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0;]"
	chromeOnAndroid    = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
	chromeOnWindows    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)

// A guest in an app's own browser takes the game to the phone's browser by a link's token, once: the app's browser
// stays signed in as the same player. The server sends the token and its number, never an address to go to.
func TestHandoffLink(t *testing.T) {
	g := start(t)
	app := g.player()
	app.ua = messengerOnAndroid
	_, out := app.call("POST", "/api/guest", map[string]any{})
	guest := name(out)
	_, out = app.call("POST", "/api/auth/handoff", map[string]any{})
	token, _ := out["token"].(string)
	number, _ := out["number"].(float64)
	if len(token) != 43 || number < 10 || number > 99 || out["url"] != nil {
		t.Fatalf("the link: %v", out)
	}
	// Asked again with the link it holds, the page keeps it; with none, it's given another.
	if _, again := app.call("POST", "/api/auth/handoff", map[string]string{"token": token}); again["token"] != token ||
		again["number"] != number {
		t.Fatalf("held: %v", again)
	}
	if _, other := app.call("POST", "/api/auth/handoff", map[string]any{}); other["token"] == token {
		t.Fatalf("a new one: %v", other)
	}
	// There's no page for a link: it's a fragment of Днес's address.
	if res, err := http.Get(g.url + "/hand/" + token); err != nil || res.StatusCode != 404 {
		t.Fatalf("the old page: %v %v", res, err)
	}

	browser := g.player()
	browser.ua = chromeOnAndroid
	// What it brings shows first, whose it is, and nothing is taken by it; the same phone isn't asked for the number.
	if status, out := browser.call("POST", "/api/auth/hand/look", map[string]string{"token": token}); status != 200 ||
		out["game"].(map[string]any)["name"] != guest || out["game"].(map[string]any)["number"] != nil {
		t.Fatalf("looked at: %d %v", status, out)
	}
	if status, out := browser.call("POST", "/api/auth/hand", map[string]string{"token": token}); status != 200 ||
		name(out) != guest {
		t.Fatalf("taken: %d %v", status, out)
	}
	if _, out := browser.call("GET", "/api/me", nil); name(out) != guest {
		t.Fatalf("the browser is %v", out)
	}
	// The game is in both: the app's browser stays signed in, as the same player.
	if _, out := app.call("GET", "/api/me", nil); name(out) != guest {
		t.Fatalf("the app's browser is %v", out)
	}
	if status, out := g.player().call("POST", "/api/auth/hand", map[string]string{"token": token}); status != 404 ||
		out["error"] != "no_handoff" {
		t.Fatalf("taken twice: %d %v", status, out)
	}
}

// A browser on another system than the phone the link was made on gives the number its page shows: without it, it's
// asked for; a wrong one says how many tries are left.
func TestHandoffAsksTheNumber(t *testing.T) {
	g := start(t)
	app := g.player()
	app.ua = messengerOnAndroid
	app.call("POST", "/api/guest", map[string]any{})
	_, out := app.call("POST", "/api/auth/handoff", map[string]any{})
	token, _ := out["token"].(string)
	number := int(out["number"].(float64))

	laptop := g.player()
	laptop.ua = chromeOnWindows
	if _, out := laptop.call("POST", "/api/auth/hand/look", map[string]string{"token": token}); out["game"].(map[string]any)["number"] != true {
		t.Fatalf("looked at from a laptop: %v", out)
	}
	if status, out := laptop.call("POST", "/api/auth/hand", map[string]string{"token": token}); status != 409 ||
		out["error"] != "handoff_number" {
		t.Fatalf("without the number: %d %v", status, out)
	}
	wrong := number%90 + 10
	if status, out := laptop.call("POST", "/api/auth/hand", map[string]any{"token": token, "number": wrong}); status != 400 ||
		out["error"] != "bad_number" || !strings.Contains(out["message"].(string), "2 опита") {
		t.Fatalf("a wrong number: %d %v", status, out)
	}
	if status, out := laptop.call("POST", "/api/auth/hand", map[string]any{"token": token, "number": number}); status != 200 ||
		name(out) == "" {
		t.Fatalf("the right number: %d %v", status, out)
	}
}

// The family of system, by the user agent: an app's own browser is its phone's.
func TestOSFamily(t *testing.T) {
	for ua, want := range map[string]string{
		messengerOnAndroid: "android",
		chromeOnAndroid:    "android",
		chromeOnWindows:    "windows",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 350.0":            "ios",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1": "ios",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15":                   "mac",
		"Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0":                                                                  "linux",
		"": "other",
	} {
		if got := osFamily(ua); got != want {
			t.Errorf("%q: %s, want %s", ua, got, want)
		}
	}
}

// The network a link compares is the /24 of an IPv4 address and the /64 of an IPv6 one, as a keyed hash: never the
// address, and the same for two addresses of one network.
func TestHandoffOriginNetwork(t *testing.T) {
	g := start(t)
	s := g.srv
	mark := func(addr string) []byte {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = addr
		return s.origin(r).Net
	}
	a, b, c := mark("203.0.113.5:1"), mark("203.0.113.200:1"), mark("203.0.114.5:1")
	if len(a) != 12 || string(a) != string(b) || string(a) == string(c) || strings.Contains(string(a), "203.0") {
		t.Fatalf("IPv4: %x %x %x", a, b, c)
	}
	d, e, f := mark("[2001:db8:1:2::1]:1"), mark("[2001:db8:1:2:ffff::9]:1"), mark("[2001:db8:1:3::1]:1")
	if string(d) != string(e) || string(d) == string(f) {
		t.Fatalf("IPv6: %x %x %x", d, e, f)
	}
	if mark("127.0.0.1:1") != nil {
		t.Fatal("the machine's own address is no network")
	}
}

// A browser that started the day's questions keeps it, whoever it's signed in as after: a game brought into it that
// day plays the issue a second time there (playedHere), which writes pencil, not ink.
func TestPlayedHere(t *testing.T) {
	g := start(t)
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	day := g.srv.game.Today()
	ask := func() bool {
		r := httptest.NewRequest("GET", g.url+"/", nil)
		for _, c := range p.client.Jar.Cookies(r.URL) {
			r.AddCookie(c)
		}
		return g.srv.playedHere(r, day)
	}
	if ask() {
		t.Fatal("played before starting")
	}
	if status, out := p.call("POST", "/api/day", map[string]any{}); status != 200 {
		t.Fatalf("starting the day: %d %v", status, out)
	}
	if !ask() {
		t.Fatal("not played here after starting the day")
	}
	p.call("POST", "/api/auth/signout", map[string]any{})
	if !ask() {
		t.Fatal("a sign-out forgot that the day was played here")
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: g.srv.playedCookie, Value: "2020-01-01"})
	if g.srv.playedHere(r, day) {
		t.Fatal("another day's mark counts for today")
	}
}
