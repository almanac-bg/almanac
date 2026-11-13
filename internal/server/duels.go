package server

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
)

// startDuel gives the player a duel to play now: with a friend they name, or with whoever comes (another's open
// duel, or one of their own).
func (s *Server) startDuel(w http.ResponseWriter, r *http.Request) error {
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
	var st play.State
	var id int64
	if in.Friend != 0 {
		st, id, err = s.game.ChallengeFriend(r.Context(), u.ID, in.Friend)
	} else {
		st, id, err = s.game.FindDuel(r.Context(), u.ID)
	}
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"duel": id, "state": st})
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

// playDuel is the player's run in a duel they were asked to (made the first time).
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

// declineDuel turns a duel down (the friend asked) or calls it off (its starter, before anyone else played).
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

// duelNews tells a player of a duel: a friend asks, or a result.
func (s *Server) duelNews(ctx context.Context, n play.DuelNews) {
	m := push.Message{URL: "/duel"}
	switch n.Kind {
	case "asked":
		m.Title, m.Body = n.From+" те предизвика на дуел", "Десет въпроса, когато ти е удобно: имаш 48 часа."
	case "result":
		word := map[string]string{"won": "Победа", "lost": "Загуба", "draw": "Равенство"}[n.Outcome]
		m.Title = fmt.Sprintf("%s срещу %s", word, n.From)
		m.Body = fmt.Sprintf("Рейтинг: %+d.", n.Delta)
	default:
		return
	}
	go s.notify(context.WithoutCancel(ctx), m, n.To)
}

// ranks is a board: by rating this season (with the season), by level, or by knowledge (over every topic, or one);
// of everyone, or of the viewer and their friends (?among=friends).
func (s *Server) ranks(w http.ResponseWriter, r *http.Request) error {
	viewer := int64(0)
	if u, err := s.user(r); err == nil && u != nil {
		viewer = u.ID
	}
	q := r.URL.Query()
	friends := q.Get("among") == "friends"
	ctx := r.Context()
	switch q.Get("by") {
	case "level":
		b, err := s.game.LevelBoard(ctx, viewer, friends)
		if err != nil {
			return err
		}
		return ok(w, map[string]any{"board": b})
	case "knowledge":
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
	season, err := s.game.SeasonOf(ctx, viewer)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"board": b, "season": season})
}

// joinRoyal puts the player in a tournament and gives them their run.
func (s *Server) joinRoyal(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	st, id, err := s.game.JoinRoyal(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"royal": id, "state": st})
}

// royals lists the tournaments the player is in, with their rating.
func (s *Server) royals(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	list, err := s.game.RoyalsOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	if list == nil {
		list = []play.Royal{}
	}
	st, err := s.game.StandingOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"royals": list, "standing": st})
}

// royalNews tells a player how a tournament they were in ended.
func (s *Server) royalNews(ctx context.Context, n play.RoyalNews) {
	m := push.Message{
		URL:   "/royal",
		Title: fmt.Sprintf("Роял: %d-и от %d", n.Place, n.Of),
		Body:  fmt.Sprintf("Рейтинг: %+d.", n.Delta),
	}
	go s.notify(context.WithoutCancel(ctx), m, n.To)
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

// season is the rating's season as the player sees it: their games and place in it, and how the ones before ended.
func (s *Server) season(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	season, err := s.game.SeasonOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, season)
}

// seasonNews tells a player placed in a season how it ended.
func (s *Server) seasonNews(ctx context.Context, n play.SeasonNews) {
	body := fmt.Sprintf("%d-и от %d в рейтинга. Новият сезон започна.", n.Place, n.Of)
	if n.Place <= 3 {
		title, _ := play.PodiumTitle(n.Place, 1)
		body = fmt.Sprintf("%d-и от %d: %s на сезона! Новият сезон започна.", n.Place, n.Of, strings.ToLower(title))
	}
	go s.notify(context.WithoutCancel(ctx), push.Message{URL: "/me", Title: "Сезонът свърши", Body: body}, n.To)
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
	return ok(w, map[string]any{"goals": goals})
}
