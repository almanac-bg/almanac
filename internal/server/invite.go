package server

import (
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// A player's invite link (play/invite.go): asked for from Приятели (POST /api/invite: made the first time, the same
// after; POST /api/invite/new, a new one in its place), and the page it opens (/f/<code>: the app, with whose it is in
// its boot, which Днес shows over the day's issue: pages.go), from which one tap (POST /api/invites/{code}) makes the
// two friends. A guest who hasn't finished a game is told to play first (errPlayFirst), as for a request: the client
// keeps the tap and takes the link after their first game.
//
// What it costs if one /48 calls it all day: a link is looked up (its page, GET /api/invites/{code}, or a tap) at most
// invitesNet an hour from a network and invitesSite from its site, in the guard's limiter: the guests' scale, so that a
// class, an office or a carrier's shared address all opening one link posted in their group are let in. That is 43,200
// guesses a day from a site, 16 million a year: against 2^50 codes, with a million links made, a year of it finds one
// at odds of about 1 in 70, and what it finds (a name, an avatar, a seal) is on its player's profile anyway; a tap on
// it makes the guesser one friend, whom the player can remove. A tap befriends at most befriendsNet an hour from a
// network (befriendsSite its site), each from a player who has finished a game (asked before the budget is spent, so a
// guest told to play first loses none of it), into lists of MaxFriends, InviteADay a day from one link; each is a row of
// friends and one write to the link's count. Making links is per player (invitesNew a day for a new one) and per
// network. Past the budget, a link's page says so (errInviteBusy), not that the link is gone.

const (
	invitesNet    = 360
	invitesSite   = 5 * invitesNet
	befriendsNet  = 120
	befriendsSite = 5 * befriendsNet
	invitesMade   = 120
	invitesNew    = 10
)

// invitePath is an invite link's path.
var invitePath = regexp.MustCompile(`^/f/([a-z2-9]{10})$`)

// errInviteBusy is a network past its budget of links looked up.
var errInviteBusy = &apiError{http.StatusTooManyRequests, "too_many", "Твърде много покани оттук. Опитай пак след малко."}

// inviteURL is a link's address.
func (s *Server) inviteURL(code string) string { return s.cfg.PublicURL + "/f/" + code }

// inviteLink gives the player their link, made the first time (fresh: a new one in place of the old). Only a player who
// has finished a game has one: before that, nobody is there to be friends with.
func (s *Server) inviteLink(fresh bool) func(http.ResponseWriter, *http.Request) error {
	return func(w http.ResponseWriter, r *http.Request) error {
		u, err := s.mustUser(r)
		if err != nil {
			return err
		}
		if !s.allowFrom(r, "invite", invitesMade, invitesMade*5, time.Hour) ||
			fresh && !s.limits.allow("invite-new:"+strconv.FormatInt(u.ID, 10), invitesNew, 24*time.Hour) {
			return errTooMany
		}
		played, err := s.game.Played(r.Context(), u.ID)
		if err != nil {
			return err
		}
		if !played {
			return errPlayFirst
		}
		link := s.game.InviteOf
		if fresh {
			link = s.game.NewInvite
		}
		code, err := link(r.Context(), u.ID)
		if err != nil {
			return err
		}
		return ok(w, map[string]string{"url": s.inviteURL(code)})
	}
}

// invited looks up a link for whoever opens it (0: nobody signed in), within the network's budget (errInviteBusy).
func (s *Server) invited(r *http.Request, code string, viewer int64) (play.Invite, error) {
	if !s.guardFrom(r, "invites", invitesNet, invitesSite, time.Hour) {
		return play.Invite{}, errInviteBusy
	}
	return s.game.Invited(r.Context(), code, viewer)
}

// inviteOf is the page's link (/f/<code>), as its opener sees it: ok false for a path that isn't one; err the lookup's
// (play.ErrNoInvite: a link that isn't, or is no more; errInviteBusy: the network past its budget).
func (s *Server) inviteOf(r *http.Request, viewer int64) (in play.Invite, ok bool, err error) {
	m := invitePath.FindStringSubmatch(r.URL.Path)
	if m == nil {
		return play.Invite{}, false, nil
	}
	in, err = s.invited(r, m[1], viewer)
	return in, true, err
}

// inviteOne is a link as its opener sees it (GET /api/invites/{code}): for a page that came to it without one in its
// boot.
func (s *Server) inviteOne(w http.ResponseWriter, r *http.Request) error {
	u, err := s.user(r)
	if err != nil {
		return err
	}
	var viewer int64
	if u != nil {
		viewer = u.ID
	}
	in, err := s.invited(r, r.PathValue("code"), viewer)
	if err != nil {
		return err
	}
	return ok(w, in)
}

// takeInvite makes the player friends with whose link it is, at once (POST /api/invites/{code}). A guest takes one
// once they've finished a game (errPlayFirst), as for a request: one made for the asking, then another, would let a
// stranger fill someone's list from throwaway names.
func (s *Server) takeInvite(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if u.Email == "" {
		played, err := s.game.Played(r.Context(), u.ID)
		if err != nil {
			return err
		}
		if !played {
			return errPlayFirst
		}
	}
	if !s.allowFrom(r, "befriend", befriendsNet, befriendsSite, time.Hour) ||
		!s.guardFrom(r, "invites", invitesNet, invitesSite, time.Hour) {
		return errTooMany
	}
	t, err := s.game.TakeInvite(r.Context(), r.PathValue("code"), u.ID)
	if err != nil {
		return err
	}
	return ok(w, t)
}
