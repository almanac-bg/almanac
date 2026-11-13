package server

import "net/http"

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
