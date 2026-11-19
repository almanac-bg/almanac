package server

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// However many kinds browsers send, the server's own problems and a failed backup are still told; past their
// budget, the browsers' are only counted.
func TestBrowsersCantSilenceProblems(t *testing.T) {
	p := newProblems()
	for i := range 1500 {
		p.note(fmt.Sprint("browser: junk ", i), fromBrowser)
	}
	p.add("panic: GET /api/day: boom")
	p.note("backup: upload failed", background)
	news, over := p.take()
	if news["panic: GET /api/day: boom"] == nil || news["backup: upload failed"] == nil {
		t.Fatal("the server's problems weren't told past the browsers'")
	}
	if len(news) != browserKinds+2 || over[fromBrowser] != 1500-browserKinds {
		t.Fatalf("%d kinds told, %d over; want %d and %d", len(news), over[fromBrowser], browserKinds+2, 1500-browserKinds)
	}

	// The server's own have a budget of their own, a guard on memory; a backup's never ends.
	for i := range serverKinds + 5 {
		p.add(fmt.Sprint("server: kind ", i))
	}
	p.note("backup: another", background)
	news, over = p.take()
	if len(news) != serverKinds-1+1 || over[fromServer] != 6 || news["backup: another"] == nil {
		t.Fatalf("%d told, %d over", len(news), over[fromServer])
	}
}

// A kind is told once a day: again the next day, if it goes on, with every budget whole again.
func TestProblemsForgottenDaily(t *testing.T) {
	c := newClock()
	p := newProblems()
	p.now = c.now
	p.add("server: x")
	p.add("server: x")
	if news, _ := p.take(); news["server: x"].count != 2 {
		t.Fatalf("counted %v", news)
	}
	p.add("server: x")
	for i := range browserKinds {
		p.note(fmt.Sprint("browser: ", i), fromBrowser)
	}
	if news, _ := p.take(); len(news) != browserKinds {
		t.Fatalf("a kind told today again, or a browser's missed: %d", len(news))
	}
	c.add(24 * time.Hour)
	p.add("server: x")
	p.note("browser: new", fromBrowser)
	if news, _ := p.take(); news["server: x"] == nil || news["browser: new"] == nil {
		t.Fatalf("the next day: %v", news)
	}
}

