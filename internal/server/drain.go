package server

import (
	"errors"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"sync"
	"time"
)

// A restart cuts what is played in memory: live duels (internal/live) and games in rooms (internal/room). So a deploy
// (deploy/deploy.sh) asks the server to drain first, with POST /api/drain from the machine itself, again every few
// seconds while it waits. Draining, the server starts no live duel (whoever asks for one waits, told why, and finds
// it on the new server) and no game in a room, and says it's ready once nothing is under way, or once it has drained
// for drainCap. Around Роял, from drainLead before its lobby opens until its games are over, it doesn't drain at all:
// the restart waits for the evening to pass. A drain nobody asks about for drainLease ends by itself (a deploy that
// died midway), and DELETE /api/drain ends it at once.
const (
	// drainCap is the longest a restart waits for the games under way: a live duel, start to end, if slow.
	drainCap = 5 * time.Minute
	// drainLead is how long before Роял's lobby opens a drain no longer starts: one begun earlier is over in time.
	drainLead = drainCap + time.Minute
	// drainLease is how long a drain lasts without being asked about again.
	drainLease = time.Minute
)

// drain is where the server stands on a restart.
type drain struct {
	mu    sync.Mutex
	asked time.Time // last asked to drain (zero: not asked)
	since time.Time // draining since (zero: not draining)
}

// DrainStatus is what a deploy hears: whether it may restart the server now, and if not, what it waits for.
type DrainStatus struct {
	Ready bool `json:"ready"`
	// Duels and Rooms are the live duels and the rooms' games under way.
	Duels int `json:"duels"`
	Rooms int `json:"rooms"`
	// Royal says Роял is near or on: no drain until it's over.
	Royal bool `json:"royal"`
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
	royal := s.royal.Near(drainLead)
	switch on := wanted && !royal; {
	case on && d.since.IsZero():
		d.since = now
		s.live.Pause()
		s.rooms.Pause()
		slog.Info("draining for a restart")
	case !on && !d.since.IsZero():
		d.since = time.Time{}
		s.live.Resume()
		s.rooms.Resume()
		slog.Info("drain over", "asked", wanted, "royal", royal)
	}
	st := DrainStatus{Duels: s.live.UnderWay(), Rooms: s.rooms.UnderWay(), Royal: royal}
	if !d.since.IsZero() {
		waited := now.Sub(d.since)
		st.Waited = int(waited.Seconds())
		st.Ready = st.Duels+st.Rooms == 0 || waited >= drainCap
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

// saveRooms keeps the rooms open as the server stops, for the next run to open again (room.Hub.Save).
func (s *Server) saveRooms() {
	if s.cfg.RoomsFile == "" {
		return
	}
	tmp := s.cfg.RoomsFile + ".part"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err == nil {
		err = s.rooms.Save(f)
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}
	if err == nil {
		err = os.Rename(tmp, s.cfg.RoomsFile)
	}
	if err != nil {
		slog.Error("saving rooms", "err", err)
	}
}

// restoreRooms opens again the rooms the last run of the server kept, once.
func (s *Server) restoreRooms() {
	if s.cfg.RoomsFile == "" {
		return
	}
	f, err := os.Open(s.cfg.RoomsFile)
	if errors.Is(err, fs.ErrNotExist) {
		return
	}
	if err != nil {
		slog.Error("restoring rooms", "err", err)
		return
	}
	n, err := s.rooms.Restore(f)
	f.Close()
	os.Remove(s.cfg.RoomsFile)
	if err != nil {
		slog.Error("restoring rooms", "err", err)
		return
	}
	if n > 0 {
		slog.Info("rooms restored", "rooms", n)
	}
}
