package play

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/safe"
)

// snapshot keeps a count that goes over everyone's answers (the crowds, the questions' hardness, the boards of
// knowledge): too dear to make for a request, so it's shown as last counted, and counted again in the background once
// it's stale. One count at a time, on no request's context, with no deadline: a player who gives up waiting doesn't
// throw a count away for the next to start again, and a big count still ends. A bank reloaded makes the count stale,
// not missing: what it holds is by question id, and a count of the bank before is better than a wait (each user of it
// says what stands for a question it lacks). Only the first count is waited for.
type snapshot[T any] struct {
	mu      sync.Mutex
	last    *snapOf[T]
	running chan struct{} // closed as the count under way ends; nil while none is
	err     error         // the last count's
}

// snapOf is a count: when, of which bank, and what.
type snapOf[T any] struct {
	at   time.Time
	bank *bank.Bank
	v    T
}

// countFunc counts as of a moment, for a bank.
type countFunc[T any] func(ctx context.Context, now time.Time, b *bank.Bank) (T, error)

// stale says whether a count is to be made again: fresh old, from the clock's future, or of another bank.
func (c *snapOf[T]) stale(now time.Time, b *bank.Bank, fresh time.Duration) bool {
	return c == nil || c.bank != b || now.Sub(c.at) >= fresh || now.Before(c.at)
}

// get is the last count, and starts the next one if it's stale. With none yet, it waits for the first (or until ctx
// is done: the count goes on).
func (s *snapshot[T]) get(ctx context.Context, now time.Time, b *bank.Bank, fresh time.Duration, count countFunc[T]) (T, error) {
	s.mu.Lock()
	last := s.last
	if last.stale(now, b, fresh) {
		s.start(now, b, count)
	}
	done := s.running
	s.mu.Unlock()
	if last != nil {
		return last.v, nil
	}
	return s.wait(ctx, done)
}

// peek is the last count, if there's one (nil if not), and starts the next one if it's stale: for what shows
// nothing rather than wait.
func (s *snapshot[T]) peek(now time.Time, b *bank.Bank, fresh time.Duration, count countFunc[T]) *snapOf[T] {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.last.stale(now, b, fresh) {
		s.start(now, b, count)
	}
	return s.last
}

// refresh counts now, after the count under way if there's one, and waits for it.
func (s *snapshot[T]) refresh(ctx context.Context, now time.Time, b *bank.Bank, count countFunc[T]) (T, error) {
	for {
		s.mu.Lock()
		done := s.running
		if done == nil {
			s.start(now, b, count)
			done = s.running
			s.mu.Unlock()
			return s.wait(ctx, done)
		}
		s.mu.Unlock()
		select {
		case <-done:
		case <-ctx.Done():
			var zero T
			return zero, ctx.Err()
		}
	}
}

// errCountBroke is a count that panicked (stopped and reported by package safe).
var errCountBroke = errors.New("the count broke off")

// start starts a count, unless one is under way. Called with the lock held.
func (s *snapshot[T]) start(now time.Time, b *bank.Bank, count countFunc[T]) {
	if s.running != nil {
		return
	}
	done := make(chan struct{})
	s.running = done
	go func() {
		var v T
		var err error
		if !safe.Do("counting everyone's answers", func() { v, err = count(context.Background(), now, b) }) {
			err = errCountBroke // a count that panicked is a count that failed: the next asks again
		}
		if err != nil {
			slog.Warn("counting everyone's answers", "err", err)
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if err == nil {
			s.last = &snapOf[T]{at: now, bank: b, v: v}
		}
		s.err, s.running = err, nil
		close(done)
	}()
}

// wait waits for the count that ends with done, and is the last count then.
func (s *snapshot[T]) wait(ctx context.Context, done chan struct{}) (T, error) {
	select {
	case <-done:
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.last == nil {
		var zero T
		return zero, s.err
	}
	return s.last.v, s.err
}

// settle waits for the count under way, if there's one (tests).
func (s *snapshot[T]) settle() {
	s.mu.Lock()
	done := s.running
	s.mu.Unlock()
	if done != nil {
		<-done
	}
}
