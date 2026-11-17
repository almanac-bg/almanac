package server

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/safe"
)

// A panic in the work done in the background is stopped there (package safe) and told as one of the server's
// problems: in a loop of the server's, the next round comes as ever; in its loops of the program, the loop starts
// again.
func TestBackgroundPanicsTold(t *testing.T) {
	g := start(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rounds := make(chan int, 10)
	n := 0
	go safe.Every(ctx, "a test's round", time.Millisecond, func() {
		n++
		rounds <- n
		if n == 1 {
			panic("the first round")
		}
	})
	for range 3 {
		select {
		case <-rounds:
		case <-time.After(5 * time.Second):
			t.Fatal("the rounds stopped after a panic")
		}
	}
	cancel()
	news, _ := g.srv.problems.take()
	if news["panic: a test's round: the first round"] == nil {
		t.Fatalf("the panic wasn't told: %v", news)
	}
}

// A run that ends without its clean stop is told of by the next, with how many in a row; one that stops cleanly takes
// its note away.
func TestUncleanStopTold(t *testing.T) {
	g := start(t)
	file := filepath.Join(t.TempDir(), "running.json")
	g.srv.cfg.RunningFile = file

	g.srv.noteRunning() // the first run: nothing before it
	if news, _ := g.srv.problems.take(); len(news) != 0 {
		t.Fatalf("a first run told: %v", news)
	}
	g.srv.noteRunning() // the last one never stopped cleanly…
	g.srv.noteRunning() // …nor that one
	news, _ := g.srv.problems.take()
	told := ""
	for k := range news {
		told += k + "\n"
	}
	if !strings.Contains(told, "ended without a clean stop") || !strings.Contains(told, "2 in a row") {
		t.Fatalf("told: %q", told)
	}
	data, _ := os.ReadFile(file)
	var note runNote
	if err := json.Unmarshal(data, &note); err != nil || note.Unclean != 2 || note.Version != "test" {
		t.Fatalf("the note: %s (%v)", data, err)
	}

	g.srv.noteStopped()
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("the note stays after a clean stop: %v", err)
	}
	g.srv.noteRunning()
	if news, _ := g.srv.problems.take(); len(news) != 0 {
		t.Fatalf("a run after a clean stop told: %v", news)
	}
}
