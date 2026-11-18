package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/store"
)

// The open reports, a question a line as JSON with their words, plain (a report from before they were kept plain
// loses its escapes here); resolving marks them done, and only those.
func TestBankReports(t *testing.T) {
	path := filepath.Join(t.TempDir(), "almanac.db")
	t.Setenv("DB_PATH", path)
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range [][2]string{{"gen-1", "Грешна дата"}, {"geo-2", "Две\tверни"}, {"gen-1", "Не е\x1b[2J вярно‮"}} {
		if _, err := db.Write.Exec(`INSERT INTO reports (question_id, text, at) VALUES (?, ?, ?)`, r[0], r[1], i+1); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()
	run := func(args ...string) string {
		r, w, _ := os.Pipe()
		out := os.Stdout
		os.Stdout = w
		err := bankReports(args)
		w.Close()
		os.Stdout = out
		got, _ := io.ReadAll(r)
		if err != nil {
			t.Fatal(err)
		}
		return string(got)
	}
	want := `{"id":"gen-1","reports":2,"player_text":["Грешна дата","Не е[2J вярно"]}` + "\n" +
		`{"id":"geo-2","reports":1,"player_text":["Две верни"]}` + "\n"
	if got := run(); got != want {
		t.Errorf("open: %q", got)
	}
	if got := run("-resolve", "gen-1"); !strings.HasPrefix(got, "2 reports resolved") {
		t.Errorf("resolve: %q", got)
	}
	if got := run(); got != `{"id":"geo-2","reports":1,"player_text":["Две верни"]}`+"\n" {
		t.Errorf("after: %q", got)
	}
}
