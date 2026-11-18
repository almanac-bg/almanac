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

	"github.com/almanac-bg/almanac/internal/live"
)

// A restart cuts what is played in memory: live duels (internal/live) and games in rooms (internal/room). So a deploy
// (deploy/deploy.sh) asks the server to drain first, with POST /api/drain from the machine itself, again every few
// seconds while it waits. Draining, the server starts no live duel (whoever asks for one waits, told why, and finds
// it on the new server) and no game in a room, and says it's ready once nothing is under way: each live duel waited
// for to its end, by its own clock (live.Hub.UnderWay: however long its questions, live.Longest at most), the rooms'
// games for drainCap at most (a game cut then goes on after the restart, where it was: room.Hub.Restore). Around Роял,
// from drainLead before its lobby opens until its games are over, it doesn't drain at all: the restart waits for the
// evening to pass. A drain nobody asks about for drainLease ends by itself (a deploy that died midway), and DELETE
// /api/drain ends it at once.
//
// The answer never waits on a game: a duel busy at the moment it's asked counts as under way, for all of a duel, so a
// deploy hears back at once even at the evening's peak. A deploy that hears nothing (a timeout, an error) asks again,
// and never takes that for ready; only a server too old to drain answers it 404 (deploy.sh).
const (
	// drainCap is the longest a restart waits for the rooms' games under way.
	drainCap = 5 * time.Minute
	// drainLead is how long before Роял's lobby opens a drain no longer starts: one begun earlier is over in time.
	drainLead = max(drainCap, live.Longest) + time.Minute
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
	// DuelsLeft is, in seconds, how long the live duels under way may still take, at most.
	DuelsLeft int `json:"duelsLeft"`
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
	duels, left := s.live.UnderWay()
	st := DrainStatus{Duels: duels, Rooms: s.rooms.UnderWay(), Royal: royal}
	st.DuelsLeft = int(left.Round(time.Second).Seconds())
	if !d.since.IsZero() {
		waited := now.Sub(d.since)
		st.Waited = int(waited.Seconds())
		// A duel past its longest by its own clock (left 0) is stuck: waiting for it would save nothing.
		st.Ready = (st.Duels == 0 || left == 0) && (st.Rooms == 0 || waited >= drainCap)
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

// roomsSaved is where the rooms' file stands: one save at a time, and the hub's changes it holds.
type roomsSaved struct {
	mu      sync.Mutex
	changes uint64
}

// saveRoomsChanged saves the rooms if they've changed since they were last saved: every roomsEvery, so that a crash
// loses no more of them than that (the game under way in each, every answer in it).
func (s *Server) saveRoomsChanged() {
	if s.rooms.Changes() != s.roomsSaved.changesNow() {
		s.saveRooms()
	}
}

func (r *roomsSaved) changesNow() uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.changes
}

// saveRooms keeps the rooms open, with their games as they stand, for the next run to open again (room.Hub.Save):
// written whole beside the file, synced, then put in its place, so that a crash or a power cut at any moment leaves
// the last save or this one, never half of one.
func (s *Server) saveRooms() {
	if s.cfg.RoomsFile == "" {
		return
	}
	s.roomsSaved.mu.Lock()
	defer s.roomsSaved.mu.Unlock()
	changes := s.rooms.Changes() // before the save: a change during it is saved next time
	tmp := s.cfg.RoomsFile + ".part"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err == nil {
		err = s.rooms.Save(f)
		if err == nil {
			err = f.Sync()
		}
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}
	if err == nil {
		err = os.Rename(tmp, s.cfg.RoomsFile)
	}
	if err != nil {
		slog.Error("saving rooms", "err", err)
		return
	}
	s.roomsSaved.changes = changes
}

// restoreRooms opens again the rooms the last run of the server kept. The file stays: until the next save, it is what
// a crash would come back to.
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
	if err != nil {
		slog.Error("restoring rooms", "err", err)
		return
	}
	if n > 0 {
		slog.Info("rooms restored", "rooms", n)
	}
}
