package server

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/live"
	"github.com/almanac-bg/almanac/internal/play"
)

// livePlayer is a player as a live duel shows them: name, tag, look and rating, and its division once it's placed
// (play.Placed; none while it's still being set).
func (s *Server) livePlayer(ctx context.Context, id int64) (live.Player, error) {
	var p live.Player
	err := s.db.Read.QueryRowContext(ctx, `SELECT name, tag FROM users WHERE id = ?`, id).Scan(&p.Name, &p.Tag)
	if err != nil {
		return p, err
	}
	p.ID = id
	if p.Look, err = s.game.LookOf(ctx, id); err != nil {
		return p, err
	}
	st, err := s.game.StandingOf(ctx, id)
	p.Rating = st.Rating
	if st.Of == 0 {
		p.Division = st.Division
	}
	return p, err
}

// liveEvents is a live duel on a player's screen (Server-Sent Events). Opening it asks for a duel: the one the
// player is in, if they're in one, else with whoever is waiting; else they wait, told how long, and play a recording
// if nobody comes (while the server drains for a restart, they wait for it, told so, and the stream that ends with
// the server comes back to the new one by itself). Then the duel as they see it, again after every change, each view
// with the duel's id: a line that dropped and came back sends it (Last-Event-ID), and follows that duel again, or
// hears it's gone. Closing it while waiting stops waiting. Opened with ?rematch=<duel>, it asks for a rematch with the
// other of a duel just over instead (live.Hub.Rematch), and hears "norematch" if it doesn't come about.
func (s *Server) liveEvents(w http.ResponseWriter, r *http.Request) {
	u, err := s.mustUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "signed_out"})
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	send := sender(w)
	fail := func(event string) { send("event: " + event + "\ndata: {}\n\n") }
	if !s.limits.allow("live:"+strconv.FormatInt(u.ID, 10), 120, time.Hour) {
		fail("busy")
		return
	}
	ping := time.NewTicker(20 * time.Second) // keeps the line open through proxies (Cloudflare closes it after 100 s)
	defer ping.Stop()
	// find is the duel to follow. A line that dropped and came back (the browser says the duel it had) goes back to
	// that duel, over or not, or hears that it's gone (a restart): never into the queue for a new one, which would
	// leave the screen on the old one's last question. The browser says it in a header; a stream the screen opens anew
	// (one the browser gave up on: web/src/lib/stream.ts), in the address (?last=), as it can set no header.
	find := func() (*live.Match, bool) {
		if last := cmp.Or(r.Header.Get("Last-Event-ID"), r.URL.Query().Get("last")); last != "" {
			id, _ := strconv.ParseInt(last, 10, 64)
			m, err := s.live.Get(id)
			if err != nil {
				fail("closed")
				return nil, false
			}
			return m, true
		}
		p, err := s.livePlayer(r.Context(), u.ID)
		if err != nil {
			slog.Error("live duel", "err", err)
			fail("busy")
			return nil, false
		}
		p.Net = s.netMark(r) // two from one network play a friendly (play/fair.go)
		p.Device = clientDevice(r)
		// ?rematch=<duel>: a new duel with the other of that one (both ask: live.Hub.Rematch); else whoever comes.
		var seek *live.Seek
		if again, _ := strconv.ParseInt(r.URL.Query().Get("rematch"), 10, 64); again > 0 {
			seek = s.live.Rematch(p, again)
		} else {
			seek = s.live.Seek(p)
		}
		defer seek.Leave() // once it's settled, only the waiting it stops
		// waiting says how long until a recording, or that the server is about to restart (held: the screen waits,
		// and finds its duel on the new server).
		waiting := func() bool {
			data, _ := json.Marshal(map[string]any{"leftMs": seek.Left().Milliseconds(), "held": seek.Held()})
			return send("event: waiting\ndata: " + string(data) + "\n\n")
		}
		select {
		case <-seek.Done():
		default:
			if !waiting() {
				return nil, false
			}
		}
		for settled := false; !settled; {
			select {
			case <-seek.Done():
				settled = true
			case <-seek.Changed():
				if !waiting() {
					return nil, false
				}
			case <-ping.C:
				if !send(": ping\n\n") {
					return nil, false
				}
			case <-s.closing:
				return nil, false
			case <-r.Context().Done():
				return nil, false
			}
		}
		switch {
		case errors.Is(seek.Err, play.ErrNobody):
			fail("nobody")
			return nil, false
		case errors.Is(seek.Err, live.ErrNoRematch):
			fail("norematch")
			return nil, false
		case errors.Is(seek.Err, live.ErrPaused):
			fail("paused")
			return nil, false
		case seek.Err != nil:
			if !errors.Is(seek.Err, live.ErrTooMany) {
				slog.Error("live duel", "err", seek.Err)
			}
			fail("busy")
			return nil, false
		}
		// A screen closed as its duel was found doesn't follow it: the duel, not come to, is called off.
		if r.Context().Err() != nil {
			return nil, false
		}
		return seek.Match, true
	}
	m, found := find()
	if !found {
		return
	}
	sub, err := m.Follow(u.ID)
	if err != nil {
		fail("closed")
		return
	}
	defer m.Unfollow(sub)
	for {
		select {
		case <-sub.C:
			data, _ := json.Marshal(m.View(u.ID))
			// The duel's id goes with each view: a line that drops sends it back (Last-Event-ID), to come back to it.
			if !send("id: " + strconv.FormatInt(m.ID(), 10) + "\ndata: " + string(data) + "\n\n") {
				return
			}
		case <-ping.C:
			if !send(": ping\n\n") {
				return
			}
		case <-sub.Done:
			fail("closed")
			return
		case <-s.closing:
			return
		case <-r.Context().Done():
			return
		}
	}
}