// A browser's text in the mail is one line, with no address but the game's own, numbers left out, and short.
func TestPlainKind(t *testing.T) {
	for in, want := range map[string]string{
		"https://almanac.bg/assets/app-3F2A.js:1:23456": "/assets/app-3F2A.js:#:#",
		"Сменете ключа тук: https://evil.example/x?y=1": "Сменете ключа тук: [адрес]",
		"see www.evil.example now":                      "see [адрес] now",
		"line one\n\nline two\tend":                     "line one line two end",
		"Expected 3 items, got 12":                      "Expected # items, got #",
	} {
		if got := plainKind(in, "https://almanac.bg", 100); got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
	if got := plainKind(strings.Repeat("я", 300), "", 10); got != strings.Repeat("я", 10)+"…" {
		t.Errorf("cut: %q", got)
	}
	if got := cut("абв", 3); got != "а" {
		t.Errorf("cut in a letter: %q", got)
	}
}

// The mail sets the browsers' text apart, as from outside, and says how many were past the budgets.
func TestProblemsMail(t *testing.T) {
	at := time.Date(2026, 11, 17, 9, 30, 0, 0, time.UTC)
	text := problemsMail(map[string]*problem{
		"panic: x":          {first: at, count: 1, from: fromServer},
		"browser: y at z":   {first: at, count: 3, from: fromBrowser},
		"backup: no bucket": {first: at, count: 1, from: background},
	}, [sources]int{fromBrowser: 7}, "https://almanac.bg", "v1")
	ours, theirs := strings.Index(text, "panic: x"), strings.Index(text, "browser: y at z")
	apart := strings.Index(text, "От браузърите")
	if ours < 0 || theirs < 0 || apart < ours || theirs < apart || !strings.Contains(text, "backup: no bucket") {
		t.Fatalf("the mail:\n%s", text)
	}
	if !strings.Contains(text, "Още 7 от браузърите") {
		t.Fatalf("the browsers' past the budget:\n%s", text)
	}
	if problemsMail(nil, [sources]int{}, "", "") != "" {
		t.Fatal("a mail with nothing in it")
	}
}

// Reports are limited by player, not by name (names repeat), and whoever runs the game hears of them as one kind,
// whatever the question.
func TestReportsLimitedByPlayer(t *testing.T) {
	g := start(t)
	ana, bo := g.player(), g.player()
	for _, p := range []*player{ana, bo} {
		p.call("POST", "/api/guest", map[string]any{})
		if status, _ := p.call("PATCH", "/api/me", map[string]string{"name": "Иван"}); status != 200 {
			t.Fatalf("rename: %d", status)
		}
	}
	report := func(p *player, id string) int {
		status, _ := p.call("POST", "/api/questions/"+id+"/report", map[string]string{"text": "Отговорът е грешен."})
		return status
	}
	for i := range reportsPlayer {
		if status := report(ana, "geo-001"); status != 200 {
			t.Fatalf("report %d: %d", i+1, status)
		}
	}
	if status := report(ana, "geo-001"); status != 429 {
		t.Fatalf("past the player's limit: %d", status)
	}
	if status := report(bo, "geo-002"); status != 200 {
		t.Fatalf("another player of the same name: %d", status)
	}
	news, _ := g.srv.problems.take()
	if len(news) != 1 {
		t.Fatalf("reports told as %d kinds: %v", len(news), news)
	}
	for k, p := range news {
		if strings.Contains(k, "geo-") || p.count != reportsPlayer+1 {
			t.Fatalf("the reports' kind: %q ×%d", k, p.count)
		}
	}
}

// Every API answer says the game's version; an error from a page of another one is logged, not told as a problem (the
// page loads itself anew).
func TestClientErrorsOfAnotherVersion(t *testing.T) {
	g := start(t)
	p := g.player()
	res, err := p.client.Get(g.url + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if v := res.Header.Get(versionHeader); v != "test" {
		t.Fatalf("the version on an API answer: %q", v)
	}
	p.call("POST", "/api/errors", map[string]string{"message": "old", "where": "x", "version": "v0.0.1"})
	p.call("POST", "/api/errors", map[string]string{"message": "now", "where": "x", "version": "test"})
	news, _ := g.srv.problems.take()
	if len(news) != 1 || news["browser: now at x"] == nil {
		t.Fatalf("the browsers' kinds: %v", news)
	}
}

// Browsers' errors are limited by network and in all, and come into the mail as browsers' kinds.
func TestClientErrorsLimited(t *testing.T) {
	g := start(t)
	p := g.player()
	for i := range clientErrorsNet {
		if status, _ := p.call("POST", "/api/errors", map[string]string{"message": fmt.Sprint("boom ", i), "where": "x"}); status != 200 {
			t.Fatalf("error %d: %d", i+1, status)
		}
	}
	if status, _ := p.call("POST", "/api/errors", map[string]string{"message": "one more", "where": "x"}); status != 429 {
		t.Fatalf("past the network's limit: %d", status)
	}
	news, _ := g.srv.problems.take()
	if len(news) != 1 || news["browser: boom # at x"] == nil || news["browser: boom # at x"].from != fromBrowser {
		t.Fatalf("the browsers' kinds: %v", news)
	}
}

// Problems are mailed to the address set, once each new kind.
func TestProblemsByMail(t *testing.T) {
	g := start(t)
	g.srv.Problem("backup: upload failed")
	g.srv.tellProblems(t.Context(), Alerts{Email: "alerts@almanac.bg"})
	g.outbox.Flush(t.Context())
	if len(g.inbox.got) != 1 || !strings.Contains(g.inbox.got[0].Text, "backup: upload failed") {
		t.Fatalf("mailed %+v", g.inbox.got)
	}
}
