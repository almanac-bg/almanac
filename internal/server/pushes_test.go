package server

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank/banktest"
	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/store/storetest"
)

// remindSent and notifySent queue as their namesakes do, and send what they queued.
func (s *Server) remindSent(ctx context.Context, at time.Time) int {
	n := s.remind(ctx, at)
	s.sendQueued(ctx)
	return n
}

func (s *Server) notifySent(ctx context.Context, kind pushKind, m push.Message, userIDs ...int64) {
	s.notify(ctx, kind, m, userIDs...)
	s.sendQueued(ctx)
}

// daytime is a clock that runs from noon today in Bulgaria: nights are quiet (pushes.go), and a test that sends
// pushes mustn't depend on the hour it's run at.
func daytime() func() time.Time {
	start := time.Now()
	n := start.In(bulgaria())
	noon := time.Date(n.Year(), n.Month(), n.Day(), 12, 0, 0, 0, bulgaria())
	return func() time.Time { return noon.Add(time.Since(start)) }
}

// devicesOf are the endpoints of a player's browsers, as kept.
func devicesOf(g *game, userID int64) []string {
	g.t.Helper()
	rows, err := g.db.Read.Query(`SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at, endpoint`, userID)
	if err != nil {
		g.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var e string
		_ = rows.Scan(&e)
		out = append(out, e[strings.LastIndex(e, "/"):])
	}
	return out
}

