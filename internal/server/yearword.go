package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/push"
)

// The year's word: once a year, in December, from the day the year's look back opens on Начало (play.YearOpens) to
// the year's end, a player who played on YearWordFrom days of it or more hears „Твоята 2026 в АЛМАНАХ“: the days they
// played and the facts they learned, and the way to their year (/year/2026). After the reminders have stopped
// (remind.go), it's a reason to come back that asks nothing of them (review 2026-11-18, R8). By notification where one
// reaches them and they keep the day's on; else by mail, to the address the sign-in code proved, while they keep the
// game's mail (the streak's, on by default, or the day's reminder) and haven't stopped this one by its link. At their
// own hour (RemindMinute), never in the night (quietFrom: pushes.go). Claimed in year_words before it's queued, in one
// transaction, one a player and year: never twice, over a restart too. A player held out of the reminders
// (play.HeldReminders) whom it would reach by notification is claimed the same, marked held, and not sent; by mail it
// goes to everyone, as the day's reminder by mail does (daymail.go).

const (
	// YearWordFrom is the fewest days played in a year that bring its word.
	YearWordFrom = 7
	// mailYear is the year's word by mail: on without a row, stopped by its own link (mailOff).
	mailYear mailKind = "year"
)

// yearWording keeps, for the day, the players due the year's word and their minute of the day. Lost in a restart, it's
// drawn again: the claims are in the database.
type yearWording struct {
	mu  sync.Mutex
	day string
	due map[int64]int
}

// yearWords sends the year's word to those whose minute has come at `at`, and says to how many. Remind calls it every
// minute; it does nothing before December's YearOpens.
func (s *Server) yearWords(ctx context.Context, at time.Time) int {
	now := at.In(bulgaria())
	if now.Month() != time.December || now.Day() < play.YearOpens {
		return 0
	}
	today, minute := now.Format(time.DateOnly), now.Hour()*60+now.Minute()
	if minute < RemindEarliest || minute >= quietFrom {
		return 0
	}
	w := &s.yearWording
	w.mu.Lock()
	if w.day != today {
		due, err := s.yearWordDue(ctx, now.Year(), today)
		if err != nil {
			w.mu.Unlock()
			slog.Error("the year's word", "err", err)
			return 0
		}
		w.day, w.due = today, due
	}
	var ready []int64
	for id, when := range w.due {
		if minute >= when {
			ready = append(ready, id)
			delete(w.due, id)
		}
	}
	w.mu.Unlock()
	n := 0
	for _, id := range ready {
		sent, err := s.yearWord(ctx, now.Year(), at, id)
		if err != nil {
			slog.Error("the year's word", "err", err)
			continue
		}
		if sent {
			n++
		}
	}
	if n > 0 {
		s.pushq.poke()
		if s.outbox != nil {
			s.outbox.Wake()
		}
		slog.Info("the year's word", "sent", n)
	}
	return n
}

// yearWordDue are the players who may be due the year's word today, with their minute: YearWordFrom days played in the
// year or more, and none had yet.
func (s *Server) yearWordDue(ctx context.Context, year int, today string) (map[int64]int, error) {
	rows, err := s.db.Read.QueryContext(ctx, `SELECT a.user_id FROM active_days a
		WHERE a.day BETWEEN ?1 AND ?2
			AND NOT EXISTS (SELECT 1 FROM year_words y WHERE y.user_id = a.user_id AND y.year = ?3)
		GROUP BY a.user_id HAVING count(*) >= ?4`,
		fmt.Sprintf("%d-01-01", year), fmt.Sprintf("%d-12-31", year), year, YearWordFrom)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	due := make(map[int64]int, len(ids))
	for _, id := range ids {
		due[id] = s.remindMinute(ctx, today, id)
	}
	return due, nil
}

