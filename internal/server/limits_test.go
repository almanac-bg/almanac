package server

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// A player's page is within the read budget, and says whether a tag is someone's only by the counted lookup (profileOf):
// past a network's misses, it no longer tells a tag that is someone's from one that isn't (review 2026-11-18, S12).
func TestPlayerPagesTellNoMoreThanTheAPI(t *testing.T) {
	g := start(t)
	p, _ := g.guest()
	tag := tagOf(p)
	get := func(path string) int {
		t.Helper()
		res, err := http.Get(g.url + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	if real, absent := get("/players/"+tag), get("/players/nobody0"); real != 200 || absent != 404 {
		t.Fatalf("within the budget: real %d, absent %d", real, absent)
	}
	for n := range profileMissesNet {
		get(fmt.Sprintf("/players/nobody%d", n+1))
	}
	if real, absent := get("/players/"+tag), get("/players/nobody999"); real != absent {
		t.Errorf("past the misses: real %d, absent %d: the page still tells them apart", real, absent)
	}
	// Pages share the API's read budget: past it, a page is refused as a call is.
	for range readsNet {
		get("/me")
	}
	if status := get("/"); status != http.StatusTooManyRequests {
		t.Errorf("a page past the network's reads: %d", status)
	}
}

// clock is a time the test moves.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newClock() *clock { return &clock{t: time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)} }

// A window ends a period after its first count, and the key is forgotten then: not kept for a day whatever its
// period.
func TestLimiterWindowEndsByItsPeriod(t *testing.T) {
	c := newClock()
	l := newLimiter()
	l.now = c.now
	for i := range 3 {
		if !l.allow("k", 3, time.Minute) {
			t.Fatalf("count %d refused", i+1)
		}
	}
	if l.allow("k", 3, time.Minute) || !l.spent("k", 3) {
		t.Fatal("a fourth in the minute")
	}
	c.add(time.Minute)
	if l.spent("k", 3) || !l.allow("k", 3, time.Minute) {
		t.Fatal("the window didn't end with its minute")
	}
	c.add(2 * time.Minute) // past the window's end, and a minute since its shard's last sweep
	other := "other"
	for i := 0; l.shard(other) != l.shard("k"); i++ {
		other = fmt.Sprint("other", i)
	}
	l.allow(other, 1, time.Hour)
	if n := l.keys(); n != 1 {
		t.Fatalf("keys after the sweep: %d, want 1", n)
	}
}

// However many keys come, the limiter holds no more than its most; a key pushed out is the one nearest its end.
func TestLimiterBounded(t *testing.T) {
	l := newLimiterOf(limitShards * 2) // two keys a shard: a full shard's every key is looked at
	l.now = newClock().now
	for i := range 10_000 {
		l.allow(fmt.Sprint("flood:", i), 1, time.Hour)
	}
	if n := l.keys(); n > limitShards*2 {
		t.Fatalf("%d keys, want %d at most", n, limitShards*2)
	}

	l = newLimiterOf(limitShards * 2)
	l.now = newClock().now
	long := "long"
	var short, next string
	for i := 0; short == "" || next == ""; i++ {
		k := fmt.Sprint("k", i)
		if l.shard(k) != l.shard(long) {
			continue
		}
		if short == "" {
			short = k
		} else {
			next = k
		}
	}
	l.allow(long, 1, 24*time.Hour)
	l.allow(short, 1, time.Minute)
	l.allow(next, 1, time.Hour)
	if !l.spent(long, 1) || l.spent(short, 1) || !l.spent(next, 1) {
		t.Fatal("the key pushed out wasn't the one nearest its end")
	}
}

// A flood of new keys pushes out its own and the barely used, not the budgets spent: a site's code limit spent stays
// spent however many keys come after it (review 2026-11-18, S8). And the server hears of the flood, once a minute.
func TestLimiterFloodKeepsSpentBudgets(t *testing.T) {
	c := newClock()
	l := newLimiterOf(limitShards * 64)
	l.now = c.now
	full := 0
	l.onFull = func() { full++ }
	for range 50 {
		l.allow("code:site:2001:db8::/48", 50, time.Hour)
	}
	for i := range 100_000 {
		l.allow(fmt.Sprint("tally:", i), 30, 24*time.Hour) // windows that end later than the spent one
	}
	if l.allow("code:site:2001:db8::/48", 50, time.Hour) {
		t.Fatal("a flood of keys gave a spent budget whole again")
	}
	if full != 1 {
		t.Fatalf("told of the flood %d times in a minute, want once", full)
	}
	c.add(time.Minute)
	l.allow("one more", 1, time.Hour)
	if full != 2 {
		t.Fatalf("told of the flood %d times over two minutes, want twice", full)
	}
}

// The counts go on over a restart: what a stopping server saves, the next restores, but for the windows that ended
// in between.
func TestLimiterOutlivesARestart(t *testing.T) {
	c := newClock()
	l := newLimiter()
	l.now = c.now
	for range 3 {
		l.allow("hour", 5, time.Hour)
	}
	l.allow("minute", 1, time.Minute)
	var file bytes.Buffer
	if n, err := l.save(&file); err != nil || n != 2 {
		t.Fatalf("saved %d (%v)", n, err)
	}

	c.add(2 * time.Minute) // the restart
	next := newLimiter()
	next.now = c.now
	if n, err := next.restore(&file); err != nil || n != 1 {
		t.Fatalf("restored %d (%v), want the hour's only", n, err)
	}
	if !next.allow("hour", 5, time.Hour) || !next.allow("hour", 5, time.Hour) || next.allow("hour", 5, time.Hour) {
		t.Fatal("the hour's count didn't go on from 3")
	}
	if !next.allow("minute", 1, time.Minute) {
		t.Fatal("a window that ended came back")
	}
}

// Many requests at once, over the shards (with -race).
func TestLimiterAtOnce(t *testing.T) {
	l := newLimiter()
	var wg sync.WaitGroup
	allowed := make([]int, 8)
	for g := range 8 {
		wg.Go(func() {
			for i := range 1000 {
				if l.allow("shared", 100, time.Hour) {
					allowed[g]++
				}
				l.allow(fmt.Sprint(g, ":", i), 1, time.Hour)
			}
		})
	}
	wg.Wait()
	sum := 0
	for _, n := range allowed {
		sum += n
	}
	if sum != 100 {
		t.Fatalf("%d allowed of a shared 100", sum)
	}
}

// A stopping server keeps its limits' counts in Config.LimitsFile, and the next one takes them, once: a deploy gives
// no budget whole again.
func TestLimitsKeptOverARestart(t *testing.T) {
	file := filepath.Join(t.TempDir(), "limits.json")
	g := start(t)
	g.srv.cfg.LimitsFile = file
	p := g.player()
	for range clientErrorsNet {
		p.call("POST", "/api/errors", map[string]string{"message": "boom", "where": "x"})
	}
	g.srv.saveLimits()

	next := start(t)
	next.srv.cfg.LimitsFile = file
	next.srv.restoreLimits()
	if status, _ := next.player().call("POST", "/api/errors", map[string]string{"message": "boom", "where": "x"}); status != 429 {
		t.Fatalf("after a restart, the spent budget: %d", status)
	}
	if _, err := os.Stat(file); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("the file is still there: %v", err)
	}
}

// from sends a request as a page at an address would (no session), and says the answer's status and body.
func (g *game) from(addr, method, path, body string) (int, string) {
	r := httptest.NewRequest(method, g.url+path, strings.NewReader(body))
	r.RemoteAddr = net.JoinHostPort(addr, "1234")
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	w := httptest.NewRecorder()
	g.srv.Handler().ServeHTTP(w, r)
	return w.Code, w.Body.String()
}

// Writes are limited by session, network and site, whatever they are: one client can't take the database's writer
// (review 2026-11-18, S11). Reads have a budget of their own.
func TestWritesLimited(t *testing.T) {
	g := start(t)
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	for i := range writesSession { // the guest came before the session
		if status, _ := p.call("POST", "/api/told", map[string]string{"line": "none"}); status == 429 {
			t.Fatalf("write %d refused", i+1)
		}
	}
	if status, out := p.call("POST", "/api/told", map[string]string{"line": "none"}); status != 429 {
		t.Fatalf("past the session's writes: %d %v", status, out)
	}
	if status, _ := p.call("GET", "/api/me", nil); status != 200 {
		t.Fatalf("a read past the writes: %d", status)
	}
	if status, _ := g.player().call("POST", "/api/guest", map[string]any{}); status != 200 {
		t.Fatalf("another session of the network: %d", status)
	}
}

// Reads are limited by session, network and site too, apart from the writes: one client asking in a loop can't hold
// the read pool (audit 2026-11-24, С3).
func TestReadsLimited(t *testing.T) {
	g := start(t)
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	for i := range readsSession {
		if status, _ := p.call("GET", "/api/me", nil); status == 429 {
			t.Fatalf("read %d refused", i+1)
		}
	}
	if status, out := p.call("GET", "/api/me", nil); status != 429 {
		t.Fatalf("past the session's reads: %d %v", status, out)
	}
	if status, _ := p.call("POST", "/api/told", map[string]string{"line": "none"}); status == 429 {
		t.Fatal("a write past the reads refused")
	}

	for i := range readsNet {
		if status, _ := g.from("198.51.100.7", "GET", "/api/health", ""); status == 429 {
			t.Fatalf("the network's read %d refused", i+1)
		}
	}
	if status, _ := g.from("198.51.100.7", "GET", "/api/health", ""); status != 429 {
		t.Fatalf("past the network's reads: %d", status)
	}
	if status, _ := g.from("198.51.100.8", "GET", "/api/health", ""); status != 200 {
		t.Fatalf("another network of the site: %d", status)
	}
}

// /admin shows a bounded share of a flood of reports, and resolves every report of one player at once (S10).
func TestAdminReportsBounded(t *testing.T) {
	g := start(t)
	p := g.player()
	_, out := p.call("POST", "/api/guest", map[string]any{})
	id := int64(out["user"].(map[string]any)["id"].(float64))
	_, _ = g.db.Write.Exec(`UPDATE users SET admin = 1`)
	for i := range reportsEach + 5 {
		if _, err := g.db.Write.Exec(`INSERT INTO reports (question_id, user_id, text, at) VALUES ('geo-001', ?, ?, ?)`,
			id, fmt.Sprint("доклад ", i), i); err != nil {
			t.Fatal(err)
		}
	}
	page := func() string {
		res, err := p.client.Get(g.url + "/admin/questions")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		return string(body)
	}
	body := page()
	if !strings.Contains(body, fmt.Sprintf("Доклади (%d за 1 въпрос)", reportsEach+5)) || !strings.Contains(body, "И още 5.") ||
		strings.Contains(body, fmt.Sprint("доклад ", reportsEach)) {
		t.Fatalf("the reports on /admin: %s", body)
	}
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/admin/players/%d/reports/resolve", g.url, id), nil)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	res, err := p.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if !strings.Contains(page(), "Няма нови") {
		t.Fatal("a player's reports still open")
	}
}

