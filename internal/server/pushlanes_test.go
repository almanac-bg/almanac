package server

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/push"
)

// heldFor says how long a send was held back for, and whether for the lane's pace; or -1, if it wasn't.
func heldFor(err error) (time.Duration, bool) {
	var h *heldBack
	if errors.As(err, &h) {
		return h.after, h.full
	}
	return -1, false
}

// A service that keeps failing rests: its sends are held back without dialling, then one tries it; failing again,
// it rests longer; answering, it's open again. Other services go on meanwhile.
func TestLaneRests(t *testing.T) {
	clock := time.Date(2030, 1, 1, 19, 0, 0, 0, time.UTC)
	ls := &lanes{now: func() time.Time { return clock }}
	ctx := t.Context()
	dialled := 0
	answer := func(err error) func(context.Context) error {
		return func(context.Context) error {
			dialled++
			return err
		}
	}
	busy := answer(&push.Busy{Err: errors.New("503")})
	for range laneTrips {
		if err := ls.send(ctx, nil, "down", time.Second, busy); !errors.As(err, new(*push.Busy)) {
			t.Fatalf("a failing service: %v", err)
		}
	}
	if after, _ := heldFor(ls.send(ctx, nil, "down", time.Second, busy)); after != laneRest || dialled != laneTrips {
		t.Fatalf("resting: held for %v, dialled %d", after, dialled)
	}
	if err := ls.send(ctx, nil, "up", time.Second, answer(nil)); err != nil {
		t.Fatalf("another service: %v", err)
	}
	if after, _, ok := ls.room([]string{"down"}); ok || after != laneRest {
		t.Fatalf("room while resting: %v %v", after, ok)
	}
	if _, _, ok := ls.room([]string{"down", "up"}); !ok {
		t.Fatal("no room for a player with a device on a service that's up")
	}

	// The rest over: one send tries it, the others are held back meanwhile; it fails, and the rest is longer.
	clock = clock.Add(laneRest)
	trying, release, tried := make(chan struct{}), make(chan struct{}), make(chan error)
	go func() {
		tried <- ls.send(ctx, nil, "down", time.Second, func(context.Context) error {
			close(trying)
			<-release
			return &push.Busy{Err: errors.New("503")}
		})
	}()
	<-trying
	if after, _ := heldFor(ls.send(ctx, nil, "down", time.Second, busy)); after != time.Second {
		t.Fatalf("while it's tried: held for %v", after)
	}
	close(release)
	<-tried
	if after, _ := heldFor(ls.send(ctx, nil, "down", time.Second, busy)); after != 2*laneRest {
		t.Fatalf("failing again: held for %v", after)
	}

	// Answering at last: open, and the next failure starts the count again.
	clock = clock.Add(2 * laneRest)
	if err := ls.send(ctx, nil, "down", time.Second, answer(push.ErrGone)); !errors.Is(err, push.ErrGone) {
		t.Fatalf("tried after a rest: %v", err)
	}
	if err := ls.send(ctx, nil, "down", time.Second, busy); !errors.As(err, new(*push.Busy)) {
		t.Fatalf("open again: %v", err)
	}
}

// A lane sends laneSends at once and keeps laneWaits waiting; a send past those is held back for the lane's pace,
// later the more there are before it, and other lanes go on.
func TestLaneFull(t *testing.T) {
	ls := &lanes{}
	ctx := t.Context()
	release := make(chan struct{})
	wait := func(context.Context) error {
		<-release
		return nil
	}
	var wg sync.WaitGroup
	for range laneSends + laneWaits {
		wg.Go(func() {
			if err := ls.send(ctx, nil, "slow", time.Minute, wait); err != nil {
				t.Errorf("a send with a place: %v", err)
			}
		})
	}
	for deadline := time.Now().Add(5 * time.Second); ; {
		ls.mu.Lock()
		l := ls.of("slow")
		full := len(l.slots) == laneSends && l.waiting == laneWaits
		ls.mu.Unlock()
		if full {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the lane never filled")
		}
		time.Sleep(time.Millisecond)
	}
	first, paced := heldFor(ls.send(ctx, nil, "slow", time.Minute, wait))
	second, _ := heldFor(ls.send(ctx, nil, "slow", time.Minute, wait))
	if first < laneSoonest || !paced || second <= first {
		t.Fatalf("past the lane: held for %v (paced %v), then %v", first, paced, second)
	}
	if after, paced, ok := ls.room([]string{"slow"}); ok || !paced || after <= second {
		t.Fatalf("room in a full lane: %v %v %v", after, paced, ok)
	}
	if err := ls.send(ctx, nil, "quick", time.Minute, func(context.Context) error { return nil }); err != nil {
		t.Fatalf("another lane: %v", err)
	}
	// Told to stop, a send waiting for its place doesn't begin.
	stop := make(chan struct{})
	close(stop)
	ls.mu.Lock()
	ls.of("slow").waiting-- // a place among those waiting, for this one
	ls.mu.Unlock()
	if _, paced := heldFor(ls.send(ctx, stop, "slow", time.Minute, wait)); !paced {
		t.Fatal("a send waiting when told to stop began")
	}
	ls.mu.Lock()
	ls.of("slow").waiting++
	ls.mu.Unlock()
	close(release)
	wg.Wait()
}
