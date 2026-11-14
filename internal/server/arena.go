package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/room"
)

// arenaEvents is a player waiting for an arena (Server-Sent Events): the queue as it stands after every change, then
// the room they're put in (event "matched"). Opening the stream is joining the queue; closing it, leaving.
func (s *Server) arenaEvents(w http.ResponseWriter, r *http.Request) {
	u, err := s.mustUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "signed_out"})
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	t, err := s.rooms.Enqueue(s.roomPlayer(r.Context(), u.ID, u.Name))
	if err != nil {
		fmt.Fprint(w, "event: closed\ndata: {}\n\n")
		return
	}
	defer s.rooms.Leave(t)

	send := func(line string) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprint(w, line); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-t.C:
			data, _ := json.Marshal(s.rooms.Queue())
			if !send("data: " + string(data) + "\n\n") {
				return
			}
		case <-t.Done:
			if t.Code() == "" {
				send("event: replaced\ndata: {}\n\n") // the same player waits in another tab now
				return
			}
			data, _ := json.Marshal(map[string]string{"code": t.Code()})
			send("event: matched\ndata: " + string(data) + "\n\n")
			return
		case <-ping.C:
			if !send(": ping\n\n") {
				return
			}
		case <-s.closing:
			return
		case <-r.Context().Done():
			return
		}
	}
}

// arenaEnded keeps an arena's places, moves the ratings, and shows the room what they did.
func (s *Server) arenaEnded(rm *room.Room, placed []room.Placed) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	list := make([]play.ArenaPlace, len(placed))
	for i, p := range placed {
		list[i] = play.ArenaPlace{UserID: p.ID, Place: p.Place, Points: p.Points, Rights: p.Rights}
	}
	deltas, err := s.game.SettleArena(ctx, list)
	if err != nil {
		slog.Error("arena", "room", rm.Code(), "err", err)
	}
	if deltas != nil {
		rm.Settled(deltas)
	}
}
