package server

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/bank/banktest"
	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/store"
	"github.com/almanac-bg/almanac/internal/store/storetest"
)

type inbox struct {
	mu  sync.Mutex
	got []mail.Message
}

func (i *inbox) Send(_ context.Context, _ string, m mail.Message) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.got = append(i.got, m)
	return nil
}

type game struct {
	t      *testing.T
	srv    *Server
	db     *store.DB
	url    string
	outbox *mail.Outbox
	inbox  *inbox
}

func start(t *testing.T) *game {
	t.Helper()
	db := storetest.Open(t)
	b := banktest.Sample(t)
	in := &inbox{}
	out := mail.NewOutbox(db, in, "АЛМАНАХ <no-reply@almanac.bg>")
	accounts := &account.Accounts{DB: db, Outbox: out, Secret: []byte("test")}
	ts := httptest.NewUnstartedServer(nil)
	s, err := New(Config{PublicURL: "http://" + ts.Listener.Addr().String(), Version: "test", MTASTS: []string{"mx.example"}},
		Deps{DB: db, Accounts: accounts, Outbox: out, Bank: b})
	if err != nil {
		t.Fatal(err)
	}
	ts.Config.Handler = s.Handler()
	ts.Start()
	// Run in reverse: the server stops taking requests, then what it started in the background ends, then the
	// database closes (storetest).
	t.Cleanup(func() { s.game.Settled(context.Background()) })
	t.Cleanup(ts.Close)
	return &game{t: t, srv: s, db: db, url: ts.URL, outbox: out, inbox: in}
}

// player is a browser: it keeps its cookies.
type player struct {
	g      *game
	client *http.Client
	ua     string // the User-Agent it sends, if any
}

func (g *game) player() *player {
	jar, _ := cookiejar.New(nil)
	return &player{g: g, client: &http.Client{Jar: jar}}
}

// call sends a request as the page would, and decodes the answer.
func (p *player) call(method, path string, body any) (int, map[string]any) {
	p.g.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = strings.NewReader(string(b))
	}
	req, _ := http.NewRequest(method, p.g.url+path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	if p.ua != "" {
		req.Header.Set("User-Agent", p.ua)
	}
	res, err := p.client.Do(req)
	if err != nil {
		p.g.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func name(out map[string]any) string {
	u, _ := out["user"].(map[string]any)
	n, _ := u["name"].(string)
	return n
}

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.DiscardHandler))
	os.Exit(m.Run())
}

// A wrong code says how many tries are left once they're few; the last used, the code is dead and a new one goes at
// once.
func TestCodeTries(t *testing.T) {
	g := start(t)
	p := g.player()
	email := map[string]string{"email": "tries@example.com"}
	if status, out := p.call("POST", "/api/auth/code", email); status != 200 || out["again"] != float64(60) ||
		out["digits"] != float64(account.CodeDigits) {
		t.Fatalf("sending a code: %d %v", status, out)
	}
	wrong := map[string]string{"email": "tries@example.com", "code": "x"}
	for _, want := range []string{
		"Грешен код.", "Грешен код.", "Грешен код. Остават ти още 2 опита.", "Грешен код. Остава ти още 1 опит.",
	} {
		_, out := p.call("POST", "/api/auth/verify", wrong)
		if out["error"] != "bad_code" || out["message"] != want {
			t.Fatalf("a wrong code: %v, want %q", out, want)
		}
	}
	if _, out := p.call("POST", "/api/auth/verify", wrong); out["error"] != "code_tries" {
		t.Fatalf("the last try: %v", out)
	}
	if status, out := p.call("POST", "/api/auth/code", email); status != 200 {
		t.Fatalf("a new code once the old is dead: %d %v", status, out)
	}
}

// A code works only in the browser that asked for it (its ask cookie), and what others ask for with a player's
// address, from their own network, never uses up what the player may ask for (review 2026-11-17, S3).
func TestCodeIsTheBrowsers(t *testing.T) {
	g := start(t)
	mine, theirs := g.player(), g.player()
	mine.call("POST", "/api/auth/code", map[string]string{"email": "me@example.com"})
	g.outbox.Flush(t.Context())
	code := regexp.MustCompile(`\d{6}`).FindString(g.inbox.got[0].Text)
	if _, out := theirs.call("POST", "/api/auth/verify", map[string]string{"email": "me@example.com", "code": code}); out["error"] != "code_expired" {
		t.Fatalf("my code in another browser: %v", out)
	}
	if _, out := mine.call("POST", "/api/auth/verify", map[string]string{"email": "me@example.com", "code": code}); out["user"] == nil {
		t.Fatalf("my code in my browser: %v", out)
	}
	// The ask cookie is gone with the code.
	for _, c := range mine.client.Jar.Cookies(must(url.Parse(g.url))) {
		if c.Name == "ask" {
			t.Fatalf("the ask cookie stayed: %v", c)
		}
	}

	ask := func(from, email string) int {
		r := httptest.NewRequest("POST", g.url+"/api/auth/code", strings.NewReader(`{"email":"`+email+`"}`))
		r.RemoteAddr = from + ":1234"
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Sec-Fetch-Site", "same-origin")
		w := httptest.NewRecorder()
		g.srv.Handler().ServeHTTP(w, r)
		return w.Code
	}
	// One address gets a few codes an hour, from whatever networks ask (review 2026-11-18, S5): nobody floods an inbox.
	for i := range account.CodesPerAddressHour {
		if status := ask(fmt.Sprintf("198.51.%d.1", 100+i), "victim@example.com"); status != 200 {
			t.Fatalf("code %d to one address: %d", i+1, status)
		}
	}
	if status := ask("203.0.113.1", "victim@example.com"); status != 429 {
		t.Fatalf("a code past the address's hour, from yet another network: %d", status)
	}
	if status := ask("203.0.113.1", "other@example.com"); status != 200 {
		t.Fatalf("a code to another address: %d", status)
	}
}

// A class behind its school's one IPv4 address (or a carrier's) asks for its codes at once (review 2026-11-18, S9):
// a site's share of a minute (account.SiteShare) goes, and the rest the next minute, each told to try again then.
func TestCodesForAClass(t *testing.T) {
	g := start(t)
	ask := func(email string) int {
		r := httptest.NewRequest("POST", g.url+"/api/auth/code", strings.NewReader(`{"email":"`+email+`"}`))
		r.RemoteAddr = "198.51.100.1:1234"
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Sec-Fetch-Site", "same-origin")
		w := httptest.NewRecorder()
		g.srv.Handler().ServeHTTP(w, r)
		return w.Code
	}
	for {
		minute := time.Now().Unix() / 60
		i := 0
		for ; i < account.SiteShare; i++ {
			if status := ask(fmt.Sprintf("pupil%d@example.com", i)); status != 200 {
				break
			}
		}
		next := ask("late@example.com")
		if time.Now().Unix()/60 != minute {
			continue // the minute turned meanwhile: again
		}
		if i < account.SiteShare || next != http.StatusServiceUnavailable {
			t.Fatalf("%d of a class's codes went at once, then %d", i, next)
		}
		return
	}
}

// signIn signs a browser in with an email, by the code mailed to it.
func (p *player) signIn(email string) map[string]any {
	p.g.t.Helper()
	p.g.inbox.got = nil
	if status, out := p.call("POST", "/api/auth/code", map[string]string{"email": email}); status != 200 {
		p.g.t.Fatalf("sending a code: %d %v", status, out)
	}
	p.g.outbox.Flush(p.g.t.Context())
	code := regexp.MustCompile(`\d{6}`).FindString(p.g.inbox.got[0].Text)
	status, out := p.call("POST", "/api/auth/verify", map[string]string{"email": email, "code": code})
	if status != 200 {
		p.g.t.Fatalf("verify: %d %v", status, out)
	}
	return out
}

