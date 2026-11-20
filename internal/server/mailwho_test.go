package server

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// A mail's link carries whose it was, signed, so that a browser with no session (a mail app's own) fills the address
// into the sign-in; a token that isn't the game's, or of a player without an address, is nobody's.
func TestMailWho(t *testing.T) {
	g := start(t)
	_, id := g.guest()
	if _, err := g.db.Write.Exec(`UPDATE users SET email = 'ana@example.bg' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	link := g.srv.mailLink(id)
	u, err := url.Parse(link)
	if err != nil || u.Query().Get("from") != "mail" || u.Query().Get("to") == "" || strings.Contains(link, "ana") {
		t.Fatalf("the link: %s %v", link, err)
	}
	reader := g.player() // no session
	if status, out := reader.call("GET", "/api/mail-who?"+url.Values{"to": {u.Query().Get("to")}}.Encode(), nil); status != 200 ||
		out["email"] != "ana@example.bg" {
		t.Fatalf("whose: %d %v", status, out)
	}
	_, other := g.guest()
	bad := strings.Split(u.Query().Get("to"), ".")[0] + ".forged"
	for _, to := range []string{"", "nothing", bad, g.srv.mailWhoToken(other)} {
		if status, _ := reader.call("GET", "/api/mail-who?"+url.Values{"to": {to}}.Encode(), nil); status != http.StatusNotFound {
			t.Fatalf("%q: %d", to, status)
		}
	}
}
