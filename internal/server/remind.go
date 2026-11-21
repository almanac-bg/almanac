package server

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
)

// The day's reminder: once a day at most, to a player with notifications on who hasn't finished the day's questions,
// at their own hour (RemindMinute): half an hour before they usually finish the day; one whose hour has passed (just
// subscribed, the server back after a while) at once, until the night (quietFrom: pushes.go), never after. Each is
// claimed in push_reminded and queued (pushes.go) in one transaction, unless the day is played by then, so a restart
// never sends two nor loses one; it's written as it's sent, and not sent if the player has played the day meanwhile.
// The claim keeps how many of the player's devices it reached.
//
// It stops when it doesn't help: after RemindIgnored reminders left without play since the player last played the day
// (whatever the weekday: a player who played one day stops as soon as any other), the next is one last word that the
// reminders stop (naming the nearest step in their book, never a question's text, nor a streak that ended:
// lastReminder), then nothing until they play the day again, when the reminders start again by themselves. A reminder
// that reached none of their devices (a service down, the game's keys wrong) doesn't count. Word from friends goes as
// before.

const (
	// RemindDefault is the hour of a player who hasn't finished a day yet (minutes into the day, in Bulgaria): 19:00.
	RemindDefault = 19 * 60
	// RemindAhead is how long before their usual hour a player is reminded.
	RemindAhead = 30
	// RemindFrom is how many of a player's last days played their hour is drawn from.
	RemindFrom = 7
	// RemindEarliest and RemindLatest bound the hour: 08:00 to 21:30.
	RemindEarliest, RemindLatest = 8 * 60, 21*60 + 30
	// RemindIgnored is how many reminders in a row a player may leave without playing the day before they stop.
	RemindIgnored = 3
)

// RemindMinute is the minute of the day, in Bulgaria, a player is reminded at, from the minutes of the day they
// finished the day's questions on their last days played (RemindFrom of them): the median, RemindAhead sooner, between
// RemindEarliest and RemindLatest; RemindDefault without any.
func RemindMinute(finished []int) int {
	if len(finished) == 0 {
		return RemindDefault
	}
	s := slices.Sorted(slices.Values(finished))
	median := s[len(s)/2]
	if len(s)%2 == 0 {
		median = (s[len(s)/2-1] + s[len(s)/2]) / 2
	}
	return min(max(median-RemindAhead, RemindEarliest), RemindLatest)
}

// reminders keeps, for the day, when each player is due (a minute of the day; never: past its end). Lost in a restart,
// it's drawn again: the claims are in the database.
type reminders struct {
	mu  sync.Mutex
	day string
	due map[int64]int
}

// never is a minute no day reaches: a player not to be reminded today.
const never = 24 * 60

// Remind reminds, every minute, those whose hour has come (remind), and mails those whose streak ended and whom no
// notification reaches (streakMails), and those who asked for the day's reminder by mail (dayMails).
func (s *Server) Remind(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			now := time.Now()
			s.remind(ctx, now)
			s.streakMails(ctx, now) // for those no notification reaches (streakmail.go)
			s.dayMails(ctx, now)    // after it: one mail a day at most (daymail.go)
		}
	}
}

// remind queues the reminders of the players whose hour has come at `at` and who haven't been reminded today. It says
// how many.
func (s *Server) remind(ctx context.Context, at time.Time) int {
	if s.push == nil {
		return 0
	}
	now := at.In(bulgaria())
	today, minute := now.Format(time.DateOnly), now.Hour()*60+now.Minute()
	if minute < RemindEarliest || minute >= quietFrom {
		return 0 // a player found due late (just subscribed, the server back after a while) waits for tomorrow
	}
	rows, err := s.db.Read.QueryContext(ctx, `SELECT DISTINCT p.user_id FROM push_subs p WHERE `+wants(pushDay, "p.user_id")+`
		AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.user_id = p.user_id AND r.kind = 'day' AND r.day = ?1
			AND r.finished_at IS NOT NULL)
		AND NOT EXISTS (SELECT 1 FROM push_reminded d WHERE d.user_id = p.user_id AND d.day = ?1)`, today)
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

	s.reminders.mu.Lock()
	if s.reminders.day != today {
		s.reminders.day, s.reminders.due = today, map[int64]int{}
	}
	s.reminders.mu.Unlock()
	due := func(id int64) int {
		s.reminders.mu.Lock()
		defer s.reminders.mu.Unlock()
		m, ok := s.reminders.due[id]
		if !ok {
			m = s.remindMinute(ctx, today, id)
			s.reminders.due[id] = m
		}
		return m
	}
	type claim struct {
		user int64
		last bool
	}
	var claims []claim
	for _, id := range users {
		if minute < due(id) {
			continue
		}
		last, ok, err := s.dayReminder(ctx, today, id)
		switch {
		case err != nil:
			slog.Error("reminders", "err", err) // tried again the next minute
		case !ok:
			s.reminders.mu.Lock()
			s.reminders.due[id] = never // stopped: not again today
			s.reminders.mu.Unlock()
		default:
			claims = append(claims, claim{id, last})
		}
	}
	// Claimed and queued together, a few hundred to a transaction: one a day, whatever happens after.
	d, _ := time.ParseInLocation(time.DateOnly, today, bulgaria())
	until := d.AddDate(0, 0, 1)
	n := 0
	for chunk := range slices.Chunk(claims, 500) {
		k := 0
		err := s.db.Tx(ctx, func(tx *sql.Tx) error {
			k = 0
			q, err := s.queuer(ctx, tx)
			if err != nil {
				return err
			}
			defer q.close()
			stmt, err := tx.PrepareContext(ctx, `INSERT INTO push_reminded (user_id, day, at, last, delivered)
				SELECT ?1, ?2, ?3, ?4, 0 WHERE NOT EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'day'
					AND day = ?2 AND finished_at IS NOT NULL)
				ON CONFLICT DO NOTHING`)
			if err != nil {
				return err
			}
			defer stmt.Close()
			for _, c := range chunk {
				res, err := stmt.ExecContext(ctx, c.user, today, at.UnixMilli(), c.last)
				if err != nil {
					return err
				}
				if a, _ := res.RowsAffected(); a == 0 {
					continue
				}
				m := push.Message{} // written as it's sent
				if c.last {
					m.Kind = "stop"
				}
				if _, err := q.add(ctx, notice{kind: pushDay, m: m, day: today, until: until}, c.user); err != nil {
					return err
				}
				k++
			}
			return nil
		})
		if err != nil {
			slog.Error("reminders", "err", err) // the rest are tried again the next minute
			break
		}
		n += k
	}
	if n > 0 {
		s.pushq.poke()
		slog.Info("reminded", "players", n)
	}
	return n
}

