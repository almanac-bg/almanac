package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/store"
)

// subscribe keeps a browser's push subscription, for its player.
func (s *Server) subscribe(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if s.push == nil {
		return errNotFound
	}
	var sub push.Subscription
	if err := readJSON(r, &sub); err != nil {
		return err
	}
	if err := sub.Check(); err != nil {
		return errBadRequest
	}
	_, err = s.db.Write.ExecContext(r.Context(), `INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at)
		VALUES (?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
		auth = excluded.auth`, sub.Endpoint, u.ID, sub.Keys.P256dh, sub.Keys.Auth, store.Now())
	if err != nil {
		return err
	}
	return ok(w, map[string]bool{"on": true})
}

// unsubscribe forgets a browser's subscription.
func (s *Server) unsubscribe(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Endpoint string `json:"endpoint"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	_, err = s.db.Write.ExecContext(r.Context(), `DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?`, in.Endpoint, u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]bool{"on": false})
}

// notify sends a message to every browser of these players that asked for notifications, a few at a time.
func (s *Server) notify(ctx context.Context, m push.Message, userIDs ...int64) {
	if s.push == nil || len(userIDs) == 0 {
		return
	}
	type target struct {
		sub  push.Subscription
		user int64
	}
	var targets []target
	for _, id := range userIDs {
		rows, err := s.db.Read.QueryContext(ctx, `SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?`, id)
		if err != nil {
			slog.Error("push", "err", err)
			return
		}
		for rows.Next() {
			var t target
			t.user = id
			if rows.Scan(&t.sub.Endpoint, &t.sub.Keys.P256dh, &t.sub.Keys.Auth) == nil {
				targets = append(targets, t)
			}
		}
		rows.Close()
	}
	work := make(chan target)
	var wg sync.WaitGroup
	for range min(8, len(targets)) {
		wg.Go(func() {
			for t := range work {
				err := s.push.Send(ctx, t.sub, m)
				switch {
				case errors.Is(err, push.ErrGone):
					_, _ = s.db.Write.ExecContext(ctx, `DELETE FROM push_subs WHERE endpoint = ?`, t.sub.Endpoint)
				case err != nil:
					slog.Warn("push", "err", err)
				}
			}
		})
	}
	for _, t := range targets {
		work <- t
	}
	close(work)
	wg.Wait()
}

// RemindAt is when, in Bulgaria, players who haven't played the day's questions yet are reminded.
const RemindAt = 19

// Remind reminds, once a day at RemindAt, everyone with notifications on who hasn't finished the day's questions.
func (s *Server) Remind(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.remind(ctx, time.Now())
		}
	}
}

// remind does the day's reminding if it's time and it isn't done yet. The day it last did is kept, so a restart
// around then doesn't remind twice. It says how many it reminded.
func (s *Server) remind(ctx context.Context, at time.Time) int {
	if s.push == nil {
		return 0
	}
	now := at.In(bulgaria())
	today := now.Format(time.DateOnly)
	if now.Hour() < RemindAt {
		return 0
	}
	// Claim the day first: one reminder a day, whatever happens after.
	res, err := s.db.Write.ExecContext(ctx, `INSERT INTO kv (key, value) VALUES ('reminded', ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE value != excluded.value`, today)
	if err != nil {
		slog.Error("reminders", "err", err)
		return 0
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return 0 // done today
	}
	rows, err := s.db.Read.QueryContext(ctx, `SELECT DISTINCT p.user_id FROM push_subs p WHERE NOT EXISTS (
		SELECT 1 FROM runs r WHERE r.user_id = p.user_id AND r.kind = 'day' AND r.day = ? AND r.finished_at IS NOT NULL)`, today)
	if err != nil {
		slog.Error("reminders", "err", err)
		return 0
	}
	var users []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			users = append(users, id)
		}
	}
	rows.Close()
	for _, id := range users {
		body := "Десет въпроса, един опит. До полунощ."
		if streak, _ := s.game.Streak(ctx, id); streak > 0 {
			days := "дни"
			if streak == 1 {
				days = "ден"
			}
			body = fmt.Sprintf("Серията ти е %d %s. Не я прекъсвай: десет въпроса, до полунощ.", streak, days)
		}
		s.notify(ctx, push.Message{Title: "Въпросите на деня те чакат", Body: body, URL: "/"}, id)
	}
	slog.Info("reminded", "players", len(users))
	return len(users)
}

// place is a player's place among others, said of the place so that it reads the same to everyone: „3-то място от 12“.
func place(n, of int) string { return fmt.Sprintf("%s място от %d", ordinal(n), of) }

// ordinal is n as the ordinal of a neuter word („място“), in digits as Bulgarian writes it: 1-во, 2-ро, 3-то, 4-то,
// 5-о … 11-о … 21-во, 100-тно, 1000-но.
func ordinal(n int) string {
	end := "о"
	switch tens := n % 100; {
	case n > 0 && n%1000 == 0:
		end = "но"
	case n > 0 && tens == 0:
		end = "тно"
	case tens >= 11 && tens <= 19:
	case n%10 == 1:
		end = "во"
	case n%10 == 2:
		end = "ро"
	case n%10 == 3, n%10 == 4:
		end = "то"
	}
	return fmt.Sprintf("%d-%s", n, end)
}

// pushKey is what a browser subscribes with (empty: no notifications here).
func (s *Server) pushKey() string {
	if s.push == nil {
		return ""
	}
	return s.push.Keys.Public
}
