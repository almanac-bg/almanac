package server

import (
	"bufio"
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
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/store"
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
	db, err := store.Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
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
	t.Cleanup(ts.Close)
	return &game{t: t, srv: s, db: db, url: ts.URL, outbox: out, inbox: in}
}

// player is a browser: it keeps its cookies.
type player struct {
	g      *game
	client *http.Client
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
	if status, _ := other.call("POST", "/api/auth/code", map[string]string{"email": "me@example.com"}); status != 429 {
		t.Fatalf("a second code at once: %d", status)
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
		"/": 200, "/play": 404, "/play/history": 200, "/me": 200, "/duel/live": 200, "/duel/12": 200, "/duel/other": 404, "/nowhere": 404, "/api/nowhere": 404,
		"/qimg/edf5f1c42d5e21e8.webp": 200, "/qimg/../../go.mod": 404, "/qimg/0000000000000000.webp": 404,
		"/privacy": 200, "/.well-known/security.txt": 200,
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
	for _, path := range []string{"/me", "/ranks", "/play/history", "/r/123456", "/f/abcd1234", "/players/someone", "/nowhere"} {
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
	// Before a first game finished, Начало is the day and the topics only.
	if _, today := p.call("GET", "/api/day", nil); today["played"] != false {
		t.Fatalf("played before a game: %v", today["played"])
	}
	status, run := p.call("POST", "/api/day", map[string]any{})
	if status != 200 || run["total"] != float64(10) {
		t.Fatalf("start: %d %v", status, run)
	}
	id := strconv.Itoa(int(run["id"].(float64)))
	for n := range 10 {
		_, st := p.call("POST", "/api/runs/"+id+"/show", map[string]any{})
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
	if today["run"].(map[string]any)["done"] != true || today["streak"] != float64(1) || today["played"] != true {
		t.Fatalf("today: %v", today)
	}
	// Начало shows the level too: the day's ten have earned XP.
	if lv, _ := today["level"].(map[string]any); lv == nil || lv["level"].(float64) < 1 || lv["xp"].(float64) <= 0 {
		t.Fatalf("today's level: %v", today["level"])
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
	if res, _ := get("www.127.0.0.1", "/ranks?x=1"); res.StatusCode != 301 || res.Header.Get("Location") != g.url+"/ranks?x=1" {
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

// stream is a room's event stream as a browser reads it.
type stream struct {
	t   *testing.T
	r   *bufio.Reader
	res *http.Response
}

func (p *player) follow(code string) *stream {
	p.g.t.Helper()
	return p.stream("/api/rooms/" + code + "/events")
}

// stream opens an event stream at path.
func (p *player) stream(path string, lastID ...string) *stream {
	p.g.t.Helper()
	req, _ := http.NewRequest("GET", p.g.url+path, nil)
	for _, id := range lastID {
		req.Header.Set("Last-Event-ID", id) // as a browser sends it, coming back after the line dropped
	}
	res, err := p.client.Do(req)
	if err != nil {
		p.g.t.Fatal(err)
	}
	if res.Header.Get("Content-Type") != "text/event-stream" {
		p.g.t.Fatalf("not a stream: %d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	p.g.t.Cleanup(func() { res.Body.Close() })
	return &stream{t: p.g.t, r: bufio.NewReader(res.Body), res: res}
}

// until reads views until one passes ok.
func (s *stream) until(ok func(map[string]any) bool) map[string]any {
	s.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		line, err := s.r.ReadString('\n')
		if err != nil {
			s.t.Fatal(err)
		}
		data, found := strings.CutPrefix(strings.TrimSpace(line), "data: ")
		if !found {
			continue
		}
		var v map[string]any
		if err := json.Unmarshal([]byte(data), &v); err != nil {
			s.t.Fatal(err)
		}
		if ok(v) {
			return v
		}
	}
	s.t.Fatal("no such view in time")
	return nil
}

func TestARoomOverHTTP(t *testing.T) {
	g := start(t)
	ana, bo := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	status, out := ana.call("POST", "/api/rooms", map[string]string{"category": ""})
	code, _ := out["code"].(string)
	if status != 200 || len(code) != 6 {
		t.Fatalf("open: %d %v", status, out)
	}
	as, bs := ana.follow(code), bo.follow(code)
	as.until(func(v map[string]any) bool { return len(v["players"].([]any)) == 2 })
	if status, _ := bo.call("POST", "/api/rooms/"+code+"/start", map[string]any{}); status != 403 {
		t.Fatalf("a guest started: %d", status)
	}
	if status, _ := ana.call("POST", "/api/rooms/"+code+"/start", map[string]any{}); status != 200 {
		t.Fatalf("start: %d", status)
	}
	v := bs.until(func(v map[string]any) bool { return v["phase"] == "question" })
	if v["question"].(map[string]any)["view"] == nil {
		t.Fatalf("no question: %v", v)
	}
	for _, p := range []*player{ana, bo} {
		if status, out := p.call("POST", "/api/rooms/"+code+"/answer", map[string]any{"n": 0, "answer": nil}); status != 400 {
			t.Fatalf("an empty answer: %d %v", status, out)
		}
	}
	answer := map[string]any{"pick": 0}
	if q := v["question"].(map[string]any)["view"].(map[string]any); q["type"] == "number" {
		answer = map[string]any{"value": 1}
	} else if q["type"] == "order" {
		answer = map[string]any{"order": []int{0, 1, 2, 3}}
	} else if q["type"] == "truefalse" {
		answer = map[string]any{"truth": true}
	} else if q["type"] == "match" {
		answer = map[string]any{"pairs": []int{0, 1, 2, 3}}
	}
	ana.call("POST", "/api/rooms/"+code+"/answer", map[string]any{"n": 0, "answer": answer})
	bo.call("POST", "/api/rooms/"+code+"/answer", map[string]any{"n": 0, "answer": answer})
	v = as.until(func(v map[string]any) bool { return v["phase"] == "reveal" })
	if v["question"].(map[string]any)["reveal"] == nil {
		t.Fatalf("no answer shown: %v", v)
	}
	if status, _ := g.player().call("GET", "/api/rooms/000000/events", nil); status != 401 {
		t.Fatalf("a stranger's stream: %d", status)
	}
	stranger := g.player()
	stranger.call("POST", "/api/guest", map[string]any{})
	req, _ := http.NewRequest("GET", g.url+"/api/rooms/999999/events", nil)
	res, err := stranger.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.HasPrefix(string(body), "event: closed") {
		t.Fatalf("no such room: %q", body)
	}
}

func TestALiveDuelOverHTTP(t *testing.T) {
	g := start(t)
	ana, bo := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})

	// Ana waits, told for how long; Bo comes, and both see the duel.
	as := ana.stream("/api/duels/live/events")
	if line, _ := as.r.ReadString('\n'); line != "event: waiting\n" {
		t.Fatalf("Ana isn't waiting: %q", line)
	}
	bs := bo.stream("/api/duels/live/events")
	v := as.until(func(v map[string]any) bool { return v["phase"] == "intro" })
	id := int64(v["id"].(float64))
	if v["them"].(map[string]any)["name"] == nil || v["recorded"] != nil {
		t.Fatalf("the start: %v", v)
	}
	path := fmt.Sprintf("/api/duels/live/%d/answer", id)
	if status, _ := ana.call("POST", path, map[string]any{"n": 0, "answer": map[string]any{"pick": 0}}); status != 409 {
		t.Fatalf("an answer before the question: %d", status)
	}
	v = bs.until(func(v map[string]any) bool { return v["phase"] == "question" })
	answer := map[string]any{"pick": 0}
	switch v["question"].(map[string]any)["view"].(map[string]any)["type"] {
	case "number":
		answer = map[string]any{"value": 1}
	case "order":
		answer = map[string]any{"order": []int{0, 1, 2, 3}}
	case "truefalse":
		answer = map[string]any{"truth": true}
	case "match":
		answer = map[string]any{"pairs": []int{0, 1, 2, 3}}
	}
	if status, out := ana.call("POST", path, map[string]any{"n": 0, "answer": answer}); status != 200 {
		t.Fatalf("Ana's answer: %d %v", status, out)
	}
	v = bs.until(func(v map[string]any) bool { return v["them"].(map[string]any)["answered"] == true })
	if v["phase"] != "question" || v["them"].(map[string]any)["given"] != nil {
		t.Fatalf("Bo sees Ana's answer before his own: %v", v["them"])
	}
	stranger := g.player()
	stranger.call("POST", "/api/guest", map[string]any{})
	if status, _ := stranger.call("POST", path, map[string]any{"n": 0, "answer": answer}); status != 404 {
		t.Fatalf("a stranger answered: %d", status)
	}
	bo.call("POST", path, map[string]any{"n": 0, "answer": answer})
	v = as.until(func(v map[string]any) bool { return v["phase"] == "reveal" })
	if v["question"].(map[string]any)["reveal"] == nil || v["them"].(map[string]any)["given"] == nil {
		t.Fatalf("no answers shown: %v", v)
	}

	// Ana's line drops and comes back: the same duel, not the queue for a new one. A duel that's gone (a restart) says
	// so.
	again := ana.stream("/api/duels/live/events", strconv.FormatInt(id, 10))
	if v := again.until(func(map[string]any) bool { return true }); int64(v["id"].(float64)) != id {
		t.Fatalf("back in another duel: %v", v)
	}
	gone := ana.stream("/api/duels/live/events", strconv.FormatInt(id+1000, 10))
	if line, _ := gone.r.ReadString('\n'); line != "event: closed\n" {
		t.Fatalf("a duel that's gone: %q", line)
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
	page := func() (int, string) {
		req, _ := http.NewRequest("GET", g.url+"/admin", nil)
		res, err := p.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res.StatusCode, string(body)
	}
	if status, _ := page(); status != 404 {
		t.Fatalf("the admin page for a player: %d", status)
	}
	_, _ = g.db.Write.Exec(`UPDATE users SET admin = 1`)
	status, body := page()
	if status != 200 || !strings.Contains(body, "Отговорът е остарял") || !strings.Contains(body, "Мусала") {
		t.Fatalf("the admin page: %d %s", status, body)
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
}

// fakePushService takes pushes and counts them.
type fakePushService struct {
	mu   sync.Mutex
	hits map[string]int
}

func (f *fakePushService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.hits[r.URL.Path]++
	f.mu.Unlock()
	w.WriteHeader(http.StatusCreated)
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

	db, _ := store.Open(filepath.Join(t.TempDir(), "game.db"))
	t.Cleanup(func() { db.Close() })
	b, _ := bank.Load("../../bank/sample")
	out := mail.NewOutbox(db, &inbox{}, "a@almanac.bg")
	ts := httptest.NewUnstartedServer(nil)
	s, err := New(Config{PublicURL: "http://" + ts.Listener.Addr().String(), Push: &push.Sender{Keys: keys, Subject: "mailto:a@b.bg", Client: ps.Client(),
		Services: []string{ps.Listener.Addr().String()}}},
		Deps{DB: db, Accounts: &account.Accounts{DB: db, Outbox: out, Secret: []byte("x")}, Outbox: out, Bank: b})
	if err != nil {
		t.Fatal(err)
	}
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

// befriend makes two players friends, by a's invite link.
func befriend(a, b *player) {
	_, mine := a.call("GET", "/api/friends", nil)
	link := mine["invite"].(string)
	b.call("POST", "/api/invites/"+link[strings.LastIndex(link, "/")+1:], nil)
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
	if n := s.remind(t.Context(), evening); n != 1 || fake.count("/bo") != 1 || fake.count("/ana") != 0 {
		t.Fatalf("reminded %d; bo %d, ana %d", n, fake.count("/bo"), fake.count("/ana"))
	}
	if n := s.remind(t.Context(), evening.Add(time.Minute)); n != 0 {
		t.Fatal("reminded twice in a day")
	}
	if n := s.remind(t.Context(), evening.Add(-2*time.Hour)); n != 0 {
		t.Fatal("reminded before the hour")
	}

	// Bo accepts Ana's invite link: Ana hears of it. Ana asks Bo to a duel and plays hers: Bo hears of it.
	pushes := func(path string, want int) {
		t.Helper()
		for deadline := time.Now().Add(5 * time.Second); fake.count(path) < want && time.Now().Before(deadline); {
			time.Sleep(10 * time.Millisecond)
		}
		if got := fake.count(path); got != want {
			t.Fatalf("%s: %d pushes, want %d", path, got, want)
		}
	}
	_, mine := ana.call("GET", "/api/friends", nil)
	link := mine["invite"].(string)
	bo.call("POST", "/api/invites/"+link[strings.LastIndex(link, "/")+1:], nil)
	pushes("/ana", 1)
	_, mine = ana.call("GET", "/api/friends", nil)
	boID := int64(mine["friends"].([]any)[0].(map[string]any)["id"].(float64))
	_, duel := ana.call("POST", "/api/duels", map[string]any{"friend": boID})
	if _, w := bo.call("GET", "/api/friends/invites", nil); len(w["challenges"].([]any)) != 0 {
		t.Fatalf("Bo challenged before Ana played: %v", w)
	}
	playRun(ana, duel["state"].(map[string]any))
	pushes("/bo", 2)
	if _, w := bo.call("GET", "/api/friends/invites", nil); len(w["challenges"].([]any)) != 1 {
		t.Fatalf("Bo's challenges: %v", w)
	}
}

// Each player chooses the kinds of notification they get: the day's reminder, word from friends, Роял's call.
func TestPushKinds(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	bo, _ := g.guest()
	subscribe(ana, "/ana")
	subscribe(bo, "/bo")

	if _, out := ana.call("GET", "/api/push/prefs", nil); fmt.Sprint(out["prefs"]) != "map[day:true friends:true royal:false]" {
		t.Fatalf("the defaults: %v", out)
	}
	if status, _ := ana.call("PATCH", "/api/push/prefs", map[string]any{"kind": "news", "on": true}); status != 400 {
		t.Fatalf("an unknown kind: %d", status)
	}
	if _, out := ana.call("PATCH", "/api/push/prefs", map[string]any{"kind": "friends", "on": false}); fmt.Sprint(out["prefs"]) != "map[day:true friends:false royal:false]" {
		t.Fatalf("friends off: %v", out)
	}
	bo.call("PATCH", "/api/push/prefs", map[string]any{"kind": "day", "on": false})

	// Bo turned the day's reminder off: only Ana hears it.
	evening := time.Date(2030, 1, 1, 19, 5, 0, 0, bulgaria())
	if n := s.remind(t.Context(), evening); n != 1 || fake.count("/ana") != 1 || fake.count("/bo") != 0 {
		t.Fatalf("reminded %d; ana %d, bo %d", n, fake.count("/ana"), fake.count("/bo"))
	}
	// Ana turned word from friends off; the day's reminders she still gets.
	m := push.Message{Title: "Т", Body: "Т", URL: "/"}
	s.notify(t.Context(), pushFriends, m, anaID)
	s.notify(t.Context(), pushRoyal, m, anaID)
	if got := fake.count("/ana"); got != 1 {
		t.Fatalf("ana got %d pushes, want 1", got)
	}
	s.notify(t.Context(), pushDay, m, anaID)
	s.notify(t.Context(), pushAsked, m, anaID)
	if got := fake.count("/ana"); got != 3 {
		t.Fatalf("ana got %d pushes, want 3", got)
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
	if m := s.reminder(ctx, today, boID); m.Body != "Серията ти е 1 ден. Не я прекъсвай: десет въпроса, до полунощ." {
		t.Fatalf("with a streak: %+v", m)
	}
	// Ana, Bo's friend, plays today: Bo hears how she did.
	befriend(ana, bo)
	_, run = ana.call("POST", "/api/day", map[string]any{})
	playRun(ana, run)
	_, board := ana.call("GET", "/api/day/"+today+"/board", nil)
	rights := -1
	for _, r := range board["top"].([]any) {
		if r := r.(map[string]any); r["name"] == anaName {
			rights = int(r["rights"].(float64))
		}
	}
	if want := fmt.Sprintf("%s има %d от 10 днес. Серията ти е 1 ден.", anaName, rights); s.reminder(ctx, today, boID).Body != want {
		t.Fatalf("with a friend: %q, want %q", s.reminder(ctx, today, boID).Body, want)
	}
	// Cy isn't Ana's friend, and has no streak.
	if m := s.reminder(ctx, today, cyID); m.Body != "Десет въпроса, един опит. До полунощ." {
		t.Fatalf("someone else's friend: %+v", m)
	}
}

// Players say they'll come to the evening's Роял; when its lobby opens they're called, with those who want the call
// every evening. Once an evening.
func TestRoyalPlans(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, _ := g.guest()
	bo, _ := g.guest()
	cy, _ := g.guest()
	for p, path := range map[*player]string{ana: "/ana", bo: "/bo", cy: "/cy"} {
		subscribe(p, path)
	}
	// Ana turned Роял's notifications off; she still comes tonight.
	ana.call("PATCH", "/api/push/prefs", map[string]any{"kind": "royal", "on": false})
	cy.call("PATCH", "/api/push/prefs", map[string]any{"kind": "royal", "on": true})

	if status, out := ana.call("POST", "/api/royal/plan", map[string]any{}); status != 200 || out["coming"] != 1.0 || out["planned"] != true {
		t.Fatalf("Ana's plan: %d %v", status, out)
	}
	ana.call("POST", "/api/royal/plan", map[string]any{}) // again changes nothing
	if _, out := bo.call("GET", "/api/royal/tonight", nil); out["coming"] != 1.0 || out["planned"] != false {
		t.Fatalf("tonight, to Bo: %v", out)
	}
	if res, err := http.Get(g.url + "/api/royal/tonight"); err != nil || res.StatusCode != 200 {
		t.Fatalf("tonight, to someone not signed in: %v %v", res, err)
	}
	bo.call("POST", "/api/royal/plan", map[string]any{})
	if _, out := bo.call("DELETE", "/api/royal/plan", nil); out["coming"] != 1.0 || out["planned"] != false {
		t.Fatalf("Bo changes his mind: %v", out)
	}

	_, out := ana.call("GET", "/api/royal/tonight", nil)
	start := time.UnixMilli(int64(out["glance"].(map[string]any)["next"].(float64)))
	if n := s.callRoyal(t.Context(), start); n != 2 || fake.count("/ana") != 1 || fake.count("/cy") != 1 || fake.count("/bo") != 0 {
		t.Fatalf("called %d: ana %d, cy %d, bo %d", n, fake.count("/ana"), fake.count("/cy"), fake.count("/bo"))
	}
	if n := s.callRoyal(t.Context(), start); n != 0 {
		t.Fatal("called twice")
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
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	_, me := p.call("GET", "/api/me", nil)
	_, run := p.call("POST", "/api/topic", map[string]string{"category": "music"})
	id := strconv.Itoa(int(run["id"].(float64)))
	for n := range 10 {
		p.call("POST", "/api/runs/"+id+"/show", map[string]any{})
		p.call("POST", "/api/runs/"+id+"/answer", map[string]any{"n": n, "answer": nil})
	}
	_, friends := p.call("GET", "/api/friends", nil)
	link := friends["invite"].(string)
	who := me["user"].(map[string]any)["name"].(string)
	if body := page(link[len(g.url):]); !strings.Contains(body, `og:title" content="`+who+` те кани в АЛМАНАХ"`) {
		t.Fatalf("the invite's preview:\n%s", body[:min(len(body), 1500)])
	}
	_, room := p.call("POST", "/api/rooms", map[string]string{"category": ""})
	code := room["code"].(string)
	if body := page("/r/" + code); !strings.Contains(body, "Ела в стая "+code[:3]+" "+code[3:]) {
		t.Fatal("the room's preview")
	}
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
	if news := g.srv.problems.take(); len(news) != 0 {
		t.Fatalf("a left request became a problem: %v", news)
	}
}

func TestFriendsOverHTTP(t *testing.T) {
	g := start(t)
	ana, bo := g.player(), g.player()
	_, a := ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	_, mine := ana.call("GET", "/api/friends", nil)
	link, _ := mine["invite"].(string)
	code := link[strings.LastIndex(link, "/")+1:]
	if !strings.HasSuffix(link, "/f/"+code) || len(code) != 8 {
		t.Fatalf("Ana's invite link: %q", link)
	}
	if _, info := ana.call("GET", "/api/invites/"+code, nil); info["own"] != true {
		t.Fatalf("Ana's own link: %v", info)
	}
	if _, info := bo.call("GET", "/api/invites/"+code, nil); info["by"] != name(a) || info["own"] != false {
		t.Fatalf("Ana's link, as Bo sees it: %v", info)
	}
	if status, _ := bo.call("POST", "/api/invites/nosuchcd", nil); status != http.StatusNotFound {
		t.Fatalf("a made-up link: %d", status)
	}
	if status, out := bo.call("POST", "/api/invites/"+code, nil); status != http.StatusOK || out["name"] != name(a) {
		t.Fatalf("Bo accepts: %d %v", status, out)
	}
	_, mine = ana.call("GET", "/api/friends", nil)
	friends, _ := mine["friends"].([]any)
	if len(friends) != 1 {
		t.Fatalf("Ana's friends: %v", mine)
	}
	boID := int64(friends[0].(map[string]any)["id"].(float64))

	// Strangers can't ask each other.
	vi := g.player()
	vi.call("POST", "/api/guest", map[string]any{})
	if status, _ := vi.call("POST", "/api/duels", map[string]any{"friend": boID}); status != http.StatusNotFound {
		t.Fatalf("a stranger asked Bo to a duel: %d", status)
	}
	if status, _ := bo.call("DELETE", fmt.Sprintf("/api/friends/%d", int64(a["user"].(map[string]any)["id"].(float64))), nil); status != http.StatusOK {
		t.Fatalf("unfriending: %d", status)
	}
	if _, his := bo.call("GET", "/api/friends", nil); len(his["friends"].([]any)) != 0 {
		t.Fatalf("still friends: %v", his)
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
		ana.call("POST", "/api/runs/"+id+"/answer", map[string]any{"n": n, "answer": nil})
	}

	status, p := g.player().call("GET", "/api/players/@"+strings.ToUpper(anaTag), nil)
	if status != http.StatusOK || p["name"] != name(a) || p["tag"] != anaTag || p["games"] != float64(1) ||
		p["friend"] != nil || p["id"] != nil || p["me"] != nil {
		t.Fatalf("Ana's profile, to someone not signed in: %d %v", status, p)
	}
	if _, ok := p["mastery"].([]any); !ok {
		t.Fatalf("no mastery: %v", p)
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

	// Bo asks; Ana sees he asks, he sees he asked; once she accepts, they're friends and he may call her to a duel.
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
	if p["friend"] != "yes" || p["id"] != a["user"].(map[string]any)["id"] || p["record"] == nil {
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

func TestOrdinal(t *testing.T) {
	for n, want := range map[int]string{1: "1-во", 2: "2-ро", 3: "3-то", 4: "4-то", 5: "5-о", 7: "7-о", 11: "11-о",
		12: "12-о", 20: "20-о", 21: "21-во", 22: "22-ро", 50: "50-о", 100: "100-тно", 101: "101-во", 1000: "1000-но"} {
		if got := ordinal(n); got != want {
			t.Errorf("ordinal(%d) = %q, want %q", n, got, want)
		}
	}
}

// A new player starts as one animal: its name, its tag and the avatar drawn for them.
func TestGuestIsOneAnimal(t *testing.T) {
	if len(account.Animals) != len(play.FreeShapes) {
		t.Fatalf("%d animals for %d free avatars", len(account.Animals), len(play.FreeShapes))
	}
	for i, a := range account.Animals {
		if a.Shape != play.FreeShapes[i] {
			t.Fatalf("animal %d is %q, the free avatar %q", i, a.Shape, play.FreeShapes[i])
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