// remindMinute is a player's minute of the day to be reminded at today (RemindMinute), from their last days played.
func (s *Server) remindMinute(ctx context.Context, today string, userID int64) int {
	rows, err := s.db.Read.QueryContext(ctx, `SELECT finished_at FROM runs WHERE user_id = ? AND kind = 'day'
		AND finished_at IS NOT NULL AND day < ? ORDER BY day DESC LIMIT ?`, userID, today, RemindFrom)
	if err != nil {
		return RemindDefault
	}
	defer rows.Close()
	var finished []int
	for rows.Next() {
		var ms int64
		if rows.Scan(&ms) == nil {
			t := time.UnixMilli(ms).In(bulgaria())
			finished = append(finished, t.Hour()*60+t.Minute())
		}
	}
	return RemindMinute(finished)
}

// dayReminder says whether a player gets a reminder today, and which: the usual one (reminder) while fewer than
// RemindIgnored of them have been left since they last played the day; the last one (last) once that many have; else
// none, until they play the day again. Only those that reached a device count.
func (s *Server) dayReminder(ctx context.Context, today string, userID int64) (last, ok bool, err error) {
	var left int
	var stopped bool
	err = s.db.Read.QueryRowContext(ctx, `SELECT count(*) FILTER (WHERE NOT last), coalesce(max(last), 0)
		FROM push_reminded WHERE user_id = ?1 AND day < ?2 AND delivered > 0
			AND day > coalesce((SELECT max(day) FROM runs WHERE user_id = ?1 AND kind = 'day' AND finished_at IS NOT NULL), '')`,
		userID, today).Scan(&left, &stopped)
	switch {
	case err != nil || stopped:
		return false, false, err
	case left >= RemindIgnored:
		return true, true, nil
	}
	return false, true, nil
}

// lastReminder says the reminders stop, and that the day's issue waits, with the nearest step in the player's book
// (stepWords): never a question's text, nor the number of a streak that ended (DECISIONS.md, the direction).
func (s *Server) lastReminder(ctx context.Context, userID int64) push.Message {
	return push.Message{Title: "Спираме напомнянията, докато не играеш пак", Body: s.stepWords(ctx, userID), URL: "/", Kind: "stop"}
}

// reminder is the day's word to a player who hasn't played the day's questions: the best of their friends who have
// played, and their streak; or, while none of their friends has, just the streak.
func (s *Server) reminder(ctx context.Context, today string, userID int64) push.Message {
	m := push.Message{Title: "Днешният брой те чака", URL: "/"}
	streak, _ := s.game.Streak(ctx, userID)
	board, _ := s.game.FriendsBoard(ctx, today, userID)
	var best *play.Score
	for i := range board {
		if !board[i].Me {
			best = &board[i]
			break
		}
	}
	switch {
	case best != nil && streak > 0:
		m.Body = fmt.Sprintf("%s позна %d от %d днес. Серията ти е %s.", best.Name, best.Rights, play.Length, days(streak))
	case best != nil:
		m.Body = fmt.Sprintf("%s позна %d от %d днес. А ти?", best.Name, best.Rights, play.Length)
	case streak > 0:
		m.Body = fmt.Sprintf("Серията ти е %s. Десет въпроса, до полунощ.", days(streak))
	default:
		m.Body = "Десет въпроса, един опит. До полунощ."
	}
	return m
}
