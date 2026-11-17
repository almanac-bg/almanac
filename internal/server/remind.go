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
// at their own hour (RemindMinute): half an hour before they usually finish the day. Each is claimed in push_reminded
// before it's sent, so a restart never sends two.
//
// It stops when it doesn't help: after RemindIgnored reminders since the player last played the day, none more; on
// the RemindQuietAfter-th day without play, one last word that the reminders stop (with the streak that ended), then
// nothing until they play the day again, when the reminders start again by themselves. Word from friends and Роял's
// call go as before.

const (
	// RemindDefault is the hour of a player who hasn't finished a day yet (minutes into the day, in Bulgaria): 19:00.
	RemindDefault = 19 * 60
	// RemindAhead is how long before their usual hour a player is reminded.
	RemindAhead = 30
	// RemindFrom is how many of a player's last days played their hour is drawn from.
	RemindFrom = 7
	// RemindEarliest and RemindLatest bound the hour: 08:00 to 21:30.
	RemindEarliest, RemindLatest = 8 * 60, 21*60 + 30
	// Роял's evening (its lobby, its game) is no time for the day's reminder: one that would fall in it goes at
	// RemindBeforeRoyal.
	RoyalQuietFrom, RoyalQuietTo, RemindBeforeRoyal = 20*60 + 45, 21*60 + 30, 20*60 + 30
	// RemindIgnored is how many reminders in a row a player may leave without playing the day before they stop.
	RemindIgnored = 3
	// RemindQuietAfter is the day without play that says the reminders stop.
	RemindQuietAfter = 7
)

// RemindMinute is the minute of the day, in Bulgaria, a player is reminded at, from the minutes of the day they
// finished the day's questions on their last days played (RemindFrom of them): the median, RemindAhead sooner, between
// RemindEarliest and RemindLatest and never in Роял's evening; RemindDefault without any.
func RemindMinute(finished []int) int {
	if len(finished) == 0 {
		return RemindDefault
	}
	s := slices.Sorted(slices.Values(finished))
	median := s[len(s)/2]
	if len(s)%2 == 0 {
		median = (s[len(s)/2-1] + s[len(s)/2]) / 2
	}
	m := min(max(median-RemindAhead, RemindEarliest), RemindLatest)
	if m >= RoyalQuietFrom && m <= RoyalQuietTo {
		m = RemindBeforeRoyal
	}
	return m
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
// notification reaches (streakMails).
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
		}
	}
}

