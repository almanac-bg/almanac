package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The server plays a copy of BANK_DIR; a bank with errors leaves no copy, and the last good one is there to start on.
func TestKeptBanks(t *testing.T) {
	src := filepath.Join(t.TempDir(), "bank")
	if err := os.CopyFS(src, os.DirFS("../../bank/sample")); err != nil {
		t.Fatal(err)
	}
	at := func(commit string) {
		t.Helper()
		os.MkdirAll(filepath.Join(src, ".git/refs/heads"), 0o755)
		os.WriteFile(filepath.Join(src, ".git/HEAD"), []byte("ref: refs/heads/main\n"), 0o644)
		os.WriteFile(filepath.Join(src, ".git/refs/heads/main"), []byte(commit+"\n"), 0o644)
	}
	commit := func(c byte) string { return strings.Repeat(string(c), 40) }
	k := keptBanks{src: src, dir: filepath.Join(t.TempDir(), "banks")}

	if b := k.fallback(); b != nil {
		t.Fatal("a copy before any was made")
	}
	at(commit('a'))
	a, _, c := k.take()
	if a == nil || c != commit('a') || a.Commit != commit('a') {
		t.Fatalf("the first copy: %v %q", a, c)
	}
	if !strings.HasPrefix(a.Dir, k.dir) || !strings.HasSuffix(a.Dir, "-"+commit('a')) {
		t.Fatalf("played from %s", a.Dir)
	}
	if _, err := os.Stat(filepath.Join(a.Dir, bank.CategoriesFile)); err != nil {
		t.Fatal(err)
	}

	// A pull with errors: refused, no copy left of it; the good copy is what a start falls back on.
	at(commit('b'))
	stray := filepath.Join(src, bank.QuestionsDir, "stray.json")
	os.WriteFile(stray, []byte("[]"), 0o644)
	if b, problems, c := k.take(); b != nil || c != commit('b') || bank.CountOf(problems).Errors == 0 {
		t.Fatalf("a bank with errors: %v %q %v", b, c, problems)
	}
	if kept := k.kept(); len(kept) != 1 || kept[0].dir != a.Dir {
		t.Fatalf("kept after a refusal: %v", kept)
	}
	if entries, _ := os.ReadDir(k.dir); len(entries) != 1 {
		t.Fatalf("left behind: %v", entries)
	}
	if b := k.fallback(); b == nil || b.Commit != commit('a') || b.Dir != a.Dir {
		t.Fatalf("the fallback: %v", b)
	}
	os.Remove(stray)

	// A pull that takes a question out of the bank, rather than retire it: refused, as one with errors.
	file := filepath.Join(src, bank.QuestionsDir, "geography.json")
	was, _ := os.ReadFile(file)
	var qs []map[string]any
	if err := json.Unmarshal(was, &qs); err != nil {
		t.Fatal(err)
	}
	gone := qs[0]["id"].(string)
	data, _ := json.Marshal(qs[1:])
	os.WriteFile(file, data, 0o644)
	if b, problems, _ := k.take(); b != nil || !slices.ContainsFunc(problems, func(p bank.Problem) bool { return p.ID == gone && !p.Warning }) {
		t.Fatalf("a bank without %s: %v %v", gone, b, problems)
	}
	if kept := k.kept(); len(kept) != 1 || kept[0].dir != a.Dir {
		t.Fatalf("kept after a question dropped: %v", kept)
	}
	os.WriteFile(file, was, 0o644)

	// Copies of more commits (d twice, as after a restart): the newest keepBanks of different commits stay, and those
	// held, however old.
	var last *bank.Bank
	for _, c := range []byte{'c', 'd', 'd', 'e', 'f'} {
		at(commit(c))
		if last, _, _ = k.take(); last == nil {
			t.Fatal("no copy")
		}
	}
	k.prune([]*bank.Bank{a, last})
	var got []string
	for _, c := range k.kept() {
		got = append(got, c.commit[:1])
	}
	if strings.Join(got, "") != "feda" {
		t.Fatalf("kept: %v", got)
	}

	// A copy half made (the server stopped midway) is no copy, and goes.
	os.Mkdir(filepath.Join(k.dir, "20261117T120000.000000000-"+commit('g')+partSuffix), 0o700)
	if kept := k.kept(); kept[0].commit != commit('f') {
		t.Fatalf("a half copy counts: %v", kept)
	}
	k.prune([]*bank.Bank{last})
	if entries, _ := os.ReadDir(k.dir); len(entries) != keepBanks {
		t.Fatalf("after pruning: %d entries", len(entries))
	}

	// In development, BANK_DIR itself is played.
	dev := keptBanks{src: src}
	if b, _, c := dev.take(); b == nil || b.Dir != src || c != commit('f') || b.Commit != c {
		t.Fatalf("in development: %v %q", b, c)
	}
}
