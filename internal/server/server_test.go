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
		"/": 200, "/play": 200, "/play/history": 200, "/me": 200, "/nowhere": 404, "/api/nowhere": 404,
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
			answer = map[string]float64{"value": view["min"].(float64)}
		case "order":
			answer = map[string][]int{"order": {0, 1, 2, 3}}
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
	if today["run"].(map[string]any)["done"] != true || today["streak"] != float64(1) {
		t.Fatalf("today: %v", today)
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
	if res, _ := get("www.127.0.0.1", "/play?x=1"); res.StatusCode != 301 || res.Header.Get("Location") != g.url+"/play?x=1" {
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
	req, _ := http.NewRequest("GET", p.g.url+"/api/rooms/"+code+"/events", nil)
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
		answer = map[string]any{"value": q["min"]}
	} else if q["type"] == "order" {
		answer = map[string]any{"order": []int{0, 1, 2, 3}}
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

func TestTwoPeopleAskForADuel(t *testing.T) {
	g := start(t)
	ana, bo := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	codes := make(chan string, 2)
	for _, p := range []*player{ana, bo} {
		go func() {
			_, out := p.call("POST", "/api/duel", map[string]any{})
			code, _ := out["code"].(string)
			codes <- code
		}()
	}
	a, b := <-codes, <-codes
	if a == "" || a != b {
		t.Fatalf("matched into %q and %q", a, b)
	}
	as, bs := ana.follow(a), bo.follow(a)
	for _, s := range []*stream{as, bs} {
		v := s.until(func(v map[string]any) bool { return v["phase"] == "question" })
		if v["duel"] != true || v["canLead"] == true {
			t.Fatalf("a duel: %v", v)
		}
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

func TestNotifications(t *testing.T) {
	fake := &fakePushService{hits: map[string]int{}}
	ps := httptest.NewTLSServer(fake)
	defer ps.Close()
	pub, priv, _ := push.NewKeys()
	keys, _ := push.ParseKeys(pub, priv)

	db, _ := store.Open(filepath.Join(t.TempDir(), "game.db"))
	defer db.Close()
	b, _ := bank.Load("../../bank/sample")
	out := mail.NewOutbox(db, &inbox{}, "a@almanac.bg")
	ts := httptest.NewUnstartedServer(nil)
	s, err := New(Config{PublicURL: "http://" + ts.Listener.Addr().String(), Push: &push.Sender{Keys: keys, Subject: "mailto:a@b.bg", Client: ps.Client()}},
		Deps{DB: db, Accounts: &account.Accounts{DB: db, Outbox: out, Secret: []byte("x")}, Outbox: out, Bank: b})
	if err != nil {
		t.Fatal(err)
	}
	ts.Config.Handler = s.Handler()
	ts.Start()
	defer ts.Close()
	g := &game{t: t, db: db, url: ts.URL}

	// The page offers notifications, with the key to subscribe with.
	if res, _ := http.Get(ts.URL + "/"); res != nil {
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if !strings.Contains(string(body), pub) {
			t.Fatal("the page doesn't carry the push key")
		}
	}
	subscribe := func(p *player, path string) {
		browser, _ := ecdh.P256().GenerateKey(rand.Reader)
		sub := map[string]any{"endpoint": ps.URL + path, "keys": map[string]string{
			"p256dh": base64.RawURLEncoding.EncodeToString(browser.PublicKey().Bytes()),
			"auth":   base64.RawURLEncoding.EncodeToString([]byte("0123456789abcdef")),
		}}
		if status, _ := p.call("POST", "/api/push", sub); status != 200 {
			t.Fatalf("subscribe: %d", status)
		}
	}
	ana, bo := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	subscribe(ana, "/ana")
	subscribe(bo, "/bo")
	if status, _ := ana.call("POST", "/api/push", map[string]any{"endpoint": "http://plain.example/x"}); status != 400 {
		t.Fatalf("a bad subscription: %d", status)
	}

	// Ana plays the day; at 19:05 only Bo is reminded, and only once.
	_, run := ana.call("POST", "/api/day", map[string]any{})
	id := strconv.Itoa(int(run["id"].(float64)))
	for n := range 10 {
		_, st := ana.call("POST", "/api/runs/"+id+"/show", map[string]any{})
		view := st["question"].(map[string]any)["view"].(map[string]any)
		a := map[string]any{"pick": 0}
		if view["type"] == "number" {
			a = map[string]any{"value": view["min"]}
		} else if view["type"] == "order" {
			a = map[string]any{"order": []int{0, 1, 2, 3}}
		}
		ana.call("POST", "/api/runs/"+id+"/answer", map[string]any{"n": n, "answer": a})
	}
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

	// Bo accepts Ana's invite link: Ana hears of it. Ana asks Bo to a duel: Bo hears of it.
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
	ana.call("POST", fmt.Sprintf("/api/friends/%d/duel", boID), nil)
	pushes("/bo", 2)
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

// A player who leaves while asking (a duel search cancelled) isn't a server error nor a problem to mail, and their
// place in the queue is free at once: the next player isn't matched with someone gone.
func TestALeftRequestIsNoProblem(t *testing.T) {
	g := start(t)
	g.srv.duelWait = 2 * time.Second // before any request reads it
	ana, bo := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	ctx, cancel := context.WithCancel(t.Context())
	req, _ := http.NewRequestWithContext(ctx, "POST", g.url+"/api/duel", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	done := make(chan struct{})
	go func() {
		if res, err := ana.client.Do(req); err == nil {
			res.Body.Close()
		}
		close(done)
	}()
	time.Sleep(300 * time.Millisecond)
	cancel()
	<-done
	time.Sleep(300 * time.Millisecond)
	if news := g.srv.problems.take(); len(news) != 0 {
		t.Fatalf("a cancelled search became a problem: %v", news)
	}
	// Bo asks now: Ana is gone, so he isn't matched with her (with nobody about and no recordings: nobody).
	if status, out := bo.call("POST", "/api/duel", map[string]any{}); status != 404 || out["error"] != "nobody" {
		t.Fatalf("Bo was matched with someone gone: %d %v", status, out)
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

	// A duel: Ana asks, Bo sees the invitation, comes, and it starts.
	_, out := ana.call("POST", fmt.Sprintf("/api/friends/%d/duel", boID), nil)
	room, _ := out["code"].(string)
	as := ana.follow(room)
	as.until(func(v map[string]any) bool { return v["phase"] == "lobby" && v["invite"] == true })
	_, his := bo.call("GET", "/api/friends", nil)
	if inv, _ := his["invites"].([]any); len(inv) != 1 || inv[0].(map[string]any)["code"] != room {
		t.Fatalf("Bo's invitations: %v", his)
	}
	bs := bo.follow(room)
	for _, s := range []*stream{as, bs} {
		s.until(func(v map[string]any) bool { return v["phase"] == "question" && v["duel"] == true })
	}

	// Another, turned down: Ana's screen hears it was.
	_, out = ana.call("POST", fmt.Sprintf("/api/friends/%d/duel", boID), nil)
	second, _ := out["code"].(string)
	if second == room {
		t.Fatal("a started duel was offered again")
	}
	as2 := ana.follow(second)
	as2.until(func(v map[string]any) bool { return v["phase"] == "lobby" })
	if status, _ := bo.call("POST", "/api/rooms/"+second+"/decline", nil); status != http.StatusOK {
		t.Fatalf("Bo declines: %d", status)
	}
	for deadline := time.Now().Add(5 * time.Second); ; {
		line, err := as2.r.ReadString('\n')
		if err != nil || time.Now().After(deadline) {
			t.Fatalf("no word of the decline: %v", err)
		}
		if strings.TrimSpace(line) == "event: declined" {
			break
		}
	}

	// Strangers can't ask each other.
	vi := g.player()
	vi.call("POST", "/api/guest", map[string]any{})
	if status, _ := vi.call("POST", fmt.Sprintf("/api/friends/%d/duel", boID), nil); status != http.StatusNotFound {
		t.Fatalf("a stranger asked Bo to a duel: %d", status)
	}
	if status, _ := bo.call("DELETE", fmt.Sprintf("/api/friends/%d", int64(a["user"].(map[string]any)["id"].(float64))), nil); status != http.StatusOK {
		t.Fatalf("unfriending: %d", status)
	}
	if _, his = bo.call("GET", "/api/friends", nil); len(his["friends"].([]any)) != 0 {
		t.Fatalf("still friends: %v", his)
	}
}
