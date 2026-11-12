package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/mail"
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
	s, err := New(Config{PublicURL: "http://" + ts.Listener.Addr().String(), Version: "test"}, db, accounts, out, b)
	if err != nil {
		t.Fatal(err)
	}
	ts.Config.Handler = s.Handler()
	ts.Start()
	t.Cleanup(ts.Close)
	return &game{t: t, url: ts.URL, outbox: out, inbox: in}
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
		if want == 200 && !strings.HasPrefix(path, "/qimg/") && !strings.Contains(string(body), `id="boot"`) {
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
