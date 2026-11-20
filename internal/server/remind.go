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
// It stops when it doesn't help: after RemindIgnored reminders left without play since the player last played the day,
// counted on their weekdays, or RemindQuietAfter left in all whatever the weekday (a player who played one day has a
// rhythm of one weekday: the others' reminders alone mustn't run on for weeks), none more; on the RemindQuietAfter-th
// day without play, or with the RemindQuietAfter-th left, one last word that the reminders stop (naming the nearest
// step in their book, never a question's text, nor a streak that ended: lastReminder), then nothing until they play the
// day again, when the reminders start again by themselves. A reminder left counts only on a weekday the player has
// played on (rhythm): one who plays on weekdays alone isn't cut off by a weekend's reminders, and the rhythm is theirs
// from their first week, not learned over months. A reminder that reached none of their devices (a service down, the
// game's keys wrong) counts for neither. Word from friends goes as before.
//
// A player held out (play.HeldReminders, a tenth of them: the owner's call, so that /admin can tell what the
// reminders do) is claimed the same, at the same hour, by the same rules, marked held, and never sent: what they would
// have had. A held claim counts as one that reached them, so the held stop as the reminded do.

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
	// RemindQuietAfter is the day without play that says the reminders stop.
	RemindQuietAfter = 7
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
			stmt, err := tx.PrepareContext(ctx, `INSERT INTO push_reminded (user_id, day, at, last, delivered, held)
				SELECT ?1, ?2, ?3, ?4, 0, ?5 WHERE NOT EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'day'
					AND day = ?2 AND finished_at IS NOT NULL)
				ON CONFLICT DO NOTHING`)
			if err != nil {
				return err
			}
			defer stmt.Close()
			for _, c := range chunk {
				// One held out (play.HeldReminders) is claimed as any other, never sent.
				held := s.heldOut(c.user)
				res, err := stmt.ExecContext(ctx, c.user, today, at.UnixMilli(), c.last, held)
				if err != nil {
					return err
				}
				if a, _ := res.RowsAffected(); a == 0 || held {
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

// dayReminder says whether a player gets a reminder today, and which: the usual one (reminder) while RemindIgnored
// of them haven't been left since they last played the day, counted on the weekdays they play (rhythm); the last one
// (last) on the RemindQuietAfter-th day without play; else none, until they play the day again. Only those that
// reached a device count.
func (s *Server) dayReminder(ctx context.Context, today string, userID int64) (last, ok bool, err error) {
	var played sql.NullString
	if err := s.db.Read.QueryRowContext(ctx, `SELECT max(day) FROM runs WHERE user_id = ? AND kind = 'day'
		AND finished_at IS NOT NULL`, userID).Scan(&played); err != nil {
		return false, false, err
	}
	week, err := s.rhythm(ctx, userID)
	if err != nil {
		return false, false, err
	}
	rows, err := s.db.Read.QueryContext(ctx, `SELECT day, last FROM push_reminded WHERE user_id = ? AND day > ?
		AND day < ? AND (delivered > 0 OR held) ORDER BY day`, userID, played.String, today)
	if err != nil {
		return false, false, err
	}
	var ignored, left int
	var stopped bool
	var first sql.NullString
	for rows.Next() {
		var day string
		var isLast bool
		if err := rows.Scan(&day, &isLast); err != nil {
			rows.Close()
			return false, false, err
		}
		if !first.Valid {
			first = sql.NullString{String: day, Valid: true}
		}
		stopped = stopped || isLast
		if !isLast {
			left++
			if week.counts(day) {
				ignored++
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return false, false, err
	}
	switch {
	case stopped:
		return false, false, nil
	case left >= RemindQuietAfter-1:
		return true, true, nil // the last word, whatever the weekdays: RemindQuietAfter in all
	case ignored < RemindIgnored:
		return false, true, nil
	}
	// The days without play: since the day last played, or, for one who never has, since the first reminder left.
	without := 0
	if played.Valid {
		without = dayGap(played.String, today)
	} else if first.Valid {
		without = dayGap(first.String, today) + 1
	}
	return true, without >= RemindQuietAfter, nil
}

// lastReminder says the reminders stop, and that the day's issue waits, with the nearest step in the player's book
// (stepWords): never a question's text, nor the number of a streak that ended (DECISIONS.md, the direction).
func (s *Server) lastReminder(ctx context.Context, userID int64) push.Message {
	return push.Message{Title: "Спираме напомнянията засега", Body: s.stepWords(ctx, userID), URL: "/", Kind: "stop"}
}

// rhythm is the weekdays a player has played the day's questions on, from their first week: a reminder left on one
// of them counts as ignored, one on another weekday doesn't (counts). A player who has never finished a day has no
// rhythm yet, and every reminder left counts.
type rhythm struct {
	days  [7]bool
	known bool
}

// counts says whether a reminder left on day (YYYY-MM-DD) counts as ignored.
func (w rhythm) counts(day string) bool {
	d, err := time.Parse(time.DateOnly, day)
	return !w.known || err != nil || w.days[d.Weekday()]
}

// rhythm reads a player's rhythm: the weekdays of the days they finished the day's questions.
func (s *Server) rhythm(ctx context.Context, userID int64) (rhythm, error) {
	var w rhythm
	rows, err := s.db.Read.QueryContext(ctx, `SELECT DISTINCT CAST(strftime('%w', day) AS INTEGER) FROM runs
		WHERE user_id = ? AND kind = 'day' AND finished_at IS NOT NULL`, userID)
	if err != nil {
		return w, err
	}
	defer rows.Close()
	for rows.Next() {
		var d int
		if err := rows.Scan(&d); err != nil {
			return w, err
		}
		if d >= 0 && d < 7 {
			w.days[d], w.known = true, true
		}
	}
	return w, rows.Err()
}

// dayGap is how many days `to` is after `from` (YYYY-MM-DD).
func dayGap(from, to string) int {
	a, _ := time.Parse(time.DateOnly, from)
	b, _ := time.Parse(time.DateOnly, to)
	return int(b.Sub(a).Hours() / 24)
}

// reminder is the day's word to a player who hasn't played the day's questions: the best of their friends who have
// played, and their streak; or, while none of their friends has, just the streak.
func (s *Server) reminder(ctx context.Context, today string, userID int64) push.Message {
	m := push.Message{Title: "Въпросите на деня те чакат", URL: "/"}
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
		m.Body = fmt.Sprintf("Серията ти е %s. Не я прекъсвай: десет въпроса, до полунощ.", days(streak))
	default:
		m.Body = "Десет въпроса, един опит. До полунощ."
	}
	return m
}
