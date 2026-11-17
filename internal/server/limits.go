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
	"time"
)

// limiter counts what each key (a network, a player, an email) did in a window of its own, to stop floods and
// guessing.
//
// A window ends a period after its first count, and its count with it: the key is forgotten then (swept within a
// minute). The keys are kept in shards, each under its own lock, so that a sweep holds up a sixteenth of the requests
// for a sixteenth of the time. There are limitKeys at most: a flood of new keys (a key for each of many networks)
// pushes out the windows nearest their end, of a few picked at random. A key pushed out starts again from nothing, so
// under such a flood a limit lets a little more through rather than refuse everyone, and the memory stays what it was.
//
// The counts outlive a restart (save and restore, Config.LimitsFile): a deploy, several a day, would otherwise give
// every budget whole again. A crash loses them, which is rare enough.
type limiter struct {
	off    bool                    // development and the browser tests: every request from one address
	now    func() time.Time        // the clock (tests); nil: time.Now
	seed   maphash.Seed            // which key goes to which shard
	most   int                     // keys in a shard at most
	shards [limitShards]limitShard // by the key's hash
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
	if !ok || now >= w.end {
		if !ok && len(sh.hits) >= l.most {
			sh.makeRoom(now, l.most)
		}
		w = window{end: now + per.Milliseconds()}
	}
	w.n++
	sh.hits[key] = w
	return w.n <= n
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
// second), else the one nearest its end of a few picked at random (a map's order is). Called with the lock held.
func (sh *limitShard) makeRoom(now int64, most int) {
	sh.sweep(now, time.Second)
	if len(sh.hits) < most {
		return
	}
	var out string
	var end int64
	seen := 0
	for k, w := range sh.hits {
		if seen == 0 || w.end < end {
			out, end = k, w.end
		}
		if seen++; seen == limitSample {
			break
		}
	}
	delete(sh.hits, out)
}

// kept is a window as a stopping server keeps it.
type kept struct {
	Key string `json:"k"`
	End int64  `json:"e"`
	N   int    `json:"n"`
}

// save writes the windows that haven't ended, one a line, and says how many.
func (l *limiter) save(w io.Writer) (int, error) {
	bw := bufio.NewWriter(w)
	enc := json.NewEncoder(bw)
	now := l.ms()
	n := 0
	for i := range l.shards {
		sh := &l.shards[i]
		sh.mu.Lock()
		for k, win := range sh.hits {
			if win.end <= now {
				continue
			}
			if err := enc.Encode(kept{k, win.end, win.n}); err != nil {
				sh.mu.Unlock()
				return n, err
			}
			n++
		}
		sh.mu.Unlock()
	}
	return n, bw.Flush()
}

// restore counts again what save wrote, as far as the windows haven't ended since, and says how many it took.
func (l *limiter) restore(r io.Reader) (int, error) {
	dec := json.NewDecoder(bufio.NewReader(r))
	now := l.ms()
	n := 0
	for {
		var k kept
		if err := dec.Decode(&k); errors.Is(err, io.EOF) {
			return n, nil
		} else if err != nil {
			return n, err
		}
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
		n, err = s.limits.save(f)
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
	n, err := s.limits.restore(f)
	f.Close()
	os.Remove(s.cfg.LimitsFile)
	if err != nil {
		slog.Error("restoring limits", "err", err, "keys", n)
		return
	}
	slog.Info("limits restored", "keys", n)
}
