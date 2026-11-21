package server

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

// A player's invite link, over HTTP: made for a player who has finished a game, the same when asked again; its page is
// the app with whose it is in its boot and its preview, kept from search engines and from caches between; a guest
// opening it plays first; one tap makes the two friends, and both see it; a new link ends the old.
func TestInviteOverHTTP(t *testing.T) {
	g := start(t)
	ana, _ := g.guest()
	if status, out := ana.call("POST", "/api/invite", nil); status != http.StatusForbidden || out["error"] != "play_first" {
		t.Fatalf("a link before a game: %d %v", status, out)
	}
	played(ana)
	status, out := ana.call("POST", "/api/invite", nil)
	link, _ := out["url"].(string)
	path := strings.TrimPrefix(link, g.url)
	if status != http.StatusOK || !regexp.MustCompile(`^/f/[a-z2-9]{10}$`).MatchString(path) {
		t.Fatalf("Ana's link: %d %v", status, out)
	}
	if _, again := ana.call("POST", "/api/invite", nil); again["url"] != link {
		t.Fatalf("asked again: %v, not %s", again["url"], link)
	}
	code := strings.TrimPrefix(path, "/f/")
	_, me := ana.call("GET", "/api/me", nil)
	anaName := me["user"].(map[string]any)["name"].(string)

	// Opened by someone not signed in: the app, whose link it is in its boot and its preview; private and unindexed.
	stranger := g.player()
	status, h, body := stranger.get(path, browserUA)
	if status != http.StatusOK || h.Get("X-Robots-Tag") != "noindex" || h.Get("Cache-Control") != private ||
		!strings.Contains(body, fmt.Sprintf(`content="%s те кани в АЛМАНАХ"`, anaName)) {
		t.Fatalf("the link's page: %d %v\n%s", status, h, body)
	}
	boot := bootOf(t, stranger, path)
	in, _ := boot["invite"].(map[string]any)
	if in["code"] != code || in["name"] != anaName || in["avatar"] == "" || in["mine"] != nil || boot["day"] == nil {
		t.Fatalf("the page's boot: %v", boot)
	}
	if status, _, _ := stranger.get("/f/abcdefghij", browserUA); status != http.StatusNotFound {
		t.Fatalf("a link that isn't: %d", status)
	}
	if gone, _ := bootOf(t, stranger, "/f/abcdefghij")["invite"].(map[string]any); gone["gone"] != true {
		t.Fatalf("a link that isn't, in the boot: %v", gone)
	}
	if mine, _ := bootOf(t, ana, path)["invite"].(map[string]any); mine["mine"] != true {
		t.Fatalf("Ana's own link, opened: %v", mine)
	}

	// A guest who hasn't finished a game plays first; then one tap, and both are friends.
	bo := stranger
	bo.call("POST", "/api/guest", map[string]any{})
	if status, out := bo.call("POST", "/api/invites/"+code, nil); status != http.StatusForbidden || out["error"] != "play_first" {
		t.Fatalf("a guest before a game: %d %v", status, out)
	}
	if status, out := ana.call("POST", "/api/invites/"+code, nil); status != http.StatusConflict || out["error"] != "self" {
		t.Fatalf("Ana takes her own: %d %v", status, out)
	}
	played(bo)
	if status, out := bo.call("POST", "/api/invites/"+code, nil); status != http.StatusOK || out["name"] != anaName ||
		out["already"] != nil {
		t.Fatalf("Bo takes it: %d %v", status, out)
	}
	for _, p := range []*player{ana, bo} {
		if _, list := p.call("GET", "/api/friends", nil); len(list["friends"].([]any)) != 1 {
			t.Fatalf("friends: %v", list)
		}
	}
	if _, list := ana.call("GET", "/api/friends", nil); list["accepted"] == nil {
		t.Fatalf("Ana isn't told of the yes: %v", list)
	}
	if _, out := bo.call("POST", "/api/invites/"+code, nil); out["already"] != true {
		t.Fatalf("taken again: %v", out)
	}
	if _, out := bo.call("GET", "/api/invites/"+code, nil); out["friends"] != true || out["name"] != anaName {
		t.Fatalf("opened by a friend: %v", out)
	}

	// A new link ends the old one.
	_, fresh := ana.call("POST", "/api/invite/new", nil)
	if fresh["url"] == link || fresh["url"] == nil {
		t.Fatalf("a new link: %v", fresh)
	}
	cy, _ := g.guest()
	played(cy)
	if status, out := cy.call("POST", "/api/invites/"+code, nil); status != http.StatusNotFound || out["error"] != "no_invite" {
		t.Fatalf("the old link taken: %d %v", status, out)
	}
	if status, _ := cy.call("POST", "/api/invites/"+strings.TrimPrefix(fresh["url"].(string), g.url+"/f/"), nil); status != http.StatusOK {
		t.Fatalf("the new link taken: %d", status)
	}
}