// liveAnswer is a player's answer in a live duel.
func (s *Server) liveAnswer(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return live.ErrNoMatch
	}
	m, err := s.live.Get(id)
	if err != nil {
		return err
	}
	var in struct {
		N      int             `json:"n"`
		Answer json.RawMessage `json:"answer"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if err := m.Answer(u.ID, in.N, in.Answer); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// liveSeen is a player's screen saying it shows a live duel's question n now: their time on it runs from then, within
// bounds (live.Match.Seen).
func (s *Server) liveSeen(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return live.ErrNoMatch
	}
	m, err := s.live.Get(id)
	if err != nil {
		return err
	}
	var in struct {
		N int `json:"n"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if err := m.Seen(u.ID, in.N); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// liveLeave is a player leaving a live duel under way, as they confirmed on its screen: it goes on without them at
// once, the other told so (live.Match.Leave).
func (s *Server) liveLeave(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return live.ErrNoMatch
	}
	m, err := s.live.Get(id)
	if err != nil {
		return err
	}
	if err := m.Leave(u.ID); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// liveClaim is a player taking the win of a live duel the other has left for good, while they lead (live.Match.Claim):
// it ends at once.
func (s *Server) liveClaim(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return live.ErrNoMatch
	}
	m, err := s.live.Get(id)
	if err != nil {
		return err
	}
	if err := m.Claim(u.ID); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// duels lists the player's duels, with their rating.
func (s *Server) duels(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	list, err := s.game.DuelsOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	st, err := s.game.StandingOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"duels": list, "standing": st})
}

// duelOne is one of the player's duels, with what its result says (play.DuelOf).
func (s *Server) duelOne(w http.ResponseWriter, r *http.Request) error {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return play.ErrNoDuel
	}
	u, err := s.mustUser(r)
	if errors.Is(err, errSignedOut) {
		// Signed out: asked to sign in only for a duel there is (one that isn't is said so, to anyone).
		if there, e := s.game.DuelExists(r.Context(), id); e != nil {
			return e
		} else if !there {
			return play.ErrNoDuel
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

// ranks is a board: by rating, or by knowledge (over every topic, or one); of everyone, or of the viewer and their
// friends (?among=friends).
func (s *Server) ranks(w http.ResponseWriter, r *http.Request) error {
	viewer := int64(0)
	if u, err := s.user(r); err == nil && u != nil {
		viewer = u.ID
	}
	q := r.URL.Query()
	friends := q.Get("among") == "friends"
	ctx := r.Context()
	if q.Get("by") == "knowledge" {
		b, err := s.game.KnowledgeBoard(ctx, viewer, friends, q.Get("topic"))
		if err != nil {
			return err
		}
		least := play.KnowAll
		if q.Get("topic") != "" {
			least = play.KnowTopic
		}
		return ok(w, map[string]any{"board": b, "least": least})
	}
	b, err := s.game.RatingBoard(ctx, viewer, friends)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"board": b, "least": play.MinRatedGames})
}

// almanac is a page of the player's collection of learned facts: of a topic (?topic=, or all), from where the page
// before ended (?from=, its next).
func (s *Server) almanac(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	a, err := s.game.AlmanacOf(r.Context(), u.ID, q.Get("topic"), q.Get("from"), play.AlmanacPage)
	if err != nil {
		return err
	}
	return ok(w, a)
}

// goals are the player's goals for today.
func (s *Server) goals(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	goals, err := s.game.GoalsOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	streak, err := s.game.StreakOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	// What the three done would bring the streak: a reserve day, or why not (all in hand, this week's earned, the
	// streak too young: play.ReserveFrom).
	return ok(w, map[string]any{"goals": goals, "reserve": streak.Reserve, "reserveMax": play.ReserveMax,
		"reserveBy": streak.GoalsReserve()})
}