// „Излез от другите устройства“: every other browser signed in to the profile is signed out; this one stays.
func TestSignOutOthers(t *testing.T) {
	g := start(t)
	if status, out := g.player().call("POST", "/api/auth/signout-others", map[string]any{}); status != 401 {
		t.Fatalf("signed out the others of nobody: %d %v", status, out)
	}
	phone, laptop, tablet := g.player(), g.player(), g.player()
	for _, p := range []*player{phone, laptop, tablet} {
		p.signIn("many@example.com")
	}
	if status, out := laptop.call("POST", "/api/auth/signout-others", map[string]any{}); status != 200 ||
		out["ended"] != float64(2) {
		t.Fatalf("signed out the others: %d %v", status, out)
	}
	for p, in := range map[*player]bool{phone: false, laptop: true, tablet: false} {
		if _, out := p.call("GET", "/api/me", nil); (out["user"] != nil) != in {
			t.Fatalf("after signing out the others, a browser is %v", out)
		}
	}
}

func TestSignInFlow(t *testing.T) {
	g := start(t)
	p := g.player()
	if status, out := p.call("GET", "/api/me", nil); status != 200 || out["user"] != nil {
		t.Fatalf("a newcomer is %d %v", status, out)
	}
	if status, _ := p.call("PATCH", "/api/me", map[string]string{"name": "Нов"}); status != 401 {
		t.Fatalf("renaming without an account: %d", status)
	}
	_, out := p.call("POST", "/api/guest", map[string]any{})
	guest := name(out)
	if guest == "" {
		t.Fatalf("no guest: %v", out)
	}
	if _, out := p.call("GET", "/api/me", nil); name(out) != guest {
		t.Fatalf("the cookie didn't keep the guest: %v", out)
	}
	if status, out := p.call("PATCH", "/api/me", map[string]string{"name": "Звездоброец"}); status != 200 || name(out) != "Звездоброец" {
		t.Fatalf("rename: %d %v", status, out)
	}

	if status, out := p.call("POST", "/api/auth/code", map[string]string{"email": "nope"}); status != 400 || out["error"] != "bad_email" {
		t.Fatalf("a bad address: %d %v", status, out)
	}
	if status, _ := p.call("POST", "/api/auth/code", map[string]string{"email": "me@example.com"}); status != 200 {
		t.Fatalf("sending a code: %d", status)
	}
	g.outbox.Flush(t.Context())
	code := regexp.MustCompile(`\d{6}`).FindString(g.inbox.got[0].Text)
	if status, out := p.call("POST", "/api/auth/verify", map[string]string{"email": "me@example.com", "code": "x"}); status != 400 || out["error"] != "bad_code" {
		t.Fatalf("a wrong code: %d %v", status, out)
	}
	status, out := p.call("POST", "/api/auth/verify", map[string]string{"email": "me@example.com", "code": code})
	if status != 200 || name(out) != "Звездоброец" {
		t.Fatalf("verify: %d %v", status, out)
	}

	// Another browser, a guest there, signs in to the same account (a used code is gone: a new one may go at once).
	other := g.player()
	_, _ = other.call("POST", "/api/guest", map[string]any{})
	g.inbox.got = nil
	other.call("POST", "/api/auth/code", map[string]string{"email": "me@example.com"})
	if status, out := other.call("POST", "/api/auth/code", map[string]string{"email": "me@example.com"}); status != 429 ||
		!regexp.MustCompile(`след (1 секунда|[1-6]?[0-9] секунди)\.$`).MatchString(fmt.Sprint(out["message"])) {
		t.Fatalf("a second code at once: %d %v", status, out)
	}
	g.outbox.Flush(t.Context())
	code = regexp.MustCompile(`\d{6}`).FindString(g.inbox.got[0].Text)
	if _, out := other.call("POST", "/api/auth/verify", map[string]string{"email": "me@example.com", "code": code}); name(out) != "Звездоброец" {
		t.Fatalf("the other browser signed in as %v", out)
	}

	if status, out := p.call("POST", "/api/auth/signout", map[string]any{}); status != 200 || out["user"] != nil {
		t.Fatalf("sign out: %d %v", status, out)
	}
	if _, out := p.call("GET", "/api/me", nil); out["user"] != nil {
		t.Fatalf("still signed in: %v", out)
	}
}

func TestRefusesOtherSites(t *testing.T) {
	g := start(t)
	req, _ := http.NewRequest("POST", g.url+"/api/guest", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("a cross-site POST got %d", res.StatusCode)
	}
	// A form post can't pass for JSON.
	p := g.player()
	req, _ = http.NewRequest("POST", g.url+"/api/auth/code", strings.NewReader(`{"email":"a@b.bg"}`))
	req.Header.Set("Content-Type", "text/plain")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	res, _ = p.client.Do(req)
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("text/plain got %d", res.StatusCode)
	}
}

func TestPages(t *testing.T) {
	g := start(t)
	for path, want := range map[string]int{
		"/": 200, "/play": 404, "/play/history": 200, "/me": 200, "/duel/new": 200, "/duel/12": 404, "/duel/other": 404, "/duel": 404,
		"/play/mix": 200, "/play/nosuch": 404, "/players/nobody": 404, "/nowhere": 404, "/api/nowhere": 404,
		"/qimg/edf5f1c42d5e21e8.webp": 200, "/qimg/../../go.mod": 404, "/qimg/0000000000000000.webp": 404,
		"/privacy": 200, "/.well-known/security.txt": 200,
		// An app's page with a slash after it is that page; the slash after anything else isn't.
		"/almanac/": 200, "/almanac/history/": 200, "/almanac/nosuch/": 404, "/nowhere/": 404,
		// „Микс“ and „България“ are ways to play, not chapters of the book: no page of their own.
		"/almanac/mix": 404, "/almanac/bulgaria": 404,
	} {
		res, err := http.Get(g.url + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != want {
			t.Errorf("%s: %d, want %d", path, res.StatusCode, want)
		}
		if res.Header.Get("Content-Security-Policy") == "" || res.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s: missing security headers", path)
		}
		if want == 200 && !strings.HasPrefix(path, "/qimg/") && !strings.HasPrefix(path, "/privacy") &&
			!strings.HasPrefix(path, "/.well-known") && !strings.Contains(string(body), `id="boot"`) {
			t.Errorf("%s: not the app's page", path)
		}
	}
	res, _ := http.Post(g.url+"/", "text/plain", nil)
	res.Body.Close()
	if res.StatusCode != http.StatusMethodNotAllowed && res.StatusCode != http.StatusForbidden {
		t.Errorf("POST /: %d", res.StatusCode)
	}
}

