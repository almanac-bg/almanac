package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
)

// Pushes that other players cause (a friend request, a duel sent or played back) are what a stranger could turn into a flood: so one from one
// player goes once a day at most (asking again after a no included), and a player gets at most peoplePushes of them a
// day, whoever they're from.
const peoplePushes = 20

// notifyFrom queues a push to a player that another (from) caused, unless the caps above are spent.
func (s *Server) notifyFrom(ctx context.Context, from int64, m push.Message, to int64) {
	if s.push == nil {
		return
	}
	who := strconv.FormatInt(to, 10)
	if !s.limits.allow("told:"+who+":"+strconv.FormatInt(from, 10), 1, 24*time.Hour) {
		return
	}
	if !s.limits.allow("told:"+who, peoplePushes, 24*time.Hour) {
		return
	}
	s.notify(ctx, pushFriends, m, to)
}

// friends is the player's side of being friends: their friends, the friend requests to and from them, a yes to one
// of theirs not told yet.
func (s *Server) friends(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
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
	// A friend said yes to their request: told once, here (POST /api/told).
	accepted, err := s.game.AcceptedOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{
		"friends":  list,
		"requests": map[string]any{"in": in, "out": out},
		"accepted": accepted,
	})
}

// errPlayFirst is a friend request from a guest who has yet to finish a game.
var errPlayFirst = &apiError{http.StatusForbidden, "play_first", "Първо изиграй една игра, после добавяй приятели."}

// errNoLink is a request by a shared link (askSharer) that isn't one, or not of a day the player has finished while
// it's today's.
var errNoLink = &apiError{http.StatusNotFound, "no_link", "Тази връзка вече не води до днешния брой."}

// errLinkAsked is a request by a shared link that has brought its owner play.SharerAsks requests already.
var errLinkAsked = &apiError{http.StatusConflict, "link_asked",
	"По тази връзка вече поискаха приятелство твърде много хора. Поискай потребителското име на човека, който ти я прати."}

// linkOf is a shared day's link as the page sends it, its issue and code („13-k4f2m7qa“: share.go, sharePath).
var linkOf = regexp.MustCompile(`^([0-9]{1,5})-([a-z2-9]{8})$`)

// requestFriend asks someone to be friends: by their tag (@tag) or an email address, or (link) whoever shared the day
// the player played by its link (play.AskSharer). A guest asks once they've finished a game (errPlayFirst).
func (s *Server) requestFriend(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		To   string `json:"to"`
		Link string `json:"link"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	// Tags are public, but a stream of guesses isn't asking a friend.
	if !s.allowFrom(r, "request", 30, 0, time.Hour) {
		return errTooMany
	}
	// A guest who hasn't finished a game is nobody yet: one made for the asking, then another, would let a stranger
	// send anyone requests from throwaway names.
	if u.Email == "" {
		played, err := s.game.Played(r.Context(), u.ID)
		if err != nil {
			return err
		}
		if !played {
			return errPlayFirst
		}
	}
	if in.Link != "" {
		return s.askSharer(w, r, u, in.Link)
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
	s.toldOfRequest(r.Context(), u, sent)
	return ok(w, sent)
}

// askSharer asks whoever shared the day by the link the player played it by (play.AskSharer), within the limits of
// any request (requestFriend's) and the link's own (play.SharerAsks). Its answer is the same whoever it went to, and
// whether a request was made or one stood already: it names nobody (DECISIONS.md, Sharing: unsigned).
func (s *Server) askSharer(w http.ResponseWriter, r *http.Request, u *account.User, link string) error {
	m := linkOf.FindStringSubmatch(link)
	if m == nil {
		return errNoLink
	}
	issue, _ := strconv.Atoi(m[1])
	sent, err := s.game.AskSharer(r.Context(), u.ID, issue, m[2])
	switch {
	case errors.Is(err, play.ErrNoRun):
		return errNoLink
	case errors.Is(err, play.ErrSharerAsked):
		return errLinkAsked
	case err != nil:
		return err
	}
	if sent.New {
		s.notifyFrom(context.WithoutCancel(r.Context()), u.ID, push.Message{Title: u.Name + " иска да сте приятели",
			Body: fmt.Sprintf("По връзката ти от Брой %d. Приеми или откажи в Приятели.", issue), URL: "/friends"}, sent.To)
	}
	return ok(w, map[string]bool{"ok": true})
}

// toldOfRequest tells a player that another has asked them to be friends: by a push the first time (notifyFrom), not
// again however often they ask.
func (s *Server) toldOfRequest(ctx context.Context, from *account.User, sent play.Sent) {
	if !sent.New {
		return
	}
	s.notifyFrom(context.WithoutCancel(ctx), from.ID,
		push.Message{Title: from.Name + " иска да сте приятели", Body: "Приеми или откажи в Приятели.", URL: "/friends"}, sent.To)
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

// friendsNews says whether something has come to Приятели since the player last looked there, on any device
// (play.FriendsNews): the dot on Приятели. Light enough for a page to ask every half minute.
func (s *Server) friendsNews(w http.ResponseWriter, r *http.Request) error {
	u, err := s.user(r)
	if err != nil {
		return err
	}
	if u == nil {
		return ok(w, map[string]bool{"news": false})
	}
	news, err := s.game.FriendsNews(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]bool{"news": news})
}

// sawFriends keeps that the player has opened Приятели (play.SawFriends): its dot goes, on every device. A POST of its
// own, not a side of GET /api/friends: that one is a read, asked again every quarter minute while the page is open,
// and a read writes nothing.
func (s *Server) sawFriends(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if err := s.game.SawFriends(r.Context(), u.ID); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
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

// told keeps a line Днес has told the player once (play.Told): a friend's yes, what came of a duel they left.
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
