package server

import (
	"context"
	"errors"
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

// Pushes that other players cause (a friend request, a challenge, a duel's result) are what a stranger could turn
// into a flood: so none goes between two players one of whom has blocked the other, one of a kind from one player
// goes once a day at most (dedupe), and a player gets at most peoplePushes of them a day, whoever they're from.
const peoplePushes = 20

// notifyFrom queues a push to a player that another (from) caused, unless one of them has blocked the other or the
// caps above are spent. what names its kind for the once a day from one player ("" for news that comes once by
// itself, as a duel's result).
func (s *Server) notifyFrom(ctx context.Context, from int64, what string, m push.Message, to int64) {
	if s.push == nil && s.phones == nil {
		return
	}
	if blocked, err := s.game.Blocked(ctx, from, to); err != nil || blocked {
		return
	}
	who := strconv.FormatInt(to, 10)
	if what != "" && !s.limits.allow("told:"+who+":"+strconv.FormatInt(from, 10)+":"+what, 1, 24*time.Hour) {
		return
	}
	if !s.limits.allow("told:"+who, peoplePushes, 24*time.Hour) {
		return
	}
	s.notify(ctx, pushFriends, m, to)
}

// friends is the player's side of being friends: their own invite link, their friends, the friend requests to and
// from them, and whom they've blocked.
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
	blocked, err := s.game.BlockedOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{
		"invite":   s.cfg.PublicURL + "/f/" + code,
		"friends":  list,
		"requests": map[string]any{"in": in, "out": out},
		"blocked":  blocked,
	})
}

// newInvite gives the player a new invite link in place of the one they had, which stops working.
func (s *Server) newInvite(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if !s.limits.allow("invite:"+strconv.FormatInt(u.ID, 10), 10, time.Hour) {
		return errTooMany
	}
	code, err := s.game.NewInviteCode(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"invite": s.cfg.PublicURL + "/f/" + code})
}

// block blocks a player, by their tag: no longer friends, and nothing more between the two (play/blocks.go).
func (s *Server) block(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Tag string `json:"tag"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	tag, err := account.NormalTag(in.Tag)
	if err != nil {
		return play.ErrNoPlayer
	}
	name, err := s.game.Block(r.Context(), u.ID, tag)
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"name": name})
}

// unblock lifts the player's block of another, by their tag.
func (s *Server) unblock(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	tag, err := account.NormalTag(r.PathValue("tag"))
	if err != nil {
		return play.ErrNoPlayer
	}
	if err := s.game.Unblock(r.Context(), u.ID, tag); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
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
	if !s.allowFrom(r, "request", 30, 0, time.Hour) {
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
		return ok(w, map[string]any{"requests": 0, "challenges": []play.Asked{}})
	}
	n, err := s.game.RequestsWaiting(r.Context(), u.ID)
	if err != nil {
		return err
	}
	challenges, err := s.game.AskedOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"requests": n, "challenges": challenges})
}

// inviteInfo says whose an invite link is, for the page it opens (anyone may ask): whether the one asking is its owner,
// already a friend (then with the friend's id, to challenge them), or has asked its owner already (`asked`), and how
// each of the two did on the day's ten, if they've played them (`their`, `mine`). The same link ends a shared day's
// result: it brings the friend to the day.
func (s *Server) inviteInfo(w http.ResponseWriter, r *http.Request) error {
	code := r.PathValue("code")
	if !inviteCode.MatchString(code) {
		return play.ErrNoInvite
	}
	id, name, err := s.game.Inviter(r.Context(), code)
	if err != nil {
		return err
	}
	u, err := s.user(r)
	if err != nil {
		return err
	}
	out := map[string]any{"by": name, "own": false, "friends": false}
	var viewer int64
	if u != nil {
		viewer = u.ID
		out["own"] = u.ID == id
		if _, err := s.game.Friend(r.Context(), u.ID, id); err == nil {
			out["friends"], out["id"] = true, id
		} else if asked, err := s.game.Asked(r.Context(), u.ID, id); err != nil {
			return err
		} else if asked {
			out["asked"] = true
		}
	}
	day := s.game.Today()
	if n, played, err := s.game.DayRights(r.Context(), id, day, viewer); err != nil {
		return err
	} else if played {
		out["their"] = n
	}
	if u != nil {
		if n, played, err := s.game.DayRights(r.Context(), u.ID, day, u.ID); err != nil {
			return err
		} else if played {
			out["mine"] = n
		}
	}
	return ok(w, out)
}

// askInvite is the player asking the owner of an invite link to be friends: a request the owner accepts, told to them
// by a push the first time (notifyFrom); or friends at once, if the owner had asked first.
func (s *Server) askInvite(w http.ResponseWriter, r *http.Request) error {
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
	id, name, sent, err := s.game.AskByInvite(r.Context(), u.ID, code)
	if err != nil {
		return err
	}
	if sent.Friends {
		return ok(w, map[string]any{"id": id, "name": name, "friends": true})
	}
	if sent.New {
		s.notifyFrom(context.WithoutCancel(r.Context()), u.ID, "request",
			push.Message{Title: u.Name + " иска да сте приятели", Body: "Дойде по връзката ти за покана. Приеми или откажи в Приятели.",
				URL: "/friends"}, id)
	}
	return ok(w, map[string]any{"name": name, "asked": true})
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

// told keeps a line Начало has told the player once (play.Told): a friend's yes, what came of a duel they left.
func (s *Server) told(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Line string `json:"line"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if err := s.game.Told(r.Context(), u.ID, in.Line); err != nil {
		if errors.Is(err, play.ErrNoLine) {
			return errBadRequest
		}
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}
