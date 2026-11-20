package safe

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// told collects what Tell hears, for one test (the hook is the program's: the tests here don't run in parallel).
func told(t *testing.T) func() []string {
	t.Helper()
	var mu sync.Mutex
	var kinds []string
	Tell(func(kind string) {
		mu.Lock()
		kinds = append(kinds, kind)
		mu.Unlock()
	})
	t.Cleanup(func() { Tell(nil) })
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), kinds...)
	}
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for range 400 {
		if ok() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("never: %s", what)
}

func TestGoStopsAPanicAndTellsIt(t *testing.T) {
	kinds := told(t)
	before := Stopped()
	var after atomic.Bool
	Go("a count", func() { panic("boom") }, func() { after.Store(true) })
	eventually(t, "the panic told", func() bool { return len(kinds()) == 1 })
	if got := kinds()[0]; got != "panic: a count: boom" {
		t.Errorf("told %q", got)
	}
	eventually(t, "the fallback run", after.Load)
	if Stopped() != before+1 {
		t.Errorf("stopped %d, want %d", Stopped(), before+1)
	}
}

func TestAFallbackThatPanicsToo(t *testing.T) {
	kinds := told(t)
	Go("a clock", func() { panic("first") }, func() { panic("second") })
	eventually(t, "both told", func() bool { return len(kinds()) == 2 })
	if k := kinds(); !strings.Contains(k[1], "a clock, after a panic: second") {
		t.Errorf("told %q", k)
	}
}

func TestAfterFuncLetsTheLockGoFirst(t *testing.T) {
	told(t)
	var mu sync.Mutex
	done := make(chan bool)
	AfterFunc(time.Millisecond, "a duel's clock", func() {
		mu.Lock()
		defer mu.Unlock()
		panic("in the lock")
	}, func() {
		mu.Lock() // the fallback takes the lock again: it was let go as the panic passed
		defer mu.Unlock()
		done <- true
	})
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the fallback never ran")
	}
}

func TestDo(t *testing.T) {
	told(t)
	if !Do("fine", func() {}) {
		t.Error("a run that went through said it didn't")
	}
	if Do("broken", func() { panic(42) }) {
		t.Error("a run that panicked said it went through")
	}
}

func TestEveryGoesOnAfterAPanickedRound(t *testing.T) {
	told(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var rounds atomic.Int32
	go Every(ctx, "a ticker", time.Millisecond, func() {
		if rounds.Add(1) == 1 {
			panic("the first round")
		}
	})
	eventually(t, "rounds after the panic", func() bool { return rounds.Load() >= 3 })
}

func TestLoopStartsAgainAndStops(t *testing.T) {
	told(t)
	firstPause, lastPause = time.Millisecond, 4*time.Millisecond
	t.Cleanup(func() { firstPause, lastPause = time.Second, time.Minute })
	ctx, cancel := context.WithCancel(context.Background())
	var starts atomic.Int32
	done := make(chan struct{})
	go func() {
		Loop(ctx, "a loop", func(ctx context.Context) {
			if starts.Add(1) <= 3 {
				panic("again")
			}
			<-ctx.Done()
		})
		close(done)
	}()
	eventually(t, "started again after each panic", func() bool { return starts.Load() == 4 })
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the loop didn't end with its context")
	}

	// A loop that returns of itself isn't started again.
	starts.Store(0)
	Loop(context.Background(), "once", func(context.Context) { starts.Add(1) })
	if starts.Load() != 1 {
		t.Errorf("started %d times", starts.Load())
	}
}