// Browsers' errors past everyone's hour are still taken, one in clientErrorsSample logged; and question reports past
// everyone's hour are kept, the flood told (review 2026-11-18, S10).
func TestGlobalCapsAreAlarms(t *testing.T) {
	g := start(t)
	for range clientErrorsAll {
		g.srv.guard.allow("client-error", clientErrorsAll, time.Hour)
	}
	for i := range clientErrorsSample {
		status, _ := g.from(fmt.Sprintf("198.51.%d.1", i), "POST", "/api/errors", `{"message":"boom","where":"x"}`)
		if status != 200 {
			t.Fatalf("a browser's error past everyone's: %d", status)
		}
	}
	if n := g.srv.unlogged.Load(); n != 0 {
		t.Fatalf("%d unlogged after one in %d was logged", n, clientErrorsSample)
	}

	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	for range reportsAll {
		g.srv.guard.allow("report", reportsAll, time.Hour)
	}
	g.srv.problems.take()
	if status, _ := p.call("POST", "/api/questions/geo-001/report", map[string]string{"text": "Грешен отговор."}); status != 200 {
		t.Fatalf("a report past everyone's: %d", status)
	}
	var n int
	_ = g.db.Read.QueryRow(`SELECT count(*) FROM reports`).Scan(&n)
	news, _ := g.srv.problems.take()
	if n != 1 || len(news) != 2 { // the report, and the flood
		t.Fatalf("%d reports kept; told %v", n, news)
	}
}
