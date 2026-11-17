package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/qr"
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
	var in room.Settings
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.limits.allow("room:"+strconv.FormatInt(u.ID, 10), 30, time.Hour) {
		return errTooMany
	}
	rm, err := s.rooms.Open(s.roomPlayer(r.Context(), u.ID, u.Name), in)
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
	if err != nil {
		// Said in the stream, which is all a browser's EventSource can read: no such room (any more), no room in it, or
		// not for this player (sent out by the host).
		event := "closed"
		switch {
		case errors.Is(err, room.ErrFull):
			event = "full"
		case errors.Is(err, room.ErrRemoved):
			event = "removed"
		}
		fmt.Fprintf(w, "event: %s\ndata: {}\n\n", event)
		return
	}
	defer rm.Unfollow(sub)

	send := sender(w)
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
			if sub.Removed() {
				send("event: removed\ndata: {}\n\n")
			} else {
				send("event: closed\ndata: {}\n\n")
			}
			return
		case <-s.closing:
			return
		case <-r.Context().Done():
			return
		}
	}
}

// roomLead is who leads a room starting a game, moving it on (Next) or ending it (Finish).
func (s *Server) roomLead(act func(*room.Room, int64) error) func(http.ResponseWriter, *http.Request) error {
	return func(w http.ResponseWriter, r *http.Request) error {
		u, err := s.mustUser(r)
		if err != nil {
			return err
		}
		rm, err := s.roomOf(r)
		if err != nil {
			return err
		}
		if err := act(rm, u.ID); err != nil {
			return err
		}
		return ok(w, map[string]bool{"ok": true})
	}
}

// roomOpen says whether a room is open under a code, to anyone who asks (before a name is asked or a player made for
// it): a wrong code is told at once. Limited by address, so that it's no way to look for rooms.
func (s *Server) roomOpen(w http.ResponseWriter, r *http.Request) error {
	if !s.limits.allow("roomcode:"+s.clientIP(r), 120, time.Hour) {
		return errTooMany
	}
	if _, err := s.roomOf(r); err != nil {
		return err
	}
	return ok(w, map[string]bool{"open": true})
}

// roomSettings is the host choosing what the room plays next, between games (room.Room.Change).
func (s *Server) roomSettings(w http.ResponseWriter, r *http.Request) error {
	var in room.Settings
	if err := readJSON(r, &in); err != nil {
		return err
	}
	return s.roomLead(func(rm *room.Room, by int64) error { return rm.Change(by, in) })(w, r)
}

// roomHold is who leads keeping each answer up until they move on, or letting the room move on by itself again.
func (s *Server) roomHold(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		On bool `json:"on"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	return s.roomLead(func(rm *room.Room, by int64) error { return rm.Hold(by, in.On) })(w, r)
}

// roomQR is the room's link as a QR code, for a big screen: drawn here, so that no outside service sees the code.
func (s *Server) roomQR(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	if !roomCode.MatchString(code) {
		http.NotFound(w, r)
		return
	}
	c, err := qr.Encode(s.cfg.PublicURL + "/r/" + code)
	if err != nil {
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = io.WriteString(w, c.SVG())
}

// roomRemove is the host sending a player out of the room, by their key.
func (s *Server) roomRemove(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	rm, err := s.roomOf(r)
	if err != nil {
		return err
	}
	var in struct {
		Key int `json:"key"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if err := rm.Remove(u.ID, in.Key); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// roomPeople is what a room's end offers its player: whom of the others to add as friends (their keys: not friends
// yet, nor asked), and whether the day's ten still wait for them.
func (s *Server) roomPeople(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	rm, err := s.roomOf(r)
	if err != nil {
		return err
	}
	add := []int{}
	for key, id := range rm.Players() {
		if id == u.ID {
			continue
		}
		var known bool
		if err := s.db.Read.QueryRowContext(r.Context(), `SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ?1 AND friend_id = ?2)
			OR EXISTS (SELECT 1 FROM friend_requests WHERE from_id = ?1 AND to_id = ?2)`, u.ID, id).Scan(&known); err != nil {
			return err
		}
		if !known {
			add = append(add, key)
		}
	}
	_, played, err := s.game.DayRights(r.Context(), u.ID, s.game.Today(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"add": add, "day": played})
}

// roomBefriend asks a player of the room (by their key) to be friends: a request, as by their tag.
func (s *Server) roomBefriend(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	rm, err := s.roomOf(r)
	if err != nil {
		return err
	}
	var in struct {
		Key int `json:"key"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	id, here := rm.Players()[in.Key]
	if !here || id == u.ID {
		return play.ErrNoPlayer
	}
	if !s.limits.allow("request:"+s.clientIP(r), 30, time.Hour) {
		return errTooMany
	}
	var tag string
	if err := s.db.Read.QueryRowContext(r.Context(), `SELECT tag FROM users WHERE id = ?`, id).Scan(&tag); err != nil {
		return err
	}
	sent, err := s.game.Request(r.Context(), u.ID, tag, false)
	if err != nil {
		return err
	}
	return ok(w, sent)
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
