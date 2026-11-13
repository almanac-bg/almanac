package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/room"
)

var roomCode = regexp.MustCompile(`^[0-9]{6}$`)

func (s *Server) roomOf(r *http.Request) (*room.Room, error) {
	code := r.PathValue("code")
	if !roomCode.MatchString(code) {
		return nil, room.ErrNoRoom
	}
	return s.rooms.Get(code)
}

// roomPlayer is a player as a room shows them: their name and their look (avatar, title, level).
func (s *Server) roomPlayer(ctx context.Context, id int64, name string) room.Player {
	look, err := s.game.LookOf(ctx, id)
	if err != nil {
		look = play.Look{Avatar: play.DefaultAvatar(id), Level: 1}
	}
	return room.Player{ID: id, Name: name, Look: look}
}

func (s *Server) openRoom(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Category string `json:"category"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.limits.allow("room:"+strconv.FormatInt(u.ID, 10), 30, time.Hour) {
		return errTooMany
	}
	rm, err := s.rooms.Open(s.roomPlayer(r.Context(), u.ID, u.Name), in.Category)
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"code": rm.Code(), "url": s.cfg.PublicURL + "/r/" + rm.Code()})
}

// roomEvents streams a room to a player's screen (Server-Sent Events): the room as they see it, again after every
// change. Opening the stream joins the room. The browser reconnects by itself if the line drops.
func (s *Server) roomEvents(w http.ResponseWriter, r *http.Request) {
	u, err := s.mustUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "signed_out"})
		return
	}
	rm, err := s.roomOf(r)
	if err == nil {
		err = rm.Join(s.roomPlayer(r.Context(), u.ID, u.Name))
	}
	var sub *room.Sub
	if err == nil {
		sub, err = rm.Follow(u.ID)
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	if err != nil {
		// Said in the stream, which is all a browser's EventSource can read: no such room (any more), or no room in it.
		event := "closed"
		if errors.Is(err, room.ErrFull) {
			event = "full"
		}
		fmt.Fprintf(w, "event: %s\ndata: {}\n\n", event)
		return
	}
	defer rm.Unfollow(sub)

	send := func(line string) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprint(w, line); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	ping := time.NewTicker(20 * time.Second) // keeps the line open through proxies (Cloudflare closes it after 100 s)
	defer ping.Stop()
	for {
		select {
		case <-sub.C:
			data, _ := json.Marshal(rm.View(u.ID))
			if !send("data: " + string(data) + "\n\n") {
				return
			}
		case <-ping.C:
			if !send(": ping\n\n") {
				return
			}
		case <-sub.Done:
			send("event: closed\ndata: {}\n\n")
			return
		case <-s.closing:
			return
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) roomStart(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	rm, err := s.roomOf(r)
	if err != nil {
		return err
	}
	if err := rm.Start(u.ID); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

func (s *Server) roomAnswer(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	rm, err := s.roomOf(r)
	if err != nil {
		return err
	}
	var in struct {
		N      int             `json:"n"`
		Answer json.RawMessage `json:"answer"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if err := rm.Answer(u.ID, in.N, in.Answer); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}
