package server

import (
	"bytes"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/play"
)

// get asks for a page as a browser (`ua`: its user agent) with the player's cookies, if any, and says its status,
// its headers and its body.
func (p *player) get(path, ua string) (int, http.Header, string) {
	p.g.t.Helper()
	req, _ := http.NewRequest("GET", p.g.url+path, nil)
	req.Header.Set("User-Agent", ua)
	res, err := p.client.Do(req)
	if err != nil {
		p.g.t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return res.StatusCode, res.Header, string(body)
}

const (
	browserUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
	previewUA = "facebookexternalhit/1.1"
)

// A finished day is shared as its score and shape with a link of its own, made once; the link opens the day (as long
// as it lasts) with the card in its preview, says nothing of whose it was, and goes with the player; the shares and
// the links opened are counted, and nothing else.
func TestSharingTheDay(t *testing.T) {
	g := start(t)
	p, _ := g.guest()
	_, run := p.call("POST", "/api/day", map[string]any{})
	id := strconv.Itoa(int(run["id"].(float64)))
	if status, out := p.call("POST", "/api/runs/"+id+"/share", nil); status != 409 || out["error"] != "not_shared" {
		t.Fatalf("a day not finished, shared: %d %v", status, out)
	}
	playRun(p, run)
	status, out := p.call("POST", "/api/runs/"+id+"/share", nil)
	if status != 200 {
		t.Fatalf("share: %d %v", status, out)
	}
	link, _ := out["url"].(string)
	path := strings.TrimPrefix(link, g.url)
	day := g.srv.game.Today()
	issue := play.Issue(day)
	if !regexp.MustCompile(fmt.Sprintf(`^/d/%d-[a-z2-9]{8}$`, issue)).MatchString(path) {
		t.Fatalf("the link: %q", link)
	}
	_, state := p.call("GET", "/api/runs/"+id, nil)
	rights := int(state["rights"].(float64))
	if _, again := p.call("POST", "/api/runs/"+id+"/share", nil); again["url"] != link {
		t.Fatalf("shared again: %v, not %s", again["url"], link)
	}
	other, _ := g.guest()
	if status, _ := other.call("POST", "/api/runs/"+id+"/share", nil); status != 404 {
		t.Fatalf("someone else's day shared: %d", status)
	}

	// Opened: the day's page, with the day shared in its boot and the card in its preview, and no name.
	_, me := p.call("GET", "/api/me", nil)
	u := me["user"].(map[string]any)
	shape := ""
	for _, m := range state["trail"].([]any) {
		switch m := m.(map[string]any); {
		case m["void"] == true:
			shape += "3"
		case m["right"] == true:
			shape += "1"
		case m["close"] == true:
			shape += "2"
		default:
			shape += "0"
		}
	}
	status, _, body := other.get(path, browserUA)
	if status != 200 || !strings.Contains(body, fmt.Sprintf(`property="og:image" content="%s/card/%d-%s.png"`, g.url, issue, shape)) ||
		!strings.Contains(body, fmt.Sprintf(`content="%d от 10 · АЛМАНАХ, Брой %d"`, rights, issue)) ||
		!strings.Contains(body, fmt.Sprintf(`"shared":{"day":"%s","issue":%d,"shape":"%s"}`, day, issue, shape)) {
		t.Fatalf("the shared day's page: %d\n%s", status, body)
	}
	// What the page says of the link (its preview, the day shared) names nobody; the day's board under it is
	// everyone's, as on Начало.
	head, _, _ := strings.Cut(body, `<script type="application/json" id="boot">`)
	shared := regexp.MustCompile(`"shared":\{[^}]*\}`).FindString(body)
	for _, secret := range []string{u["name"].(string), u["tag"].(string)} {
		if strings.Contains(head+shared, secret) {
			t.Fatalf("the shared day's page names the player (%q)", secret)
		}
	}
	other.get(path, browserUA)      // the same browser again: counted once
	other.get(path, previewUA)      // a preview: not a person
	g.player().get(path, previewUA) // nor without a profile
	counts, err := g.srv.game.Tallies(t.Context(), day, day)
	if err != nil {
		t.Fatal(err)
	}
	if counts["share:day"] != 1 || counts["share:open"] != 1 {
		t.Fatalf("counted: %v", counts)
	}
	// A new player come by the link came from a share.
	newcomer := g.player()
	_, made := newcomer.call("POST", "/api/guest", map[string]any{"from": path})
	var from string
	if err := g.db.Read.QueryRow(`SELECT came_from FROM users WHERE id = ?`,
		made["user"].(map[string]any)["id"]).Scan(&from); err != nil || from != "share" {
		t.Fatalf("came from %q (%v)", from, err)
	}

	// The card: the issue's and the shape's, for any issue out, of 1200 × 630, cached by anyone.
	res, err := http.Get(fmt.Sprintf("%s/card/%d-%s.png", g.url, issue, shape))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	img, err := png.Decode(bytes.NewReader(b))
	if res.StatusCode != 200 || err != nil || img.Bounds().Dx() != 1200 || img.Bounds().Dy() != 630 ||
		!strings.HasPrefix(res.Header.Get("Cache-Control"), "public") {
		t.Fatalf("the card: %d %v %v", res.StatusCode, err, res.Header)
	}
	for _, name := range []string{
		fmt.Sprintf("%d-%s.png", issue+1, shape), // not out yet
		"0-1111111111.png", "1-11111111111.png", "1-4.png", "1-.png", "1-1111.jpg",
	} {
		if status, _, _ := other.get("/card/"+name, browserUA); status != 404 {
			t.Errorf("card %s: %d", name, status)
		}
	}
	// The site's own picture, what a link to any other page shows.
	res, err = http.Get(g.url + "/og.png")
	if err != nil {
		t.Fatal(err)
	}
	b, _ = io.ReadAll(res.Body)
	res.Body.Close()
	img, err = png.Decode(bytes.NewReader(b))
	if res.StatusCode != 200 || err != nil || img.Bounds().Dx() != 1200 || img.Bounds().Dy() != 630 ||
		res.Header.Get("Cache-Control") != "public, max-age=3600" {
		t.Fatalf("the site's picture: %d %v %v", res.StatusCode, err, res.Header)
	}

	// A link that isn't: another code, or the code with another issue.
	code := path[strings.LastIndex(path, "-")+1:]
	for _, wrong := range []string{fmt.Sprintf("/d/%d-abcdefgh", issue), fmt.Sprintf("/d/%d-%s", issue+1, code)} {
		if status, _, _ := other.get(wrong, browserUA); status != 404 {
			t.Errorf("%s: %d", wrong, status)
		}
	}
	// The player gone, the link goes too.
	if status, _ := p.call("DELETE", "/api/me", nil); status != 200 {
		t.Fatal("delete")
	}
	if status, _, _ := other.get(path, browserUA); status != 404 {
		t.Fatalf("a deleted player's link: %d", status)
	}
}

// Links are made within a player's budget an hour.
func TestSharesLimited(t *testing.T) {
	g := start(t)
	p, _ := g.guest()
	_, run := p.call("POST", "/api/day", map[string]any{})
	playRun(p, run)
	id := strconv.Itoa(int(run["id"].(float64)))
	for range sharesPlayer {
		if status, _ := p.call("POST", "/api/runs/"+id+"/share", nil); status != 200 {
			t.Fatalf("share: %d", status)
		}
	}
	if status, _ := p.call("POST", "/api/runs/"+id+"/share", nil); status != 429 {
		t.Fatalf("past the player's shares: %d", status)
	}
}
