package server

import (
	"errors"
	"net/http"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/play"
)

// news tells the player, once, what's new since they last looked (play.NewsOf): the milestones noted in their book;
// and, for the game they just played (run), the facts it put in their Алманах (mastery is never shown).
func (s *Server) news(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Run int64 `json:"run"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	n, err := s.game.NewsOf(r.Context(), u.ID, in.Run)
	if err != nil {
		return err
	}
	return ok(w, n)
}

// streakTold keeps a streak notice Днес has told as told (play.TellStreak), so that it isn't told again on another
// device.
func (s *Server) streakTold(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Key string `json:"key"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	fresh, err := s.game.TellStreak(r.Context(), u.ID, in.Key)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"fresh": fresh})
}

// setLook changes the player's avatar (play.SetAvatar).
func (s *Server) setLook(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Avatar string `json:"avatar"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if err := s.game.SetAvatar(r.Context(), u.ID, in.Avatar); err != nil {
		return err
	}
	look, err := s.game.LookOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, look)
}

// profile is a player as anyone sees them, by their tag: and, to a signed-in viewer, how the two stand.
func (s *Server) profile(w http.ResponseWriter, r *http.Request) error {
	tag, err := account.NormalTag(r.PathValue("tag"))
	if err != nil {
		return play.ErrNoPlayer
	}
	viewer := int64(0)
	if u, err := s.user(r); err != nil {
		return err
	} else if u != nil {
		viewer = u.ID
	}
	p, err := s.profileOf(r, tag, viewer)
	if err != nil {
		return err
	}
	return ok(w, p)
}

// A profile is anyone's to see, signed in or not (play.ProfileOf says what it shows, and the privacy page): what keeps
// it from being read over and over, or the tags from being walked, is how many a network and its site may look at in
// an hour, and fewer that miss (a tag nobody has), counted apart where no flood can push them out (Server.guard);
// past those, no tag is looked up (review 2026-11-18, S12). A class on one network looking at each other's profiles
// is well within them.
const (
	profilesNet       = 300
	profilesSite      = 1500
	profileMissesNet  = 30
	profileMissesSite = 150
)

// profileOf is play.ProfileOf for a request, under the limits on profiles: errTooMany past them.
func (s *Server) profileOf(r *http.Request, tag string, viewer int64) (play.Profile, error) {
	misses := map[string]int{
		"profilemiss:" + s.clientNet(r):       profileMissesNet,
		"profilemiss:site:" + s.clientSite(r): profileMissesSite,
	}
	for key, n := range misses {
		if s.guard.spent(key, n) {
			return play.Profile{}, errTooMany
		}
	}
	if !s.allowFrom(r, "profile", profilesNet, profilesSite, time.Hour) {
		return play.Profile{}, errTooMany
	}
	p, err := s.game.ProfileOf(r.Context(), tag, viewer)
	if errors.Is(err, play.ErrNoPlayer) {
		for key, n := range misses {
			s.guard.allow(key, n, time.Hour)
		}
	}
	return p, err
}
