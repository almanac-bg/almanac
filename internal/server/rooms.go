package server

// Rooms over HTTP (internal/room). Who may do what in a room is one rule: a player joins it by its code (roomJoin),
// and from then on everything of the room (its stream, the game, its people, its QR code) is theirs, and its host's;
// to anyone else the room isn't there (404, as for a code nobody has), so that nothing tells them it's open. A code
// is six digits, easy to say to a class; what keeps codes from being walked is that a code given that isn't open, or
// is a locked room's, counts against the player, their network and their site (roomByCode: an IPv6 /48 or an IPv4
// /24, so that the 65,536 /64s of one /48 don't each get a budget: review 2026-11-18, S3), and past a few an hour, no
// code is looked up for them at all. The misses of everyone together are only counted: past roomMissesAll an hour
// whoever runs the game hears of it, as many networks walking the codes at once would look; refusing everyone then
// would let the walkers close every room to the players. And a code alone takes nobody new into a game under way:
// that takes the room's link, whose key (room.Room.Key) no one can guess; a code that finds a game under way counts as
// a miss too, so that walking the codes finds no game to come into.

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/qr"
	"github.com/almanac-bg/almanac/internal/room"
)

var roomCode = regexp.MustCompile(`^[0-9]{6}$`)

// errLocked is someone new at a room its host has locked; errStarted, at a game under way, with the code alone.
var (
	errLocked  = &apiError{http.StatusForbidden, "locked", "Стаята е заключена: нови играчи не могат да влязат."}
	errStarted = &apiError{http.StatusForbidden, "started",
		"Играта вече започна. Нови играчи влизат с връзката към стаята или след края на играта."}
)

// roomLink is the room's link: its code, and its key after # (a browser never sends it, so that no log keeps it).
func (s *Server) roomLink(rm *room.Room) string {
	return s.cfg.PublicURL + "/r/" + rm.Code() + "#" + rm.Key()
}

// refused is why a room doesn't take someone (room.Room.Admits, Join), as a player is told it: a refusal of someone
// new (a locked room, a game under way) counts as a code that missed (roomByCode).
func (s *Server) refused(r *http.Request, userID int64, err error) error {
	switch {
	case errors.Is(err, room.ErrLocked):
		s.missed(r, userID)
		return errLocked
	case errors.Is(err, room.ErrStarted):
		s.missed(r, userID)
		return errStarted
	}
	return err
}

// How many codes given in an hour may miss (no room open under them, or a locked one), for a player, for a network (a
// school's, many players behind it) and for a site (a few such networks), before none is looked up: typos are a few,
// walking the codes is thousands. A site walks at most roomMissesSite codes an hour: with ten rooms open, a day of it
// (7,200 of the 900,000 codes) comes on one about once in twelve days. roomMissesAll is when the misses of everyone
// are heard of.
const (
	roomMissesPlayer  = 20
	roomMissesAddress = 100
	roomMissesSite    = 300
	roomMissesAll     = 2000
)

func (s *Server) roomOf(r *http.Request) (*room.Room, error) {
	code := r.PathValue("code")
	if !roomCode.MatchString(code) {
		return nil, room.ErrNoRoom
	}
	return s.rooms.Get(code)
}

// roomMisses are the limits on codes that miss for a request: its site's, its network's, and its player's (0: none).
func (s *Server) roomMisses(r *http.Request, userID int64) map[string]int {
	keys := map[string]int{
		"roommiss:site:" + s.clientSite(r): roomMissesSite,
		"roommiss:" + s.clientNet(r):       roomMissesAddress,
	}
	if userID != 0 {
		keys["roommiss:user:"+strconv.FormatInt(userID, 10)] = roomMissesPlayer
	}
	return keys
}

// missed counts a code that missed, and tells whoever runs the game once the misses of everyone are many.
func (s *Server) missed(r *http.Request, userID int64) {
	for key, n := range s.roomMisses(r, userID) {
		s.guard.allow(key, n, time.Hour)
	}
	if !s.guard.allow("roommiss:all", roomMissesAll, time.Hour) {
		s.problems.add(fmt.Sprintf("rooms: over %d room codes missed in an hour; someone walking the codes?", roomMissesAll))
	}
}