// Looking links up is bounded by network and site, in the guard's limiter: a guess at codes from one /48 all day finds
// nothing, and costs the server a read each.
func TestInvitesLookedUpWithinBudget(t *testing.T) {
	g := start(t)
	p := g.player()
	for i := range invitesNet {
		if status, _ := p.call("GET", fmt.Sprintf("/api/invites/abcdefg%03d", i), nil); status != http.StatusNotFound {
			t.Fatalf("guess %d: %d", i, status)
		}
	}
	if status, out := p.call("GET", "/api/invites/abcdefghij", nil); status != http.StatusTooManyRequests ||
		out["error"] != "too_many" {
		t.Fatalf("past the budget: %d %v", status, out)
	}
	// The page, past it, says too many from here (busy, not gone), and its boot nothing of whose it'd be.
	if status, _, _ := p.get("/f/abcdefghij", browserUA); status != http.StatusTooManyRequests {
		t.Fatalf("the page past the budget: %d", status)
	}
	in, _ := bootOf(t, p, "/f/abcdefghij")["invite"].(map[string]any)
	if in["error"] != errInviteBusy.message || in["gone"] != nil || in["name"] != nil {
		t.Fatalf("the boot past the budget: %v", in)
	}
}

// A guest told to play first spends none of the network's budget of taps: a class of guests tapping one link before
// their first games are each still let in after them.
func TestPlayFirstSpendsNoBudget(t *testing.T) {
	g := start(t)
	ana, _ := g.guest()
	played(ana)
	_, out := ana.call("POST", "/api/invite", nil)
	code := strings.TrimPrefix(out["url"].(string), g.url+"/f/")
	// Two friends already spend all but one of the network's taps (each tap counts, a friend's too).
	cy, _ := g.guest()
	dee, _ := g.guest()
	played(cy)
	played(dee)
	for i := range befriendsNet - 1 {
		p := []*player{cy, dee}[i%2]
		if status, out := p.call("POST", "/api/invites/"+code, nil); status != http.StatusOK {
			t.Fatalf("tap %d: %d %v", i, status, out)
		}
	}
	bo, _ := g.guest()
	for i := range 5 {
		if status, out := bo.call("POST", "/api/invites/"+code, nil); status != http.StatusForbidden || out["error"] != "play_first" {
			t.Fatalf("tap %d before a game: %d %v", i, status, out)
		}
	}
	played(bo)
	if status, out := bo.call("POST", "/api/invites/"+code, nil); status != http.StatusOK || out["name"] == nil {
		t.Fatalf("after the game: %d %v", status, out)
	}
}

// Removing a friend ends the remover's link: the one removed is not back by a tap on it.
func TestUnfriendEndsTheLinkOverHTTP(t *testing.T) {
	g := start(t)
	ana, _ := g.guest()
	played(ana)
	_, out := ana.call("POST", "/api/invite", nil)
	link, _ := out["url"].(string)
	code := strings.TrimPrefix(link, g.url+"/f/")
	bo, _ := g.guest()
	played(bo)
	if status, out := bo.call("POST", "/api/invites/"+code, nil); status != http.StatusOK {
		t.Fatalf("Bo takes it: %d %v", status, out)
	}
	_, list := ana.call("GET", "/api/friends", nil)
	boID := list["friends"].([]any)[0].(map[string]any)["id"]
	if status, out := ana.call("DELETE", fmt.Sprintf("/api/friends/%v", boID), nil); status != http.StatusOK {
		t.Fatalf("Ana removes Bo: %d %v", status, out)
	}
	if status, out := bo.call("POST", "/api/invites/"+code, nil); status != http.StatusNotFound || out["error"] != "no_invite" {
		t.Fatalf("Bo taps the old link: %d %v", status, out)
	}
	if _, fresh := ana.call("POST", "/api/invite", nil); fresh["url"] == link || fresh["url"] == nil {
		t.Fatalf("Ana's link after: %v", fresh)
	}
}
