package server

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/play"
)

// The mail when a streak ends: the one word the game sends a player it can't reach otherwise — one with an email and
// notifications on no device (an iPhone in Safari, say) — when a streak of StreakMailFrom days or more has ended. It
// goes the day after the day missed that ended it, at the player's own hour (RemindMinute), unless they've played by
// then; while the streak can still be won back (play/repair.go) it says how. At most one in StreakMailEvery days,
// claimed in streak_mails before it's queued in the outbox, so a restart never sends two.
//
// The player stops it with a switch in Настройки → Известия, or with the link in the mail, signed so that it needs
// no sign-in (mailOff); mail programs offer the same as a button of their own (mail.Message.Unsubscribe).

const (
	// StreakMailFrom is the shortest streak whose end is mailed.
	StreakMailFrom = 5
	// StreakMailEvery is how many days one such mail lasts a player: one in so many.
	StreakMailEvery = 30
)

// mailKind is a kind of mail a player may turn off (mail_prefs). A kind with no row is on.
type mailKind string

const mailStreak mailKind = "streak"

// streakMailing keeps, for the day, the players due the mail and their minute of the day. Lost in a restart, it's
// drawn again: the claims are in the database.
type streakMailing struct {
	mu  sync.Mutex
	day string
	due map[int64]int
}

// streakMails sends the mails whose minute has come at `at`, and says how many. Remind calls it every minute.
func (s *Server) streakMails(ctx context.Context, at time.Time) int {
	if s.outbox == nil {
		return 0
	}
	now := at.In(bulgaria())
	today, minute := now.Format(time.DateOnly), now.Hour()*60+now.Minute()
	if minute < RemindEarliest {
		return 0
	}
	m := &s.streakMailing
	m.mu.Lock()
	if m.day != today {
		due, err := s.streakMailDue(ctx, today)
		if err != nil {
			m.mu.Unlock()
			slog.Error("streak mails", "err", err)
			return 0
		}
		m.day, m.due = today, due
	}
	var ready []int64
	for id, when := range m.due {
		if minute >= when {
			ready = append(ready, id)
			delete(m.due, id)
		}
	}
	m.mu.Unlock()
	n := 0
	for _, id := range ready {
		sent, err := s.streakMail(ctx, today, at, id)
		if err != nil {
			slog.Error("streak mail", "err", err)
			continue
		}
		if sent {
			n++
		}
	}
	if n > 0 {
		s.outbox.Wake()
		slog.Info("streak mails", "sent", n)
	}
	return n
}

// streakMailDue are the players who may be due the mail today, with their minute: an email, no notifications, and
// the day's questions last finished between ReserveMax+2 and 2 days ago (the streak ended yesterday, if it was one:
// streakMail says).
func (s *Server) streakMailDue(ctx context.Context, today string) (map[int64]int, error) {
	rows, err := s.db.Read.QueryContext(ctx, `SELECT u.id FROM users u WHERE u.email IS NOT NULL
		AND NOT EXISTS (SELECT 1 FROM push_subs p WHERE p.user_id = u.id)
		AND NOT EXISTS (SELECT 1 FROM phones p WHERE p.user_id = u.id)
		AND (SELECT max(day) FROM runs r WHERE r.user_id = u.id AND r.kind = 'day' AND r.finished_at IS NOT NULL)
			BETWEEN ? AND ?`, play.DayShift(today, -2-play.ReserveMax), play.DayShift(today, -2))
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

// streakMail sends a player the mail, if they're due it now (streakMailOf), and says whether it went.
func (s *Server) streakMail(ctx context.Context, today string, at time.Time, userID int64) (bool, error) {
	m, due, err := s.streakMailOf(ctx, today, userID)
	if err != nil || !due {
		return false, err
	}
	sent := false
	err = s.db.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.Exec(`INSERT INTO streak_mails (user_id, day, at) SELECT ?1, ?2, ?3
			WHERE NOT EXISTS (SELECT 1 FROM streak_mails WHERE user_id = ?1 AND day > ?4) ON CONFLICT DO NOTHING`,
			userID, today, at.UnixMilli(), play.DayShift(today, -StreakMailEvery))
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
	return true, s.game.Tally(ctx, "mail:streak:sent", 1)
}

// streakMailOf is the mail a player is due today, if they are: they have an email, want the mail, have notifications
// on no device, haven't played the day's questions today, and a streak of StreakMailFrom days or more ended
// yesterday (none in StreakMailEvery days is streakMail's to tell).
func (s *Server) streakMailOf(ctx context.Context, today string, userID int64) (mail.Message, bool, error) {
	var m mail.Message
	var email sql.NullString
	var reachable bool
	err := s.db.Read.QueryRowContext(ctx, `SELECT email, EXISTS (SELECT 1 FROM push_subs WHERE user_id = ?1)
		OR EXISTS (SELECT 1 FROM phones WHERE user_id = ?1) FROM users WHERE id = ?1`, userID).Scan(&email, &reachable)
	if errors.Is(err, sql.ErrNoRows) {
		return m, false, nil
	}
	if err != nil || !email.Valid || reachable {
		return m, false, err
	}
	if on, err := s.wantsMail(ctx, userID, mailStreak); err != nil || !on {
		return m, false, err
	}
	st, err := s.game.StreakOf(ctx, userID)
	if err != nil {
		return m, false, err
	}
	e := st.Ended
	if st.Days != 0 || e == nil || e.On != play.DayShift(today, -1) || e.Days < StreakMailFrom {
		return m, false, nil
	}
	repair, err := s.game.RepairOf(ctx, userID)
	if err != nil {
		return m, false, err
	}
	m = mail.Message{To: email.String, Subject: fmt.Sprintf("Серията ти от %d дни прекъсна", e.Days),
		Unsubscribe: s.mailOffURL(userID, mailStreak)}
	m.Text = "Въпросите на деня те чакат на almanac.bg. "
	if repair != nil {
		m.Text += "Изиграй ги днес заедно с още една игра и серията ти се връща."
	} else {
		m.Text += "Днес можеш да започнеш нова серия."
	}
	m.Text += "\n\n" + s.cfg.PublicURL + "\n\n—\nНе искам такива писма: " + m.Unsubscribe + "\n"
	return m, true, nil
}

// wantsMail says whether a player gets a kind of mail (on, unless they've turned it off).
func (s *Server) wantsMail(ctx context.Context, userID int64, kind mailKind) (bool, error) {
	var on bool
	err := s.db.Read.QueryRowContext(ctx, `SELECT coalesce((SELECT wanted FROM mail_prefs WHERE user_id = ? AND kind = ?), 1)`,
		userID, kind).Scan(&on)
	return on, err
}

func (s *Server) setMailPref(ctx context.Context, userID int64, kind mailKind, on bool) error {
	_, err := s.db.Write.ExecContext(ctx, `INSERT INTO mail_prefs (user_id, kind, wanted) VALUES (?, ?, ?)
		ON CONFLICT (user_id, kind) DO UPDATE SET wanted = excluded.wanted`, userID, kind, on)
	return err
}

// mailSign is the signature of a player's link to stop a kind of mail: only the server can make it.
func (s *Server) mailSign(userID int64, kind mailKind) string {
	h := hmac.New(sha256.New, s.accounts.Secret)
	fmt.Fprintf(h, "mail-off\x00%s\x00%d", kind, userID)
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil)[:18])
}

