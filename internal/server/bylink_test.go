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

// Whoever played the day by a shared link may ask its owner to be friends: a request, which the owner sees with the
// link's issue, and which names nobody to its sender, not even in what it answers, until it's accepted (DECISIONS.md,
// Friends). Asking again, or asking oneself, or a friend, is as if sent; a link brings its owner requests from
// play.SharerAsks people at most, each counted once; a day not played yet is said so, and a link of a day gone by
// asks nobody; and the address's limit on requests holds for these too.
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
	if status, out := idle.call("POST", "/api/friends/requests", asks); status != 403 || out["error"] != "play_shared" {
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
		if err := g.db.Read.QueryRow(`SELECT count(*) FROM share_asks`).Scan(&n); err != nil {
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

	// A link brings its owner requests from play.SharerAsks people at most, each counted once: a yes or a no makes no
	// room, and one who asked already may ask again.
	for range play.SharerAsks - 2 {
		_, id := g.guest()
		if _, err := g.db.Write.Exec(`INSERT INTO share_asks (code, from_id) VALUES (?, ?)`, link[len(link)-8:], id); err != nil {
			t.Fatal(err)
		}
	}
	answer(playedDay(g))
	if status, out := playedDay(g).call("POST", "/api/friends/requests", asks); status != 409 || out["error"] != "link_asked" {
		t.Fatalf("past the link's requests: %d %v", status, out)
	}
	if again := answer(stranger); again != first {
		t.Fatalf("asked again by one counted, past the link's requests: %s", again)
	}
	if _, err := g.db.Write.Exec(`DELETE FROM share_asks`); err != nil {
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
	// What's kept is a mark on the game, nothing of whose link it was.
	var cols int
	if err := g.db.Read.QueryRow(`SELECT count(*) FROM pragma_table_info('runs_by_link')`).Scan(&cols); err != nil || cols != 1 {
		t.Fatalf("runs_by_link has %d columns (%v)", cols, err)
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
	// A new guest by a link who then signs in to a profile that played long before isn't new: counted, then not, as
	// in „Нови“.
	old := g.player()
	old.signIn("old@example.com")
	played(old)
	_, me := old.call("GET", "/api/me", nil)
	if _, err := g.db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?, ?)`, me["user"].(map[string]any)["id"],
		play.DayShift(g.srv.game.Today(), -100)); err != nil {
		t.Fatal(err)
	}
	rows, _ := g.srv.dayRows(t.Context())
	isNew := rows[0].New
	again, _ := g.guest()
	day(again, link, 3*time.Second)
	if rows, _ := g.srv.dayRows(t.Context()); rows[0].ByLink != 2 || rows[0].New != isNew+1 {
		t.Fatalf("a new guest by a link: %d by a link, %d new (were %d)", rows[0].ByLink, rows[0].New, isNew)
	}
	again.signIn("old@example.com")
	if rows, _ := g.srv.dayRows(t.Context()); rows[0].ByLink != 1 || rows[0].New != isNew {
		t.Fatalf("signed in to an older profile: %d by a link, %d new (want 1, %d)", rows[0].ByLink, rows[0].New, isNew)
	}
	// On /admin, beside the days shared.
	if _, err := g.db.Write.Exec(`UPDATE users SET admin = 1`); err != nil {
		t.Fatal(err)
	}
	if _, _, body := fresh.get("/admin", browserUA); !strings.Contains(body, "<th class=\"num\">Нови по връзка</th>") {
		t.Fatalf("/admin has no „Нови по връзка“:\n%s", body)
	}
}

// requestsOut are the friend requests a player sent, as Приятели lists them.
func requestsOut(p *player) []map[string]any {
	p.g.t.Helper()
	_, out := p.call("GET", "/api/friends", nil)
	var list []map[string]any
	for _, r := range out["requests"].(map[string]any)["out"].([]any) {
		list = append(list, r.(map[string]any))
	}
	return list
}

// Nothing its sender can see or do after a request by a link tells them whose the link was, whatever username they
// guess: asked by tag, the sharer and anyone else answer alike, each a request of its own beside the one by the link;
// the limit on requests waiting holds for both alike; a no to the one by the link leaves it waiting, as one to anyone
// would; and asked by a friend of the sharer's, or by one the sharer had asked first, it's a request like any other.
func TestSharerStaysUnnamed(t *testing.T) {
	g := start(t)
	sharer, link := sharedLink(g)
	other, sender := playedDay(g), playedDay(g)
	byLink := map[string]string{"link": link}
	if status, out := sender.call("POST", "/api/friends/requests", byLink); status != 200 {
		t.Fatalf("asking by the link: %d %v", status, out)
	}
	_, me := sender.call("GET", "/api/me", nil)
	senderID := me["user"].(map[string]any)["id"]

	// Its waiting requests at the limit, the sender is turned away by tag from the sharer as from anyone.
	for i := range play.MaxRequests - 1 {
		if _, err := g.db.Write.Exec(`INSERT INTO friend_requests (from_id, to_email, at) VALUES (?, ?, 0)`, senderID,
			fmt.Sprintf("filler%d@example.com", i)); err != nil {
			t.Fatal(err)
		}
	}
	for _, guess := range []*player{sharer, other} {
		if status, out := sender.call("POST", "/api/friends/requests", map[string]string{"to": "@" + tagOf(guess)}); status != 409 ||
			out["error"] != "many_requests" {
			t.Fatalf("asked by tag past the limit: %d %v", status, out)
		}
	}
	if _, err := g.db.Write.Exec(`DELETE FROM friend_requests WHERE to_email LIKE 'filler%'`); err != nil {
		t.Fatal(err)
	}

	// Asked by tag, the sharer and the other alike: a request of its own each, named, beside the one by the link.
	for _, guess := range []*player{sharer, other} {
		status, out := sender.call("POST", "/api/friends/requests", map[string]string{"to": "@" + tagOf(guess)})
		if status != 200 || out["friends"] != nil || out["name"] == nil {
			t.Fatalf("asked by tag: %d %v", status, out)
		}
		if _, p := sender.call("GET", "/api/players/"+tagOf(guess), nil); p["friend"] != "asked" {
			t.Fatalf("a guess's profile, to the sender: %v", p["friend"])
		}
	}
	sent := func() (named, unnamed int) {
		t.Helper()
		for _, r := range requestsOut(sender) {
			switch {
			case r["via"] != nil && r["name"] == nil && r["tag"] == nil:
				unnamed++
			case r["via"] == nil && (r["tag"] == tagOf(sharer) || r["tag"] == tagOf(other)):
				named++
			default:
				t.Fatalf("a request sent: %v", r)
			}
		}
		return named, unnamed
	}
	if named, unnamed := sent(); named != 2 || unnamed != 1 {
		t.Fatalf("the sender's requests: %d named, %d by the link", named, unnamed)
	}
	// Asked by the link again, nothing new.
	sender.call("POST", "/api/friends/requests", byLink)
	if named, unnamed := sent(); named != 2 || unnamed != 1 {
		t.Fatalf("asked by the link again: %d named, %d by the link", named, unnamed)
	}

	// The sharer has both; a no to the one by the link leaves it in the sender's list, and the one by tag stands.
	_, theirs := sharer.call("GET", "/api/friends", nil)
	in := theirs["requests"].(map[string]any)["in"].([]any)
	if len(in) != 2 {
		t.Fatalf("the sharer's requests: %v", in)
	}
	for _, r := range in {
		if r := r.(map[string]any); r["via"] != nil {
			if status, _ := sharer.call("DELETE", fmt.Sprintf("/api/friends/requests/%d", int64(r["id"].(float64))), nil); status != 200 {
				t.Fatalf("saying no: %d", status)
			}
		}
	}
	if named, unnamed := sent(); named != 2 || unnamed != 1 {
		t.Fatalf("after a no to the one by the link: %d named, %d by the link", named, unnamed)
	}
	if _, theirs := sharer.call("GET", "/api/friends", nil); len(theirs["requests"].(map[string]any)["in"].([]any)) != 1 {
		t.Fatalf("the sharer's requests after the no: %v", theirs["requests"])
	}

	// A friend of the sharer's asking by the link has a request in their list as anyone does; the sharer sees none.
	pal := playedDay(g)
	befriend(sharer, pal)
	if status, _ := pal.call("POST", "/api/friends/requests", byLink); status != 200 {
		t.Fatalf("a friend asking by the link: %d", status)
	}
	if out := requestsOut(pal); len(out) != 1 || out[0]["via"] == nil || out[0]["tag"] != nil {
		t.Fatalf("a friend's requests by the link: %v", out)
	}
	_, theirs = sharer.call("GET", "/api/friends", nil)
	for _, r := range theirs["requests"].(map[string]any)["in"].([]any) {
		if r.(map[string]any)["tag"] == tagOf(pal) {
			t.Fatalf("the sharer sees a friend's request by the link: %v", r)
		}
	}

	// One the sharer had asked first, asking by the link, isn't their friend at once: that would name the sharer.
	asked := playedDay(g)
	played(sharer)
	sharer.call("POST", "/api/friends/requests", map[string]string{"to": "@" + tagOf(asked)})
	if status, _ := asked.call("POST", "/api/friends/requests", byLink); status != 200 {
		t.Fatalf("asked first, asking by the link: %d", status)
	}
	if _, f := asked.call("GET", "/api/friends", nil); len(f["friends"].([]any)) != 0 {
		t.Fatalf("friends at once by the link: %v", f["friends"])
	}
}

// Called off and made again, a request by a link is one asker of its play.SharerAsks still.
func TestAskingByALinkCountsOnce(t *testing.T) {
	g := start(t)
	_, link := sharedLink(g)
	sender := playedDay(g)
	for range 3 {
		if status, out := sender.call("POST", "/api/friends/requests", map[string]string{"link": link}); status != 200 {
			t.Fatalf("asking by the link: %d %v", status, out)
		}
		out := requestsOut(sender)
		if len(out) != 1 {
			t.Fatalf("the sender's requests: %v", out)
		}
		if status, _ := sender.call("DELETE", fmt.Sprintf("/api/friends/requests/%d", int64(out[0]["id"].(float64))), nil); status != 200 {
			t.Fatalf("calling it off: %d", status)
		}
	}
	var n int
	if err := g.db.Read.QueryRow(`SELECT count(*) FROM share_asks`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("the link has %d askers (%v), want 1", n, err)
	}
}

// Yesterday's link asks its owner only in the grace after midnight (play.DayGrace), as a game of yesterday's can still
// be finished then; after it, it's a link of a day gone by.
func TestYesterdaysLinkInTheGrace(t *testing.T) {
	g := start(t)
	_, link := sharedLink(g)
	sender := playedDay(g)
	d, _ := time.ParseInLocation(time.DateOnly, play.DayShift(g.srv.game.Today(), 1), play.Bulgaria)
	g.srv.game.Settled(t.Context()) // the games' work after them done: nothing reads the clock while it's set
	g.srv.game.Now = func() time.Time { return d.Add(play.DayGrace + time.Minute) }
	if status, out := sender.call("POST", "/api/friends/requests", map[string]string{"link": link}); status != 404 ||
		out["error"] != "no_link" {
		t.Fatalf("yesterday's link after the grace: %d %v", status, out)
	}
	g.srv.game.Now = func() time.Time { return d.Add(play.DayGrace - time.Minute) }
	if status, out := sender.call("POST", "/api/friends/requests", map[string]string{"link": link}); status != 200 {
		t.Fatalf("yesterday's link in the grace: %d %v", status, out)
	}
}
