package server

import (
	"net/http"
	"regexp"
	"strconv"
	"time"
)

// challengeCode is a challenge's code in its link (/c/<code>): an invite's letters (play.newInviteCode). The old
// challenges' six-letter codes are let through, to hear they're gone.
var challengeCode = regexp.MustCompile(`^[a-z0-9]{6,8}$`)

// challengeLink makes (or finds) the challenge for one of the player's finished games of ten: its link, to share.
func (s *Server) challengeLink(w http.ResponseWriter, r *http.Request) error {
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
	if !s.limits.allow("challenge:"+strconv.FormatInt(u.ID, 10), 60, time.Hour) {
		return errTooMany
	}
	code, err := s.game.Challenge(r.Context(), u.ID, in.Run)
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"code": code, "url": s.cfg.PublicURL + "/c/" + code})
}

// challengeView is a challenge as whoever opens its link sees it (anyone may look).
func (s *Server) challengeView(w http.ResponseWriter, r *http.Request) error {
	code := r.PathValue("code")
	if !challengeCode.MatchString(code) {
		return errNotFound
	}
	var viewer int64
	if u, err := s.user(r); err == nil && u != nil {
		viewer = u.ID
	}
	v, err := s.game.ChallengeOf(r.Context(), code, viewer)
	if err != nil {
		return err
	}
	return ok(w, v)
}

// takeChallenge is the player's game of a challenge: their duel against its game, made the first time (or, for the
// friend a friend's duel was sent to, that duel's id).
func (s *Server) takeChallenge(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	code := r.PathValue("code")
	if !challengeCode.MatchString(code) {
		return errNotFound
	}
	st, id, err := s.game.TakeChallenge(r.Context(), u.ID, code)
	if err != nil {
		return err
	}
	out := map[string]any{"duel": id}
	if st.ID != 0 {
		out["state"] = st
	}
	return ok(w, out)
}