// mailOffURL is the link in a mail that stops that kind of mail, no sign-in needed.
func (s *Server) mailOffURL(userID int64, kind mailKind) string {
	q := url.Values{"u": {strconv.FormatInt(userID, 10)}, "k": {string(kind)}, "s": {s.mailSign(userID, kind)}}
	return s.cfg.PublicURL + "/mail/off?" + q.Encode()
}

var mailOffPage = template.Must(template.New("off").Parse(`{{if .Done}}
<p role="status">Готово. Няма да ти пращаме писма, когато серията ти прекъсне.</p>
<p class="muted">Ако размислиш, включи ги пак от <a href="/settings">Профил → Настройки → Известия</a>.</p>
{{else if .Bad}}
<p>Тази връзка не е вярна. Писмата можеш да спреш и от <a href="/settings">Профил → Настройки → Известия</a>.</p>
{{else}}
<p>Пращаме ти по едно писмо, когато серия от {{.From}} дни или повече прекъсне, и само ако не получаваш известия.</p>
<form method="post"><button class="btn" type="submit">Не искам такива писма</button></form>
{{end}}`))

// mailOff stops a kind of mail by the signed link in it: shown, then turned off with a tap (a page that turned it off
// as it opened would be turned off by any program that opens the links in mail to check them); a mail program's own
// button posts straight to it.
func (s *Server) mailOff(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Robots-Tag", "noindex")
	q := r.URL.Query()
	id, err := strconv.ParseInt(q.Get("u"), 10, 64)
	kind := mailKind(q.Get("k"))
	good := err == nil && kind == mailStreak && hmac.Equal([]byte(q.Get("s")), []byte(s.mailSign(id, kind)))
	data := map[string]any{"Bad": !good, "From": StreakMailFrom}
	if good && r.Method == http.MethodPost {
		if err := s.setMailPref(r.Context(), id, kind, false); err != nil {
			slog.Error("mail off", "err", err)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		data["Done"] = true
	}
	var body bytes.Buffer
	_ = mailOffPage.Execute(&body, data)
	s.plain(w, "Писма от АЛМАНАХ", template.HTML(body.String()))
}

// mailPrefs is the player's mail by kind: whether they get it, and whether they can (an email, and notifications on
// no device: the mail is for whom nothing else reaches).
func (s *Server) mailPrefs(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	return s.mailPrefsOf(r.Context(), w, u.ID, u.Email != "")
}

func (s *Server) mailPrefsOf(ctx context.Context, w http.ResponseWriter, userID int64, email bool) error {
	on, err := s.wantsMail(ctx, userID, mailStreak)
	if err != nil {
		return err
	}
	var reachable bool
	if err := s.db.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM push_subs WHERE user_id = ?1)
		OR EXISTS (SELECT 1 FROM phones WHERE user_id = ?1)`, userID).Scan(&reachable); err != nil {
		return err
	}
	return ok(w, map[string]bool{"streak": on, "can": email && !reachable})
}

// setMailPrefs turns a kind of mail on or off for the player.
func (s *Server) setMailPrefs(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Kind mailKind `json:"kind"`
		On   bool     `json:"on"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if in.Kind != mailStreak {
		return errBadRequest
	}
	if err := s.setMailPref(r.Context(), u.ID, in.Kind, in.On); err != nil {
		return err
	}
	return s.mailPrefsOf(r.Context(), w, u.ID, u.Email != "")
}
