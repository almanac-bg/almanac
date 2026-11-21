package server

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
)

// Duels are played on one's own time (play/duels.go): with a friend, who plays the same ten when they can, or against
// a real recorded game. Each side is a run like any other (/api/runs/{id}), played on its own clock.

// duelsPerHour is how many duels a player may start in an hour (a friend's, or against a recording), on top of the
// game's own limits (play.DuelsToOne, play.DuelsADay): each draws ten questions and writes a game.
const duelsPerHour = 60

// duels lists the player's duels: theirs to play, those waiting for a friend, and those played.
func (s *Server) duels(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	list, err := s.game.DuelsOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, list)
}

// recordingReady says whether a duel against a recording can be played now (play.RecordingReady), so that the way to
// one is offered only while there is one; to a visitor too, who becomes a guest by starting it.
func (s *Server) recordingReady(w http.ResponseWriter, r *http.Request) error {
	u, err := s.user(r)
	if err != nil {
		return err
	}
	var id int64
	if u != nil {
		id = u.ID
	}
	ready, err := s.game.RecordingReady(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"ready": ready})
}

// newDuel starts a duel: with a friend ({"friend": id}) or against a recording ({"recording": true}); one of the same
// left unfinished is gone on with instead. It answers with the duel, and the player's run in it to play.
func (s *Server) newDuel(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Friend    int64  `json:"friend"`
		Recording bool   `json:"recording"`
		Level     string `json:"level"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if !s.limits.allow("duel:"+strconv.FormatInt(u.ID, 10), duelsPerHour, time.Hour) {
		return errTooMany
	}
	var id int64
	switch {
	case in.Recording:
		id, err = s.game.DuelRecording(r.Context(), u.ID, in.Level)
	case in.Friend > 0:
		id, err = s.game.DuelFriend(r.Context(), u.ID, in.Friend)
	default:
		return errBadRequest
	}
	if err != nil {
		return err
	}
	d, err := s.game.DuelOf(r.Context(), u.ID, id)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"duel": d})
}

// playDuel is the player's run in a duel that's theirs to play (play.PlayDuel): made as a friend's duel sent to them
// is first played.
func (s *Server) playDuel(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return play.ErrDuelGone
	}
	if _, err := s.game.PlayDuel(r.Context(), u.ID, id); err != nil {
		return err
	}
	d, err := s.game.DuelOf(r.Context(), u.ID, id)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"duel": d})
}

// duelOne is one of the player's duels, with what its result says (play.DuelOf).
func (s *Server) duelOne(w http.ResponseWriter, r *http.Request) error {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return play.ErrDuelGone
	}
	u, err := s.mustUser(r)
	if errors.Is(err, errSignedOut) {
		// Signed out: asked to sign in only for a duel there is (one that isn't is said so, to anyone).
		if there, e := s.game.DuelExists(r.Context(), id); e != nil {
			return e
		} else if !there {
			return play.ErrDuelGone
		}
	}
	if err != nil {
		return err
	}
	d, err := s.game.DuelOf(r.Context(), u.ID, id)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"duel": d})
}

// duelNews tells a player of a friend's duel (play.Game.DuelNews): sent to them, or played back, its result in. It
// goes through notifyFrom, as anything one player sends another: once a day from one player at most, a few a day in
// all; Приятели and Начало say it whatever the push does.
func (s *Server) duelNews(ctx context.Context, n play.DuelNews) {
	if s.push == nil {
		return
	}
	var name string
	if err := s.db.Read.QueryRowContext(ctx, `SELECT name FROM users WHERE id = ?`, n.From).Scan(&name); err != nil {
		return
	}
	m := push.Message{Title: name + " те покани на дуел", Body: "Десет въпроса, същите като на " + name + ". Имаш седем дни.",
		URL: "/duel/" + strconv.FormatInt(n.DuelID, 10)}
	if n.Played {
		m.Title, m.Body = name+" изигра дуела ви", "Виж как завърши."
	}
	s.notifyFrom(context.WithoutCancel(ctx), n.From, m, n.To)
}

// almanac is a page of the player's book: of a chapter (?topic=, or all), from where the page before ended (?from=,
// its next) or by its number (?page=, from 0), its facts found by words (?q=).
func (s *Server) almanac(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	a, err := s.game.AlmanacOf(r.Context(), u.ID, play.AlmanacQuery{Topic: q.Get("topic"), From: q.Get("from"),
		Search: q.Get("q"), Page: min(max(page, 0), 10_000), Limit: play.AlmanacPage})
	if err != nil {
		return err
	}
	noun := "almanac" // the book; a chapter's page, „глави“ (play.Used)
	if q.Get("topic") != "" {
		noun = "chapters"
	}
	if err := s.game.Used(r.Context(), u.ID, noun); err != nil {
		return err
	}
	return ok(w, a)
}
