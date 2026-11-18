package play

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/gob"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/safe"
	"github.com/almanac-bg/almanac/internal/store"
)

// snapshot keeps a count that goes over everyone's answers (the crowds, the questions' hardness, the boards of
// knowledge): too dear to make for a request, so it's shown as last counted, and counted again in the background once
// it's stale. One count at a time, on no request's context, with no deadline: a player who gives up waiting doesn't
// throw a count away for the next to start again, and a big count still ends. It reads on the database's pool for
// long reads (store.DB.Scan), never taking a connection a request needs. A bank reloaded makes the count stale,
// not missing: what it holds is by question id, and a count of the bank before is better than a wait (each user of it
// says what stands for a question it lacks).
//
// A count is kept in the database too (counts, at most every keepEvery), and a server that starts again takes up the
// last one kept as a stale count: shown at once, and counted again in the background. So a deploy makes nobody wait;
// only a server that has never counted waits for its first count.
type snapshot[T any] struct {
	mu      sync.Mutex
	last    *snapOf[T]
	running chan struct{} // closed as the count under way ends; nil while none is
	err     error         // the last count's
	keptAt  time.Time     // when the count kept in the database was counted
	taken   sync.Once     // the count kept, taken up (once, before anything else is asked of the snapshot)
}

// snapOf is a count: when, of which bank (nil: taken up from the database, of no bank this server knows), and what.
type snapOf[T any] struct {
	at   time.Time
	bank *bank.Bank
	v    T
}

// countFunc counts as of a moment, for a bank.
type countFunc[T any] func(ctx context.Context, now time.Time, b *bank.Bank) (T, error)

// counter is what a snapshot is counted by and how long a count stands; and how a count is kept in the database (in
// counts, by name): keep makes the bytes kept of a count, and take a count of them again, for the bank in play (which
// may not be the one it was counted for).
type counter[T any] struct {
	db    *store.DB
	name  string
	fresh time.Duration
	count countFunc[T]
	keep  func(T) ([]byte, error)
	take  func([]byte, *bank.Bank) (T, error)
}

// keepEvery is how often a count is kept in the database at most: a server that starts again takes up a count that
// old at the most (and counts again at once), and the database isn't written a count's worth every few minutes.
const keepEvery = 30 * time.Minute

// stale says whether a count is to be made again: fresh old, from the clock's future, or of another bank.
func (c *snapOf[T]) stale(now time.Time, b *bank.Bank, fresh time.Duration) bool {
	return c == nil || c.bank != b || now.Sub(c.at) >= fresh || now.Before(c.at)
}

// get is the last count, and starts the next one if it's stale. With none yet (none kept either), it waits for the
// first (or until ctx is done: the count goes on).
func (s *snapshot[T]) get(ctx context.Context, now time.Time, b *bank.Bank, c counter[T]) (T, error) {
	s.take(c, b)
	s.mu.Lock()
	last := s.last
	if last.stale(now, b, c.fresh) {
		s.start(now, b, c)
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
func (s *snapshot[T]) peek(now time.Time, b *bank.Bank, c counter[T]) *snapOf[T] {
	s.take(c, b)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.last.stale(now, b, c.fresh) {
		s.start(now, b, c)
	}
	return s.last
}

// refresh counts now, after the count under way if there's one, and waits for it.
func (s *snapshot[T]) refresh(ctx context.Context, now time.Time, b *bank.Bank, c counter[T]) (T, error) {
	for {
		s.mu.Lock()
		done := s.running
		if done == nil {
			s.start(now, b, c)
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

// take takes up the count kept in the database, if there's one and nothing newer is here, the first time the
// snapshot is asked for: a read of one row, where a count reads every answer.
func (s *snapshot[T]) take(c counter[T], b *bank.Bank) {
	s.taken.Do(func() {
		if c.db == nil || c.take == nil {
			return
		}
		var at int64
		var raw []byte
		err := c.db.Read.QueryRow(`SELECT at, value FROM counts WHERE name = ?`, c.name).Scan(&at, &raw)
		if errors.Is(err, sql.ErrNoRows) {
			return
		}
		var v T
		if err == nil {
			v, err = c.take(raw, b)
		}
		if err != nil { // no reason to stop: it's counted
			slog.Warn("taking up a kept count", "count", c.name, "err", err)
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		s.keptAt = time.UnixMilli(at)
		if s.last == nil {
			s.last = &snapOf[T]{at: s.keptAt, v: v}
		}
	})
}

// errCountBroke is a count that panicked (stopped and reported by package safe).
var errCountBroke = errors.New("the count broke off")

// start starts a count, unless one is under way. Called with the lock held.
func (s *snapshot[T]) start(now time.Time, b *bank.Bank, c counter[T]) {
	if s.running != nil {
		return
	}
	done := make(chan struct{})
	s.running = done
	keep := c.keep != nil && c.db != nil && (now.Sub(s.keptAt) >= keepEvery || now.Before(s.keptAt))
	go func() {
		var v T
		var err error
		if !safe.Do("counting everyone's answers", func() { v, err = c.count(context.Background(), now, b) }) {
			err = errCountBroke // a count that panicked is a count that failed: the next asks again
		}
		if err != nil {
			slog.Warn("counting everyone's answers", "count", c.name, "err", err)
		}
		s.mu.Lock()
		if err == nil {
			s.last = &snapOf[T]{at: now, bank: b, v: v}
		}
		s.mu.Unlock()
		// Kept before the count is over: whoever waits for it (a server stopping, a test) has it written too. A count
		// that isn't kept is no reason to stop either: the next is.
		if err == nil && keep {
			var kerr error
			if !safe.Do("keeping a count", func() { kerr = s.keep(c, now, v) }) || kerr != nil {
				slog.Warn("keeping a count", "count", c.name, "err", kerr)
			}
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		s.err, s.running = err, nil
		close(done)
	}()
}

// keep writes a count to the database, in place of the one kept before.
func (s *snapshot[T]) keep(c counter[T], at time.Time, v T) error {
	raw, err := c.keep(v)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if _, err := c.db.Write.ExecContext(ctx, `INSERT INTO counts (name, at, value) VALUES (?, ?, ?)
		ON CONFLICT (name) DO UPDATE SET at = excluded.at, value = excluded.value`, c.name, store.Ms(at), raw); err != nil {
		return err
	}
	s.mu.Lock()
	s.keptAt = at
	s.mu.Unlock()
	return nil
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

// gobbed is a value as gob writes it: what a count keeps in the database.
func gobbed(v any) ([]byte, error) {
	var buf bytes.Buffer
	err := gob.NewEncoder(&buf).Encode(v)
	return buf.Bytes(), err
}

// ungobbed reads a value gobbed wrote.
func ungobbed[V any](raw []byte) (V, error) {
	var v V
	err := gob.NewDecoder(bytes.NewReader(raw)).Decode(&v)
	return v, err
}
