package server

import (
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"
)

// A restart cuts what is played in memory: live duels (internal/live). So a deploy (deploy/deploy.sh) asks the server
// to drain first, with POST /api/drain from the machine itself, again every few seconds while it waits. Draining, the
// server starts no live duel (whoever asks for one waits, told why, and finds it on the new server), and says it's
// ready once none is under way: each waited for to its end, by its own clock (live.Hub.UnderWay: however long its
// questions, live.Longest at most). A drain nobody asks about for drainLease ends by itself (a deploy that died midway), and DELETE
// /api/drain ends it at once.
//
// The answer never waits on a game: a duel busy at the moment it's asked counts as under way, for all of a duel, so a
// deploy hears back at once even at the busiest moment. A deploy that hears nothing (a timeout, an error) asks again,
// and never takes that for ready; only a server too old to drain answers it 404 (deploy.sh).
// drainLease is how long a drain lasts without being asked about again.
const drainLease = time.Minute

// drain is where the server stands on a restart.
type drain struct {
	mu    sync.Mutex
	asked time.Time // last asked to drain (zero: not asked)
	since time.Time // draining since (zero: not draining)
}

// DrainStatus is what a deploy hears: whether it may restart the server now, and if not, what it waits for.
type DrainStatus struct {
	Ready bool `json:"ready"`
	// Duels are the live duels under way.
	Duels int `json:"duels"`
	// DuelsLeft is, in seconds, how long the live duels under way may still take, at most.
	DuelsLeft int `json:"duelsLeft"`
	// Waited is how long the server has drained, in seconds.
	Waited int `json:"waited"`
}

// drainStep brings the drain up to date: asked is whether a deploy asks for one now (nil: no news, the clock only).
func (s *Server) drainStep(asked *bool) DrainStatus {
	d := &s.drain
	d.mu.Lock()
	defer d.mu.Unlock()
	if asked == nil && d.asked.IsZero() && d.since.IsZero() {
		return DrainStatus{} // nothing asked, nothing to undo: the clock's tick costs nothing
	}
	now := s.game.Now()
	if asked != nil {
		d.asked = time.Time{}
		if *asked {
			d.asked = now
		}
	}
	wanted := !d.asked.IsZero() && now.Sub(d.asked) < drainLease
	switch {
	case wanted && d.since.IsZero():
		d.since = now
		s.live.Pause()
		slog.Info("draining for a restart")
	case !wanted && !d.since.IsZero():
		d.since = time.Time{}
		s.live.Resume()
		slog.Info("drain over")
	}
	duels, left := s.live.UnderWay()
	st := DrainStatus{Duels: duels}
	st.DuelsLeft = int(left.Round(time.Second).Seconds())
	if !d.since.IsZero() {
		st.Waited = int(now.Sub(d.since).Seconds())
		// A duel past its longest by its own clock (left 0) is stuck: waiting for it would save nothing.
		st.Ready = st.Duels == 0 || left == 0
	}
	return st
}

// drainHandler is POST /api/drain (drain, and how it stands) and DELETE /api/drain (drain no more), for the machine
// itself only: to anyone else it isn't there.
func (s *Server) drainHandler(w http.ResponseWriter, r *http.Request) error {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		return errNotFound
	}
	asked := r.Method == http.MethodPost
	return ok(w, s.drainStep(&asked))
}
