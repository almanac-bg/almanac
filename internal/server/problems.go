package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/almanac-bg/almanac/internal/mail"
)

// problems collects what went wrong, so that whoever runs the game hears of each new kind once a day, rather than
// having to read the logs: by mail (ALERT_EMAIL).
//
// What anyone can send must never silence what the server says itself, so each source has a budget of its own:
//   - background work (a failed backup): never capped; only the code says these, a few a day at most.
//   - the server's own kinds (an error, a panic, a question reported): what its code can say, so never filled from
//     outside; serverKinds a day, a guard on memory alone.
//   - the kinds players' browsers report (/api/errors): whatever anyone sends, so few (browserKinds a day), their
//     text made plain (one line, no numbers, no addresses but the game's own) and set apart in the mail as text from
//     outside.
//
// Past a budget, a new kind is only counted, and the mail says how many there were. The kinds told are forgotten
// daily, so one that goes on is heard of again the next day, and a budget is whole again.
//
// What was told today is kept over a restart (kv 'problems_told', written with the mail that tells it, read by New):
// a deploy, many a day, mails again no problem that goes on, nor makes a budget whole.
type problems struct {
	mu    sync.Mutex
	now   func() time.Time // the clock (tests); nil: time.Now
	since time.Time        // when the kinds told were last forgotten
	told  map[string]bool  // every kind told since
	kinds [sources]int     // how many of each source's kinds were told since
	news  map[string]*problem
	over  [sources]int // kinds past their source's budget since the last mail
}

// source is where a problem comes from, for its budget.
type source int

const (
	background source = iota
	fromServer
	fromBrowser
	sources
)

const (
	serverKinds  = 200
	browserKinds = 20
)

// budget is how many kinds of a source are told a day (0: no end).
var budget = [sources]int{background: 0, fromServer: serverKinds, fromBrowser: browserKinds}

type problem struct {
	first time.Time
	count int
	from  source
}

func newProblems() *problems {
	return &problems{told: map[string]bool{}, news: map[string]*problem{}}
}

func (p *problems) clock() time.Time {
	if p.now != nil {
		return p.now()
	}
	return time.Now()
}

// add records one problem of the server's own (a short, stable description: no ids or times in it).
func (p *problems) add(kind string) { p.note(kind, fromServer) }

// note records one occurrence of a kind of problem, from a source.
func (p *problems) note(kind string, from source) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.clock()
	if now.Sub(p.since) >= 24*time.Hour {
		p.told = map[string]bool{}
		p.kinds = [sources]int{}
		p.since = now
	}
	if n := p.news[kind]; n != nil {
		n.count++
		return
	}
	if p.told[kind] {
		return
	}
	if most := budget[from]; most > 0 && p.kinds[from] >= most {
		p.over[from]++
		return
	}
	p.kinds[from]++
	p.told[kind] = true
	p.news[kind] = &problem{first: now, count: 1, from: from}
}

// take returns the new kinds and how many were past each budget, and forgets them.
func (p *problems) take() (map[string]*problem, [sources]int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	news, over := p.news, p.over
	p.news, p.over = map[string]*problem{}, [sources]int{}
	return news, over
}

// toldKey is the kv row that keeps what was told today (problemsTold) over a restart.
const toldKey = "problems_told"

// problemsTold is what was told today, as the database keeps it.
type problemsTold struct {
	Since int64        `json:"since"` // ms
	Told  []string     `json:"told"`
	Kinds [sources]int `json:"kinds"`
}

// toldToday is what has been told today as the database keeps it: every kind told but those still waiting to be.
func (p *problems) toldToday() ([]byte, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	t := problemsTold{Since: p.since.UnixMilli(), Told: []string{}, Kinds: p.kinds}
	for k := range p.told {
		if p.news[k] == nil {
			t.Told = append(t.Told, k)
		}
	}
	slices.Sort(t.Told)
	return json.Marshal(t)
}

// restore takes back what was told today as the database kept it (toldToday), unless it's a day old.
func (p *problems) restore(kept []byte) {
	var t problemsTold
	if json.Unmarshal(kept, &t) != nil {
		return
	}
	since := time.UnixMilli(t.Since)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.clock().Sub(since) >= 24*time.Hour {
		return
	}
	p.since, p.kinds = since, t.Kinds
	for _, k := range t.Told {
		p.told[k] = true
	}
}

