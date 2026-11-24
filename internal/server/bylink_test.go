package server

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// sharedLink is a player who has played and shared today's issue, and its link as the page sends it („13-k4f2m7qa“).
func sharedLink(g *game) (*player, string) {
	g.t.Helper()
	p, _ := g.guest()
	_, run := p.call("POST", "/api/day", map[string]any{})
	playRun(p, run)
	_, out := p.call("POST", "/api/runs/"+strconv.Itoa(int(run["id"].(float64)))+"/share", nil)
	url, _ := out["url"].(string)
	_, link, ok := strings.Cut(url, "/d/")
	if !ok {
		g.t.Fatalf("share: %v", out)
	}
	return p, link
}

// playedDay is a new guest who has finished today's issue.
func playedDay(g *game) *player {
	p, _ := g.guest()
	_, run := p.call("POST", "/api/day", map[string]any{})
	playRun(p, run)
	return p
}

// Whoever played the day by a shared link may ask its owner to be friends: an ordinary request, which the owner sees
// with the link's issue, and which names nobody to its sender, not even in what it answers, until it's accepted
// (DECISIONS.md, Friends). Asking again, or asking oneself, or a friend, is as if sent, and makes nothing; a link
// brings its owner play.SharerAsks at most; a day not played, or a link of a day gone by, asks nobody; and the
// address's limit on requests holds for these too.
func TestAskingWhoSharedTheDay(t *testing.T) {
	g := start(t)
	sharer, link := sharedLink(g)
	issue := play.Issue(g.srv.game.Today())
	_, me := sharer.call("GET", "/api/me", nil)
	who := me["user"].(map[string]any)
	asks := map[string]string{"link": link}

	// A guest who hasn't played the day (a game of a chapter only) asks nobody by it; nor does a link that isn't.
	idle, _ := g.guest()
	played(idle)
	if status, out := idle.call("POST", "/api/friends/requests", asks); status != 404 || out["error"] != "no_link" {
		t.Fatalf("asked without playing the day: %d %v", status, out)
	}
	someone := playedDay(g)
	for _, bad := range []string{fmt.Sprintf("%d-aaaaaaaa", issue), fmt.Sprintf("%d-%s", issue+1, link[len(link)-8:]), "x"} {
		if status, out := someone.call("POST", "/api/friends/requests", map[string]string{"link": bad}); status != 404 ||
			out["error"] != "no_link" {
			t.Fatalf("a link that isn't (%q): %d %v", bad, status, out)
		}
	}

	stranger := playedDay(g)
	answer := func(p *player) string {
		t.Helper()
		req, _ := http.NewRequest("POST", g.url+"/api/friends/requests", strings.NewReader(`{"link":"`+link+`"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		res, err := p.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		if res.StatusCode != 200 {
			t.Fatalf("asking by the link: %d %s", res.StatusCode, b)
		}
		return string(b)
	}
	first := answer(stranger)
	if again := answer(stranger); again != first {
		t.Fatalf("asked again: %s, not %s", again, first)
	}
	if mine := answer(sharer); mine != first {
		t.Fatalf("asked of oneself: %s, not %s", mine, first)
	}
	for _, secret := range []string{who["name"].(string), who["tag"].(string)} {
		if strings.Contains(first, secret) {
			t.Fatalf("the answer names the sharer (%q): %s", secret, first)
		}
	}
	asked := func() int {
		t.Helper()
		var n int
		if err := g.db.Read.QueryRow(`SELECT asked FROM shares`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := asked(); n != 1 {
		t.Fatalf("the link has asked %d, want 1: asking again or oneself counts nothing", n)
	}
	// The sender sees a request that names nobody; the sharer, one from them with the link's issue; and nobody asked
	// themselves.
	_, theirs := stranger.call("GET", "/api/friends", nil)
	out := theirs["requests"].(map[string]any)["out"].([]any)
	if len(out) != 1 || out[0].(map[string]any)["via"] != float64(issue) || out[0].(map[string]any)["name"] != nil ||
		out[0].(map[string]any)["tag"] != nil {
		t.Fatalf("the sender's requests: %v", out)
	}
	_, mine := sharer.call("GET", "/api/friends", nil)
	in := mine["requests"].(map[string]any)["in"].([]any)
	if len(in) != 1 || in[0].(map[string]any)["via"] != float64(issue) || in[0].(map[string]any)["tag"] != tagOf(stranger) ||
		len(mine["requests"].(map[string]any)["out"].([]any)) != 0 {
		t.Fatalf("the sharer's requests: %v", mine["requests"])
	}
	// Nor does the sharer's profile give it away to the sender.
	if _, p := stranger.call("GET", "/api/players/"+who["tag"].(string), nil); p["friend"] != nil {
		t.Fatalf("the sharer's profile, to the sender: %v", p)
	}
	// Accepted, they're friends, and the sender knows whom; asked again by a friend, it's as before.
	acceptAll(sharer)
	_, theirs = stranger.call("GET", "/api/friends", nil)
	if f := theirs["friends"].([]any); len(f) != 1 || f[0].(map[string]any)["name"] != who["name"] {
		t.Fatalf("friends after the yes: %v", theirs)
	}
	if again := answer(stranger); again != first || asked() != 1 {
		t.Fatalf("asked by a friend: %s, the link at %d", again, asked())
	}

	// A link brings its owner play.SharerAsks requests at most, counted as made: a yes or a no makes no room.
	if _, err := g.db.Write.Exec(`UPDATE shares SET asked = ?`, play.SharerAsks-1); err != nil {
		t.Fatal(err)
	}
	answer(playedDay(g))
	if status, out := playedDay(g).call("POST", "/api/friends/requests", asks); status != 409 || out["error"] != "link_asked" {
		t.Fatalf("past the link's requests: %d %v", status, out)
	}
	if _, err := g.db.Write.Exec(`UPDATE shares SET asked = 0`); err != nil {
		t.Fatal(err)
	}

	// A link of a day gone by (its day and the sender's both two days ago): it opened today's issue, another ten, so it
	// asks nobody.
	late := playedDay(g)
	today, gone := g.srv.game.Today(), play.DayShift(g.srv.game.Today(), -2)
	if _, err := g.db.Write.Exec(`UPDATE runs SET day = ? WHERE kind = 'day'`, gone); err != nil {
		t.Fatal(err)
	}
	old := fmt.Sprintf("%d-%s", play.Issue(gone), link[len(link)-8:])
	if status, out := late.call("POST", "/api/friends/requests", map[string]string{"link": old}); status != 404 ||
		out["error"] != "no_link" {
		t.Fatalf("a link of a day gone by: %d %v", status, out)
	}
	if _, err := g.db.Write.Exec(`UPDATE runs SET day = ? WHERE kind = 'day'`, today); err != nil {
		t.Fatal(err)
	}

	// The address's limit on requests holds: one network asking by links all day is turned away within the hour.
	for range 40 {
		if status, _ := late.call("POST", "/api/friends/requests", asks); status == http.StatusTooManyRequests {
			return
		}
	}
	t.Fatal("no limit on requests by a link from one address")
}

// „Нови по връзка“: a new player whose first game, the day's issue, was played on a page opened at someone's shared
// link is counted once on that day's row, and nothing else is kept of it; not a player who had played before, nor a
// game at a script's speed, nor one by a link that isn't, nor one by none.
func TestNewByLink(t *testing.T) {
	g := start(t)
	_, link := sharedLink(g)
	byLink := func() int {
		t.Helper()
		rows, err := g.srv.dayRows(t.Context())
		if err != nil || len(rows) == 0 {
			t.Fatal(err)
		}
		return rows[0].ByLink
	}
	day := func(p *player, via string, took time.Duration) {
		_, run := p.call("POST", "/api/day", map[string]any{})
		playRunBy(p, run, via, took)
	}
	fresh, _ := g.guest()
	day(fresh, link, 3*time.Second)
	if n := byLink(); n != 1 {
		t.Fatalf("a new player by a link: %d", n)
	}
	// What's kept is the count, by day, and nothing of who.
	var cols int
	if err := g.db.Read.QueryRow(`SELECT count(*) FROM pragma_table_info('new_by_link')`).Scan(&cols); err != nil || cols != 2 {
		t.Fatalf("new_by_link has %d columns (%v)", cols, err)
	}
	back, _ := g.guest()
	played(back)
	day(back, link, 3*time.Second)
	script, _ := g.guest()
	day(script, link, 50*time.Millisecond)
	nolink, _ := g.guest()
	day(nolink, fmt.Sprintf("%d-aaaaaaaa", play.Issue(g.srv.game.Today())), 3*time.Second)
	direct, _ := g.guest()
	day(direct, "", 3*time.Second)
	if n := byLink(); n != 1 {
		t.Fatalf("counted %d, want 1: a player back, a script, a link that isn't, or none, count nobody", n)
	}
	// On /admin, beside the days shared.
	if _, err := g.db.Write.Exec(`UPDATE users SET admin = 1`); err != nil {
		t.Fatal(err)
	}
	if _, _, body := fresh.get("/admin", browserUA); !strings.Contains(body, "<th class=\"num\">Нови по връзка</th>") {
		t.Fatalf("/admin has no „Нови по връзка“:\n%s", body)
	}
}
