package seed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/bank/banktest"
	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/server"
	"github.com/almanac-bg/almanac/internal/store/storetest"
)

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.DiscardHandler))
	os.Exit(m.Run())
}

type discard struct{}

func (discard) Send(context.Context, string, mail.Message) error { return nil }

// A seeded game has its personas, each what it says, and every screen's API answers each of them: the pages a
// review looks at, as each kind of player sees them.
func TestSeededGame(t *testing.T) {
	db := storetest.Open(t)
	b := banktest.Sample(t)
	ctx := t.Context()
	personas, err := Seed(ctx, db, b, Options{Players: 18, Days: 14, Seed: 7, small: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := Fresh(ctx, db); !errors.Is(err, ErrNotFresh) {
		t.Fatalf("a seeded database is fresh: %v", err)
	}
	if _, err := Seed(ctx, db, b, Options{Players: 30, Days: 15}); !errors.Is(err, ErrNotFresh) {
		t.Fatalf("seeded twice: %v", err)
	}
	by := map[string]Persona{}
	for _, p := range personas {
		by[p.Key] = p
	}
	for _, key := range personaKinds {
		if by[key].Token == "" || by[key].ID == 0 {
			t.Fatalf("no %s persona: %+v", key, personas)
		}
	}

	// The history has what the screens show: every kind of game, friends.
	for what, q := range map[string]string{
		"day runs":         `SELECT count(*) FROM runs WHERE kind = 'day' AND finished_at IS NOT NULL`,
		"topic runs":       `SELECT count(*) FROM runs WHERE kind = 'topic'`,
		"friends' duels":   `SELECT count(*) FROM duels WHERE kind = 'person' AND outcome IN ('a', 'b', 'draw')`,
		"duels waiting":    `SELECT count(*) FROM duels WHERE kind = 'person' AND sent_at IS NOT NULL AND ended_at IS NULL`,
		"recorded duels":   `SELECT count(*) FROM duels WHERE kind = 'recording' AND outcome IN ('a', 'b', 'draw')`,
		"friends":          `SELECT count(*) FROM friends`,
		"requests waiting": `SELECT count(*) FROM friend_requests WHERE NOT declined`,
		"notes":            `SELECT count(*) FROM notes`,
		"guests":           `SELECT count(*) FROM users WHERE email IS NULL`,
		"tallies":          `SELECT count(*) FROM daily_counts`,
	} {
		var n int
		if err := db.Read.QueryRow(q).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			t.Errorf("no %s", what)
		}
	}

	// Every screen's API, as each persona.
	out := mail.NewOutbox(db, discard{}, "АЛМАНАХ <no-reply@almanac.bg>")
	ts := httptest.NewUnstartedServer(nil)
	srv, err := server.New(server.Config{PublicURL: "http://" + ts.Listener.Addr().String(), Dev: true},
		server.Deps{DB: db, Accounts: &account.Accounts{DB: db, Outbox: out, Secret: []byte("test")}, Outbox: out, Bank: b})
	if err != nil {
		t.Fatal(err)
	}
	ts.Config.Handler = srv.Handler()
	ts.Start()
	t.Cleanup(ts.Close)
	get := func(p Persona, path string) (int, map[string]any) {
		t.Helper()
		method := http.MethodGet
		var body io.Reader
		if strings.HasPrefix(path, "POST ") {
			method, path, body = http.MethodPost, strings.TrimPrefix(path, "POST "), strings.NewReader(`{}`)
		}
		req, _ := http.NewRequest(method, ts.URL+path, body)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "sid", Value: p.Token})
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var v map[string]any
		_ = json.NewDecoder(res.Body).Decode(&v)
		return res.StatusCode, v
	}
	screens := []string{"/api/me", "/api/me/stats", "/api/me/games", "/api/me/games?kind=duel",
		"POST /api/me/news", "/api/day", "/api/runs/left",
		"/api/duels", "/api/ranks", "/api/ranks?among=friends", "/api/ranks?topic=history",
		"/api/almanac", "/api/friends",
		"/api/friends/requests", "/api/push/prefs", "/api/mail/prefs"}
	for _, p := range personas {
		for _, path := range append(screens, "/api/players/"+p.Tag) {
			if code, v := get(p, path); code != http.StatusOK {
				t.Errorf("%s: %s: %d %v", p.Key, path, code, v)
			}
		}
		code, me := get(p, "/api/me")
		if u, _ := me["user"].(map[string]any); code != http.StatusOK || u["tag"] != p.Tag {
			t.Errorf("%s isn't signed in by their cookie: %v", p.Key, me)
		}
		// Each of their duels (to play, waiting, played), and a game gone over, of those who have them.
		_, d := get(p, "/api/duels")
		for _, kind := range []string{"yours", "theirs", "played"} {
			if list, _ := d[kind].([]any); len(list) > 0 {
				id := list[0].(map[string]any)["id"]
				if code, v := get(p, fmt.Sprintf("/api/duels/%v", id)); code != http.StatusOK {
					t.Errorf("%s: a duel: %d %v", p.Key, code, v)
				}
			}
		}
		var run int64 // today's: a game is gone over on its day
		today, _ := time.ParseInLocation(time.DateOnly, time.Now().In(play.Bulgaria).Format(time.DateOnly), play.Bulgaria)
		_ = db.Read.QueryRow(`SELECT coalesce(max(id), 0) FROM runs WHERE user_id = ? AND finished_at >= ?`,
			p.ID, today.UnixMilli()).Scan(&run)
		if run != 0 {
			if code, v := get(p, fmt.Sprintf("/api/runs/%d/review", run)); code != http.StatusOK {
				t.Errorf("%s: a game gone over: %d %v", p.Key, code, v)
			}
		}
	}
	// What each persona is for, as the screens say it.
	if _, v := get(by[keyGuest], "/api/me/stats"); v == nil {
		t.Error("the guest has no stats")
	}
	var days int
	_ = db.Read.QueryRow(`SELECT count(*) FROM active_days WHERE user_id = ?`, by[keyGuest].ID).Scan(&days)
	if days != 0 {
		t.Errorf("the new guest has played %d days", days)
	}
	_, day := get(by[keyLapsed], "/api/day")
	if day["ended"] == nil {
		t.Errorf("the lapsed persona's streak isn't told as ended on Начало: %v", day)
	}
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/admin", nil)
	req.AddCookie(&http.Cookie{Name: "sid", Value: by[keyAdmin].Token})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("/admin for the admin: %d", res.StatusCode)
	}

	// The server's clean-up, run as it serves the database, leaves the players as seeded: a guest's browser keeps its
	// cookie, and only a guest nothing of theirs can come back to is dropped.
	var before, after int
	if err := db.Read.QueryRow(`SELECT count(*) FROM users`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := (&account.Accounts{DB: db}).CleanUp(ctx); err != nil {
		t.Fatal(err)
	}
	if err := db.Read.QueryRow(`SELECT count(*) FROM users`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Errorf("the clean-up dropped %d of %d seeded players", before-after, before)
	}
}