// restoreProblems takes back what was told today, before this start (tellProblems).
func (s *Server) restoreProblems(ctx context.Context) error {
	var kept string
	err := s.db.Read.QueryRowContext(ctx, `SELECT value FROM kv WHERE key = ?`, toldKey).Scan(&kept)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	s.problems.restore([]byte(kept))
	return nil
}

// Problem records a problem from outside a request (a failed backup), to be mailed like the rest.
func (s *Server) Problem(kind string) { s.problems.note(kind, background) }

// problemsFirst is how soon after the start the first mail goes: what a start finds (the last run's crash, a panic
// as it loads) is heard of at once, not an hour on, when a server falling over again may be gone.
const problemsFirst = time.Minute

// Alerts is where problems are told: an address to mail.
type Alerts struct {
	Email string
}

// TellProblems tells whatever new problems there are where Config.Alerts says (nowhere: it returns at once),
// problemsFirst after the start and every period after, until ctx ends; and then once more, so that what the run found
// last isn't lost with it (a mail waits in the outbox for the next run, if this one can't send it).
func (s *Server) TellProblems(ctx context.Context, period time.Duration) {
	to := s.cfg.Alerts
	if to == (Alerts{}) {
		return
	}
	t := time.NewTimer(min(problemsFirst, period))
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			last, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			s.tellProblems(last, to)
			cancel()
			return
		case <-t.C:
			t.Reset(period)
		}
		s.tellProblems(ctx, to)
	}
}

// tellProblems mails the new problems, if there are any, and keeps what has been told today with the mail.
func (s *Server) tellProblems(ctx context.Context, to Alerts) {
	news, over := s.problems.take()
	text := problemsMail(news, over, s.cfg.PublicURL, s.cfg.Version)
	if text == "" {
		return
	}
	subject := problemsSubject(len(news) + over[fromServer] + over[fromBrowser])
	if to.Email == "" {
		return
	}
	told, err := s.problems.toldToday()
	if err != nil {
		slog.Error("mailing problems", "err", err)
		return
	}
	err = s.db.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
			toldKey, string(told)); err != nil {
			return err
		}
		return s.outbox.Enqueue(tx, mail.Message{To: to.Email, Subject: subject, Text: text})
	})
	if err != nil {
		slog.Error("mailing problems", "err", err)
		return
	}
	s.outbox.Wake()
}

// problemsMail is the mail about new problems ("": none): the server's first, then the browsers', apart.
func problemsMail(news map[string]*problem, over [sources]int, site, version string) string {
	if len(news) == 0 && over == [sources]int{} {
		return ""
	}
	var ours, theirs []string
	for k, p := range news {
		if p.from == fromBrowser {
			theirs = append(theirs, k)
		} else {
			ours = append(ours, k)
		}
	}
	slices.Sort(ours)
	slices.Sort(theirs)
	var b strings.Builder
	list := func(kinds []string) {
		for _, k := range kinds {
			fmt.Fprintf(&b, "%s ×%d (от %s)\n  %s\n\n", news[k].first.Format("15:04"), news[k].count, news[k].first.Format("02.01"), k)
		}
	}
	fmt.Fprintf(&b, "Нови проблеми в %s (%s), всеки за пръв път днес:\n\n", site, version)
	list(ours)
	if over[fromServer] > 0 {
		fmt.Fprintf(&b, "Още %d от сървъра, над %d вида за ден: само в дневника.\n\n", over[fromServer], serverKinds)
	}
	if len(theirs) > 0 || over[fromBrowser] > 0 {
		b.WriteString("От браузърите на играчите. Текстът е какъвто го е пратил браузърът, а може да го е пратил всеки: " +
			"не е от нас.\n\n")
		list(theirs)
		if over[fromBrowser] > 0 {
			fmt.Fprintf(&b, "Още %d от браузърите, над %d вида за ден: само в дневника.\n\n", over[fromBrowser], browserKinds)
		}
	}
	b.WriteString("Подробностите са в дневника: journalctl -u almanac\n")
	return b.String()
}