func TestSearchEngines(t *testing.T) {
	g := start(t)
	get := func(path string) (*http.Response, string) {
		res, err := http.Get(g.url + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res, string(body)
	}
	if res, body := get("/robots.txt"); res.StatusCode != 200 || !strings.Contains(body, "Disallow: /api/") ||
		!strings.Contains(body, "Sitemap: "+g.url+"/sitemap.xml") {
		t.Errorf("robots.txt: %d %q", res.StatusCode, body)
	}
	if res, body := get("/sitemap.xml"); res.StatusCode != 200 || !strings.Contains(body, "<loc>"+g.url+"/</loc>") ||
		!strings.Contains(body, "<loc>"+g.url+"/privacy</loc>") || strings.Count(body, "<loc>") != 2 {
		t.Errorf("sitemap.xml: %d %q", res.StatusCode, body)
	}
	res, body := get("/")
	if res.Header.Get("X-Robots-Tag") != "" || !strings.Contains(body, `<link rel="canonical" href="`+g.url+`/">`) {
		t.Errorf("/: X-Robots-Tag %q, canonical missing: %v", res.Header.Get("X-Robots-Tag"), !strings.Contains(body, "canonical"))
	}
	if res, _ := get("/privacy"); res.Header.Get("X-Robots-Tag") != "" {
		t.Errorf("/privacy: X-Robots-Tag %q", res.Header.Get("X-Robots-Tag"))
	}
	for _, path := range []string{"/me", "/friends", "/play/history", "/players/someone", "/nowhere"} {
		res, body := get(path)
		if res.Header.Get("X-Robots-Tag") != "noindex" || strings.Contains(body, "canonical") {
			t.Errorf("%s: X-Robots-Tag %q", path, res.Header.Get("X-Robots-Tag"))
		}
	}
}

func TestBootDataIsSafeInTheScript(t *testing.T) {
	g := start(t)
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	// A name can't hold < or >, but the boot data must stay inert whatever it holds.
	req, _ := http.NewRequest("GET", g.url+"/", nil)
	res, _ := p.client.Do(req)
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	start := strings.Index(string(body), `<script type="application/json" id="boot">`)
	end := strings.Index(string(body)[start:], "</script>")
	boot := string(body)[start+len(`<script type="application/json" id="boot">`) : start+end]
	var v map[string]any
	if err := json.Unmarshal([]byte(boot), &v); err != nil || v["user"] == nil || v["categories"] == nil {
		t.Fatalf("boot data %q: %v", boot, err)
	}
}

func TestPlayingOverHTTP(t *testing.T) {
	g := start(t)
	p := g.player()
	if status, _ := p.call("POST", "/api/day", map[string]any{}); status != 401 {
		t.Fatalf("playing without even a guest: %d", status)
	}
	p.call("POST", "/api/guest", map[string]any{})
	// A first day: no game finished before it.
	if _, today := p.call("GET", "/api/day", nil); today["firstDay"] != true {
		t.Fatalf("not a first day before a game: %v", today["firstDay"])
	}
	status, run := p.call("POST", "/api/day", map[string]any{})
	if status != 200 || run["total"] != float64(10) {
		t.Fatalf("start: %d %v", status, run)
	}
	id := strconv.Itoa(int(run["id"].(float64)))
	// A topic left with its question showing, to come back to (the day is no such game: Начало has it).
	_, topic := p.call("POST", "/api/topic", map[string]any{"category": "history"})
	p.call("POST", "/api/runs/"+strconv.Itoa(int(topic["id"].(float64)))+"/show", map[string]any{})
	if status, out := p.call("GET", "/api/runs/left", nil); status != 200 || len(out["runs"].([]any)) != 1 ||
		out["runs"].([]any)[0].(map[string]any)["category"] != "history" || out["runs"].([]any)[0].(map[string]any)["open"] != true {
		t.Fatalf("left: %d %v", status, out)
	}
	for n := range 10 {
		_, st := p.call("POST", "/api/runs/"+id+"/show", map[string]any{})
		if st["question"].(map[string]any)["startsMs"] != nil { // its pictures in
			_, st = p.call("POST", "/api/runs/"+id+"/start", map[string]any{"n": n})
		}
		q := st["question"].(map[string]any)
		view := q["view"].(map[string]any)
		var answer any
		switch view["type"] {
		case "choice":
			answer = map[string]int{"pick": 0}
		case "number":
			answer = map[string]float64{"value": 1}
		case "order":
			answer = map[string][]int{"order": {0, 1, 2, 3}}
		case "truefalse":
			answer = map[string]bool{"truth": true}
		case "match":
			answer = map[string][]int{"pairs": {0, 1, 2, 3}}
		case "split":
			answer = map[string][]int{"sides": {0, 1, 0, 1, 0, 1}}
		}
		status, res := p.call("POST", "/api/runs/"+id+"/answer", map[string]any{"n": n, "answer": answer})
		if status != 200 || res["reveal"] == nil {
			t.Fatalf("answer %d: %d %v", n, status, res)
		}
		if n == 4 {
			if status, _ := p.call("GET", "/api/runs/"+id+"/review", nil); status != 409 {
				t.Fatalf("a review before the end: %d", status)
			}
		}
	}
	if status, out := p.call("GET", "/api/runs/"+id+"/review", nil); status != 200 || len(out["questions"].([]any)) != 10 {
		t.Fatalf("review: %d %v", status, out)
	}
	_, today := p.call("GET", "/api/day", nil)
	if today["run"].(map[string]any)["done"] != true || today["streak"] != float64(1) || today["firstDay"] != true {
		t.Fatalf("today: %v", today)
	}
	// The day done, the entry its right answers wrote is asked for the result (none for no right answer with a fact);
	// with nobody else playing it, it says plainly that there's no crowd, and nothing of others.
	if entry, asked := today["entry"]; !asked {
		t.Fatalf("today's entry not asked for: %v", today)
	} else if e, ok := entry.(map[string]any); entry != nil && (!ok || e["crowd"] != false || e["right"] != float64(0) || e["fact"] == nil) {
		t.Fatalf("today's entry, with nobody else: %v", entry)
	}
	// The day done, „Утре“ names the chapter of tomorrow's hard question, its last, once tomorrow is drawn (ahead.go;
	// the sample bank is too small for days ahead, so tomorrow is today's ten turned round).
	if _, today := p.call("GET", "/api/day", nil); today["tomorrowHard"] != nil {
		t.Fatalf("tomorrow's hard question, before it's drawn: %v", today["tomorrowHard"])
	}
	day, _ := time.Parse(time.DateOnly, g.srv.game.Today())
	tomorrow := day.AddDate(0, 0, 1).Format(time.DateOnly)
	if _, err := g.db.Write.Exec(`INSERT INTO days (day, questions) SELECT ?, (SELECT json_group_array(json(value))
		FROM (SELECT value FROM json_each(questions) ORDER BY key DESC)) FROM days WHERE day = ?`, tomorrow, day.Format(time.DateOnly)); err != nil {
		t.Fatal(err)
	}
	next, err := g.srv.game.IssueTopics(context.Background(), tomorrow)
	if err != nil || len(next) != 10 {
		t.Fatalf("tomorrow's issue: %v %v", next, err)
	}
	if _, today := p.call("GET", "/api/day", nil); today["tomorrowHard"] != next[9] {
		t.Fatalf("tomorrow's hard question: %v, want %s", today["tomorrowHard"], next[9])
	}
	// Nothing adds up but the book and the streak: Начало has no level.
	if lv, ok := today["level"]; ok {
		t.Fatalf("today's level: %v", lv)
	}
	friend := g.player()
	friend.call("POST", "/api/guest", map[string]any{})
	if status, _ := friend.call("GET", "/api/runs/"+id, nil); status != 404 {
		t.Fatalf("someone else's run: %d", status)
	}
}

func TestDeletingAnAccount(t *testing.T) {
	g := start(t)
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	_, run := p.call("POST", "/api/day", map[string]any{})
	if status, _ := p.call("DELETE", "/api/me", nil); status != 200 {
		t.Fatalf("delete: %d", status)
	}
	if _, me := p.call("GET", "/api/me", nil); me["user"] != nil {
		t.Fatalf("still there: %v", me)
	}
	other := g.player()
	other.call("POST", "/api/guest", map[string]any{})
	if status, _ := other.call("GET", "/api/runs/"+strconv.Itoa(int(run["id"].(float64))), nil); status != 404 {
		t.Fatalf("the deleted player's run: %d", status)
	}
}

func TestBrowserErrorsBecomeProblems(t *testing.T) {
	g := start(t)
	p := g.player()
	for range 3 {
		if status, _ := p.call("POST", "/api/errors", map[string]string{"message": "x is undefined", "where": "app.js:1:2"}); status != 200 {
			t.Fatalf("report: %d", status)
		}
	}
	if status, _ := p.call("POST", "/api/errors", map[string]any{"message": 1}); status != 400 {
		t.Fatalf("a broken report: %d", status)
	}
}

func TestHosts(t *testing.T) {
	g := start(t)
	_, port, _ := strings.Cut(strings.TrimPrefix(g.url, "http://"), ":")
	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	get := func(host, path string) (*http.Response, string) {
		req, _ := http.NewRequest("GET", g.url+path, nil)
		req.Host = host + ":" + port
		res, err := noRedirect.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res, string(body)
	}
	if res, _ := get("www.127.0.0.1", "/friends?x=1"); res.StatusCode != 301 || res.Header.Get("Location") != g.url+"/friends?x=1" {
		t.Errorf("www: %d %s", res.StatusCode, res.Header.Get("Location"))
	}
	if res, body := get("mta-sts.127.0.0.1", "/.well-known/mta-sts.txt"); res.StatusCode != 200 ||
		body != "version: STSv1\r\nmode: testing\r\nmx: mx.example\r\nmax_age: 604800\r\n" {
		t.Errorf("mta-sts: %d %q", res.StatusCode, body)
	}
	if res, _ := get("mta-sts.127.0.0.1", "/"); res.StatusCode != 404 {
		t.Errorf("mta-sts /: %d", res.StatusCode)
	}
	if res, _ := get("evil.example", "/"); res.StatusCode != 404 {
		t.Errorf("another site's name: %d", res.StatusCode)
	}
}

func TestReportsAndTheAdminPage(t *testing.T) {
	g := start(t)
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	if status, _ := p.call("POST", "/api/questions/geo-001/report", map[string]string{"text": "Отговорът е остарял от 2025 г."}); status != 200 {
		t.Fatalf("report: %d", status)
	}
	if status, _ := p.call("POST", "/api/questions/geo-001/report", map[string]string{"text": "x"}); status != 400 {
		t.Fatalf("a report of one letter: %d", status)
	}
	if status, _ := p.call("POST", "/api/questions/nope-1/report", map[string]string{"text": "няма го"}); status != 404 {
		t.Fatalf("no such question: %d", status)
	}
	at := func(path string) (int, string) {
		req, _ := http.NewRequest("GET", g.url+path, nil)
		res, err := p.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res.StatusCode, string(body)
	}
	page := func() (int, string) { return at("/admin/questions") }
	// To a player, the game's own page that isn't there, not Go's bare one.
	for _, path := range []string{"/admin", "/admin/questions"} {
		if status, body := at(path); status != 404 || !strings.Contains(body, `id="boot"`) {
			t.Fatalf("%s for a player: %d %.80s", path, status, body)
		}
	}
	_, _ = g.db.Write.Exec(`UPDATE users SET admin = 1`)
	status, body := page()
	if status != 200 || !strings.Contains(body, "Отговорът е остарял") || !strings.Contains(body, "Мусала") {
		t.Fatalf("the admin page: %d %s", status, body)
	}
	_, main := at("/admin")
	for _, part := range []string{"По дни", "След 30 дни", `<td>` + short(g.srv.game.Today()) + `</td>`, "Играчи",
		`href="/admin/questions"`} {
		if !strings.Contains(main, part) {
			t.Fatalf("the admin page has no %q", part)
		}
	}
	req, _ := http.NewRequest("POST", g.url+"/admin/reports/geo-001/resolve", nil)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	res, err := p.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if _, body := page(); !strings.Contains(body, "Няма нови") {
		t.Fatal("the report is still open")
	}
	// How the questions go: geo-002 always missed, gen-001 always right, geo-001 too few answers to tell.
	res2, err := g.db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at) SELECT id, 'topic', '[]', 0 FROM users LIMIT 1`)
	if err != nil {
		t.Fatal(err)
	}
	run, _ := res2.LastInsertId()
	for i, q := range []struct {
		id    string
		right bool
		n     int
	}{{"geo-002", false, 10}, {"gen-001", true, 12}, {"geo-001", false, 9}} {
		for k := range q.n {
			if _, err := g.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, score, is_right, ms, at)
				VALUES (?, ?, ?, 0, ?, 3000, 0)`, run, 100*i+k, q.id, q.right); err != nil {
				t.Fatal(err)
			}
		}
	}
	_, body = page()
	hardest, easiest, _ := strings.Cut(body[strings.Index(body, "Най-трудните"):], "Най-лесните")
	first := func(part, a, b string) bool { // a is in part, before b
		i, j := strings.Index(part, a+" ·"), strings.Index(part, b+" ·")
		return i >= 0 && j >= 0 && i < j
	}
	if !first(hardest, "geo-002", "gen-001") || !first(easiest, "gen-001", "geo-002") ||
		!strings.Contains(hardest, "<td class=\"num\">10</td><td class=\"num\">0&nbsp;%</td>") || strings.Contains(body, "geo-001 ·") {
		t.Fatalf("the hardest and the easiest: %s", body)
	}
}

