package server

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// clock is a time the test moves.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newClock() *clock { return &clock{t: time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)} }

// A window ends a period after its first count, and the key is forgotten then: not kept for a day whatever its
// period.
func TestLimiterWindowEndsByItsPeriod(t *testing.T) {
	c := newClock()
	l := newLimiter()
	l.now = c.now
	for i := range 3 {
		if !l.allow("k", 3, time.Minute) {
			t.Fatalf("count %d refused", i+1)
		}
	}
	if l.allow("k", 3, time.Minute) || !l.spent("k", 3) {
		t.Fatal("a fourth in the minute")
	}
	c.add(time.Minute)
	if l.spent("k", 3) || !l.allow("k", 3, time.Minute) {
		t.Fatal("the window didn't end with its minute")
	}
	c.add(2 * time.Minute) // past the window's end, and a minute since its shard's last sweep
	other := "other"
	for i := 0; l.shard(other) != l.shard("k"); i++ {
		other = fmt.Sprint("other", i)
	}
	l.allow(other, 1, time.Hour)
	if n := l.keys(); n != 1 {
		t.Fatalf("keys after the sweep: %d, want 1", n)
	}
}

// However many keys come, the limiter holds no more than its most; a key pushed out is the one nearest its end.
func TestLimiterBounded(t *testing.T) {
	l := newLimiterOf(limitShards * 2) // two keys a shard: a full shard's every key is looked at
	l.now = newClock().now
	for i := range 10_000 {
		l.allow(fmt.Sprint("flood:", i), 1, time.Hour)
	}
	if n := l.keys(); n > limitShards*2 {
		t.Fatalf("%d keys, want %d at most", n, limitShards*2)
	}

	l = newLimiterOf(limitShards * 2)
	l.now = newClock().now
	long := "long"
	var short, next string
	for i := 0; short == "" || next == ""; i++ {
		k := fmt.Sprint("k", i)
		if l.shard(k) != l.shard(long) {
			continue
		}
		if short == "" {
			short = k
		} else {
			next = k
		}
	}
	l.allow(long, 1, 24*time.Hour)
	l.allow(short, 1, time.Minute)
	l.allow(next, 1, time.Hour)
	if !l.spent(long, 1) || l.spent(short, 1) || !l.spent(next, 1) {
		t.Fatal("the key pushed out wasn't the one nearest its end")
	}
}

// The counts go on over a restart: what a stopping server saves, the next restores, but for the windows that ended
// in between.
func TestLimiterOutlivesARestart(t *testing.T) {
	c := newClock()
	l := newLimiter()
	l.now = c.now
	for range 3 {
		l.allow("hour", 5, time.Hour)
	}
	l.allow("minute", 1, time.Minute)
	var file bytes.Buffer
	if n, err := l.save(&file); err != nil || n != 2 {
		t.Fatalf("saved %d (%v)", n, err)
	}

	c.add(2 * time.Minute) // the restart
	next := newLimiter()
	next.now = c.now
	if n, err := next.restore(&file); err != nil || n != 1 {
		t.Fatalf("restored %d (%v), want the hour's only", n, err)
	}
	if !next.allow("hour", 5, time.Hour) || !next.allow("hour", 5, time.Hour) || next.allow("hour", 5, time.Hour) {
		t.Fatal("the hour's count didn't go on from 3")
	}
	if !next.allow("minute", 1, time.Minute) {
		t.Fatal("a window that ended came back")
	}
}

// Many requests at once, over the shards (with -race).
func TestLimiterAtOnce(t *testing.T) {
	l := newLimiter()
	var wg sync.WaitGroup
	allowed := make([]int, 8)
	for g := range 8 {
		wg.Go(func() {
			for i := range 1000 {
				if l.allow("shared", 100, time.Hour) {
					allowed[g]++
				}
				l.allow(fmt.Sprint(g, ":", i), 1, time.Hour)
			}
		})
	}
	wg.Wait()
	sum := 0
	for _, n := range allowed {
		sum += n
	}
	if sum != 100 {
		t.Fatalf("%d allowed of a shared 100", sum)
	}
}

// A stopping server keeps its limits' counts in Config.LimitsFile, and the next one takes them, once: a deploy gives
// no budget whole again.
func TestLimitsKeptOverARestart(t *testing.T) {
	file := filepath.Join(t.TempDir(), "limits.json")
	g := start(t)
	g.srv.cfg.LimitsFile = file
	p := g.player()
	for range clientErrorsNet {
		p.call("POST", "/api/errors", map[string]string{"message": "boom", "where": "x"})
	}
	g.srv.saveLimits()

	next := start(t)
	next.srv.cfg.LimitsFile = file
	next.srv.restoreLimits()
	if status, _ := next.player().call("POST", "/api/errors", map[string]string{"message": "boom", "where": "x"}); status != 429 {
		t.Fatalf("after a restart, the spent budget: %d", status)
	}
	if _, err := os.Stat(file); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("the file is still there: %v", err)
	}
}
