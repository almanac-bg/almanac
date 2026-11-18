package server

import (
	"cmp"
	"context"
	"database/sql"
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

// duels lists the player's duels, with their rating, and the challenges they sent (play.SentOf).
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
	sent, err := s.game.SentOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"duels": list, "standing": st, "challenges": sent})
}

// duelOne is one of the player's duels, with what its result says (play.DuelOf).
func (s *Server) duelOne(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return play.ErrNoDuel
	}
	d, err := s.game.DuelOf(r.Context(), u.ID, id)
	if err != nil {
		return err
	}
	// A win is shared as the day's result is: with the player's own link (their invite).
	if d.State == "won" {
		code, err := s.game.InviteCode(r.Context(), u.ID)
		if err != nil {
			return err
		}
		d.Invite = s.cfg.PublicURL + "/f/" + code
	}
	return ok(w, map[string]any{"duel": d})
}

// declineDuel says no to a friend's challenge sent to the player, before they've started it.
func (s *Server) declineDuel(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return play.ErrNoDuel
	}
	if err := s.game.Decline(r.Context(), u.ID, id); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// duelNews tells a player of a duel: a friend's challenge waits for them, the result of one played in their own time
// (a challenge between friends; a live duel's result they've just seen), or someone took their challenge.
// Through notifyFrom: nothing between two players one of whom has blocked the other, and a day's pushes capped.
func (s *Server) duelNews(ctx context.Context, n play.DuelNews) {
	m := push.Message{URL: fmt.Sprintf("/duel/%d", n.DuelID)}
	switch n.Kind {
	case "asked":
		m.Title = n.From + " те предизвика"
		m.Body = fmt.Sprintf("Десет въпроса, когато ти е удобно: имаш %d дни.", int(play.ChallengeFor.Hours()/24))
	case "challenge": // someone took the player's challenge (play.challengeNews: once a day at most)
		m.URL = "/c/" + n.Code
		m.Title = n.From + " изигра предизвикателството ти"
		m.Body = map[string]string{"won": "Ти печелиш.", "lost": "Победата е за " + n.From + ".", "draw": "Равенство."}[n.Outcome] +
			" Виж кой още го е изиграл."
	case "result":
		if n.Seen {
			return
		}
		var kind string
		if err := s.db.Read.QueryRowContext(ctx, `SELECT kind FROM duels WHERE id = ?`, n.DuelID).Scan(&kind); err != nil || kind != "challenge" {
			return
		}
		word := map[string]string{"won": "Победа срещу", "lost": "Загуба срещу", "draw": "Равенство с"}[n.Outcome]
		m.Title = fmt.Sprintf("%s %s", word, n.From)
		m.Body = ratingWords(n.Delta)
		if n.Friendly {
			m.Body = cmp.Or(unratedWords[n.Unrated], unratedWords["again"])
		}
	default:
		return
	}
	s.notifyFrom(context.WithoutCancel(ctx), n.FromID, "", m, n.To)
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

// leagueNews queues, in the write of a week's close that keeps their places (a few groups' at a time), the word to
// each player of how their week ended: sent once the league is theirs to see (play/unfold.go), as the queue sends it (pushes.go).
func (s *Server) leagueNews(ctx context.Context, tx *sql.Tx, news []play.LeagueNews) error {
	if s.push == nil && s.phones == nil {
		return nil
	}
	q, err := s.queuer(ctx, tx)
	if err != nil {
		return err
	}
	defer q.close()
	for _, n := range news {
		m := push.Message{URL: "/ranks#league", Title: "Седмицата в лигата свърши", Body: leagueWords(n)}
		if _, err := q.add(ctx, notice{kind: pushFriends, m: m, needs: "league"}, n.To); err != nil {
			return err
		}
	}
	s.pushq.poke() // what's queued is seen once the week's end is in, at the latest the next second
	return nil
}

// leagueWords is how a player's week in the league ended: „1-во място от 8 в лига Странджа. Качваш се в лига …“
func leagueWords(n play.LeagueNews) string {
	body := fmt.Sprintf("%s в лига %s.", place(n.Place, n.Of), n.From.Name)
	switch {
	case n.Now.Tier > n.From.Tier:
		body += " Качваш се в лига " + n.Now.Name + "."
	case n.Now.Tier < n.From.Tier:
		body += " Слизаш в лига " + n.Now.Name + "."
	default:
		body += " Оставаш в лига " + n.Now.Name + "."
	}
	if n.XP > 0 {
		body += fmt.Sprintf(" +%d XP.", n.XP)
	}
	return body
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