// fakePushService takes pushes and counts them, with the topic of each path's last; or answers a path with its status
// (answer), uncounted.
type fakePushService struct {
	mu     sync.Mutex
	hits   map[string]int
	answer map[string]int
	topics map[string]string
}

func (f *fakePushService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if status := f.answer[r.URL.Path]; status != 0 {
		w.WriteHeader(status)
		return
	}
	f.hits[r.URL.Path]++
	if f.topics == nil {
		f.topics = map[string]string{}
	}
	f.topics[r.URL.Path] = r.Header.Get("Topic")
	w.WriteHeader(http.StatusCreated)
}

// answering makes the fake answer a path with a status (0: take its pushes again).
func (f *fakePushService) answering(path string, status int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.answer == nil {
		f.answer = map[string]int{}
	}
	f.answer[path] = status
}

func (f *fakePushService) topic(path string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.topics[path]
}

func (f *fakePushService) count(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[path]
}

// pushWorld is a game whose notifications go to a fake push service, with a way for a player to subscribe to them
// there (at path: what the fake counts the pushes by).
func pushWorld(t *testing.T) (*Server, *game, *fakePushService, func(p *player, path string)) {
	t.Helper()
	fake := &fakePushService{hits: map[string]int{}}
	ps := httptest.NewTLSServer(fake)
	t.Cleanup(ps.Close)
	pub, priv, _ := push.NewKeys()
	keys, _ := push.ParseKeys(pub, priv)

	db := storetest.Open(t)
	b := banktest.Sample(t)
	out := mail.NewOutbox(db, &inbox{}, "a@almanac.bg")
	ts := httptest.NewUnstartedServer(nil)
	s, err := New(Config{PublicURL: "http://" + ts.Listener.Addr().String(), Push: &push.Sender{Keys: keys, Subject: "mailto:a@b.bg", Client: ps.Client(),
		Services: []string{ps.Listener.Addr().String()}}},
		Deps{DB: db, Accounts: &account.Accounts{DB: db, Outbox: out, Secret: []byte("x")}, Outbox: out, Bank: b})
	if err != nil {
		t.Fatal(err)
	}
	s.game.Now = daytime()
	ts.Config.Handler = s.Handler()
	ts.Start()
	t.Cleanup(ts.Close)
	g := &game{t: t, srv: s, db: db, url: ts.URL}

	// The page offers notifications, with the key to subscribe with.
	if res, _ := http.Get(ts.URL + "/"); res != nil {
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if !strings.Contains(string(body), pub) {
			t.Fatal("the page doesn't carry the push key")
		}
	}
	subscribe := func(p *player, path string) {
		t.Helper()
		browser, _ := ecdh.P256().GenerateKey(rand.Reader)
		// As a browser sends it (PushSubscription.toJSON), expirationTime and all.
		sub := map[string]any{"endpoint": ps.URL + path, "expirationTime": nil, "keys": map[string]string{
			"p256dh": base64.RawURLEncoding.EncodeToString(browser.PublicKey().Bytes()),
			"auth":   base64.RawURLEncoding.EncodeToString([]byte("0123456789abcdef")),
		}}
		if status, _ := p.call("POST", "/api/push", sub); status != 200 {
			t.Fatalf("subscribe: %d", status)
		}
	}
	return s, g, fake, subscribe
}

