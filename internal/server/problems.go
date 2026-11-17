package server

import (
	"context"
	"database/sql"
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

// problems collects what went wrong, so that whoever runs the game hears of each new kind by mail, once a day, rather
// than having to read the logs.
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

// Problem records a problem from outside a request (a failed backup), to be mailed like the rest.
func (s *Server) Problem(kind string) { s.problems.note(kind, background) }

// MailProblems sends whatever new problems there are to `to`, every period, until ctx ends.
func (s *Server) MailProblems(ctx context.Context, to string, period time.Duration) {
	t := time.NewTicker(period)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		news, over := s.problems.take()
		text := problemsMail(news, over, s.cfg.PublicURL, s.cfg.Version)
		if text == "" {
			continue
		}
		subject := problemsSubject(len(news) + over[fromServer] + over[fromBrowser])
		err := s.db.Tx(ctx, func(tx *sql.Tx) error {
			return s.outbox.Enqueue(tx, mail.Message{To: to, Subject: subject, Text: text})
		})
		if err != nil {
			slog.Error("mailing problems", "err", err)
			continue
		}
		s.outbox.Wake()
	}
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
// that could all break at once, but each reports 10 at most), and from all of them together, which keeps the log
// readable when anyone sends floods (a real error is seen in the first few anyway).
const (
	clientErrorsNet = 20
	clientErrorsAll = 300
)

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
	if !s.allowFrom(r, "client-error", clientErrorsNet, 0, time.Hour) ||
		!s.limits.allow("client-error", clientErrorsAll, time.Hour) {
		return errTooMany
	}
	slog.Warn("client error", "message", cut(in.Message, 300), "where", cut(in.Where, 200), "page", cut(in.Page, 200),
		"stack", cut(in.Stack, 2000), "ua", cut(r.UserAgent(), 200), "version", cut(in.Version, 40))
	if in.Version != "" && in.Version != s.cfg.Version {
		return ok(w, map[string]bool{"ok": true})
	}
	site := s.cfg.PublicURL
	s.problems.note("browser: "+plainKind(in.Message, site, 160)+" at "+plainKind(in.Where, site, 100), fromBrowser)
	return ok(w, map[string]bool{"ok": true})
}
