package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/push"
)

// Each push service (a browser maker's Web Push service, Apple's, Google's) has a lane of its own, so that one that's
// slow or down holds up only the players it serves. A lane sends laneSends at once at most, and keeps laneWaits more
// waiting for a place; a send past those isn't made now: its row goes back to the queue, not as a try, for when the
// lane will have taken those before it (held back). So a service can hold laneSends+laneWaits of the queue's
// pushWorkers players at most, whatever it does, and the rest go on at their own services' pace. A row none of whose
// services has room is held back before its message is made (room), so that holding it back costs little.
//
// A lane rests a service that keeps failing (laneTrips busy answers in a row: no answer in time, 5xx, 429, the game's
// keys refused): for laneRest, twice that each time it fails again, laneRestMost at most. While it rests, its sends
// are held back at once, without dialling; then one send tries it, and an answer opens it again.

const (
	// laneSends is how many sends a lane makes at once at most: what the whole queue made before lanes.
	laneSends = 64
	// laneWaits is how many sends wait for a place in a lane at most.
	laneWaits = 32
	// laneTrips is how many busy answers in a row rest a service.
	laneTrips = 5
	// laneRest and laneRestMost are how long a service rests after failing: the first time, and at most.
	laneRest, laneRestMost = 15 * time.Second, 2 * time.Minute
	// laneSoonest and laneLatest bound when a send held back is tried again.
	laneSoonest, laneLatest = 100 * time.Millisecond, 2 * time.Minute
)

// heldBack is a send not made, for its lane's sake (its service resting, or the lane full): it says nothing of the
// device, and isn't a try; the row goes again after `after`. full: for the lane's pace, soon (not a rest).
type heldBack struct {
	after time.Duration
	why   string
	full  bool
}

func (h *heldBack) Error() string {
	return fmt.Sprintf("held back %v: %s", h.after.Round(time.Second), h.why)
}

// lanes are the push services' lanes, by service (pushService).
type lanes struct {
	mu   sync.Mutex
	now  func() time.Time // the clock (tests); nil: time.Now
	by   map[string]*lane
	sent func(service string, took time.Duration, err error) // told of every send made (tests)
}

// lane is one service's: its places, and what it has shown of itself. All but slots under lanes.mu.
type lane struct {
	slots   chan struct{}
	waiting int
	took    time.Duration // how long a send takes, smoothed
	ahead   time.Time     // when the lane will have taken the sends held back so far
	fails   int           // busy answers in a row
	rest    time.Duration // the rest it was given last
	until   time.Time     // resting until (zero: not resting)
	probing bool          // a send is trying it after a rest
}

func (ls *lanes) clock() time.Time {
	if ls.now != nil {
		return ls.now()
	}
	return time.Now()
}

func (ls *lanes) of(service string) *lane {
	if ls.by == nil {
		ls.by = map[string]*lane{}
	}
	l := ls.by[service]
	if l == nil {
		l = &lane{slots: make(chan struct{}, laneSends), took: 100 * time.Millisecond}
		ls.by[service] = l
	}
	return l
}

// later is when a send held back now for a full lane should come again: after those held back before it, at the
// pace the lane goes (laneSends at a time, each as long as a send takes).
func (l *lane) later(now time.Time) time.Duration {
	each := max(l.took/laneSends, time.Millisecond)
	if after := now.Add(time.Duration(laneSends+laneWaits) * each); l.ahead.Before(after) {
		l.ahead = after
	}
	l.ahead = l.ahead.Add(each)
	return min(max(l.ahead.Sub(now), laneSoonest), laneLatest)
}

// room says whether any of these services' lanes would take a send now; if none would, how long until one may, and
// whether that's for a full lane's pace (else a rest).
func (ls *lanes) room(services []string) (after time.Duration, paced, ok bool) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	now := ls.clock()
	var full []*lane
	after = laneLatest
	for _, service := range services {
		switch l := ls.of(service); {
		case !l.until.IsZero() && now.Before(l.until):
			after = min(after, max(l.until.Sub(now), laneSoonest))
		case !l.until.IsZero() || len(l.slots) < laneSends || l.waiting < laneWaits:
			return 0, false, true // a rest over (send tries it), or room
		default:
			full = append(full, l)
		}
	}
	for _, l := range full {
		if d := l.later(now); d <= after {
			after, paced = d, true
		}
	}
	return after, paced, false
}

// send makes a send to a service in its lane (fn, within timeout once it has its place), or holds it back.
func (ls *lanes) send(ctx context.Context, stop <-chan struct{}, service string, timeout time.Duration, fn func(context.Context) error) error {
	ls.mu.Lock()
	l := ls.of(service)
	now := ls.clock()
	probe := false
	switch {
	case l.until.IsZero():
	case now.Before(l.until):
		ls.mu.Unlock()
		return &heldBack{after: max(l.until.Sub(now), laneSoonest), why: service + " rests"}
	case l.probing:
		ls.mu.Unlock()
		return &heldBack{after: timeout, why: service + " is being tried"}
	default:
		l.probing, probe = true, true
	}
	select {
	case l.slots <- struct{}{}:
	default:
		if l.waiting >= laneWaits && !probe {
			after := l.later(now)
			ls.mu.Unlock()
			return &heldBack{after: after, why: service + " is full", full: true}
		}
		l.waiting++
		ls.mu.Unlock()
		select {
		case l.slots <- struct{}{}:
		case <-stop:
			ls.mu.Lock()
			l.waiting--
			if probe {
				l.probing = false
			}
			ls.mu.Unlock()
			return &heldBack{after: laneSoonest, why: "stopped waiting for " + service, full: true}
		}
		ls.mu.Lock()
		l.waiting--
	}
	ls.mu.Unlock()

	began := time.Now()
	err := func() error {
		defer func() { <-l.slots }()
		ctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		return fn(ctx)
	}()
	took := time.Since(began)

	ls.mu.Lock()
	l.took = (7*l.took + took) / 8
	rests, back := time.Duration(0), false
	var busy *push.Busy
	switch {
	case errors.As(err, &busy):
		l.fails++
		switch {
		case probe: // tried after a rest, and still failing: a longer rest
			l.rest = min(2*l.rest, laneRestMost)
			l.until, l.probing = ls.clock().Add(l.rest), false
			rests = l.rest
		case l.until.IsZero() && l.fails >= laneTrips:
			l.rest = laneRest
			l.until = ls.clock().Add(l.rest)
			rests = l.rest
		}
	case err == nil || errors.Is(err, push.ErrGone) || errors.As(err, new(*push.Refused)):
		// The service answered: it's up.
		back = !l.until.IsZero()
		l.fails, l.until, l.probing = 0, time.Time{}, false
	default: // the game's own: says nothing of the service
		if probe {
			l.probing = false
		}
	}
	fails := l.fails
	ls.mu.Unlock()
	switch {
	case rests > 0:
		slog.Warn("push: a service rests", "service", service, "for", rests, "fails", fails, "err", err)
	case back:
		slog.Info("push: a service is back", "service", service)
	}
	if ls.sent != nil {
		ls.sent(service, took, err)
	}
	return err
}
