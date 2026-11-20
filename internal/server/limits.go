package server

import (
	"bufio"
	"encoding/json"
	"errors"
	"hash/maphash"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// limiter counts what each key (a network, a player, an email) did in a window of its own, to stop floods and
// guessing.
//
// A window ends a period after its first count, and its count with it: the key is forgotten then (swept within a
// minute). The keys are kept in shards, each under its own lock, so that a sweep holds up a sixteenth of the requests
// for a sixteenth of the time. There are limitKeys at most: a flood of new keys (a key for each of many networks)
// pushes out, of a few windows picked at random, the one with the fewest counts (and of those, the nearest its end).
// A window that has spent its budget has many counts, and a flood's new keys one each, so a flood pushes out its own
// keys and other barely used ones, not the spent budgets it would like to start again (review 2026-11-18, S8): to
// push out a window of n counts, a flood must fill the limiter with windows of n counts, n requests a key. A key
// pushed out starts again from nothing; the server hears when that happens (onFull), as it means a flood.
//
// The server has two limiters (Server.limits, Server.guard): the limits that keep players safe (codes mailed and
// tried, guests made, reports) are kept apart from the rest, so that no flood of the cheap keys
// (pages visited, a player's writes) can push them out at all. Their keys are bounded too: a key for a network is
// made only while its site's budget isn't spent (from), so one site makes no more of them than its budget.
//
// The counts outlive a restart (save and restore, Config.LimitsFile): a deploy, several a day, would otherwise give
// every budget whole again. A crash loses them, which is rare enough.
type limiter struct {
	off    bool                    // development and the browser tests: every request from one address
	now    func() time.Time        // the clock (tests); nil: time.Now
	seed   maphash.Seed            // which key goes to which shard
	most   int                     // keys in a shard at most
	shards [limitShards]limitShard // by the key's hash
	// onFull is told when a key is pushed out to make room, at most once a minute (lastFull): nil, nobody.
	onFull   func()
	lastFull atomic.Int64
}

const (
	limitShards = 16
	// limitKeys is how many keys are counted at most: about 100 bytes each, 25 MB in all. An hour of the game's
	// traffic needs a few for each player (a page, a guest, a tally): this is room for tens of thousands at once.
	limitKeys = 1 << 18
	// limitSample is how many windows are looked at to pick the one to push out, when a shard is full.
	limitSample = 8
)

type limitShard struct {
	mu    sync.Mutex
	hits  map[string]window
	swept int64 // when the ended windows were last forgotten (Unix ms)
}

type window struct {
	end int64 // when the window ends, its count with it (Unix ms)
	n   int
}

func newLimiter() *limiter { return newLimiterOf(limitKeys) }

// newLimiterOf is a limiter of keys at most.
func newLimiterOf(keys int) *limiter {
	l := &limiter{seed: maphash.MakeSeed(), most: max(keys/limitShards, 1)}
	for i := range l.shards {
		l.shards[i].hits = map[string]window{}
	}
	return l
}

func (l *limiter) ms() int64 {
	if l.now != nil {
		return l.now().UnixMilli()
	}
	return time.Now().UnixMilli()
}

func (l *limiter) shard(key string) *limitShard {
	return &l.shards[maphash.String(l.seed, key)%limitShards]
}

// allow counts one for key and says whether it's within n a period (from the window's first count).
func (l *limiter) allow(key string, n int, per time.Duration) bool {
	if l.off {
		return true
	}
	now := l.ms()
	sh := l.shard(key)
	sh.mu.Lock()
	defer sh.mu.Unlock()
	sh.sweep(now, time.Minute)
	w, ok := sh.hits[key]
	full := false
	if !ok || now >= w.end {
		if !ok && len(sh.hits) >= l.most {
			full = sh.makeRoom(now, l.most)
		}
		w = window{end: now + per.Milliseconds()}
	}
	w.n++
	sh.hits[key] = w
	if full {
		l.full(now)
	}
	return w.n <= n
}

// full tells onFull that a key was pushed out, unless it was told within the last minute.
func (l *limiter) full(now int64) {
	if l.onFull == nil {
		return
	}
	if last := l.lastFull.Load(); now-last < time.Minute.Milliseconds() || !l.lastFull.CompareAndSwap(last, now) {
		return
	}
	l.onFull()
}

// spent says whether key has had its n in its window already, counting nothing: for a limit on what failed, checked
// before trying (allow counts each failure after).
func (l *limiter) spent(key string, n int) bool {
	if l.off {
		return false
	}
	now := l.ms()
	sh := l.shard(key)
	sh.mu.Lock()
	defer sh.mu.Unlock()
	w, ok := sh.hits[key]
	return ok && now < w.end && w.n >= n
}

// keys is how many keys are counted now.
func (l *limiter) keys() int {
	n := 0
	for i := range l.shards {
		sh := &l.shards[i]
		sh.mu.Lock()
		n += len(sh.hits)
		sh.mu.Unlock()
	}
	return n
}

// sweep forgets the windows that have ended, if it wasn't done in the last `every`. Called with the lock held.
func (sh *limitShard) sweep(now int64, every time.Duration) {
	if now-sh.swept < every.Milliseconds() {
		return
	}
	for k, w := range sh.hits {
		if w.end <= now {
			delete(sh.hits, k)
		}
	}
	sh.swept = now
}

// makeRoom makes room for a key in a full shard: the windows that have ended go (if they weren't swept in the last
// second), else, of a few picked at random (a map's order is), the one with the fewest counts, and of those the one
// nearest its end. It says whether a window that hadn't ended was pushed out. Called with the lock held.
func (sh *limitShard) makeRoom(now int64, most int) bool {
	sh.sweep(now, time.Second)
	if len(sh.hits) < most {
		return false
	}
	var out string
	var low window
	seen := 0
	for k, w := range sh.hits {
		if seen == 0 || w.n < low.n || (w.n == low.n && w.end < low.end) {
			out, low = k, w
		}
		if seen++; seen == limitSample {
			break
		}
	}
	delete(sh.hits, out)
	return true
}

// kept is a window as a stopping server keeps it: L is which of the limiters saved together it's of (saveAll).
type kept struct {
	Key string `json:"k"`
	End int64  `json:"e"`
	N   int    `json:"n"`
	L   int    `json:"l,omitempty"`
}

// save writes the windows that haven't ended, one a line, and says how many.
func (l *limiter) save(w io.Writer) (int, error) { return saveAll(w, l) }

// restore counts again what save wrote, as far as the windows haven't ended since, and says how many it took.
func (l *limiter) restore(r io.Reader) (int, error) { return restoreAll(r, l) }

// saveAll writes the windows of several limiters that haven't ended, one a line, each marked with its limiter's
// place among them, and says how many.
func saveAll(w io.Writer, ls ...*limiter) (int, error) {
	bw := bufio.NewWriter(w)
	enc := json.NewEncoder(bw)
	n := 0
	for i, l := range ls {
		now := l.ms()
		for j := range l.shards {
			sh := &l.shards[j]
			sh.mu.Lock()
			for k, win := range sh.hits {
				if win.end <= now {
					continue
				}
				if err := enc.Encode(kept{k, win.end, win.n, i}); err != nil {
					sh.mu.Unlock()
					return n, err
				}
				n++
			}
			sh.mu.Unlock()
		}
	}
	return n, bw.Flush()
}

// restoreAll counts again what saveAll wrote, each window in the limiter of its place, as far as the windows
// haven't ended since, and says how many it took.
func restoreAll(r io.Reader, ls ...*limiter) (int, error) {
	dec := json.NewDecoder(bufio.NewReader(r))
	n := 0
	for {
		var k kept
		if err := dec.Decode(&k); errors.Is(err, io.EOF) {
			return n, nil
		} else if err != nil {
			return n, err
		}
		if k.L < 0 || k.L >= len(ls) {
			continue
		}
		l := ls[k.L]
		now := l.ms()
		if k.Key == "" || k.End <= now || k.N <= 0 {
			continue
		}
		sh := l.shard(k.Key)
		sh.mu.Lock()
		if len(sh.hits) < l.most {
			// No window is longer than a day: a later end than that is no count of this server's.
			sh.hits[k.Key] = window{end: min(k.End, now+(24*time.Hour).Milliseconds()), n: k.N}
			n++
		}
		sh.mu.Unlock()
	}
}

// saveLimits keeps the limits' counts as the server stops, for its next run (Config.LimitsFile).
func (s *Server) saveLimits() {
	if s.cfg.LimitsFile == "" || s.limits.off {
		return
	}
	tmp := s.cfg.LimitsFile + ".part"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	var n int
	if err == nil {
		n, err = saveAll(f, s.limits, s.guard)
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}
	if err == nil {
		err = os.Rename(tmp, s.cfg.LimitsFile)
	}
	if err != nil {
		slog.Error("saving limits", "err", err)
		return
	}
	slog.Info("limits saved", "keys", n)
}

// restoreLimits goes on with the counts the last run of the server kept, once.
func (s *Server) restoreLimits() {
	if s.cfg.LimitsFile == "" || s.limits.off {
		return
	}
	f, err := os.Open(s.cfg.LimitsFile)
	if errors.Is(err, fs.ErrNotExist) {
		return
	}
	if err != nil {
		slog.Error("restoring limits", "err", err)
		return
	}
	n, err := restoreAll(f, s.limits, s.guard)
	f.Close()
	os.Remove(s.cfg.LimitsFile)
	if err != nil {
		slog.Error("restoring limits", "err", err, "keys", n)
		return
	}
	slog.Info("limits restored", "keys", n)
}