// roomByCode finds a room by the code someone gave, to come into it (or to see that it's open), under the limit on
// codes that miss: once it's spent, no code is looked up, so that the answer then tells nothing.
func (s *Server) roomByCode(r *http.Request, userID int64) (*room.Room, error) {
	for key, n := range s.roomMisses(r, userID) {
		if s.guard.spent(key, n) {
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
	return ok(w, map[string]string{"code": rm.Code(), "url": s.roomLink(rm)})
}

// roomOpen says whether a room under a code would take whoever asks (before a name is asked or a player made for it,
// so maybe nobody signed in yet), with the room's key if they have its link (?key=): a wrong code is told at once, and
// so are a locked room and a game under way. A code that misses counts against the address (roomByCode).
func (s *Server) roomOpen(w http.ResponseWriter, r *http.Request) error {
	var id int64
	if u, err := s.user(r); err != nil {
		return err
	} else if u != nil {
		id = u.ID
	}
	rm, err := s.roomByCode(r, id)
	if err != nil {
		return err
	}
	if err := rm.Admits(id, r.URL.Query().Get("key")); err != nil {
		return s.refused(r, id, err)
	}
	return ok(w, map[string]bool{"open": true})
}

// roomJoin is a player coming into a room by its code (and its key, from its link: {"key"}): once, and again on each
// return (their look as it is now). Unless the host has locked it to anyone new, or a game is under way and they have
// the code alone: either counts as a code that missed, for a stranger.
//
// A player may come in under a name for this room alone (`name`: asked as they come in, the name the others there
// know them by): it's the room's, kept in it and shown only to who's in it, never the player's
// name anywhere else (not their profile, nor the boards, nor a request from the room's end). Without one, they're in
// it by the name they had in it before, or their own.
func (s *Server) roomJoin(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Name string `json:"name"`
		Key  string `json:"key"`
	}
	if r.ContentLength != 0 {
		if err := readJSON(r, &in); err != nil {
			return err
		}
	}
	name := strings.Join(strings.Fields(in.Name), " ")
	if name != "" && name != u.Name { // the player's own name is theirs already, checked or drawn
		if name, err = account.NormalName(in.Name); err == nil && account.Reserved(name) && !u.Admin {
			err = account.ErrNameReserved
		}
		if err != nil {
			return err
		}
	}
	rm, err := s.roomByCode(r, u.ID)
	if err != nil {
		return err
	}
	p := s.roomPlayer(r.Context(), u.ID, u.Name)
	p.Name, p.RoomName = cmp.Or(name, u.Name), name != ""
	if err := rm.Join(p, in.Key); err != nil {
		return s.refused(r, u.ID, err)
	}
	return ok(w, map[string]bool{"ok": true})
}

// How many games may be started in an hour, by one player (who leads a room) and from a network and a site (a school,
// many rooms in it): a game a minute, for anyone playing; so that starting and ending games at once, over and over,
// earns no more than playing them (review 2026-11-18, S19).
const (
	roomStartsPlayer = 60
	roomStartsNet    = 300
	roomStartsSite   = 1000
)

// roomStart is who leads a room starting a game in it (room.Room.Start), within the starts an hour.
func (s *Server) roomStart(w http.ResponseWriter, r *http.Request) error {
	return s.roomAct(func(rm *room.Room, by int64) error {
		if !s.limits.allow("roomstart:user:"+strconv.FormatInt(by, 10), roomStartsPlayer, time.Hour) ||
			!s.allowFrom(r, "roomstart", roomStartsNet, roomStartsSite, time.Hour) {
			return errTooMany
		}
		return rm.Start(by)
	})(w, r)
}

// How many times a minute a room's stream may be opened: by a player (a screen or two, reconnecting when the line
// drops), from a network (a class, all reconnecting at once after a deploy), and from a site. Each open and close is
// told to every screen of the room, so a player opening thousands would hold up the room's game (review 2026-11-18,
// S6).
const (
	roomStreamsPlayer = 20
	roomStreamsNet    = 300
	roomStreamsSite   = 5 * roomStreamsNet
)

// roomEvents streams a room to the screen of a player in it (roomJoin first), or of its host (Server-Sent Events):
// the room as they see it, again after every change. The browser reconnects by itself if the line drops; past the
// streams a minute (roomStreamsPlayer), or the screens a room holds (room.ErrBusy), it's told to wait a while before
// it does. A screen closed for one more of the player's is told so (moved), and doesn't reconnect.
func (s *Server) roomEvents(w http.ResponseWriter, r *http.Request) {
	u, err := s.mustUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "signed_out"})
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	// The browser tries again by itself, after this long: its screen says it's reconnecting meanwhile.
	later := func() { fmt.Fprintf(w, "retry: %d\n\n", 15_000+rand.N(15_000)) }
	if !s.limits.allow("roomstream:user:"+strconv.FormatInt(u.ID, 10), roomStreamsPlayer, time.Minute) ||
		!s.allowFrom(r, "roomstream", roomStreamsNet, roomStreamsSite, time.Minute) {
		later()
		return
	}
	rm, err := s.roomOf(r)
	var sub *room.Sub
	if err == nil {
		sub, err = rm.Follow(u.ID) // only for who's in it
	}
	if errors.Is(err, room.ErrBusy) {
		later()
		return
	}
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
			switch {
			case sub.Removed():
				send("event: removed\ndata: {}\n\n")
			case sub.Moved():
				send("event: moved\ndata: {}\n\n")
			default:
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

// roomQR is the room's link (with its key: roomLink) as a QR code, for its host's big screen: drawn here, so that no
// outside service sees the code, once for the room, and only for who's in it.
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
	svg, err := rm.QR(func(string) (string, error) {
		c, err := qr.Encode(s.roomLink(rm))
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

// roomReturn is the host bringing back a player they sent out, by the key they had (room.Room.Return).
func (s *Server) roomReturn(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Key int `json:"key"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	return s.roomAct(func(rm *room.Room, by int64) error { return rm.Return(by, in.Key) })(w, r)
}

// roomRename is the host asking a player (by their key) for another name (room.Room.AskName): theirs in the room is
// their animal's meanwhile, as a new player's is drawn.
func (s *Server) roomRename(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Key int `json:"key"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	return s.roomAct(func(rm *room.Room, by int64) error {
		return rm.AskName(by, in.Key, account.AnimalOf(rm.Players()[in.Key]).Name)
	})(w, r)
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
			OR EXISTS (SELECT 1 FROM friend_requests WHERE from_id = ?1 AND to_id = ?2)
			OR EXISTS (SELECT 1 FROM blocks WHERE (user_id = ?1 AND blocked_id = ?2) OR (user_id = ?2 AND blocked_id = ?1))`,
			u.ID, id).Scan(&known); err != nil {
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
