package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/royal"
)

// royalEvents streams the evening's Роял to a screen (Server-Sent Events): as the viewer sees it, again after every
// change. Anyone may look; playing takes a player. The browser reconnects by itself if the line drops.
func (s *Server) royalEvents(w http.ResponseWriter, r *http.Request) {
	var viewer int64
	if u, err := s.user(r); err == nil && u != nil {
		viewer = u.ID
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	sub := s.royal.Follow(viewer)
	defer s.royal.Unfollow(sub)

	send := func(line string) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprint(w, line); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	ping := time.NewTicker(20 * time.Second) // keeps the line open through proxies (Cloudflare closes it after 100 s)
	defer ping.Stop()
	for {
		select {
		case <-sub.C:
			data, _ := json.Marshal(s.royal.View(viewer))
			if !send("data: " + string(data) + "\n\n") {
				return
			}
			// Many answers in a moment make one look, not one each.
			select {
			case <-time.After(150 * time.Millisecond):
			case <-r.Context().Done():
				return
			}
		case <-ping.C:
			if !send(": ping\n\n") {
				return
			}
		case <-s.closing:
			return
		case <-r.Context().Done():
			return
		}
	}
}

// joinRoyal puts the player in the evening's lobby.
func (s *Server) joinRoyal(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	look, err := s.game.LookOf(r.Context(), u.ID)
	if err != nil {
		look = play.Look{Avatar: play.DefaultAvatar(u.ID), Level: 1}
	}
	if err := s.royal.Join(r.Context(), royal.Player{ID: u.ID, Name: u.Name, Tag: u.Tag, Look: look}); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// leaveRoyal takes the player out of the lobby.
func (s *Server) leaveRoyal(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if err := s.royal.Leave(r.Context(), u.ID); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

func (s *Server) royalAnswer(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
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
	if err := s.royal.Answer(r.Context(), u.ID, in.N, in.Answer); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// royals lists the last tournaments the player was in, with their rating.
func (s *Server) royals(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	list, err := s.game.RoyalsOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	st, err := s.game.StandingOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"royals": list, "standing": st})
}

// royalNews tells a player how a tournament they were in ended, when they weren't there to see it.
func (s *Server) royalNews(ctx context.Context, n play.RoyalNews) {
	m := push.Message{URL: "/royal", Title: "Роял: " + place(n.Place, n.Of)}
	if n.Of >= 3 { // with fewer, ratings don't move
		m.Body = fmt.Sprintf("Рейтинг: %+d.", n.Delta)
	}
	go s.notify(context.WithoutCancel(ctx), pushFriends, m, n.To)
}

// tonight is the next Роял at a glance (for its tile on Начало and the screen before its lobby): when, how many are in
// it once its lobby is open, and how many said they'd come, the player among them or not.
func (s *Server) tonight(w http.ResponseWriter, r *http.Request) error {
	var viewer int64
	if u, err := s.user(r); err == nil && u != nil {
		viewer = u.ID
	}
	return s.tonightFor(w, r.Context(), viewer)
}

func (s *Server) tonightFor(w http.ResponseWriter, ctx context.Context, viewer int64) error {
	g := s.royal.Glance()
	coming, planned, err := s.game.RoyalPlans(ctx, eveningOf(g.Next), viewer)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"glance": g, "coming": coming, "planned": planned})
}

// eveningOf is the day of the evening that starts at ms (Unix milliseconds), in Bulgaria.
func eveningOf(ms int64) string {
	return time.UnixMilli(ms).In(play.Bulgaria).Format(time.DateOnly)
}

// planRoyal says the player will come to the next Роял (POST), or won't after all (DELETE). They're called when its
// lobby opens, whatever they chose for Роял's notifications.
func (s *Server) planRoyal(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	day := eveningOf(s.royal.Glance().Next)
	if err := s.game.PlanRoyal(r.Context(), day, u.ID, r.Method == http.MethodPost); err != nil {
		return err
	}
	return s.tonightFor(w, r.Context(), u.ID)
}

// callRoyal calls to the evening that starts at start, as its lobby opens: those who said they'd come, and those who
// want Роял's notifications every evening. Once an evening, whatever restarts the server. It says how many it called.
func (s *Server) callRoyal(ctx context.Context, start time.Time) int {
	if s.push == nil {
		return 0
	}
	res, err := s.db.Write.ExecContext(ctx, `INSERT INTO kv (key, value) VALUES ('royal_called', ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE value != excluded.value`, start.UTC().Format(time.RFC3339))
	if err != nil {
		slog.Error("royal call", "err", err)
		return 0
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return 0 // called already
	}
	day := eveningOf(start.UnixMilli())
	ids := func(q string, args ...any) []int64 {
		rows, err := s.db.Read.QueryContext(ctx, q, args...)
		if err != nil {
			slog.Error("royal call", "err", err)
			return nil
		}
		defer rows.Close()
		var out []int64
		for rows.Next() {
			var id int64
			if rows.Scan(&id) == nil {
				out = append(out, id)
			}
		}
		return out
	}
	planned := ids(`SELECT user_id FROM royal_plans WHERE day = ?`, day)
	always := ids(`SELECT user_id FROM push_prefs WHERE kind = 'royal' AND wanted = 1
		AND user_id NOT IN (SELECT user_id FROM royal_plans WHERE day = ?)`, day)
	// The plans of evenings gone are of no more use.
	_, _ = s.db.Write.ExecContext(ctx, `DELETE FROM royal_plans WHERE day < ?`, day)
	at := start.In(play.Bulgaria).Format("15:04")
	m := push.Message{Title: "Входът за Роял е отворен", Body: "Роял започва в " + at + ". Влез.", URL: "/royal"}
	s.notify(ctx, pushAsked, m, planned...)
	s.notify(ctx, pushRoyal, m, always...)
	slog.Info("royal called", "planned", len(planned), "always", len(always))
	return len(planned) + len(always)
}
