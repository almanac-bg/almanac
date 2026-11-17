package server

// Rooms over HTTP (internal/room). Who may do what in a room is one rule: a player joins it by its code (roomJoin),
// and from then on everything of the room (its stream, the game, its people, its QR code) is theirs, and its host's;
// to anyone else the room isn't there (404, as for a code nobody has), so that nothing tells them it's open. A code
// is six digits, easy to say to a class; what keeps codes from being walked is that a code given that isn't open, or
// is a locked room's, counts against the player and their address (roomByCode), and past a few an hour, no code is
// looked up for them at all.

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

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/qr"
	"github.com/almanac-bg/almanac/internal/room"
)

var roomCode = regexp.MustCompile(`^[0-9]{6}$`)

// errLocked is someone new at a room its host has locked.
var errLocked = &apiError{http.StatusForbidden, "locked", "Стаята е заключена: нови играчи не могат да влязат."}

// How many codes given in an hour may miss (no room open under them, or a locked one), for a player and for an
// address (a school's, many players behind it), before none is looked up: typos are a few, walking the codes is
// thousands.
const (
	roomMissesPlayer  = 20
	roomMissesAddress = 100
)

func (s *Server) roomOf(r *http.Request) (*room.Room, error) {
	code := r.PathValue("code")
	if !roomCode.MatchString(code) {
		return nil, room.ErrNoRoom
	}
	return s.rooms.Get(code)
}

// roomMisses are the limits on codes that miss for a request: its address's, and its player's (0: none).
func (s *Server) roomMisses(r *http.Request, userID int64) map[string]int {
	keys := map[string]int{"roommiss:" + s.clientNet(r): roomMissesAddress}
	if userID != 0 {
		keys["roommiss:user:"+strconv.FormatInt(userID, 10)] = roomMissesPlayer
	}
	return keys
}

// missed counts a code that missed.
func (s *Server) missed(r *http.Request, userID int64) {
	for key, n := range s.roomMisses(r, userID) {
		s.limits.allow(key, n, time.Hour)
	}
}

// roomByCode finds a room by the code someone gave, to come into it (or to see that it's open), under the limit on
// codes that miss: once it's spent, no code is looked up, so that the answer then tells nothing.
func (s *Server) roomByCode(r *http.Request, userID int64) (*room.Room, error) {
	for key, n := range s.roomMisses(r, userID) {
		if s.limits.spent(key, n) {
			return nil, errTooMany
		}
	}
	rm, err := s.roomOf(r)
	if err != nil {
		s.missed(r, userID)
	}
	return rm, err
}

// roomFor finds the room under the request's code for a player in it (or its host): to anyone else there's no room.
func (s *Server) roomFor(r *http.Request, u *account.User) (*room.Room, error) {
	rm, err := s.roomOf(r)
	if err != nil || !rm.In(u.ID) {
		return nil, room.ErrNoRoom
	}
	return rm, nil
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
	rm, err := s.rooms.Open(s.roomPlayer(r.Context(), u.ID, u.Name), s.clientNet(r), in)
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"code": rm.Code(), "url": s.cfg.PublicURL + "/r/" + rm.Code()})
}

// roomOpen says whether a room is open under a code, to anyone who asks (before a name is asked or a player made for
// it): a wrong code is told at once. A code that misses counts against the address (roomByCode).
func (s *Server) roomOpen(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.roomByCode(r, 0); err != nil {
		return err
	}
	return ok(w, map[string]bool{"open": true})
}

// roomJoin is a player coming into a room by its code: once, and again on each return (their name and look as they
// are now). Unless the host has locked it to anyone new: a locked room counts as a code that missed, for a stranger.
func (s *Server) roomJoin(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	rm, err := s.roomByCode(r, u.ID)
	if err != nil {
		return err
	}
	if err := rm.Join(s.roomPlayer(r.Context(), u.ID, u.Name)); err != nil {
		if errors.Is(err, room.ErrLocked) {
			s.missed(r, u.ID)
			return errLocked
		}
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// roomEvents streams a room to the screen of a player in it (roomJoin first), or of its host (Server-Sent Events):
// the room as they see it, again after every change. The browser reconnects by itself if the line drops.
func (s *Server) roomEvents(w http.ResponseWriter, r *http.Request) {
	u, err := s.mustUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "signed_out"})
		return
	}
	rm, err := s.roomOf(r)
	var sub *room.Sub
	if err == nil {
		sub, err = rm.Follow(u.ID) // only for who's in it
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	if err != nil {
		// Said in the stream, which is all a browser's EventSource can read: no such room (any more), or not one this
		// player is in.
		fmt.Fprint(w, "event: closed\ndata: {}\n\n")
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

// roomAct is something a player in a room does in it (act decides whether they may): starting a game, moving it on,
// ending it, choosing the next, holding the answers, locking the room.
func (s *Server) roomAct(act func(*room.Room, int64) error) func(http.ResponseWriter, *http.Request) error {
	return func(w http.ResponseWriter, r *http.Request) error {
		u, err := s.mustUser(r)
		if err != nil {
			return err
		}
		rm, err := s.roomFor(r, u)
		if err != nil {
			return err
		}
		if err := act(rm, u.ID); err != nil {
			return err
		}
		return ok(w, map[string]bool{"ok": true})
	}
}

// roomSettings is the host choosing what the room plays next, between games (room.Room.Change).
func (s *Server) roomSettings(w http.ResponseWriter, r *http.Request) error {
	var in room.Settings
	if err := readJSON(r, &in); err != nil {
		return err
	}
	return s.roomAct(func(rm *room.Room, by int64) error { return rm.Change(by, in) })(w, r)
}

// roomHold is who leads keeping each answer up until they move on, or letting the room move on by itself again.
func (s *Server) roomHold(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		On bool `json:"on"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	return s.roomAct(func(rm *room.Room, by int64) error { return rm.Hold(by, in.On) })(w, r)
}

// roomLock is the host locking the room to anyone new, or opening it again (room.Room.SetLocked).
func (s *Server) roomLock(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		On bool `json:"on"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	return s.roomAct(func(rm *room.Room, by int64) error { return rm.SetLocked(by, in.On) })(w, r)
}

// roomQR is the room's link as a QR code, for its host's big screen: drawn here, so that no outside service sees the
// code, once for the room, and only for who's in it.
func (s *Server) roomQR(w http.ResponseWriter, r *http.Request) {
	u, err := s.mustUser(r)
	var rm *room.Room
	if err == nil {
		rm, err = s.roomFor(r, u)
	}
	if err != nil {
		http.NotFound(w, r)
		return
	}
	svg, err := rm.QR(func(code string) (string, error) {
		c, err := qr.Encode(s.cfg.PublicURL + "/r/" + code)
		if err != nil {
			return "", err
		}
		return c.SVG(), nil
	})
	if err != nil {
		http.Error(w, "Нещо се обърка при нас. Опитай пак след малко.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, _ = io.WriteString(w, svg)
}

// roomRemove is the host sending a player out of the room, by their key.
func (s *Server) roomRemove(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Key int `json:"key"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	return s.roomAct(func(rm *room.Room, by int64) error { return rm.Remove(by, in.Key) })(w, r)
}

// roomPeople is what a room's end offers its player: whom of the others to add as friends (their keys: not friends
// yet, nor asked), and whether the day's ten still wait for them.
func (s *Server) roomPeople(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	rm, err := s.roomFor(r, u)
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
	rm, err := s.roomFor(r, u)
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
	if !s.allowFrom(r, "request", 30, 0, time.Hour) {
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
	rm, err := s.roomFor(r, u)
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
