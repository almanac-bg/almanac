package server

import (
	"net/http"
	"strconv"
	"time"
)

// The Handoff's three calls (account/handoff.go): the page in an app's own browser asks for a link's token (handoff)
// and writes it into its own address's fragment while it offers the way out, so that the app's „Open in browser“
// carries it; the page in the phone's browser finds it there (web/src/screens/keep.ts), asks whose game it brings
// (lookHandoff) and takes it with a tap that names it (takeHandoff). The server never makes the address: the page
// writes its own (the game's own origin), and nothing here sends a browser anywhere. The links made are limited by
// the player; the look and the take by address, never with more for a site.

// handoff gives the page that offers the way out a new link's token.
func (s *Server) handoff(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if !s.limits.allow("handoff:"+strconv.FormatInt(u.ID, 10), 20, time.Hour) {
		return errTooMany
	}
	token, err := s.accounts.Handoff(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"token": token})
}

// lookHandoff says whose game a handoff's token brings to this browser (account.LookHandoff), or why it can't come
// here; it takes nothing.
func (s *Server) lookHandoff(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.allowFrom(r, "handlook", 60, 300, time.Hour) {
		return errTooMany
	}
	h, err := s.accounts.LookHandoff(r.Context(), in.Token, s.session(r))
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"game": h})
}

// takeHandoff brings the game of a handoff's token to this browser, in place of a guest with nothing yet
// (account.TakeHandoff); the browser it came from stays signed in.
func (s *Server) takeHandoff(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	// From a phone's browser: behind a carrier's address, many phones (codesNet).
	if !s.guardFrom(r, "hand", codesNet, codesSite, time.Hour) {
		return errTooMany
	}
	u, token, err := s.accounts.TakeHandoff(r.Context(), in.Token, s.session(r))
	if err != nil {
		return err
	}
	if token != "" {
		s.setSession(w, token)
	}
	return s.signedIn(w, r, u, 0)
}

// The day's questions played in this browser: a cookie holds the day this browser last started them, whoever it was
// signed in as, and stays through a sign-out and a handoff (it's no session's). A game brought into a browser that
// played the day already (by a handoff, or a sign-in after a sign-out) has the day's answers in sight there, so its
// play of the issue that day is its second (playedHere): the game writes grey for it, not ink (DECISIONS.md, the
// direction: ink is the first meeting in the issue).

// playedKept is how long the cookie lasts: the day, and its grace past midnight.
const playedKept = 48 * time.Hour

// markPlayed keeps in this browser that it started the day's questions of day (YYYY-MM-DD).
func (s *Server) markPlayed(w http.ResponseWriter, day string) {
	if day == "" {
		return
	}
	http.SetCookie(w, &http.Cookie{Name: s.playedCookie, Value: day, Path: "/", MaxAge: int(playedKept / time.Second),
		HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode})
}

// playedHere says whether this browser started the day's questions of day before (markPlayed): a run of them begun
// now, for a player who hadn't one, is a second play of the issue here.
func (s *Server) playedHere(r *http.Request, day string) bool {
	c, err := r.Cookie(s.playedCookie)
	return err == nil && day != "" && c.Value == day
}
