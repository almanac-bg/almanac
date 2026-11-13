package server

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
)

var inviteCode = regexp.MustCompile(`^[a-z0-9]{8}$`)

// friends is the player's side of being friends: their own invite link, their friends, and the friend requests to
// and from them.
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
	in, out, err := s.game.Requests(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{
		"invite":   s.cfg.PublicURL + "/f/" + code,
		"friends":  list,
		"requests": map[string]any{"in": in, "out": out},
	})
}

// requestFriend asks someone to be friends: by their tag (@tag) or an email address.
func (s *Server) requestFriend(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		To string `json:"to"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	// Tags are public, but a stream of guesses isn't asking a friend.
	if !s.limits.allow("request:"+s.clientIP(r), 30, time.Hour) {
		return errTooMany
	}
	to, byEmail := strings.TrimSpace(in.To), strings.Contains(in.To, "@") && !strings.HasPrefix(strings.TrimSpace(in.To), "@")
	if byEmail {
		to, err = account.NormalEmail(to)
	} else {
		to, err = account.NormalTag(to)
	}
	if err != nil {
		return err
	}
	sent, err := s.game.Request(r.Context(), u.ID, to, byEmail)
	if err != nil {
		return err
	}
	return ok(w, sent)
}

// answerRequest takes a friend request: accept it (the one asked), or drop it (either of the two).
func (s *Server) answerRequest(accept bool) func(http.ResponseWriter, *http.Request) error {
	return func(w http.ResponseWriter, r *http.Request) error {
		u, err := s.mustUser(r)
		if err != nil {
			return err
		}
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			return play.ErrNoRequest
		}
		if !accept {
			if err := s.game.Withdraw(r.Context(), u.ID, id); err != nil {
				return err
			}
			return ok(w, map[string]bool{"ok": true})
		}
		name, err := s.game.Accept(r.Context(), u.ID, id)
		if err != nil {
			return err
		}
		return ok(w, map[string]any{"name": name})
	}
}

// duelInvites says how many friend requests wait for the player, and which friends' challenges: light enough for a
// page to ask every half minute, to show there's something waiting.
func (s *Server) duelInvites(w http.ResponseWriter, r *http.Request) error {
	u, err := s.user(r)
	if err != nil {
		return err
	}
	if u == nil {
		return ok(w, map[string]any{"requests": 0, "challenges": []play.Challenge{}})
	}
	n, err := s.game.RequestsWaiting(r.Context(), u.ID)
	if err != nil {
		return err
	}
	challenges, err := s.game.Challenges(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"requests": n, "challenges": challenges})
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
		s.notify(ctx, push.Message{Title: u.Name + " прие поканата ти", Body: "Вече сте приятели в АЛМАНАХ.", URL: "/friends"}, id)
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
