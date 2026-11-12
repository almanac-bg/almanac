package server

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/mail"
)

// problems collects what went wrong — server errors and errors in players' browsers — so that whoever runs the game
// hears of each new kind by mail, once, rather than having to read the logs.
type problems struct {
	mu   sync.Mutex
	seen map[string]bool     // every kind since the start
	news map[string]*problem // new kinds not yet mailed
}

type problem struct {
	first time.Time
	count int
}

func newProblems() *problems {
	return &problems{seen: map[string]bool{}, news: map[string]*problem{}}
}

// add records one occurrence of a kind of problem (a short, stable description: no ids or times in it).
func (p *problems) add(kind string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if n := p.news[kind]; n != nil {
		n.count++
		return
	}
	if p.seen[kind] || len(p.seen) > 1000 {
		return
	}
	p.seen[kind] = true
	p.news[kind] = &problem{first: time.Now(), count: 1}
}

// take returns the new kinds and forgets them.
func (p *problems) take() map[string]*problem {
	p.mu.Lock()
	defer p.mu.Unlock()
	news := p.news
	p.news = map[string]*problem{}
	return news
}

// Problem records a problem from outside a request (a failed backup), to be mailed like the rest.
func (s *Server) Problem(kind string) { s.problems.add(kind) }

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
		news := s.problems.take()
		if len(news) == 0 {
			continue
		}
		kinds := make([]string, 0, len(news))
		for k := range news {
			kinds = append(kinds, k)
		}
		slices.Sort(kinds)
		var b strings.Builder
		fmt.Fprintf(&b, "Нови проблеми в %s (%s), всеки за пръв път:\n\n", s.cfg.PublicURL, s.cfg.Version)
		for _, k := range kinds {
			fmt.Fprintf(&b, "%s ×%d (от %s)\n  %s\n\n", news[k].first.Format("15:04"), news[k].count, news[k].first.Format("02.01"), k)
		}
		b.WriteString("Подробностите са в лога: journalctl -u almanac\n")
		err := s.db.Tx(ctx, func(tx *sql.Tx) error {
			return s.outbox.Enqueue(tx, mail.Message{To: to, Subject: fmt.Sprintf("АЛМАНАХ: %d нови проблема", len(kinds)), Text: b.String()})
		})
		if err != nil {
			slog.Error("mailing problems", "err", err)
			continue
		}
		s.outbox.Wake()
	}
}

// clientError takes an error from a player's browser: logged, and counted as a problem.
func (s *Server) clientError(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Message string `json:"message"`
		Where   string `json:"where"`
		Stack   string `json:"stack"`
		Page    string `json:"page"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.limits.allow("client-error:"+s.clientIP(r), 20, time.Hour) {
		return errTooMany
	}
	cut := func(s string, n int) string {
		if len(s) > n {
			return s[:n]
		}
		return s
	}
	slog.Warn("client error", "message", cut(in.Message, 300), "where", cut(in.Where, 200), "page", cut(in.Page, 200),
		"stack", cut(in.Stack, 2000), "ua", cut(r.UserAgent(), 200))
	s.problems.add("browser: " + cut(in.Message, 200) + " at " + cut(in.Where, 120))
	return ok(w, map[string]bool{"ok": true})
}