// yearWord claims and queues a player's word of the year, by the way that reaches them (yearWordOf), and says whether
// it went: one held out, or one nothing reaches, didn't.
func (s *Server) yearWord(ctx context.Context, year int, at time.Time, userID int64) (bool, error) {
	w, err := s.yearWordOf(ctx, year, userID)
	if err != nil || w.how == "" {
		return false, err
	}
	held := w.how == "push" && s.heldOut(userID)
	sent := false
	err = s.db.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.Exec(`INSERT INTO year_words (user_id, year, at, how, held) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT DO NOTHING`, userID, year, at.UnixMilli(), w.how, held)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 || held {
			return nil
		}
		if w.how == "mail" {
			sent = true
			return s.outbox.Enqueue(tx, w.mail)
		}
		end := time.Date(year+1, 1, 1, 0, 0, 0, 0, bulgaria())
		n, err := s.queue(ctx, tx, notice{kind: pushDay, m: w.push, until: end}, userID)
		sent = n > 0
		return err
	})
	if err != nil || !sent {
		return false, err
	}
	return true, s.game.Tally(ctx, "year:"+w.how+":sent", 1)
}

// aYearWord is a player's word of the year, and how it reaches them ("push", "mail"; "" for no way).
type aYearWord struct {
	how  string
	push push.Message
	mail mail.Message
}

// yearWordOf is a player's word of the year: what it says (yearWordText), and the way it reaches them, if one does: a
// notification on a device, the day's kept on; else a mail, the game's mail kept on and this one not stopped.
func (s *Server) yearWordOf(ctx context.Context, year int, userID int64) (aYearWord, error) {
	var w aYearWord
	var email sql.NullString
	var devices bool
	err := s.db.Read.QueryRowContext(ctx, `SELECT email, EXISTS (SELECT 1 FROM push_subs WHERE user_id = ?1)
		OR EXISTS (SELECT 1 FROM phones WHERE user_id = ?1) FROM users WHERE id = ?1`, userID).Scan(&email, &devices)
	if errors.Is(err, sql.ErrNoRows) {
		return w, nil
	}
	if err != nil {
		return w, err
	}
	y, err := s.game.YearOf(ctx, userID, year)
	if err != nil || y.Days < YearWordFrom {
		return w, err
	}
	title, text := fmt.Sprintf("Твоята %d в АЛМАНАХ", year), yearWordText(y)
	href := "/year/" + strconv.Itoa(year)
	if devices {
		var on bool
		if err := s.db.Read.QueryRowContext(ctx, `SELECT `+wants(pushDay, "?")+``, userID).Scan(&on); err != nil {
			return w, err
		}
		if on {
			w.how, w.push = "push", push.Message{Title: title, Body: text, URL: href, Kind: "year"}
			return w, nil
		}
	}
	if !email.Valid || s.outbox == nil {
		return w, nil
	}
	streak, err := s.wantsMail(ctx, userID, mailStreak)
	if err != nil {
		return w, err
	}
	day, err := s.wantsMail(ctx, userID, mailDay)
	if err != nil {
		return w, err
	}
	this, err := s.wantsMail(ctx, userID, mailYear)
	if err != nil || !this || !(streak || day) {
		return w, err
	}
	w.how = "mail"
	w.mail = mail.Message{To: email.String, Subject: title, Unsubscribe: s.mailOffURL(userID, mailYear)}
	w.mail.Text = text + "\n\n" + s.cfg.PublicURL + href + "\n\n—\nСпри тези писма: " + w.mail.Unsubscribe + "\n"
	return w, nil
}

// yearWordText is what the year's word says: „34 дни игра, 212 факта в Алманаха. Виж годината си.“
func yearWordText(y play.Year) string {
	text := fmt.Sprintf("%d дни игра", y.Days)
	switch {
	case y.Facts == 1:
		text += ", 1 факт в Алманаха"
	case y.Facts > 1:
		text += fmt.Sprintf(", %d факта в Алманаха", y.Facts)
	}
	return text + ". Виж годината си."
}
