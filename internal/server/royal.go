package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
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
	sub := s.royal.Follow(viewer)
	defer s.royal.Unfollow(sub)

	send := sender(w)
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
	err = s.royal.Join(r.Context(), royal.Player{ID: u.ID, Name: u.Name, Tag: u.Tag, Look: look})
	if errors.Is(err, royal.ErrClosed) || errors.Is(err, royal.ErrShut) {
		return &apiError{http.StatusConflict, "royal_closed", refusal(err, s.royal.Glance())}
	}
	if err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// refusal is why one can't come into Роял now, in words, with when they can: the lobby isn't open yet (ErrClosed), or
// the games are past the door (ErrShut).
func refusal(err error, g royal.Glance) string {
	now := time.UnixMilli(g.Now)
	if errors.Is(err, royal.ErrShut) {
		next := time.UnixMilli(g.Next)
		// The third: royal.Late.
		return fmt.Sprintf("Роял вече тече, а закъснелите влизат само до 3-тия въпрос. Следващият е %s в %s.",
			onDay(next, now), next.In(play.Bulgaria).Format("15:04"))
	}
	opens := time.UnixMilli(g.OpensAt)
	return fmt.Sprintf("Входът за Роял се отваря %s в %s.", onDay(opens, now), opens.In(play.Bulgaria).Format("15:04"))
}

// weekdays are the days of the week, from Sunday, as they're said after „в“.
var weekdays = [7]string{"неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"}

// onDay is the day of t from now's, in Bulgaria, in words: „днес“, „утре“, or its weekday („в петък“, „във вторник“).
func onDay(t, now time.Time) string {
	t, now = t.In(play.Bulgaria), now.In(play.Bulgaria)
	switch t.Format(time.DateOnly) {
	case now.Format(time.DateOnly):
		return "днес"
	case now.AddDate(0, 0, 1).Format(time.DateOnly):
		return "утре"
	}
	day := weekdays[t.Weekday()]
	if strings.HasPrefix(day, "в") {
		return "във " + day
	}
	return "в " + day
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
		m.Body = ratingWords(n.Delta)
	}
	s.notify(context.WithoutCancel(ctx), pushFriends, m, n.To)
}

// tonight is the next Роял at a glance (for its tile on Начало and the screen before its lobby): when, how many are in
// it once its lobby is open, and how many said they'd come, the player among them or not, and which of their friends.
func (s *Server) tonight(w http.ResponseWriter, r *http.Request) error {
	var viewer int64
	if u, err := s.user(r); err == nil && u != nil {
		viewer = u.ID
	}
	return s.tonightFor(w, r.Context(), viewer)
}

func (s *Server) tonightFor(w http.ResponseWriter, ctx context.Context, viewer int64) error {
	g := s.royal.Glance()
	day := eveningOf(g.Next)
	coming, planned, err := s.game.RoyalPlans(ctx, day, viewer)
	if err != nil {
		return err
	}
	friends := []string{}
	if viewer != 0 && coming > 0 {
		if friends, err = s.game.RoyalFriends(ctx, day, viewer); err != nil {
			return err
		}
	}
	return ok(w, map[string]any{"glance": g, "coming": coming, "planned": planned, "friends": friends})
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

// claimCall says whether the call named key to the evening that starts at start is still to be made, and claims it
// in tx, which queues the call (pushes.go): once an evening, whatever restarts the server.
func claimCall(ctx context.Context, tx *sql.Tx, key string, start time.Time) (bool, error) {
	res, err := tx.ExecContext(ctx, `INSERT INTO kv (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE value != excluded.value`, key, start.UTC().Format(time.RFC3339))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// planners are the players a query lists: those who said they'd come to an evening, say.
func planners(ctx context.Context, tx *sql.Tx, q string, args ...any) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// call claims a call to an evening and queues it, in one transaction (once an evening, whatever restarts the
// server): to is who, by the kind of call each gets, read as it's claimed. It says how many it called.
func (s *Server) call(ctx context.Context, key string, start time.Time, m push.Message,
	to func(tx *sql.Tx) (map[pushKind][]int64, error)) int {
	if s.push == nil && s.phones == nil {
		return 0
	}
	called := 0
	err := s.db.Tx(ctx, func(tx *sql.Tx) error {
		called = 0
		if ok, err := claimCall(ctx, tx, key, start); err != nil || !ok {
			return err // or called already
		}
		lists, err := to(tx)
		if err != nil {
			return err
		}
		for kind, ids := range lists {
			// Of no use once it has started.
			if _, err := s.queue(ctx, tx, notice{kind: kind, m: m, until: start}, ids...); err != nil {
				return err
			}
			called += len(ids)
		}
		return nil
	})
	if err != nil {
		slog.Error("royal call", "err", err)
		return 0
	}
	s.pushq.poke()
	return called
}

// callRoyal calls to the evening that starts at start, as its lobby opens: those who said they'd come, and those who
// want Роял's notifications every evening. Once an evening, whatever restarts the server. It says how many it called.
func (s *Server) callRoyal(ctx context.Context, start time.Time) int {
	day := eveningOf(start.UnixMilli())
	at := start.In(play.Bulgaria).Format("15:04")
	m := push.Message{Title: "Входът за Роял е отворен", Body: "Роял започва в " + at + ". Влез.", URL: "/royal"}
	return s.call(ctx, "royal_called", start, m, func(tx *sql.Tx) (map[pushKind][]int64, error) {
		planned, err := planners(ctx, tx, `SELECT user_id FROM royal_plans WHERE day = ?`, day)
		if err != nil {
			return nil, err
		}
		always, err := planners(ctx, tx, `SELECT user_id FROM push_prefs WHERE kind = 'royal' AND wanted = 1
			AND user_id NOT IN (SELECT user_id FROM royal_plans WHERE day = ?)`, day)
		if err != nil {
			return nil, err
		}
		// The plans of evenings gone are of no more use.
		if _, err := tx.ExecContext(ctx, `DELETE FROM royal_plans WHERE day < ?`, day); err != nil {
			return nil, err
		}
		slog.Info("royal called", "planned", len(planned), "always", len(always))
		return map[pushKind][]int64{pushAsked: planned, pushRoyal: always}, nil
	})
}

// callSoon calls again, a minute before the start: those in the lobby whose screen isn't on it (away), and those who
// said they'd come and aren't in it (in is everyone who is). Once an evening, whatever restarts the server. It says
// how many it called.
func (s *Server) callSoon(ctx context.Context, start time.Time, away, in []int64) int {
	at := start.In(play.Bulgaria).Format("15:04")
	m := push.Message{Title: "Роял започва след минута", Body: "Влез сега: първият въпрос е в " + at + ".", URL: "/royal"}
	return s.call(ctx, "royal_called_soon", start, m, func(tx *sql.Tx) (map[pushKind][]int64, error) {
		planned, err := planners(ctx, tx, `SELECT user_id FROM royal_plans WHERE day = ?`, eveningOf(start.UnixMilli()))
		if err != nil {
			return nil, err
		}
		to := slices.Clone(away)
		for _, id := range planned {
			if !slices.Contains(in, id) {
				to = append(to, id)
			}
		}
		slog.Info("royal called again", "away", len(away), "coming", len(to)-len(away))
		return map[pushKind][]int64{pushAsked: to}, nil
	})
}
