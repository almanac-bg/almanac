package server

import "testing"

// A report is kept as plain words: a terminal's escapes, a bell, bidi overrides and zero-width letters never reach
// whoever reads it (bank reports, the agents that fix questions), and what's left must still say something.
func TestReportsKeptPlain(t *testing.T) {
	g := start(t)
	p := g.player()
	p.call("POST", "/api/guest", map[string]any{})
	sent := "\x1b]0;pwned\x07 Грешен‮ отговор​,\tвиж\r\nизточника\u0085 "
	if status, _ := p.call("POST", "/api/questions/geo-001/report", map[string]string{"text": sent}); status != 200 {
		t.Fatalf("report: %d", status)
	}
	var kept string
	if err := g.db.Read.QueryRow(`SELECT text FROM reports`).Scan(&kept); err != nil {
		t.Fatal(err)
	}
	if want := "]0;pwned Грешен отговор, виж източника"; kept != want {
		t.Fatalf("kept %q, want %q", kept, want)
	}
	if status, _ := p.call("POST", "/api/questions/geo-001/report", map[string]string{"text": "\x1b\x07‮​​​ a"}); status != 400 {
		t.Fatalf("a report of nothing but escapes: %d", status)
	}
}
