package server

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/almanac-bg/almanac/internal/mail"
)

// The day's reminder by mail: for a player no notification reaches (an iPhone in Safari, a browser without them, one
// who said no to them) who asked for it, at the address they proved with the sign-in code; an address only typed in
// gets nothing (a mail to anyone's address would be cheap to cause). As the notification (remind.go): once a day at
// most, at the player's own hour (RemindMinute), never in the night (quietFrom: pushes.go), only while the day's
// questions still wait, in the notification's words (reminder); after RemindIgnored of them left since the player last
// played the day, none more until they play it again. It goes
// only to an address the player proved (only the sign-in code sets one), and its link lands on Днес as from a mail
// (?from=mail: a browser signed out is asked to sign in there first). Never on a day the streak's mail goes (streakmail.go): one mail
// a day at most. Claimed in day_mails before it's queued in the outbox (which lets go of one to an address the mail
// server refused: mail.Suppressed), so a restart never sends two.
//
// Asked for on Днес, under the day's result where notifications can't come (screens/today.ts), and in Настройки
// → Известия, where it's switched off too; or by the signed link in every mail (mailOff). Off without a row
// (mail_prefs), unlike the streak's mail: it's sent only to whoever asked.

const mailDay mailKind = "day"

// dayMails sends the day's reminder by mail to those whose hour has come at `at`, and says how many. Remind calls it
// every minute, after streakMails.
func (s *Server) dayMails(ctx context.Context, at time.Time) int {
	if s.outbox == nil {
		return 0
	}
	now := at.In(bulgaria())
	today, minute := now.Format(time.DateOnly), now.Hour()*60+now.Minute()
	if minute < RemindEarliest || minute >= quietFrom {
		return 0 // nights are quiet: one found due that late waits for tomorrow
	}
	rows, err := s.db.Read.QueryContext(ctx, `SELECT u.id FROM users u JOIN mail_prefs m ON m.user_id = u.id
		AND m.kind = 'day' AND m.wanted = 1 WHERE u.email IS NOT NULL
		AND NOT EXISTS (SELECT 1 FROM push_subs p WHERE p.user_id = u.id)
		AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.user_id = u.id AND r.kind = 'day' AND r.day = ?1
			AND r.finished_at IS NOT NULL)
		AND NOT EXISTS (SELECT 1 FROM day_mails d WHERE d.user_id = u.id AND d.day = ?1)
		AND NOT EXISTS (SELECT 1 FROM streak_mails d WHERE d.user_id = u.id AND d.day = ?1)`, today)
	if err != nil {
		slog.Error("day mails", "err", err)
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

	m := &s.dayMailing
	m.mu.Lock()
	if m.day != today {
		m.day, m.due = today, map[int64]int{}
	}
	m.mu.Unlock()
	due := func(id int64) int {
		m.mu.Lock()
		defer m.mu.Unlock()
		when, ok := m.due[id]
		if !ok {
			when = s.remindMinute(ctx, today, id)
			m.due[id] = when
		}
		return when
	}
	n := 0
	for _, id := range users {
		if minute < due(id) {
			continue
		}
		sent, err := s.dayMail(ctx, today, at, id)
		switch {
		case err != nil:
			slog.Error("day mail", "err", err) // tried again the next minute
		case !sent:
			m.mu.Lock()
			m.due[id] = never // stopped, or played meanwhile: not again today
			m.mu.Unlock()
		default:
			n++
		}
	}
	if n > 0 {
		s.outbox.Wake()
		slog.Info("day mails", "sent", n)
	}
	return n
}

// dayMail sends a player the day's reminder by mail, unless RemindIgnored of them have been left since they last
// played the day, and says whether it went.
func (s *Server) dayMail(ctx context.Context, today string, at time.Time, userID int64) (bool, error) {
	var email string
	var played sql.NullString
	err := s.db.Read.QueryRowContext(ctx, `SELECT u.email, (SELECT max(day) FROM runs r WHERE r.user_id = u.id
		AND r.kind = 'day' AND r.finished_at IS NOT NULL) FROM users u WHERE u.id = ? AND u.email IS NOT NULL`, userID).
		Scan(&email, &played)
	if err != nil {
		if err == sql.ErrNoRows {
			err = nil
		}
		return false, err
	}
	var left int
	if err := s.db.Read.QueryRowContext(ctx, `SELECT count(*) FROM day_mails WHERE user_id = ? AND day > ? AND day < ?`,
		userID, played.String, today).Scan(&left); err != nil || left >= RemindIgnored {
		return false, err
	}
	word := s.reminder(ctx, today, userID)
	m := mail.Message{To: email, Subject: word.Title, Unsubscribe: s.mailOffURL(userID, mailDay)}
	// The link says it came from a mail: a browser signed out is asked to sign in first (screens/today.ts).
	m.Text = word.Body + "\n\n" + s.mailLink() + "\n\n—\n" +
		"Пишем ти веднъж на ден, около часа, в който играеш, ако броят още те чака. Спри тези писма: " +
		m.Unsubscribe + "\n"
	sent := false
	err = s.db.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.Exec(`INSERT INTO day_mails (user_id, day, at) SELECT ?1, ?2, ?3
			WHERE NOT EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'day' AND day = ?2 AND finished_at IS NOT NULL)
			AND NOT EXISTS (SELECT 1 FROM streak_mails WHERE user_id = ?1 AND day = ?2)
			ON CONFLICT DO NOTHING`, userID, today, at.UnixMilli())
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return nil
		}
		sent = true
		return s.outbox.Enqueue(tx, m)
	})
	if err != nil || !sent {
		return false, err
	}
	return true, nil
}