// playRun answers each question of a run (any answer will do).
func playRun(p *player, run map[string]any) {
	id := strconv.Itoa(int(run["id"].(float64)))
	for n := range 10 {
		_, st := p.call("POST", "/api/runs/"+id+"/show", map[string]any{})
		// Answered at a person's pace, three seconds in, or the game is a script's that only its player sees
		// (play/fair.go).
		if _, err := p.g.db.Write.Exec(`UPDATE runs SET shown_at = ? WHERE id = ?`,
			p.g.srv.game.Now().Add(-3*time.Second).UnixMilli(), id); err != nil {
			p.g.t.Fatal(err)
		}
		view := st["question"].(map[string]any)["view"].(map[string]any)
		a := map[string]any{"pick": 0}
		switch view["type"] {
		case "number":
			a = map[string]any{"value": 1}
		case "order":
			a = map[string]any{"order": []int{0, 1, 2, 3}}
		case "truefalse":
			a = map[string]any{"truth": true}
		case "match":
			a = map[string]any{"pairs": []int{0, 1, 2, 3}}
		case "split":
			a = map[string]any{"sides": []int{0, 1, 0, 1, 0, 1}}
		}
		p.call("POST", "/api/runs/"+id+"/answer", map[string]any{"n": n, "answer": a})
	}
}

// guest is a new player, as a guest; with their id.
func (g *game) guest() (*player, int64) {
	p := g.player()
	_, out := p.call("POST", "/api/guest", map[string]any{})
	u, _ := out["user"].(map[string]any)
	id, _ := u["id"].(float64)
	return p, int64(id)
}

// befriend makes two players friends: b asks a by their tag (having finished a game: played), and a says yes.
func befriend(a, b *player) {
	played(b)
	b.call("POST", "/api/friends/requests", map[string]string{"to": "@" + tagOf(a)})
	acceptAll(a)
}

// played makes a player one who has finished a game (a topic's, a year ago, so that nothing of today's changes): a
// guest asks anyone to be friends only then.
func played(p *player) {
	p.g.t.Helper()
	_, me := p.call("GET", "/api/me", nil)
	at := time.Now().AddDate(-1, 0, 0).UnixMilli()
	if _, err := p.g.db.Write.Exec(`INSERT INTO runs (user_id, kind, category, questions, started_at, finished_at)
		VALUES (?, 'topic', 'history', '[]', ?, ?)`, me["user"].(map[string]any)["id"], at, at); err != nil {
		p.g.t.Fatal(err)
	}
}

// tagOf is a player's tag.
func tagOf(p *player) string {
	_, me := p.call("GET", "/api/me", nil)
	return me["user"].(map[string]any)["tag"].(string)
}

// acceptAll says yes to every friend request waiting for a player.
func acceptAll(a *player) {
	_, mine := a.call("GET", "/api/friends", nil)
	for _, r := range mine["requests"].(map[string]any)["in"].([]any) {
		id := int64(r.(map[string]any)["id"].(float64))
		if status, _ := a.call("POST", fmt.Sprintf("/api/friends/requests/%d/accept", id), map[string]any{}); status != 200 {
			a.g.t.Fatalf("accepting a request: %d", status)
		}
	}
}

func TestNotifications(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	db := g.db
	ana, bo := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	subscribe(ana, "/ana")
	subscribe(bo, "/bo")
	if status, _ := ana.call("POST", "/api/push", map[string]any{"endpoint": "http://plain.example/x"}); status != 400 {
		t.Fatalf("a bad subscription: %d", status)
	}
	// Well-formed, but not at a push service: the server would post wherever it says.
	outside := map[string]any{"endpoint": "https://169.254.169.254/x", "keys": map[string]string{
		"p256dh": base64.RawURLEncoding.EncodeToString(make([]byte, 65)), "auth": base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
	}}
	if status, _ := ana.call("POST", "/api/push", outside); status != 400 {
		t.Fatalf("a subscription outside the push services: %d", status)
	}

	// Ana plays the day; at 19:05 only Bo is reminded, and only once.
	_, run := ana.call("POST", "/api/day", map[string]any{})
	playRun(ana, run)
	evening := time.Date(2030, 1, 1, 19, 5, 0, 0, bulgaria())
	_, _ = db.Write.Exec(`UPDATE runs SET day = ?`, evening.Format(time.DateOnly))
	if n := s.remindSent(t.Context(), evening); n != 1 || fake.count("/bo") != 1 || fake.count("/ana") != 0 {
		t.Fatalf("reminded %d; bo %d, ana %d", n, fake.count("/bo"), fake.count("/ana"))
	}
	if n := s.remindSent(t.Context(), evening.Add(time.Minute)); n != 0 {
		t.Fatal("reminded twice in a day")
	}
	if n := s.remindSent(t.Context(), evening.Add(-2*time.Hour)); n != 0 {
		t.Fatal("reminded before the hour")
	}

	// Bo asks Ana to be friends by her tag: Ana hears of it, once however often he asks, and sees it waiting; she
	// accepts.
	pushes := func(path string, want int) {
		t.Helper()
		s.sendQueued(t.Context()) // queued by the request, before it answered
		if got := fake.count(path); got != want {
			t.Fatalf("%s: %d pushes, want %d", path, got, want)
		}
	}
	played(bo)
	for range 3 {
		bo.call("POST", "/api/friends/requests", map[string]string{"to": "@" + tagOf(ana)})
	}
	pushes("/ana", 1)
	if _, w := ana.call("GET", "/api/friends/requests", nil); w["requests"] != 1.0 {
		t.Fatalf("Ana's requests waiting: %v", w)
	}
	acceptAll(ana)
	pushes("/ana", 1)
	if _, w := ana.call("GET", "/api/friends/requests", nil); w["requests"] != 0.0 {
		t.Fatalf("Ana's requests waiting, after: %v", w)
	}
}

// Each player chooses the kinds of notification they get: the day's reminder, word from friends.
func TestPushKinds(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	bo, _ := g.guest()
	subscribe(ana, "/ana")
	subscribe(bo, "/bo")

	if _, out := ana.call("GET", "/api/push/prefs", nil); fmt.Sprint(out["prefs"]) != "map[day:true friends:true]" {
		t.Fatalf("the defaults: %v", out)
	}
	if status, _ := ana.call("PATCH", "/api/push/prefs", map[string]any{"kind": "news", "on": true}); status != 400 {
		t.Fatalf("an unknown kind: %d", status)
	}
	if _, out := ana.call("PATCH", "/api/push/prefs", map[string]any{"kind": "friends", "on": false}); fmt.Sprint(out["prefs"]) != "map[day:true friends:false]" {
		t.Fatalf("friends off: %v", out)
	}
	bo.call("PATCH", "/api/push/prefs", map[string]any{"kind": "day", "on": false})

	// Bo turned the day's reminder off: only Ana hears it.
	evening := time.Date(2030, 1, 1, 19, 5, 0, 0, bulgaria())
	if n := s.remindSent(t.Context(), evening); n != 1 || fake.count("/ana") != 1 || fake.count("/bo") != 0 {
		t.Fatalf("reminded %d; ana %d, bo %d", n, fake.count("/ana"), fake.count("/bo"))
	}
	// Ana turned word from friends off; the day's reminders she still gets.
	m := push.Message{Title: "Т", Body: "Т", URL: "/"}
	s.notifySent(t.Context(), pushFriends, m, anaID)
	if got := fake.count("/ana"); got != 1 {
		t.Fatalf("ana got %d pushes, want 1", got)
	}
	s.notifySent(t.Context(), pushDay, m, anaID)
	if got := fake.count("/ana"); got != 2 {
		t.Fatalf("ana got %d pushes, want 2", got)
	}
}