var (
	// anAddress is a web address in a browser's report, or one that looks like it.
	anAddress = regexp.MustCompile(`(?i)\b[a-z][a-z0-9+.-]*://\S*|\bwww\.\S+`)
	// aNumber is a number standing alone (a line, a column, a count), not one inside a word (a file's hash).
	aNumber = regexp.MustCompile(`\b\d+\b`)
)

// plainKind is a browser's text as a kind of problem: on one line, the game's own address left out and any other
// replaced (no links from outside in the mail), numbers as # (the same error at another line or count is one
// kind), and n letters at most.
func plainKind(text, site string, n int) string {
	if site != "" {
		text = strings.ReplaceAll(text, site, "")
	}
	text = anAddress.ReplaceAllString(text, "[адрес]")
	text = aNumber.ReplaceAllString(text, "#")
	text = strings.Join(strings.Fields(text), " ")
	if utf8.RuneCountInString(text) > n {
		text = string([]rune(text)[:n]) + "…"
	}
	return text
}

// cut is s in n bytes at most, not splitting a letter.
func cut(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// How many errors browsers may report in an hour: from a network (a school's, behind one address, has many browsers
// that could all break at once, but each reports 10 at most), and from a site (a few such networks). Past
// clientErrorsAll from everyone together, which only floods send, one in clientErrorsSample is logged, and the rest
// counted in the log's next line: the log stays readable, and a real error is never refused for others' flood
// (review 2026-11-18, S10). Each still counts as a problem, which has a budget of its own (browserKinds).
const (
	clientErrorsNet    = 20
	clientErrorsSite   = 5 * clientErrorsNet
	clientErrorsAll    = 300
	clientErrorsSample = 20
)

// harmlessBrowser is what browsers say that is no fault of the page: a ResizeObserver's callback that changed the
// layout again in the same frame (the next frame catches up).
var harmlessBrowser = regexp.MustCompile(`^ResizeObserver loop (completed with undelivered notifications|limit exceeded)`)

// clientError takes an error from a player's browser: logged, and counted as a problem. No session is needed: a page
// that breaks before it has one (a new player's first) is the one most worth hearing of. A page of another version
// (loaded before a deploy) is only logged: it loads itself anew soon (web/src/fresh.ts), and what is still wrong then
// is told by the page of this one.
func (s *Server) clientError(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Message string `json:"message"`
		Where   string `json:"where"`
		Stack   string `json:"stack"`
		Page    string `json:"page"`
		Version string `json:"version"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.guardFrom(r, "client-error", clientErrorsNet, clientErrorsSite, time.Hour) {
		return errTooMany
	}
	if s.guard.allow("client-error", clientErrorsAll, time.Hour) {
		s.logClientError(r, in.Message, in.Where, in.Page, in.Stack, in.Version, 0)
	} else if n := s.unlogged.Add(1); n%clientErrorsSample == 0 {
		s.unlogged.Add(-n)
		s.logClientError(r, in.Message, in.Where, in.Page, in.Stack, in.Version, int(n)-1)
	}
	if in.Version != "" && in.Version != s.cfg.Version {
		return ok(w, map[string]bool{"ok": true})
	}
	// A browser's word that is no fault of the page (lib/errors.ts, harmless; pages of before it still send it): logged,
	// never mailed.
	if harmlessBrowser.MatchString(in.Message) {
		return ok(w, map[string]bool{"ok": true})
	}
	site := s.cfg.PublicURL
	s.problems.note("browser: "+plainKind(in.Message, site, 160)+" at "+plainKind(in.Where, site, 100), fromBrowser)
	return ok(w, map[string]bool{"ok": true})
}

// logClientError writes a browser's error to the log, with how many weren't logged before it (past clientErrorsAll).
func (s *Server) logClientError(r *http.Request, message, where, page, stack, version string, unlogged int) {
	slog.Warn("client error", "message", logLine(message, 300), "where", logLine(where, 200),
		"page", logLine(pageRoute(page), 200), "stack", logLine(stack, 2000), "ua", logLine(r.UserAgent(), 200),
		"version", logLine(version, 40), "unlogged", unlogged)
}

// logLine is a browser's text for the log: cut, and on one line (a stack's lines joined by " | "), so what a browser
// sends can never pass for a line of the server's own (the JSON log escapes it as well).
func logLine(s string, n int) string {
	return strings.ReplaceAll(strings.ReplaceAll(cut(s, n), "\r", ""), "\n", " | ")
}
