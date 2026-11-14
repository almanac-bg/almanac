package server

import (
	"net/http"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/play"
)

// progress is the player's level, achievements, and what they may look like.
func (s *Server) progress(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	p, err := s.game.ProgressOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, p)
}

// news tells the player, once, what they've earned since they last looked: achievements, and a level gone up; and,
// for the game they just played (run), how it moved their mastery of its topics.
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

// setLook changes the player's avatar or title (either may be left out; an empty title takes it off).
func (s *Server) setLook(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Avatar   *string `json:"avatar"`
		Title    *string `json:"title"`
		Frame    *string `json:"frame"`
		Backdrop *string `json:"backdrop"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if err := s.game.SetLook(r.Context(), u.ID, in.Avatar, in.Title, in.Frame, in.Backdrop); err != nil {
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
	p, err := s.game.ProfileOf(r.Context(), tag, viewer)
	if err != nil {
		return err
	}
	return ok(w, p)
}
