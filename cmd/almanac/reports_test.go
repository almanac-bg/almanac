package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/store"
)

// The open reports, a question a line with their words; resolving marks them done, and only those.
func TestBankReports(t *testing.T) {
	path := filepath.Join(t.TempDir(), "almanac.db")
	t.Setenv("DB_PATH", path)
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range [][2]string{{"gen-1", "Грешна дата"}, {"geo-2", "Две верни"}, {"gen-1", "Не е вярно"}} {
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
	if got := run(); got != "gen-1\t2\tГрешна дата | Не е вярно\ngeo-2\t1\tДве верни\n" {
		t.Errorf("open: %q", got)
	}
	if got := run("-resolve", "gen-1"); !strings.HasPrefix(got, "2 reports resolved") {
		t.Errorf("resolve: %q", got)
	}
	if got := run(); got != "geo-2\t1\tДве верни\n" {
		t.Errorf("after: %q", got)
	}
}