// The evening's reminder names the best friend who has played the day's questions, with the player's streak.
func TestReminderNamesAFriend(t *testing.T) {
	s, g, _, _ := pushWorld(t)
	ctx := t.Context()
	ana, _ := g.guest()
	bo, boID := g.guest()
	_, cyID := g.guest()
	_, me := ana.call("GET", "/api/me", nil)
	anaName := name(me)
	today := s.game.Today()

	// Nobody has played: as before.
	if m := s.reminder(ctx, today, boID); m.Body != "Десет въпроса, един опит. До полунощ." || m.URL != "/" {
		t.Fatalf("without friends: %+v", m)
	}
	// Bo played yesterday: a streak of a day.
	_, run := bo.call("POST", "/api/day", map[string]any{})
	playRun(bo, run)
	yesterday := s.game.Now().In(play.Bulgaria).AddDate(0, 0, -1).Format(time.DateOnly)
	if _, err := g.db.Write.Exec(`UPDATE runs SET day = ? WHERE user_id = ?`, yesterday, boID); err != nil {
		t.Fatal(err)
	}
	if m := s.reminder(ctx, today, boID); m.Body != "Серията ти е 1 ден. Десет въпроса, до полунощ." {
		t.Fatalf("with a streak: %+v", m)
	}
	// Ana, Bo's friend, plays today: Bo hears how she did.
	befriend(ana, bo)
	_, run = ana.call("POST", "/api/day", map[string]any{})
	playRun(ana, run)
	_, board := ana.call("GET", "/api/day", nil)
	rights := -1
	for _, r := range board["board"].(map[string]any)["top"].([]any) {
		if r := r.(map[string]any); r["name"] == anaName {
			rights = int(r["rights"].(float64))
		}
	}
	if want := fmt.Sprintf("%s позна %d от 10 днес. Серията ти е 1 ден.", anaName, rights); s.reminder(ctx, today, boID).Body != want {
		t.Fatalf("with a friend: %q, want %q", s.reminder(ctx, today, boID).Body, want)
	}
	// Cy isn't Ana's friend, and has no streak.
	if m := s.reminder(ctx, today, cyID); m.Body != "Десет въпроса, един опит. До полунощ." {
		t.Fatalf("someone else's friend: %+v", m)
	}
}

