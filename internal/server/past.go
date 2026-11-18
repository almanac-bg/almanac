package server

import (
	"net/http"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// Минали броеве (play/past.go): the past issues open to play, one of them with the player's game of it and, once that's
// finished, how it went against the issue's players; and a game of one started, or gone on with. An issue is named by
// its number, as its page is (/issues/6).

// viewer is the player a request is from, 0 for a visitor (one before their first game: the list is for them too).
func (s *Server) viewer(r *http.Request) (int64, error) {
	u, err := s.user(r)
	if err != nil || u == nil {
		return 0, err
	}
	return u.ID, nil
}

// issues lists the past issues open to play, the newest first, each with the player's game of it.
func (s *Server) issues(w http.ResponseWriter, r *http.Request) error {
	viewer, err := s.viewer(r)
	if err != nil {
		return err
	}
	list, err := s.game.PastIssues(r.Context(), viewer)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"issues": list})
}

// issueDay is the day of the issue a request names (errNotFound for a number that isn't one).
func issueDay(r *http.Request) (string, error) {
	n, err := strconv.Atoi(r.PathValue("n"))
	day := play.IssueDay(n)
	if err != nil || day == "" {
		return "", errNotFound
	}
	return day, nil
}

// issue is one past issue: how many played it on its day, the player's game of it, and, that game finished, how it
// went against them (play.PastStanding).
func (s *Server) issue(w http.ResponseWriter, r *http.Request) error {
	viewer, err := s.viewer(r)
	if err != nil {
		return err
	}
	day, err := issueDay(r)
	if err != nil {
		return err
	}
	p, err := s.game.PastIssueOf(r.Context(), viewer, day)
	if err != nil {
		return err
	}
	out := map[string]any{"issue": p}
	if m := p.Mine; m != nil && m.Kind == "past" && m.Done {
		if out["standing"], err = s.game.PastStandingOf(r.Context(), viewer, m.ID); err != nil {
			return err
		}
	}
	return ok(w, out)
}

// startIssue starts the player's game of a past issue, or goes on with the one they have.
func (s *Server) startIssue(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	day, err := issueDay(r)
	if err != nil {
		return err
	}
	if !s.limits.allow("topic:"+strconv.FormatInt(u.ID, 10), 120, time.Hour) {
		return errTooMany
	}
	st, err := s.game.StartPast(s.fromClient(r, u.ID), u.ID, day)
	if err != nil {
		return err
	}
	return ok(w, st)
}