// remind reminds the players whose hour has come at `at` and who haven't been reminded today. It says how many.
func (s *Server) remind(ctx context.Context, at time.Time) int {
	if s.push == nil && s.phones == nil {
		return 0
	}
	now := at.In(bulgaria())
	today, minute := now.Format(time.DateOnly), now.Hour()*60+now.Minute()
	if minute < RemindEarliest {
		return 0
	}
	rows, err := s.db.Read.QueryContext(ctx, `SELECT DISTINCT p.user_id FROM (SELECT user_id FROM push_subs
		UNION SELECT user_id FROM phones) p WHERE `+wants(pushDay, "p.user_id")+`
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
	n := 0
	for _, id := range users {
		if minute < due(id) {
			continue
		}
		m, last, ok := s.dayReminder(ctx, today, id)
		if !ok {
			s.reminders.mu.Lock()
			s.reminders.due[id] = never // stopped: not again today
			s.reminders.mu.Unlock()
			continue
		}
		// Claim it first: one a day, whatever happens after.
		res, err := s.db.Write.ExecContext(ctx, `INSERT INTO push_reminded (user_id, day, at, last) VALUES (?, ?, ?, ?)
			ON CONFLICT DO NOTHING`, id, today, at.UnixMilli(), last)
		if err != nil {
			slog.Error("reminders", "err", err)
			return n
		}
		if k, _ := res.RowsAffected(); k == 0 {
			continue
		}
		s.notify(ctx, pushDay, m, id)
		n++
	}
	if n > 0 {
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

// dayReminder is the reminder a player gets today, if any: the usual one (reminder) while they haven't left
// RemindIgnored of them since they last played the day; the last one (last) on the RemindQuietAfter-th day without
// play; else none, until they play the day again.
func (s *Server) dayReminder(ctx context.Context, today string, userID int64) (m push.Message, last, ok bool) {
	var played sql.NullString
	if err := s.db.Read.QueryRowContext(ctx, `SELECT max(day) FROM runs WHERE user_id = ? AND kind = 'day'
		AND finished_at IS NOT NULL`, userID).Scan(&played); err != nil {
		return m, false, false
	}
	var ignored int
	var stopped bool
	var first sql.NullString
	if err := s.db.Read.QueryRowContext(ctx, `SELECT count(*) FILTER (WHERE NOT last), coalesce(max(last), 0), min(day)
		FROM push_reminded WHERE user_id = ? AND day > ? AND day < ?`, userID, played.String, today).
		Scan(&ignored, &stopped, &first); err != nil {
		return m, false, false
	}
	switch {
	case stopped:
		return m, false, false
	case ignored < RemindIgnored:
		return s.reminder(ctx, today, userID), false, true
	}
	// The days without play: since the day last played, or, for one who never has, since the first reminder left.
	without := 0
	if played.Valid {
		without = dayGap(played.String, today)
	} else if first.Valid {
		without = dayGap(first.String, today) + 1
	}
	if without < RemindQuietAfter {
		return m, false, false
	}
	return s.lastReminder(ctx, userID, played.String), true, true
}

// lastReminder says the reminders stop, with the streak that ended since the day last played, if it had 2 days or more.
func (s *Server) lastReminder(ctx context.Context, userID int64, played string) push.Message {
	m := push.Message{Title: "Спираме напомнянията засега", Body: "Въпросите на деня са тук, когато решиш.", URL: "/", Kind: "stop"}
	if st, err := s.game.StreakOf(ctx, userID); err == nil && st.Days == 0 && st.Ended != nil && st.Ended.On > played &&
		st.Ended.Days >= 2 {
		m.Body += fmt.Sprintf(" Серията ти беше %s.", days(st.Ended.Days))
	}
	return m
}

// dayGap is how many days `to` is after `from` (YYYY-MM-DD).
func dayGap(from, to string) int {
	a, _ := time.Parse(time.DateOnly, from)
	b, _ := time.Parse(time.DateOnly, to)
	return int(b.Sub(a).Hours() / 24)
}

// reminder is the day's word to a player who hasn't played the day's questions: a streak just broken that can still
// be won back today (play/repair.go), and how, as the streak's mail says it; else the best of their friends who have
// played, and their streak; or, while none of their friends has, just the streak.
func (s *Server) reminder(ctx context.Context, today string, userID int64) push.Message {
	m := push.Message{Title: "Въпросите на деня те чакат", URL: "/"}
	streak, _ := s.game.Streak(ctx, userID)
	if streak == 0 {
		if r, _ := s.game.RepairOf(ctx, userID); r != nil {
			m.Body = fmt.Sprintf("Серията ти от %s прекъсна. Върни я днес: въпросите на деня и още една игра.", days(r.Days))
			return m
		}
	}
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
		m.Body = fmt.Sprintf("%s има %d от %d днес. Серията ти е %s.", best.Name, best.Rights, play.Length, days(streak))
	case best != nil:
		m.Body = fmt.Sprintf("%s има %d от %d днес. А ти?", best.Name, best.Rights, play.Length)
	case streak > 0:
		m.Body = fmt.Sprintf("Серията ти е %s. Не я прекъсвай: десет въпроса, до полунощ.", days(streak))
	default:
		m.Body = "Десет въпроса, един опит. До полунощ."
	}
	return m
}