func TestLinkPreviews(t *testing.T) {
	g := start(t)
	page := func(path string) string {
		res, err := http.Get(g.url + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return string(body)
	}
	if home := page("/"); !strings.Contains(home, `property="og:image" content="`+g.url+`/og.png"`) {
		t.Fatal("no preview picture")
	}
	p, id := g.guest()
	_, me := p.call("GET", "/api/me", nil)
	u := me["user"].(map[string]any)
	if _, err := g.db.Write.Exec(`INSERT INTO ranks (user_id, chapter, level, quarter, ink, day, told)
		VALUES (?1, 'history', 3, 0, 15, '2026-11-20', 3)`, id); err != nil {
		t.Fatal(err)
	}
	body := page("/players/" + u["tag"].(string))
	if !strings.Contains(body, u["name"].(string)+" (@"+u["tag"].(string)+") в АЛМАНАХ") {
		t.Fatal("a player's preview")
	}
	// Beside a name only the seal shows, never its rank's word; and nothing the page can't know of them.
	for _, word := range append([]string{"вание", "Играе всеки ден"}, rankWords()...) {
		if strings.Contains(body, word) {
			t.Fatalf("a player's preview says %q", word)
		}
	}
}

// rankWords are the seal's states' names.
func rankWords() []string {
	var words []string
	for _, r := range play.Ranks {
		words = append(words, r.Name)
	}
	return words
}

// A player who leaves mid-request (closes the page) isn't a server error nor a problem to mail.
func TestALeftRequestIsNoProblem(t *testing.T) {
	g := start(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	left := g.srv.apiHandler(func(_ http.ResponseWriter, r *http.Request) error { return r.Context().Err() })
	w := httptest.NewRecorder()
	left.ServeHTTP(w, httptest.NewRequestWithContext(ctx, "GET", "/api/me", nil))
	if w.Code != 499 {
		t.Fatalf("a left request: %d", w.Code)
	}
	if news, _ := g.srv.problems.take(); len(news) != 0 {
		t.Fatalf("a left request became a problem: %v", news)
	}
	// A page left before it came (a reload over it, one held through a restart) is no 500 either.
	r := httptest.NewRequestWithContext(ctx, "GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: g.srv.cookie, Value: "a-session"})
	w = httptest.NewRecorder()
	g.srv.page(w, r)
	if w.Code != 499 {
		t.Fatalf("a left page: %d", w.Code)
	}
}

func TestFriendsOverHTTP(t *testing.T) {
	g := start(t)
	ana, bo := g.player(), g.player()
	_, a := ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	anaTag := a["user"].(map[string]any)["tag"].(string)
	// A guest who hasn't finished a game asks nobody: a throwaway made to send requests sends none.
	if status, out := bo.call("POST", "/api/friends/requests", map[string]string{"to": "@" + anaTag}); status != http.StatusForbidden ||
		out["error"] != "play_first" {
		t.Fatalf("Bo asks before a game: %d %v", status, out)
	}
	if _, w := ana.call("GET", "/api/friends/requests", nil); w["requests"] != 0.0 {
		t.Fatalf("a request from a guest who hasn't played: %v", w)
	}
	played(ana)
	played(bo)
	if status, out := ana.call("POST", "/api/friends/requests", map[string]string{"to": "@" + anaTag}); status != http.StatusConflict ||
		out["error"] != "self" {
		t.Fatalf("Ana asks herself: %d %v", status, out)
	}
	if status, _ := bo.call("POST", "/api/friends/requests", map[string]string{"to": "@nosuchplayer"}); status != http.StatusNotFound {
		t.Fatalf("an unknown tag: %d", status)
	}
	// Bo asks by her tag: a request, waiting for Ana's yes.
	if status, out := bo.call("POST", "/api/friends/requests", map[string]string{"to": "@" + anaTag}); status != http.StatusOK ||
		out["name"] != name(a) || out["friends"] != nil {
		t.Fatalf("Bo asks: %d %v", status, out)
	}
	if _, mine := ana.call("GET", "/api/friends", nil); len(mine["friends"].([]any)) != 0 || mine["invite"] != nil {
		t.Fatalf("friends by a request alone: %v", mine)
	}
	acceptAll(ana)
	_, mine := ana.call("GET", "/api/friends", nil)
	if friends, _ := mine["friends"].([]any); len(friends) != 1 {
		t.Fatalf("Ana's friends: %v", mine)
	}
	if status, _ := bo.call("DELETE", fmt.Sprintf("/api/friends/%d", int64(a["user"].(map[string]any)["id"].(float64))), nil); status != http.StatusOK {
		t.Fatalf("unfriending: %d", status)
	}
	if _, his := bo.call("GET", "/api/friends", nil); len(his["friends"].([]any)) != 0 {
		t.Fatalf("still friends: %v", his)
	}
	// Unfriended, asking again is a request again, not the friendship back.
	if _, out := bo.call("POST", "/api/friends/requests", map[string]string{"to": "@" + anaTag}); out["friends"] != nil {
		t.Fatalf("Bo asks after: %v", out)
	}
	if _, mine := ana.call("GET", "/api/friends", nil); len(mine["friends"].([]any)) != 0 {
		t.Fatalf("back by a request alone: %v", mine)
	}
}

// Pushes that others cause are capped for whoever gets them: strangers asking to be friends, once a day each (asking
// again after a no tells nobody again), at most peoplePushes a day in all.
func TestPeoplePushesCapped(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana := g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	subscribe(ana, "/ana")
	asks := map[string]string{"to": "@" + tagOf(ana)}
	// A stranger asks, Ana says no, and the stranger asks again: one push.
	cy := g.player()
	cy.call("POST", "/api/guest", map[string]any{})
	played(cy)
	cy.call("POST", "/api/friends/requests", asks)
	_, mine := ana.call("GET", "/api/friends", nil)
	in := mine["requests"].(map[string]any)["in"].([]any)
	if status, _ := ana.call("DELETE", fmt.Sprintf("/api/friends/requests/%d", int64(in[0].(map[string]any)["id"].(float64))), nil); status != http.StatusOK {
		t.Fatalf("a no: %d", status)
	}
	cy.call("POST", "/api/friends/requests", asks)
	s.sendQueued(t.Context())
	if got := fake.count("/ana"); got != 1 {
		t.Fatalf("a stranger asking again after a no: %d pushes, want 1", got)
	}
	for range peoplePushes + 5 {
		p := g.player()
		p.call("POST", "/api/guest", map[string]any{})
		played(p)
		p.call("POST", "/api/friends/requests", asks)
	}
	s.sendQueued(t.Context())
	if got := fake.count("/ana"); got != peoplePushes {
		t.Fatalf("%d pushes, want %d", got, peoplePushes)
	}
}

// Anyone may see a player's profile by their tag; a signed-in viewer also sees how they stand with them, and only a
// friend gets the id to call them to a duel.
func TestProfilesOverHTTP(t *testing.T) {
	g := start(t)
	ana, bo := g.player(), g.player()
	_, a := ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	anaTag := a["user"].(map[string]any)["tag"].(string)
	_, run := ana.call("POST", "/api/topic", map[string]string{"category": "music"})
	id := strconv.Itoa(int(run["id"].(float64)))
	for n := range 10 {
		ana.call("POST", "/api/runs/"+id+"/show", map[string]any{})
		ana.call("POST", "/api/runs/"+id+"/start", map[string]any{"n": n}) // its pictures in, if it has any
		ana.call("POST", "/api/runs/"+id+"/answer", map[string]any{"n": n, "answer": nil})
	}

	status, p := g.player().call("GET", "/api/players/@"+strings.ToUpper(anaTag), nil)
	if status != http.StatusOK || p["name"] != name(a) || p["tag"] != anaTag || p["best"] != float64(0) ||
		p["friend"] != nil || p["id"] != nil || p["me"] != nil {
		t.Fatalf("Ana's profile, to someone not signed in: %d %v", status, p)
	}
	if _, ok := p["ranks"].([]any); !ok {
		t.Fatalf("no ranks: %v", p)
	}
	if _, p := ana.call("GET", "/api/players/"+anaTag, nil); p["me"] != true {
		t.Fatalf("Ana's own profile: %v", p)
	}
	if status, _ := bo.call("GET", "/api/players/nosuchplayer", nil); status != http.StatusNotFound {
		t.Fatalf("no such player: %d", status)
	}
	if status, _ := bo.call("GET", "/api/players/%21%21", nil); status != http.StatusNotFound {
		t.Fatalf("a tag that can't be: %d", status)
	}

	// A profile shows no achievements, no title, no level: they're gone (DECISIONS.md, „The redesign“).
	for _, gone := range []string{"achievements", "of", "title", "level", "mastery", "games", "answers", "days"} {
		if v, ok := p[gone]; ok {
			t.Errorf("Ana's profile has %s: %v", gone, v)
		}
	}
	if status, _ := ana.call("GET", "/api/me/progress", nil); status != http.StatusNotFound {
		t.Errorf("/api/me/progress: %d", status)
	}

	// Bo asks; Ana sees he asks, he sees he asked; once she accepts, they're friends and he may call her to a duel.
	played(bo)
	bo.call("POST", "/api/friends/requests", map[string]string{"to": "@" + anaTag})
	if _, p := bo.call("GET", "/api/players/"+anaTag, nil); p["friend"] != "asked" || p["request"] == nil {
		t.Fatalf("Ana, to Bo who asked: %v", p)
	}
	_, me := bo.call("GET", "/api/me", nil)
	boTag := me["user"].(map[string]any)["tag"].(string)
	_, p = ana.call("GET", "/api/players/"+boTag, nil)
	if p["friend"] != "asks" {
		t.Fatalf("Bo, to Ana whom he asked: %v", p)
	}
	ana.call("POST", fmt.Sprintf("/api/friends/requests/%d/accept", int64(p["request"].(float64))), map[string]any{})
	_, p = bo.call("GET", "/api/players/"+anaTag, nil)
	if p["friend"] != "yes" || p["id"] != nil || p["record"] == nil {
		t.Fatalf("Ana, to her friend Bo: %v", p)
	}

	res, err := http.Get(g.url + "/players/" + anaTag)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.Contains(string(body), `og:title" content="`+name(a)+` (@`+anaTag+`) в АЛМАНАХ"`) {
		t.Fatalf("the profile page: %d\n%s", res.StatusCode, body[:min(len(body), 1500)])
	}
}

// A new player starts as one animal: its name, its tag and the avatar drawn for them.
func TestGuestIsOneAnimal(t *testing.T) {
	if len(account.Animals) != len(play.Starters) {
		t.Fatalf("%d animals for %d starters", len(account.Animals), len(play.Starters))
	}
	for i, a := range account.Animals {
		if a.Shape != play.Starters[i] {
			t.Fatalf("animal %d is %q, the starter %q", i, a.Shape, play.Starters[i])
		}
	}
	g := start(t)
	for range 4 {
		p := g.player()
		_, out := p.call("POST", "/api/guest", map[string]any{})
		u, _ := out["user"].(map[string]any)
		id, _ := u["id"].(float64)
		a := account.AnimalOf(int64(id))
		name, _ := u["name"].(string)
		tag, _ := u["tag"].(string)
		if !strings.HasPrefix(name, a.Name+" ") || !strings.HasPrefix(tag, a.Tag) ||
			!strings.HasPrefix(play.DefaultAvatar(int64(id)), a.Shape+"-") {
			t.Fatalf("a guest %q @%s with the avatar %s", name, tag, play.DefaultAvatar(int64(id)))
		}
	}
}

// Any animal in any tone is a player's to choose, from the first day; nothing else is. The Алманах's first page has the
// notes in the book, none on a new player's.
func TestAvatarChosen(t *testing.T) {
	g := start(t)
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	if status, out := p.call("PATCH", "/api/me/look", map[string]any{"avatar": "lynx-natural"}); status != 200 ||
		out["avatar"] != "lynx-natural" {
		t.Fatalf("a lynx: %d %v", status, out)
	}
	// A chapter's art is earned at its Страница (play/rank.go).
	for _, bad := range []string{"crown-gold", "fox-gold/ring", "", "history-gold"} {
		if status, out := p.call("PATCH", "/api/me/look", map[string]any{"avatar": bad}); status != 400 ||
			out["error"] != "no_avatar" {
			t.Fatalf("%q: %d %v", bad, status, out)
		}
	}
	if _, a := p.call("GET", "/api/almanac", nil); a["notes"] != nil {
		t.Fatalf("a new player's notes: %v", a["notes"])
	}
}

// Whoever keeps the game finds a player on /admin, gives them back a drawn name, suspends them (signed out, no way
// back in) and lifts it; nobody else can.
func TestAdminPlayers(t *testing.T) {
	g := start(t)
	admin, eve := g.player(), g.player()
	admin.call("POST", "/api/guest", map[string]any{})
	_, e := eve.call("POST", "/api/guest", map[string]any{})
	eveID := int64(e["user"].(map[string]any)["id"].(float64))
	// A name from before the check: as though it had slipped in.
	if _, err := g.db.Write.Exec(`UPDATE users SET name = 'Екипът на АЛМАНАХ', tag = 'almanac_team' WHERE id = ?`, eveID); err != nil {
		t.Fatal(err)
	}
	do := func(p *player, method, path string) (int, string) {
		t.Helper()
		req, _ := http.NewRequest(method, g.url+path, nil)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		res, err := p.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res.StatusCode, string(body)
	}
	act := fmt.Sprintf("/admin/players/%d/", eveID)
	if status, _ := do(eve, "POST", act+"name"); status != 404 {
		t.Fatalf("a player renamed another: %d", status)
	}
	if _, err := g.db.Write.Exec(`UPDATE users SET admin = 1 WHERE id <> ?`, eveID); err != nil {
		t.Fatal(err)
	}
	status, body := do(admin, "GET", "/admin?player=almanac_team")
	if status != 200 || !strings.Contains(body, "Екипът на АЛМАНАХ") || !strings.Contains(body, "Смени името с изтеглено") ||
		!strings.Contains(body, "прилича на името на играта") {
		t.Fatalf("the player on /admin: %d %s", status, body)
	}
	if status, _ := do(admin, "POST", act+"name"); status != 200 { // followed to /admin
		t.Fatalf("a drawn name: %d", status)
	}
	_, me := eve.call("GET", "/api/me", nil)
	if u := me["user"].(map[string]any); u["drawn"] != true || u["tag"] == "almanac_team" {
		t.Fatalf("Eve after: %v", u)
	}
	if status, _ := do(admin, "POST", act+"suspend"); status != 200 {
		t.Fatalf("suspend: %d", status)
	}
	if status, _ := eve.call("GET", "/api/friends", nil); status != http.StatusUnauthorized {
		t.Fatalf("a suspended player still in: %d", status)
	}
	if _, body := do(admin, "GET", "/admin"); !strings.Contains(body, "Спрени профили (1)") {
		t.Fatal("no suspended player on /admin")
	}
	if status, _ := do(admin, "POST", act+"unsuspend"); status != 200 {
		t.Fatalf("unsuspend: %d", status)
	}
	if status, _ := do(admin, "POST", fmt.Sprintf("/admin/players/%d/suspend", eveID+1)); status != 404 && status != 409 {
		t.Fatalf("suspending nobody, or an admin: %d", status)
	}
}

// A name or tag is checked only when it changes: one a player has from before a check came in (or drawn) doesn't stop
// them saving the other.
func TestOwnNameIsntCheckedAgain(t *testing.T) {
	g := start(t)
	p, id := g.guest()
	if _, err := g.db.Write.Exec(`UPDATE users SET name = 'Курва', tag = 'kurva_1' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if status, out := p.call("PATCH", "/api/me", map[string]string{"name": " Курва ", "tag": "fox_saver"}); status != 200 ||
		name(out) != "Курва" {
		t.Fatalf("a new tag beside the name had: %d %v", status, out)
	}
	if status, out := p.call("PATCH", "/api/me", map[string]string{"name": "Звезда", "tag": "@Kurva_1"}); status != 400 {
		t.Fatalf("the old tag again, once given up: %d %v", status, out)
	}
	if _, err := g.db.Write.Exec(`UPDATE users SET tag = 'kurva_1' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if status, out := p.call("PATCH", "/api/me", map[string]string{"name": "Звезда", "tag": "@Kurva_1"}); status != 200 ||
		name(out) != "Звезда" {
		t.Fatalf("a new name beside the tag had: %d %v", status, out)
	}
	if status, out := p.call("PATCH", "/api/me", map[string]string{"name": "Курва"}); status != 400 {
		t.Fatalf("a rude name taken anew: %d %v", status, out)
	}
}

// A session used slides on, and its cookie with it, once a day at most: a guest who plays every day is never dropped
// by the browser 400 days after the cookie was first set.
func TestSessionCookieSlides(t *testing.T) {
	g := start(t)
	p, _ := g.guest()
	u, _ := url.Parse(g.url)
	token := ""
	for _, c := range p.client.Jar.Cookies(u) {
		if c.Name == g.srv.cookie {
			token = c.Value
		}
	}
	// set is the session cookie a request to path sets, if any.
	set := func(path string) *http.Cookie {
		t.Helper()
		req, _ := http.NewRequest("GET", g.url+path, nil)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		res, err := p.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		for _, c := range res.Cookies() {
			if c.Name == g.srv.cookie {
				return c
			}
		}
		return nil
	}
	dayAgo := func() {
		t.Helper()
		if _, err := g.db.Write.Exec(`UPDATE sessions SET seen_at = ?`, store.Ms(time.Now().Add(-25*time.Hour))); err != nil {
			t.Fatal(err)
		}
	}
	if c := set("/api/me"); c != nil {
		t.Fatalf("a session seen just now set again: %v", c)
	}
	for _, path := range []string{"/api/me", "/"} {
		dayAgo()
		if c := set(path); c == nil || c.Value != token || c.MaxAge != account.SessionDays*24*60*60 || !c.HttpOnly {
			t.Fatalf("%s: a day later, the cookie %v", path, c)
		}
		if c := set(path); c != nil {
			t.Fatalf("%s: set twice in a day: %v", path, c)
		}
	}
}

// A new name and a new tag are saved together or not at all: a tag taken leaves the name as it was.
func TestRenameIsWhole(t *testing.T) {
	g := start(t)
	p, _ := g.guest()
	other, _ := g.guest()
	if status, out := other.call("PATCH", "/api/me", map[string]string{"tag": "taken_tag"}); status != 200 {
		t.Fatalf("%d %v", status, out)
	}
	_, before := p.call("GET", "/api/me", nil)
	if status, out := p.call("PATCH", "/api/me", map[string]string{"name": "Нелина", "tag": "taken_tag"}); status != 409 {
		t.Fatalf("a taken tag: %d %v", status, out)
	}
	if _, now := p.call("GET", "/api/me", nil); name(now) != name(before) {
		t.Fatalf("the name saved without the tag: %q, was %q", name(now), name(before))
	}
	if status, out := p.call("PATCH", "/api/me", map[string]string{"name": "Нелина", "tag": "nelina"}); status != 200 ||
		name(out) != "Нелина" || out["user"].(map[string]any)["tag"] != "nelina" {
		t.Fatalf("%d %v", status, out)
	}
	if status, out := p.call("PATCH", "/api/me", map[string]string{"name": " "}); status != 400 {
		t.Fatalf("an empty name: %d %v", status, out)
	}
	if status, out := p.call("PATCH", "/api/me", map[string]string{"name": ""}); status != 400 {
		t.Fatalf("no name at all: %d %v", status, out)
	}
	if status, out := p.call("PATCH", "/api/me", map[string]string{"tag": "@"}); status != 400 {
		t.Fatalf("no tag at all: %d %v", status, out)
	}
}
