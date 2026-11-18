package server

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/bank/banktest"
	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/store/storetest"
)

// fakeAPNs takes pushes for iPhones and counts them by token; the tokens in gone are ones Apple no longer knows; while
// keys is set, it refuses the game's signed token.
type fakeAPNs struct {
	mu   sync.Mutex
	hits map[string]int
	gone map[string]bool
	keys bool
}

func (f *fakeAPNs) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.URL.Path, "/3/device/")
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.keys {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"reason":"InvalidProviderToken"}`))
		return
	}
	if f.gone[token] {
		w.WriteHeader(http.StatusGone)
		_, _ = w.Write([]byte(`{"reason":"Unregistered"}`))
		return
	}
	f.hits[token]++
}

func (f *fakeAPNs) count(token string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[token]
}

// The game's app on an iPhone: its player allows notifications, the app gives the phone's token, and the game's
// notifications go to Apple for it, as they go to a browser's push service.
func TestPhoneNotifications(t *testing.T) {
	fake := &fakeAPNs{hits: map[string]int{}, gone: map[string]bool{}}
	apns := httptest.NewTLSServer(fake)
	t.Cleanup(apns.Close)
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(k)
	apple, err := push.NewApple(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), "KEY1234567", "TEAM123456", "bg.almanac.app")
	if err != nil {
		t.Fatal(err)
	}
	apple.Client, apple.Hosts = apns.Client(), []string{apns.URL}

	db := storetest.Open(t)
	b := banktest.Sample(t)
	out := mail.NewOutbox(db, &inbox{}, "a@almanac.bg")
	ts := httptest.NewUnstartedServer(nil)
	s, err := New(Config{PublicURL: "http://" + ts.Listener.Addr().String(), Phones: &push.Phones{Apple: apple}},
		Deps{DB: db, Accounts: &account.Accounts{DB: db, Outbox: out, Secret: []byte("x")}, Outbox: out, Bank: b})
	if err != nil {
		t.Fatal(err)
	}
	s.game.Now = daytime()
	ts.Config.Handler = s.Handler()
	ts.Start()
	t.Cleanup(ts.Close)
	g := &game{t: t, srv: s, db: db, url: ts.URL}

	// The page tells the app which platforms it can notify.
	res, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(page), `"phones":["ios"]`) {
		t.Fatal("the page doesn't say the app gets notifications on iPhones")
	}

	ana, bo := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	bo.call("POST", "/api/guest", map[string]any{})
	anaPhone, boPhone := strings.Repeat("a1", 32), strings.Repeat("b2", 32)
	for _, bad := range []map[string]any{
		{"platform": "ios", "token": "not a token"},
		{"platform": "android", "token": "token-of-an-android-phone-with-no-sender"},
		{"platform": "web", "token": anaPhone},
	} {
		if status, _ := ana.call("POST", "/api/push/phone", bad); status != 400 {
			t.Fatalf("%v: %d", bad, status)
		}
	}
	// An iPhone's token comes in upper case from the app's plugin; it's kept in lower case, once.
	for p, token := range map[*player]string{ana: strings.ToUpper(anaPhone), bo: boPhone} {
		if status, _ := p.call("POST", "/api/push/phone", map[string]any{"platform": "ios", "token": token}); status != 200 {
			t.Fatalf("a phone's token: %d", status)
		}
	}
	ana.call("POST", "/api/push/phone", map[string]any{"platform": "ios", "token": anaPhone})
	var kept int
	_ = db.Read.QueryRow(`SELECT count(*) FROM phones WHERE token = ?`, anaPhone).Scan(&kept)
	if kept != 1 {
		t.Fatalf("Ana's phone kept %d times in lower case", kept)
	}

	// Ana plays the day; at 19:05 Bo's phone is reminded, Ana's isn't.
	_, run := ana.call("POST", "/api/day", map[string]any{})
	playRun(ana, run)
	evening := time.Date(2030, 1, 1, 19, 5, 0, 0, bulgaria())
	_, _ = db.Write.Exec(`UPDATE runs SET day = ?`, evening.Format(time.DateOnly))
	if n := s.remindSent(t.Context(), evening); n != 1 || fake.count(boPhone) != 1 || fake.count(anaPhone) != 0 {
		t.Fatalf("reminded %d; bo %d, ana %d", n, fake.count(boPhone), fake.count(anaPhone))
	}

	// A phone Apple no longer knows is forgotten at the first push to it.
	fake.mu.Lock()
	fake.gone[boPhone] = true
	fake.mu.Unlock()
	var boID int64
	_ = db.Read.QueryRow(`SELECT user_id FROM phones WHERE token = ?`, boPhone).Scan(&boID)
	s.notifySent(t.Context(), pushAsked, push.Message{Title: "Роял", Body: "Започва.", URL: "/royal"}, boID)
	var left int
	_ = db.Read.QueryRow(`SELECT count(*) FROM phones WHERE token = ?`, boPhone).Scan(&left)
	if left != 0 {
		t.Fatal("a gone phone kept")
	}

	// Apple refuses the game's own keys: nothing of the phone, so it isn't counted against; the notification is
	// tried again, and whoever runs the game is told.
	fake.mu.Lock()
	fake.keys = true
	fake.mu.Unlock()
	var anaID int64
	_ = db.Read.QueryRow(`SELECT user_id FROM phones WHERE token = ?`, anaPhone).Scan(&anaID)
	s.notifySent(t.Context(), pushAsked, push.Message{Title: "Роял", Body: "Започва.", URL: "/royal"}, anaID)
	var queued, tries, fails int
	_ = db.Read.QueryRow(`SELECT count(*), coalesce(max(tries), 0) FROM push_queue`).Scan(&queued, &tries)
	_ = db.Read.QueryRow(`SELECT fails FROM phones WHERE token = ?`, anaPhone).Scan(&fails)
	news, _ := s.problems.take()
	told := false
	for kind := range news {
		told = told || strings.Contains(kind, "apns refused the game's keys")
	}
	if queued != 1 || tries != 1 || fails != 0 || !told {
		t.Fatalf("keys refused: %d queued (tries %d), the phone's fails %d, told %v", queued, tries, fails, told)
	}
	fake.mu.Lock()
	fake.keys = false
	fake.mu.Unlock()
	s.game.Now = func() time.Time { return daytime()().Add(pushBackoff[0] + time.Second) }
	s.sendQueued(t.Context())
	if _ = db.Read.QueryRow(`SELECT count(*) FROM push_queue`).Scan(&queued); queued != 0 || fake.count(anaPhone) != 1 {
		t.Fatalf("keys mended: %d queued, ana's phone %d", queued, fake.count(anaPhone))
	}

	// Ana turns notifications off on her phone: it's forgotten; Bo can't forget Ana's.
	if status, _ := bo.call("DELETE", "/api/push/phone", map[string]any{"token": anaPhone}); status != 200 {
		t.Fatalf("delete: %d", status)
	}
	_ = db.Read.QueryRow(`SELECT count(*) FROM phones WHERE token = ?`, anaPhone).Scan(&left)
	if left != 1 {
		t.Fatal("another player's phone forgotten")
	}
	ana.call("DELETE", "/api/push/phone", map[string]any{"token": strings.ToUpper(anaPhone)}) // as the app keeps it
	_ = db.Read.QueryRow(`SELECT count(*) FROM phones WHERE token = ?`, anaPhone).Scan(&left)
	if left != 0 {
		t.Fatal("a phone turned off, kept")
	}

	// Ana turns them on again, then signs out without the app saying a word of its phone (it lost the token, or the
	// call failed): the phone is forgotten with the session, and the next player there gets none of hers.
	ana.call("POST", "/api/push/phone", map[string]any{"platform": "ios", "token": anaPhone})
	if status, _ := ana.call("POST", "/api/auth/signout", map[string]any{}); status != 200 {
		t.Fatalf("sign out: %d", status)
	}
	_ = db.Read.QueryRow(`SELECT count(*) FROM phones WHERE token = ?`, anaPhone).Scan(&left)
	if left != 0 {
		t.Fatal("a phone signed out of, kept")
	}
}

// The site says which app opens its links, as an iPhone and Android check it.
func TestAppLinks(t *testing.T) {
	g := start(t)
	for path, want := range map[string]string{
		"/.well-known/apple-app-site-association": "CA38SQWUTC.bg.almanac.app",
		"/.well-known/assetlinks.json":            "bg.almanac.app",
	} {
		res, err := http.Get(g.url + path)
		if err != nil {
			t.Fatal(err)
		}
		var body any
		err = json.NewDecoder(res.Body).Decode(&body)
		res.Body.Close()
		raw, _ := json.Marshal(body)
		if err != nil || res.StatusCode != 200 || res.Header.Get("Content-Type") != "application/json" || !strings.Contains(string(raw), want) {
			t.Fatalf("%s: %d %s %s", path, res.StatusCode, res.Header.Get("Content-Type"), raw)
		}
	}
}
