package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
)

// The Handoff's three calls (account/handoff.go): the page in an app's own browser asks for a link's token (handoff)
// and writes it into its own address's fragment while it offers the way out, so that the app's „Open in browser“
// carries it; the page in the phone's browser finds it there (web/src/screens/keep.ts), asks what it brings
// (lookHandoff) and takes it (takeHandoff), with the number the app's page shows where it isn't plainly the same
// phone. The server never makes the address: the page writes its own (the game's own origin), and nothing here sends
// a browser anywhere. The limits are the player's (links made) and the link's (wrong numbers: account.HandoffMisses);
// the look and the take are counted by address as they always were, never with more for a site.

// handoff gives the page that offers the way out the link it holds (token, from its address), while it works for
// account.HandoffRotate more, or a new one: its token and the number another browser is asked for. Only a new one
// counts against the player's links an hour.
func (s *Server) handoff(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Token string `json:"token"`
	}
	if r.ContentLength != 0 {
		if err := readJSON(r, &in); err != nil {
			return err
		}
	}
	offer, held, err := s.accounts.HeldHandoff(r.Context(), u.ID, in.Token)
	if err != nil {
		return err
	}
	if !held {
		if !s.limits.allow("handoff:"+strconv.FormatInt(u.ID, 10), 20, time.Hour) {
			return errTooMany
		}
		if offer, err = s.accounts.Handoff(r.Context(), u.ID, s.origin(r)); err != nil {
			return err
		}
	}
	return ok(w, offer)
}

// lookHandoff says whose game a handoff's token brings to this browser, on how many days it was played, and whether
// the number is asked for here (account.LookHandoff), or why it can't come here; it takes nothing.
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
	h, err := s.accounts.LookHandoff(r.Context(), in.Token, s.session(r), s.origin(r))
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"game": h})
}

// takeHandoff brings the game of a handoff's token to this browser, in place of a guest with nothing yet, with the
// number given where it's asked for (account.TakeHandoff); the browser it came from stays signed in.
func (s *Server) takeHandoff(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Token  string `json:"token"`
		Number int    `json:"number"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	// From a phone's browser: behind a carrier's address, many phones (codesNet).
	if !s.guardFrom(r, "hand", codesNet, codesSite, time.Hour) {
		return errTooMany
	}
	u, token, err := s.accounts.TakeHandoff(r.Context(), in.Token, s.session(r), s.origin(r), in.Number)
	if wrong := (account.WrongNumber{}); errors.As(err, &wrong) {
		return &apiError{http.StatusBadRequest, "bad_number", wrongNumberWords(wrong.Left)}
	}
	if err != nil {
		return err
	}
	if token != "" {
		s.setSession(w, token)
	}
	return ok(w, map[string]any{"user": u})
}

// wrongNumberWords say a handoff's number was wrong, and how many tries are left.
func wrongNumberWords(left int) string {
	if left == 1 {
		return "Грешно число. Остава ти още 1 опит."
	}
	return "Грешно число. Остават ти още " + strconv.Itoa(left) + " опита."
}

// origin is where a request comes from as a handoff compares two browsers (account.Origin): the network, an IPv4 /24
// or an IPv6 /64, as a hash keyed with the server's secret (never the address: as netMark), and the family of system.
func (s *Server) origin(r *http.Request) account.Origin {
	o := account.Origin{OS: osFamily(r.UserAgent())}
	a := s.clientAddr(r)
	if !a.IsValid() || a.IsLoopback() || a.IsUnspecified() {
		return o
	}
	bits := 64
	if a.Is4() {
		bits = 24
	}
	p, _ := a.Prefix(bits)
	h := hmac.New(sha256.New, s.accounts.Secret)
	h.Write([]byte("hand-net:" + p.String()))
	o.Net = h.Sum(nil)[:12]
	return o
}

// osFamily is the family of system a user agent says it runs on: an app's own browser says the phone's, as the
// phone's own browser does.
func osFamily(ua string) string {
	switch {
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad") || strings.Contains(ua, "iPod"):
		return "ios"
	case strings.Contains(ua, "Android"):
		return "android"
	case strings.Contains(ua, "CrOS"):
		return "chromeos"
	case strings.Contains(ua, "Windows"):
		return "windows"
	case strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X"):
		return "mac"
	case strings.Contains(ua, "Linux"):
		return "linux"
	}
	return "other"
}

// The day's questions played in this browser: a cookie holds the day this browser last started them, whoever it was
// signed in as, and stays through a sign-out and a handoff (it's no session's). A game brought into a browser that
// played the day already (by a handoff, or a sign-in after a sign-out) has the day's answers in sight there, so its
// play of the issue that day is its second (playedHere): the game writes pencil for it, not ink (DECISIONS.md, the
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
