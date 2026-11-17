// Package safe keeps a panic in work done in the background from ending the server.
//
// A panic in a request ends that request alone (the server's middleware recovers it); one on any other goroutine ends
// the whole process, and every live duel, room and Роял with it. So every goroutine the game starts runs through
// this package: a timer's callback (AfterFunc), a ticker's round (Every), a loop that lives as long as the server
// (Loop), and work set off on the side (Go, Do). A panic there is stopped (Recover), logged with its stack (once a
// minute for the same work, so a panic that comes back every round doesn't flood the log), and told as a problem
// (Tell: the server mails it to whoever runs the game). What becomes of the work then is said where it runs:
//   - a loop starts again, after a pause that grows while it keeps failing (Loop);
//   - a ticker's round is one round lost: the next comes as ever (Every);
//   - a game's clock (a duel's, a room's) ends its game cleanly, by the fallback it gives Recover: a panic leaves the
//     game in a state nobody can trust, so it isn't played on.
//
// A lock is let go as a panic passes only if it was taken with a defer: code that runs here takes its locks so.
package safe

import (
	"context"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"
)

// tell is who hears of every panic stopped (nil: the log alone).
var tell atomic.Pointer[func(kind string)]

// Tell has fn hear of every panic stopped from now on, as a problem's kind ("panic: <what>: <value>"); nil: nobody.
func Tell(fn func(kind string)) {
	if fn == nil {
		tell.Store(nil)
		return
	}
	tell.Store(&fn)
}

// stopped counts the panics stopped since the program started.
var stopped atomic.Int64

// Stopped is how many panics have been stopped since the program started.
func Stopped() int64 { return stopped.Load() }

// logEvery is how often a panic in the same work is logged with its stack; in between, a line without it.
const logEvery = time.Minute

var logged struct {
	sync.Mutex
	at map[string]time.Time
}

// Report logs a panic stopped in what, with the stack where it is now (call it from the deferred function that
// recovered it), and tells it (Tell).
func Report(what string, v any) {
	stopped.Add(1)
	now := time.Now()
	logged.Lock()
	if logged.at == nil {
		logged.at = map[string]time.Time{}
	}
	full := now.Sub(logged.at[what]) >= logEvery
	if full {
		logged.at[what] = now
	}
	logged.Unlock()
	if full {
		slog.Error("panic", "in", what, "err", v, "stack", string(debug.Stack()))
	} else {
		slog.Error("panic", "in", what, "err", v, "stack", "as before")
	}
	if fn := tell.Load(); fn != nil {
		(*fn)(fmt.Sprintf("panic: %s: %v", what, v))
	}
}

// Recover, deferred, stops a panic in what was running, reports it, and then runs each of then: what ends the work
// cleanly (each of them guarded in turn). Deferred first, it runs last: after the locks taken with a defer are let
// go, so that then may take them again.
//
//	defer safe.Recover("a duel's clock", m.broken)
func Recover(what string, then ...func()) {
	v := recover()
	if v == nil {
		return
	}
	Report(what, v)
	for _, fn := range then {
		Do(what+", after a panic", fn)
	}
}

// Do runs fn, and says whether it ran through: a panic in it is stopped and reported.
func Do(what string, fn func()) (ok bool) {
	defer func() {
		if v := recover(); v != nil {
			Report(what, v)
			ok = false
		}
	}()
	fn()
	return true
}

// Go runs fn on a goroutine of its own, a panic in it stopped (and then, as Recover runs it).
func Go(what string, fn func(), then ...func()) {
	go func() {
		defer Recover(what, then...)
		fn()
	}()
}

// AfterFunc is time.AfterFunc, fn stopped if it panics (and then, as Recover runs it).
func AfterFunc(d time.Duration, what string, fn func(), then ...func()) *time.Timer {
	return time.AfterFunc(d, func() {
		defer Recover(what, then...)
		fn()
	})
}

// Every runs fn every period until ctx ends, each round on its own: a panic in one is stopped, and the next comes as
// ever.
func Every(ctx context.Context, what string, period time.Duration, fn func()) {
	t := time.NewTicker(period)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			Do(what, fn)
		}
	}
}

// How long Loop waits before it starts a loop again after a panic: firstPause, twice that after each panic that
// follows soon (within calm), lastPause at most.
var (
	firstPause = time.Second
	lastPause  = time.Minute
	calm       = 10 * time.Minute
)

// Loop runs fn, a loop that lives until ctx ends, and starts it again if it panics, after a pause (a second, then
// longer while it keeps failing, a minute at most). It returns once fn returns of itself, or ctx ends.
func Loop(ctx context.Context, what string, fn func(context.Context)) {
	pause := firstPause
	for {
		began := time.Now()
		if Do(what, func() { fn(ctx) }) {
			return
		}
		if time.Since(began) >= calm {
			pause = firstPause
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(pause):
		}
		pause = min(2*pause, lastPause)
	}
}
