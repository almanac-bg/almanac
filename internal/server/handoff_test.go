package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Phones, as their browsers say: an app's own browser, and the phone's.
const (
	messengerOnAndroid = "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0;]"
	chromeOnAndroid    = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
)

// A guest in an app's own browser takes the game to the phone's browser by a link's token, once: the app's browser
// stays signed in as the same player. The server sends the token only, never an address to go to.
func TestHandoffLink(t *testing.T) {
	g := start(t)
	app := g.player()
	app.ua = messengerOnAndroid
	_, out := app.call("POST", "/api/guest", map[string]any{})
	guest := name(out)
	_, out = app.call("POST", "/api/auth/handoff", nil)
	token, _ := out["token"].(string)
	if len(token) != 43 || len(out) != 1 {
		t.Fatalf("the link: %v", out)
	}
	if _, other := app.call("POST", "/api/auth/handoff", nil); other["token"] == token {
		t.Fatalf("a new one: %v", other)
	}
	// There's no page for a link: it's a fragment of Днес's address. Nor a call to say it was copied.
	if res, err := http.Get(g.url + "/hand/" + token); err != nil || res.StatusCode != 404 {
		t.Fatalf("the old page: %v %v", res, err)
	}
	if status, _ := app.call("POST", "/api/auth/handoff/copied", map[string]string{"token": token}); status != 404 &&
		status != 405 {
		t.Fatalf("the copied call: %d", status)
	}

	browser := g.player()
	browser.ua = chromeOnAndroid
	// What it brings shows first, whose it is, and nothing is taken by it.
	if status, out := browser.call("POST", "/api/auth/hand/look", map[string]string{"token": token}); status != 200 ||
		out["game"].(map[string]any)["name"] != guest || out["game"].(map[string]any)["mine"] != nil {
		t.Fatalf("looked at: %d %v", status, out)
	}
	if _, out := browser.call("GET", "/api/me", nil); out["user"] != nil {
		t.Fatalf("a look signed the browser in: %v", out)
	}
	// Looked at where it was made: it's this browser's own game.
	if _, out := app.call("POST", "/api/auth/hand/look", map[string]string{"token": token}); out["game"].(map[string]any)["mine"] != true {
		t.Fatalf("looked at where it was made: %v", out)
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
