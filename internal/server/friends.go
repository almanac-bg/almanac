package server

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/room"
)

var inviteCode = regexp.MustCompile(`^[a-z0-9]{8}$`)

// friends is the player's side of being friends: their own invite link, their friends, and the duels friends ask
// them to now.
func (s *Server) friends(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	code, err := s.game.InviteCode(r.Context(), u.ID)
	if err != nil {
		return err
	}
	list, err := s.game.FriendsOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	if list == nil {
		list = []play.Friend{}
	}
	return ok(w, map[string]any{
		"invite":  s.cfg.PublicURL + "/f/" + code,
		"friends": list,
		"invites": s.rooms.InvitesFor(u.ID),
	})
}

// duelInvites lists the duels friends ask the player to now: light enough for a page to ask every half minute, to
// show there's one waiting (no database, only the rooms in memory).
func (s *Server) duelInvites(w http.ResponseWriter, r *http.Request) error {
	u, err := s.user(r)
	if err != nil {
		return err
	}
	if u == nil {
		return ok(w, map[string]any{"invites": []room.Invitation{}})
	}
	return ok(w, map[string]any{"invites": s.rooms.InvitesFor(u.ID)})
}

// inviteInfo says whose an invite link is, for the page that asks whether to accept it (anyone may ask), and
// whether the one asking is its owner or already a friend.
func (s *Server) inviteInfo(w http.ResponseWriter, r *http.Request) error {
	code := r.PathValue("code")
	if !inviteCode.MatchString(code) {
		return play.ErrNoInvite
	}
	id, name, err := s.game.Inviter(r.Context(), code)
	if err != nil {
		return err
	}
	out := map[string]any{"by": name, "own": false, "friends": false}
	if u, err := s.user(r); err == nil && u != nil {
		out["own"] = u.ID == id
		if _, err := s.game.Friend(r.Context(), u.ID, id); err == nil {
			out["friends"] = true
		}
	}
	return ok(w, out)
}

// acceptInvite makes the player and the owner of an invite link friends, and tells the owner.
func (s *Server) acceptInvite(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	code := r.PathValue("code")
	if !inviteCode.MatchString(code) {
		return play.ErrNoInvite
	}
	if !s.limits.allow("befriend:"+strconv.FormatInt(u.ID, 10), 30, time.Hour) {
		return errTooMany
	}
	id, name, err := s.game.Befriend(r.Context(), u.ID, code)
	if err != nil {
		return err
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		s.notify(ctx, push.Message{Title: u.Name + " прие поканата ти", Body: "Вече сте приятели в АЛМАНАХ.", URL: "/together"}, id)
	}()
	return ok(w, map[string]any{"id": id, "name": name})
}

func (s *Server) friendOf(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, play.ErrNotFriends
	}
	return id, nil
}

// unfriend ends a friendship.
func (s *Server) unfriend(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := s.friendOf(r)
	if err != nil {
		return err
	}
	if err := s.game.Unfriend(r.Context(), u.ID, id); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// duelFriend asks a friend to a duel now: a duel for the two of them opens, and the friend hears of it (a
// notification, and the invitation in their Заедно).
func (s *Server) duelFriend(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := s.friendOf(r)
	if err != nil {
		return err
	}
	name, err := s.game.Friend(r.Context(), u.ID, id)
	if err != nil {
		return err
	}
	if !s.limits.allow("invite:"+strconv.FormatInt(u.ID, 10), 30, time.Hour) {
		return errTooMany
	}
	rm, err := s.rooms.Invite(room.Player{ID: u.ID, Name: u.Name}, room.Player{ID: id, Name: name})
	if err != nil {
		return err
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		s.notify(ctx, push.Message{
			Title: u.Name + " те кани на дуел",
			Body:  "Десет въпроса, сега. Поканата важи 10 минути.",
			URL:   "/r/" + rm.Code(),
		}, id)
	}()
	return ok(w, map[string]string{"code": rm.Code()})
}

// roomDecline turns down a duel between friends (or calls it off).
func (s *Server) roomDecline(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	rm, err := s.roomOf(r)
	if err != nil {
		return err
	}
	if err := rm.Decline(u.ID); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}
