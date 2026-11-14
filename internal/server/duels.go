package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/live"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
)

// challenge starts a duel with a friend: the player plays theirs now, and the friend hears of it once they have.
func (s *Server) challenge(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Friend int64 `json:"friend"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if in.Friend == 0 {
		return errBadRequest
	}
	st, id, err := s.game.ChallengeFriend(r.Context(), u.ID, in.Friend)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"duel": id, "state": st})
}

// livePlayer is a player as a live duel shows them: name, tag, look and rating.
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
	p.Rating, p.Division = st.Rating, st.Division
	return p, err
}

// liveEvents is a live duel on a player's screen (Server-Sent Events). Opening it asks for a duel: the one the
// player is in, if they're in one, else with whoever is waiting; else they wait, told how long, and play a recording
// if nobody comes. Then the duel as they see it, again after every change, each view with the duel's id: a line
// that dropped and came back sends it (Last-Event-ID), and follows that duel again, or hears it's gone. Closing it
// while waiting stops waiting.
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
	rc := http.NewResponseController(w)
	send := func(line string) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprint(w, line); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	fail := func(event string) { send("event: " + event + "\ndata: {}\n\n") }
	if !s.limits.allow("live:"+strconv.FormatInt(u.ID, 10), 120, time.Hour) {
		fail("busy")
		return
	}
	ping := time.NewTicker(20 * time.Second) // keeps the line open through proxies (Cloudflare closes it after 100 s)
	defer ping.Stop()
	// find is the duel to follow. A line that dropped and came back (the browser says the duel it had) goes back to
	// that duel, over or not, or hears that it's gone (a restart): never into the queue for a new one, which would
	// leave the screen on the old one's last question.
	find := func() (*live.Match, bool) {
		if last := r.Header.Get("Last-Event-ID"); last != "" {
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
		seek := s.live.Seek(p)
		defer seek.Leave() // once it's settled, only the waiting it stops
		select {
		case <-seek.Done():
		default:
			data, _ := json.Marshal(map[string]int64{"leftMs": seek.Left().Milliseconds()})
			if !send("event: waiting\ndata: " + string(data) + "\n\n") {
				return nil, false
			}
		}
		for waiting := true; waiting; {
			select {
			case <-seek.Done():
				waiting = false
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
		case seek.Err != nil:
			if !errors.Is(seek.Err, live.ErrTooMany) {
				slog.Error("live duel", "err", seek.Err)
			}
			fail("busy")
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

// playDuel is the player's run in a friend's challenge (made the first time).
func (s *Server) playDuel(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return play.ErrNoDuel
	}
	st, err := s.game.PlayDuel(r.Context(), u.ID, id)
	if err != nil {
		return err
	}
	return ok(w, st)
}

// declineDuel turns a friend's challenge down, or calls it off (its challenger, before the friend has started).
func (s *Server) declineDuel(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return play.ErrNoDuel
	}
	if err := s.game.DeclineDuel(r.Context(), u.ID, id); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// duelNews tells a player of a duel: a friend challenges them, or the result of one they played in their own time
// (a live duel's result they've just seen).
func (s *Server) duelNews(ctx context.Context, n play.DuelNews) {
	m := push.Message{URL: fmt.Sprintf("/duel/%d", n.DuelID)}
	switch n.Kind {
	case "asked":
		m.Title = n.From + " те предизвика на дуел"
		m.Body = fmt.Sprintf("Десет въпроса, когато ти е удобно: имаш %d часа.", int(play.FriendFor.Hours()))
	case "result":
		if n.Seen {
			return
		}
		var kind string
		if err := s.db.Read.QueryRowContext(ctx, `SELECT kind FROM duels WHERE id = ?`, n.DuelID).Scan(&kind); err != nil || kind != "friend" {
			return
		}
		word := map[string]string{"won": "Победа", "lost": "Загуба", "draw": "Равенство"}[n.Outcome]
		m.Title = fmt.Sprintf("%s срещу %s", word, n.From)
		m.Body = ratingWords(n.Delta)
		if n.Friendly {
			m.Body = "Приятелски дуел: вече сте играли днес, рейтингът не се мени."
		}
	default:
		return
	}
	go s.notify(context.WithoutCancel(ctx), pushFriends, m, n.To)
}

// ranks is a board: by rating, or by knowledge (over every topic, or one); of everyone, or of the viewer and their
// friends (?among=friends). The week's league is its own (league).
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

// almanac is the player's collection of learned facts.
func (s *Server) almanac(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	a, err := s.game.AlmanacOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, a)
}

// league is the week's league as the viewer sees it: their group, or (not in one yet, or nobody signed in) what puts
// them in.
func (s *Server) league(w http.ResponseWriter, r *http.Request) error {
	viewer := int64(0)
	if u, err := s.user(r); err == nil && u != nil {
		viewer = u.ID
	}
	v, err := s.game.LeagueOf(r.Context(), viewer)
	if err != nil {
		return err
	}
	return ok(w, v)
}

// year is the player's look back at a year in the game.
func (s *Server) year(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	year, err := strconv.Atoi(r.PathValue("year"))
	if err != nil {
		return errNotFound
	}
	y, err := s.game.YearOf(r.Context(), u.ID, year)
	if err != nil {
		return err
	}
	return ok(w, y)
}

// leagueNews tells a player how their week in the league ended.
func (s *Server) leagueNews(ctx context.Context, n play.LeagueNews) {
	body := fmt.Sprintf("%s в %s.", place(n.Place, n.Of), n.From.Name)
	switch {
	case n.Now.Tier > n.From.Tier:
		body += " Качваш се в " + n.Now.Name + "."
	case n.Now.Tier < n.From.Tier:
		body += " Слизаш в " + n.Now.Name + "."
	default:
		body += " Оставаш в " + n.Now.Name + "."
	}
	if n.XP > 0 {
		body += fmt.Sprintf(" +%d XP.", n.XP)
	}
	go s.notify(context.WithoutCancel(ctx), pushFriends, push.Message{URL: "/ranks#league", Title: "Седмицата в лигата свърши", Body: body}, n.To)
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
	return ok(w, map[string]any{"goals": goals, "reserve": streak.Reserve, "reserveMax": play.ReserveMax})
}