// A player's devices are few: a browser's session keeps its last subscription only, a player the newest few; a
// browser's key must be one; and a player tells them only so often.
func TestDevicesBounded(t *testing.T) {
	_, g, _, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	subscribe(ana, "/a1")
	subscribe(ana, "/a2") // the browser subscribed anew: the old one is of no more use
	if got := devicesOf(g, anaID); fmt.Sprint(got) != "[/a2]" {
		t.Fatalf("one session's subscriptions: %v", got)
	}
	var endpoint, p256dh, auth string
	_ = g.db.Read.QueryRow(`SELECT endpoint, p256dh, auth FROM push_subs`).Scan(&endpoint, &p256dh, &auth)
	host := endpoint[:strings.LastIndex(endpoint, "/")]
	// Browsers of other sessions (kept before sessions were told): the newest pushDevices stay.
	for i := range 6 {
		if _, err := g.db.Write.Exec(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)`,
			fmt.Sprintf("%s/old%d", host, i), anaID, p256dh, auth, i); err != nil {
			t.Fatal(err)
		}
	}
	subscribe(ana, "/a3") // in place of /a2, and the oldest go
	if got := devicesOf(g, anaID); fmt.Sprint(got) != "[/old2 /old3 /old4 /old5 /a3]" {
		t.Fatalf("a player's subscriptions: %v", got)
	}

	// A key that isn't a point on the curve: no browser's.
	off := make([]byte, 65)
	off[0] = 4
	sub := func(path, key string) map[string]any {
		return map[string]any{"endpoint": host + path, "keys": map[string]string{"p256dh": key, "auth": auth}}
	}
	if status, _ := ana.call("POST", "/api/push", sub("/bad", base64.RawURLEncoding.EncodeToString(off))); status != 400 {
		t.Fatalf("a key off the curve: %d", status)
	}
	// Told over and over: refused after pushTellsPerHour.
	told := 0
	for range pushTellsPerHour + 1 {
		if status, _ := ana.call("POST", "/api/push", sub("/again", p256dh)); status == 200 {
			told++
		} else if status != 429 {
			t.Fatalf("told again: %d", status)
		}
	}
	if told >= pushTellsPerHour {
		t.Fatalf("told %d times in an hour", told)
	}
}

// A reminder that reached nobody counts neither as one left unplayed nor as the last: three evenings of a push
// service refusing don't stop the reminders.
func TestFailedRemindersDontCount(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	subscribe(ana, "/ana")
	start := time.Date(2030, 3, 1, 0, 0, 0, 0, bulgaria())
	clock := start
	s.game.Now = func() time.Time { return clock }
	g.everyWeekday(anaID) // every weekday hers: each reminder left counts
	g.finishedDay(anaID, start, 18*time.Hour)
	fake.answering("/ana", http.StatusForbidden)
	for d := 1; d <= 4; d++ {
		clock = start.AddDate(0, 0, d).Add(20 * time.Hour)
		if n := s.remindSent(t.Context(), clock); n != 1 {
			t.Fatalf("day %d: reminded %d", d, n)
		}
	}
	if fake.count("/ana") != 0 {
		t.Fatalf("pushes %d", fake.count("/ana"))
	}
	var fails int
	_ = g.db.Read.QueryRow(`SELECT fails FROM push_subs WHERE user_id = ?`, anaID).Scan(&fails)
	if fails != 4 {
		t.Fatalf("the browser's failures: %d", fails)
	}
	// The service takes them again: the reminders go on, three before they stop; the browser's slate is clean.
	fake.answering("/ana", 0)
	for d := 5; d <= 7; d++ {
		clock = start.AddDate(0, 0, d).Add(20 * time.Hour)
		s.remindSent(t.Context(), clock)
	}
	if fake.count("/ana") != 3 {
		t.Fatalf("after the service came back: %d reminders, want 3", fake.count("/ana"))
	}
	_ = g.db.Read.QueryRow(`SELECT fails FROM push_subs WHERE user_id = ?`, anaID).Scan(&fails)
	if fails != 0 {
		t.Fatalf("the browser's failures after one went through: %d", fails)
	}
	// The last word, refused on the 8th day, goes on the 9th; then nothing.
	fake.answering("/ana", http.StatusForbidden)
	clock = start.AddDate(0, 0, 8).Add(20 * time.Hour)
	s.remindSent(t.Context(), clock)
	fake.answering("/ana", 0)
	for d := 9; d <= 10; d++ {
		clock = start.AddDate(0, 0, d).Add(20 * time.Hour)
		s.remindSent(t.Context(), clock)
	}
	var lasts, reached int
	_ = g.db.Read.QueryRow(`SELECT count(*), count(*) FILTER (WHERE delivered > 0) FROM push_reminded
		WHERE user_id = ? AND last`, anaID).Scan(&lasts, &reached)
	if fake.count("/ana") != 4 || lasts != 2 || reached != 1 {
		t.Fatalf("the last word: %d pushes, %d claimed, %d reached", fake.count("/ana"), lasts, reached)
	}
}

// A day's reminder queued is written as it's sent, and not sent to a player who has played the day meanwhile.
func TestReminderNotSentOncePlayed(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	bo, boID := g.guest()
	subscribe(bo, "/bo")
	evening := time.Date(2030, 1, 1, 19, 5, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return evening }
	if n := s.remind(t.Context(), evening); n != 1 {
		t.Fatalf("reminded %d", n)
	}
	g.finishedDay(boID, evening.Truncate(24*time.Hour), 19*time.Hour)
	_, _ = g.db.Write.Exec(`UPDATE runs SET day = '2030-01-01'`)
	s.sendQueued(t.Context())
	var delivered, queued int
	_ = g.db.Read.QueryRow(`SELECT delivered, (SELECT count(*) FROM push_queue) FROM push_reminded`).Scan(&delivered, &queued)
	if fake.count("/bo") != 0 || delivered != 0 || queued != 0 {
		t.Fatalf("pushes %d, delivered %d, left %d", fake.count("/bo"), delivered, queued)
	}
}

// A service that's busy is tried again, after a while, a few times; then the notification is given up on. Each
// try carries the same tag, so that the device shows it once.
func TestBusyTriedAgain(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	subscribe(ana, "/ana")
	clock := s.game.Now()
	s.game.Now = func() time.Time { return clock }
	m := push.Message{Title: "Т", Body: "Т", URL: "/"}
	fake.answering("/ana", http.StatusServiceUnavailable)
	s.notifySent(t.Context(), pushFriends, m, anaID)
	var id, tries int
	_ = g.db.Read.QueryRow(`SELECT id, tries FROM push_queue`).Scan(&id, &tries)
	if id == 0 || tries != 1 {
		t.Fatalf("a busy service's notification: row %d, tries %d", id, tries)
	}
	clock = clock.Add(pushBackoff[0] - time.Second)
	s.sendQueued(t.Context())
	if _ = g.db.Read.QueryRow(`SELECT tries FROM push_queue`).Scan(&tries); tries != 1 {
		t.Fatal("tried again before its time")
	}
	fake.answering("/ana", 0)
	clock = clock.Add(2 * time.Second)
	s.sendQueued(t.Context())
	var left int
	_ = g.db.Read.QueryRow(`SELECT count(*) FROM push_queue`).Scan(&left)
	if fake.count("/ana") != 1 || left != 0 || fake.topic("/ana") != "n"+strconv.Itoa(id) {
		t.Fatalf("tried again: %d pushes, %d left, topic %q", fake.count("/ana"), left, fake.topic("/ana"))
	}

	// Busy at every try: given up on after pushTries.
	fake.answering("/ana", http.StatusTooManyRequests)
	s.notifySent(t.Context(), pushFriends, m, anaID)
	for range pushTries {
		clock = clock.Add(time.Hour)
		s.sendQueued(t.Context())
	}
	_ = g.db.Read.QueryRow(`SELECT count(*) FROM push_queue`).Scan(&left)
	if left != 0 {
		t.Fatalf("given up: %d left", left)
	}
}

// A browser whose service refuses every push for a week, three tries at least, is forgotten; before, it's kept.
func TestRefusingDevicesForgotten(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	subscribe(ana, "/ana")
	clock := s.game.Now()
	s.game.Now = func() time.Time { return clock }
	fake.answering("/ana", http.StatusForbidden)
	m := push.Message{Title: "Т", Body: "Т", URL: "/"}
	for _, after := range []time.Duration{0, 24 * time.Hour, 5 * 24 * time.Hour} {
		clock = clock.Add(after)
		s.notifySent(t.Context(), pushFriends, m, anaID)
	}
	if len(devicesOf(g, anaID)) != 1 {
		t.Fatal("forgotten within the week")
	}
	clock = clock.Add(2 * 24 * time.Hour)
	s.notifySent(t.Context(), pushFriends, m, anaID)
	if len(devicesOf(g, anaID)) != 0 {
		t.Fatal("kept after a week of refusals")
	}
}

// What's queued survives a restart: a stop finishes the sends begun and begins none; a crash mid-send leaves its rows
// to be sent again once their lease is over, under the same tag.
func TestQueueSurvivesRestart(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	bo, boID := g.guest()
	subscribe(ana, "/ana")
	subscribe(bo, "/bo")
	clock := s.game.Now()
	s.game.Now = func() time.Time { return clock }
	s.notify(t.Context(), pushFriends, push.Message{Title: "Т", Body: "Т", URL: "/"}, anaID, boID)

	// Stopped before it began: nothing sent, nothing lost.
	stopped, stop := context.WithCancel(t.Context())
	stop()
	s.Push(stopped)
	var left int
	if _ = g.db.Read.QueryRow(`SELECT count(*) FROM push_queue`).Scan(&left); left != 2 || fake.count("/ana")+fake.count("/bo") != 0 {
		t.Fatalf("a stop: %d left, %d sent", left, fake.count("/ana")+fake.count("/bo"))
	}
	// A crash with Ana's row leased: Bo's goes after the restart, Ana's once the lease is over.
	leased, err := s.claimPushes(t.Context(), 1)
	if err != nil || len(leased) != 1 || leased[0].user != anaID {
		t.Fatalf("leased %+v %v", leased, err)
	}
	s.sendQueued(t.Context())
	if fake.count("/ana") != 0 || fake.count("/bo") != 1 {
		t.Fatalf("after the restart: ana %d, bo %d", fake.count("/ana"), fake.count("/bo"))
	}
	clock = clock.Add(pushLease + time.Second)
	s.sendQueued(t.Context())
	if fake.count("/ana") != 1 || fake.count("/bo") != 1 || fake.topic("/ana") != "n"+strconv.FormatInt(leased[0].id, 10) {
		t.Fatalf("after the lease: ana %d, bo %d, tag %q", fake.count("/ana"), fake.count("/bo"), fake.topic("/ana"))
	}
	// Running, it sends as things are queued, and stops when told.
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		s.Push(ctx)
		close(done)
	}()
	s.notify(t.Context(), pushFriends, push.Message{Title: "Т", Body: "Т", URL: "/"}, boID)
	for deadline := time.Now().Add(5 * time.Second); fake.count("/bo") < 2 && time.Now().Before(deadline); {
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
	if fake.count("/bo") != 2 {
		t.Fatalf("running: bo %d", fake.count("/bo"))
	}
}

// slowPush is a push service that takes its time (latency), hangs on /hang/… (then busy, or taking it if hangOK),
// refuses /junk/…, and keeps how many it took (/hang/… aside), at most at once, and when the last.
type slowPush struct {
	latency, hang  time.Duration
	hangOK         bool
	inflight, peak atomic.Int64
	sent           atomic.Int64
	mu             sync.Mutex
	last           time.Time
}

func (f *slowPush) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	n := f.inflight.Add(1)
	defer f.inflight.Add(-1)
	for p := f.peak.Load(); n > p && !f.peak.CompareAndSwap(p, n); p = f.peak.Load() {
	}
	switch {
	case strings.HasPrefix(r.URL.Path, "/hang"):
		time.Sleep(f.hang)
		if f.hangOK {
			w.WriteHeader(http.StatusCreated)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	case strings.HasPrefix(r.URL.Path, "/junk"):
		time.Sleep(f.latency)
		w.WriteHeader(http.StatusBadRequest)
	default:
		time.Sleep(f.latency)
		f.sent.Add(1)
		f.mu.Lock()
		f.last = time.Now()
		f.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
	}
}

// crowding is a crowd of players due the evening's reminder: n of them, each with a browser at a push service that
// takes latency to answer; the first hangs of them at a service that takes hang (its own when apart, else the
// same); and one more player with junk subscriptions the service refuses (as if kept before the limits).
type crowding struct {
	n, hangs, junk int
	latency, hang  time.Duration
	apart, hangOK  bool
}

// crowd is a server with that crowd, and the service everyone but the hanging (when apart) is at.
func crowd(t testing.TB, c crowding) (*Server, *slowPush) {
	t.Helper()
	service := func() (*slowPush, *httptest.Server) {
		fake := &slowPush{latency: c.latency, hang: c.hang, hangOK: c.hangOK}
		ps := httptest.NewUnstartedServer(fake)
		ps.EnableHTTP2 = true
		ps.StartTLS()
		t.Cleanup(ps.Close)
		return fake, ps
	}
	fake, ps := service()
	sps := ps
	if c.apart {
		_, sps = service()
	}
	pub, priv, _ := push.NewKeys()
	keys, _ := push.ParseKeys(pub, priv)
	// One client for both, as in production; the test servers' certificates both trusted.
	client := ps.Client()
	if c.apart {
		pool := client.Transport.(*http.Transport).TLSClientConfig.RootCAs
		pool.AddCert(sps.Certificate())
	}
	client.Timeout = 15 * time.Second // as in production
	db := storetest.Open(t)
	out := mail.NewOutbox(db, &inbox{}, "a@almanac.bg")
	s, err := New(Config{PublicURL: "http://localhost", Push: &push.Sender{Keys: keys, Subject: "mailto:a@b.bg", Client: client,
		Services: []string{ps.Listener.Addr().String(), sps.Listener.Addr().String()}}},
		Deps{DB: db, Accounts: NewAccounts(db, out, []byte("x")), Outbox: out, Bank: banktest.Sample(t)})
	if err != nil {
		t.Fatal(err)
	}
	s.game.Now = daytime()
	browser, _ := ecdh.P256().GenerateKey(rand.Reader)
	p256dh := base64.RawURLEncoding.EncodeToString(browser.PublicKey().Bytes())
	auth := base64.RawURLEncoding.EncodeToString([]byte("0123456789abcdef"))
	tx, err := db.Write.Begin()
	if err != nil {
		t.Fatal(err)
	}
	add := func(endpoint string, user int64) {
		if _, err := tx.Exec(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, 0)`,
			endpoint, user, p256dh, auth); err != nil {
			t.Fatal(err)
		}
	}
	for i := range c.n + 1 {
		res, err := tx.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Играч', ?, 0, 0)`, fmt.Sprint("p", i))
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		switch {
		case i == 0:
			for j := range c.junk {
				add(ps.URL+fmt.Sprintf("/junk/%d", j), id)
			}
		case i <= c.hangs:
			add(sps.URL+fmt.Sprintf("/hang/%d", i), id)
		default:
			add(ps.URL+fmt.Sprintf("/ok/%d", i), id)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return s, fake
}

// The evening's reminders go out many at once: a slow service, a few devices that hang and a player with many junk
// subscriptions hold up nobody else.
func TestRemindersGoOutTogether(t *testing.T) {
	s, fake := crowd(t, crowding{n: 200, hangs: 3, junk: 1000, latency: 50 * time.Millisecond, hang: 2 * time.Second})
	evening := time.Date(2030, 1, 1, 19, 5, 0, 0, bulgaria())
	begin := time.Now()
	if n := s.remindSent(t.Context(), evening); n != 201 {
		t.Fatalf("reminded %d", n)
	}
	fake.mu.Lock()
	last := fake.last.Sub(begin)
	fake.mu.Unlock()
	// One at a time, as before, the 197 that go through would take 10 s at 50 ms, and the hanging ones 6 s more. The
	// bounds leave room for a slow machine: under the race detector on a CI runner's few cores, encrypting each push
	// is what limits how many are in flight, not the pool.
	if fake.sent.Load() != 197 || last > 8*time.Second || fake.peak.Load() < 8 {
		t.Fatalf("%d sent, the last after %v, %d at once at most", fake.sent.Load(), last, fake.peak.Load())
	}
}

// TestScaleRemind measures how long the evening's reminders take (SCALE=players, LATENCY=50ms, HANGS=, HANG=3s,
// JUNK=; APART=1: the hanging ones at a push service of their own, one that's slow or down; HANGOK=1: that answers,
// slowly, rather than failing).
func TestScaleRemind(t *testing.T) {
	n, _ := strconv.Atoi(os.Getenv("SCALE"))
	if n == 0 {
		t.Skip("SCALE=<players> to measure")
	}
	latency, _ := time.ParseDuration(os.Getenv("LATENCY"))
	hangs, _ := strconv.Atoi(os.Getenv("HANGS"))
	hang, err := time.ParseDuration(os.Getenv("HANG"))
	if err != nil {
		hang = 3 * time.Second
	}
	junk, _ := strconv.Atoi(os.Getenv("JUNK"))
	apart, hangOK := os.Getenv("APART") != "", os.Getenv("HANGOK") != ""
	s, fake := crowd(t, crowding{n: n, hangs: hangs, junk: junk, latency: latency, hang: hang, apart: apart, hangOK: hangOK})
	evening := time.Date(2030, 1, 1, 19, 5, 0, 0, bulgaria())
	begin := time.Now()
	queued := s.remind(t.Context(), evening)
	claimed := time.Since(begin)
	s.sendQueued(t.Context())
	took := time.Since(begin)
	fake.mu.Lock()
	last := fake.last.Sub(begin)
	fake.mu.Unlock()
	t.Logf("players %d latency %v hangs %d (%v, apart %v, answering %v) junk %d: reminded %d (claimed and queued in %v), delivered %d, all done in %v, last honest push at %v, peak in flight %d",
		n, latency, hangs, hang, apart, hangOK, junk, queued, claimed.Round(time.Millisecond), fake.sent.Load(), took.Round(time.Millisecond),
		last.Round(time.Millisecond), fake.peak.Load())
}

// Nights are quiet: a notification due from 22:00 to 08:00 waits for the morning, or, of no use by then, goes
// nowhere; a day's reminder found due late waits for tomorrow.
func TestQuietNights(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	subscribe(ana, "/ana")
	at := func(day, hour, minute int) time.Time { return time.Date(2030, 1, day, hour, minute, 0, 0, bulgaria()) }
	clock := at(7, 23, 30)
	s.game.Now = func() time.Time { return clock }
	m := push.Message{Title: "Т", Body: "Т", URL: "/"}

	s.notifySent(t.Context(), pushFriends, m, anaID) // a friend request at 23:30
	var next int64
	_ = g.db.Read.QueryRow(`SELECT next_at FROM push_queue`).Scan(&next)
	if fake.count("/ana") != 0 || next != at(8, 8, 0).UnixMilli() {
		t.Fatalf("at night: %d sent, the rest at %v", fake.count("/ana"), time.UnixMilli(next).In(bulgaria()))
	}
	clock = at(8, 7, 59)
	s.sendQueued(t.Context())
	if fake.count("/ana") != 0 {
		t.Fatal("sent before the morning")
	}
	clock = at(8, 8, 0)
	s.sendQueued(t.Context())
	if fake.count("/ana") != 1 {
		t.Fatal("not sent in the morning")
	}

	// Of no use by the morning: not queued.
	clock = at(8, 23, 0)
	err := s.db.Tx(t.Context(), func(tx *sql.Tx) error {
		n, err := s.queue(t.Context(), tx, notice{kind: pushFriends, m: m, until: at(9, 1, 0)}, anaID)
		if n != 0 {
			t.Fatalf("queued %d of no use by the morning", n)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	// Queued in the evening, sent in the night (a backlog, a try again): the morning, or, for a day's reminder, never.
	clock = at(9, 21, 59)
	err = s.db.Tx(t.Context(), func(tx *sql.Tx) error {
		if _, err := s.queue(t.Context(), tx, notice{kind: pushFriends, m: m}, anaID); err != nil {
			return err
		}
		_, err := s.queue(t.Context(), tx, notice{kind: pushDay, m: m, day: "2030-01-09", until: at(10, 0, 0)}, anaID)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	clock = at(9, 22, 1)
	s.sendQueued(t.Context())
	var left, tries int
	_ = g.db.Read.QueryRow(`SELECT count(*), max(next_at), max(tries) FROM push_queue`).Scan(&left, &next, &tries)
	if fake.count("/ana") != 1 || left != 1 || next != at(10, 8, 0).UnixMilli() || tries != 0 {
		t.Fatalf("in the night: %d sent, %d left, next at %v, tries %d", fake.count("/ana"), left,
			time.UnixMilli(next).In(bulgaria()), tries)
	}

	// The day's reminder of one whose hour came late (just subscribed, the server back after a while): not at
	// 22:10, but at 21:59.
	_, _ = g.db.Write.Exec(`DELETE FROM push_queue`)
	clock = at(11, 22, 10)
	if n := s.remind(t.Context(), clock); n != 0 {
		t.Fatalf("reminded at 22:10: %d", n)
	}
	clock = at(11, 21, 59)
	if n := s.remindSent(t.Context(), clock); n != 1 || fake.count("/ana") != 2 {
		t.Fatalf("reminded at 21:59: %d", n)
	}
}

// A push service keeps a notification only while it's of use: the day's reminder at 21:30 till midnight, not into
// the next morning for a phone away for the night; word of a friend, half a day.
func TestPushesKeptWhileOfUse(t *testing.T) {
	s, g, fake, subscribe := pushWorld(t)
	ana, anaID := g.guest()
	subscribe(ana, "/ana")
	clock := time.Date(2030, 1, 7, 21, 30, 0, 0, bulgaria())
	s.game.Now = func() time.Time { return clock }
	if n := s.remindSent(t.Context(), clock); n != 1 || fake.count("/ana") != 1 {
		t.Fatalf("reminded %d, %d pushes", n, fake.count("/ana"))
	}
	if ttl, _ := strconv.Atoi(fake.header("/ana", "TTL")); ttl <= 0 || ttl > 9000 {
		t.Fatalf("the day's reminder at 21:30 kept %q seconds", fake.header("/ana", "TTL"))
	}
	clock = clock.Add(-8 * time.Hour)
	s.notifySent(t.Context(), pushFriends, push.Message{Title: "Т", Body: "Т", URL: "/"}, anaID)
	if ttl := fake.header("/ana", "TTL"); ttl != "43200" {
		t.Fatalf("word of a friend kept %q seconds", ttl)
	}
}

// The night's end, by the clocks of Bulgaria, on the nights they change too.
func TestMorning(t *testing.T) {
	for at, want := range map[string]string{
		"2030-01-07 21:59": "",
		"2030-01-07 22:00": "2030-01-08 08:00",
		"2030-01-08 00:00": "2030-01-08 08:00",
		"2030-01-08 07:59": "2030-01-08 08:00",
		"2030-01-08 08:00": "",
		"2030-03-30 23:00": "2030-03-31 08:00", // the clocks go forward that night
		"2030-10-26 23:00": "2030-10-27 08:00", // and back
	} {
		t0, _ := time.ParseInLocation("2006-01-02 15:04", at, bulgaria())
		got := ""
		if m := morning(t0); !m.IsZero() {
			got = m.In(bulgaria()).Format("2006-01-02 15:04")
		}
		if got != want {
			t.Errorf("%s: %q, want %q", at, got, want)
		}
	}
}
