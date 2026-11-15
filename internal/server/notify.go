package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
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
	// What a browser sends (PushSubscription.toJSON): the subscription, and when it expires, which no browser sets.
	var in struct {
		push.Subscription
		ExpirationTime *float64 `json:"expirationTime"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	sub := in.Subscription
	// Keys come base64url without padding from most browsers; take them with it too.
	sub.Keys.P256dh = strings.TrimRight(sub.Keys.P256dh, "=")
	sub.Keys.Auth = strings.TrimRight(sub.Keys.Auth, "=")
	if err := s.push.Check(sub); err != nil {
		if errors.Is(err, push.ErrNotService) {
			// A browser's push service the list misses shows here (push.Services).
			host := ""
			if u, err := url.Parse(sub.Endpoint); err == nil {
				host = u.Host
			}
			// The player's words in the log: one line, and short.
			host = strings.ReplaceAll(strings.ReplaceAll(host[:min(len(host), 100)], "\n", ""), "\r", "")
			slog.Warn("push: a subscription elsewhere than a known push service", "host", host)
		}
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

// addPhone keeps a phone's token from its maker's push service, for its player: the game's app sends it once the
// player allows notifications, and again whenever it opens (a token can change).
func (s *Server) addPhone(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if s.phones == nil {
		return errNotFound
	}
	var in struct {
		Platform string `json:"platform"`
		Token    string `json:"token"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	in.Token = push.PhoneToken(in.Platform, in.Token)
	if s.phones.CheckPhone(in.Platform, in.Token) != nil {
		return errBadRequest
	}
	_, err = s.db.Write.ExecContext(r.Context(), `INSERT INTO phones (token, user_id, platform, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform`,
		in.Token, u.ID, in.Platform, store.Now())
	if err != nil {
		return err
	}
	return ok(w, map[string]bool{"on": true})
}

// removePhone forgets a phone's token: its player turned notifications off there.
func (s *Server) removePhone(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	_, err = s.db.Write.ExecContext(r.Context(), `DELETE FROM phones WHERE token IN (?, ?) AND user_id = ?`,
		in.Token, push.PhoneToken("ios", in.Token), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]bool{"on": false})
}

// pushKind is what a notification is about. Each player chooses which kinds they get (push_prefs); a kind they
// haven't chosen for is at its default.
type pushKind string

const (
	// pushDay is the evening reminder of the day's questions.
	pushDay pushKind = "day"
	// pushFriends is word from people and of games played: a friend accepts a link or calls to a duel, how a duel
	// or a Роял played in one's own absence ended, how a week in the league ended.
	pushFriends pushKind = "friends"
	// pushRoyal is the call to every evening's Роял as its lobby opens. Off by default: saying „Ще дойда“ calls a
	// player to that one evening anyway.
	pushRoyal pushKind = "royal"
	// pushAsked is a notification the player asked for themselves (the evening they said they'd come to): it goes
	// whatever they chose for the kinds.
	pushAsked pushKind = ""
)

// name is the kind as notifications carry it, and as they're counted: an asked-for one is "asked".
func (k pushKind) name() string {
	if k == pushAsked {
		return "asked"
	}
	return string(k)
}

// pushKinds are the kinds a player chooses, with their defaults.
var pushKinds = map[pushKind]bool{pushDay: true, pushFriends: true, pushRoyal: false}

// wants is the SQL condition that the player in column user wants notifications of kind.
func wants(kind pushKind, user string) string {
	def := 0
	if pushKinds[kind] {
		def = 1
	}
	return fmt.Sprintf(`coalesce((SELECT wanted FROM push_prefs WHERE user_id = %s AND kind = '%s'), %d) = 1`, user, kind, def)
}

// pushPrefs is which kinds of notification the player gets.
func (s *Server) pushPrefs(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	prefs, err := s.prefsOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"prefs": prefs})
}

func (s *Server) prefsOf(ctx context.Context, userID int64) (map[pushKind]bool, error) {
	prefs := maps.Clone(pushKinds)
	rows, err := s.db.Read.QueryContext(ctx, `SELECT kind, wanted FROM push_prefs WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var kind pushKind
		var on bool
		if err := rows.Scan(&kind, &on); err != nil {
			return nil, err
		}
		prefs[kind] = on
	}
	return prefs, rows.Err()
}

// setPushPref turns one kind of notification on or off for the player.
func (s *Server) setPushPref(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Kind pushKind `json:"kind"`
		On   bool     `json:"on"`
	}
	if err := readJSON(r, &in); err != nil {
		return err
	}
	if _, known := pushKinds[in.Kind]; !known {
		return errBadRequest
	}
	_, err = s.db.Write.ExecContext(r.Context(), `INSERT INTO push_prefs (user_id, kind, wanted) VALUES (?, ?, ?)
		ON CONFLICT (user_id, kind) DO UPDATE SET wanted = excluded.wanted`, u.ID, in.Kind, in.On)
	if err != nil {
		return err
	}
	prefs, err := s.prefsOf(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"prefs": prefs})
}

// notify sends a message of a kind to every browser and phone of these players that asked for notifications, if they
// want that kind, a few at a time.
func (s *Server) notify(ctx context.Context, kind pushKind, m push.Message, userIDs ...int64) {
	if (s.push == nil && s.phones == nil) || len(userIDs) == 0 {
		return
	}
	// A target is a browser's subscription or a phone's token (with its platform).
	type target struct {
		sub      push.Subscription
		platform string
		token    string
	}
	want := func(alias string) string {
		if kind == pushAsked {
			return ""
		}
		return ` AND ` + wants(kind, alias+".user_id")
	}
	var targets []target
	for _, id := range userIDs {
		rows, err := s.db.Read.QueryContext(ctx, `SELECT endpoint, p256dh, auth, '', '' FROM push_subs b WHERE user_id = ?`+want("b")+`
			UNION ALL SELECT '', '', '', platform, token FROM phones f WHERE user_id = ?`+want("f"), id, id)
		if err != nil {
			slog.Error("push", "err", err)
			return
		}
		for rows.Next() {
			var t target
			if rows.Scan(&t.sub.Endpoint, &t.sub.Keys.P256dh, &t.sub.Keys.Auth, &t.platform, &t.token) == nil {
				targets = append(targets, t)
			}
		}
		rows.Close()
	}
	// Counted by kind (play/measure.go): the notifications delivered, and the browsers and phones found gone.
	m.Kind = kind.name()
	var sent, gone atomic.Int64
	defer func() {
		for key, n := range map[string]int64{"push:sent:" + m.Kind: sent.Load(), "push:gone:" + m.Kind: gone.Load()} {
			if n > 0 {
				_ = s.game.Tally(context.WithoutCancel(ctx), key, int(n))
			}
		}
	}()
	work := make(chan target)
	var wg sync.WaitGroup
	for range min(8, len(targets)) {
		wg.Go(func() {
			for t := range work {
				var err error
				switch {
				case t.token != "" && s.phones != nil:
					err = s.phones.Send(ctx, t.platform, t.token, m)
					if errors.Is(err, push.ErrGone) {
						_, _ = s.db.Write.ExecContext(ctx, `DELETE FROM phones WHERE token = ?`, t.token)
					}
				case t.token == "" && s.push != nil:
					err = s.push.Send(ctx, t.sub, m)
					if errors.Is(err, push.ErrGone) {
						_, _ = s.db.Write.ExecContext(ctx, `DELETE FROM push_subs WHERE endpoint = ?`, t.sub.Endpoint)
					}
				}
				switch {
				case err == nil:
					sent.Add(1)
				case errors.Is(err, push.ErrGone):
					gone.Add(1)
				default:
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
	if s.push == nil && s.phones == nil {
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
	rows, err := s.db.Read.QueryContext(ctx, `SELECT DISTINCT p.user_id FROM (SELECT user_id FROM push_subs
		UNION SELECT user_id FROM phones) p WHERE `+wants(pushDay, "p.user_id")+`
		AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.user_id = p.user_id AND r.kind = 'day' AND r.day = ?
		AND r.finished_at IS NOT NULL)`, today)
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
		s.notify(ctx, pushDay, s.reminder(ctx, today, id), id)
	}
	slog.Info("reminded", "players", len(users))
	return len(users)
}

// reminder is the evening's word to a player who hasn't played the day's questions: the best of their friends who have,
// and their streak; or, while none of their friends has, just the streak.
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

// days is a number of days in words: „1 ден“, „12 дни“.
func days(n int) string {
	if n == 1 {
		return "1 ден"
	}
	return fmt.Sprintf("%d дни", n)
}

// ratingWords is how a rating moved, with a real minus sign as the client writes it: „Рейтинг: +12.“, „Рейтинг: −8.“
func ratingWords(d int) string {
	switch {
	case d > 0:
		return fmt.Sprintf("Рейтинг: +%d.", d)
	case d < 0:
		return fmt.Sprintf("Рейтинг: −%d.", -d)
	}
	return "Рейтингът ти не се промени."
}

// problemsSubject is the subject of the mail about new problems: „1 нов проблем“, „3 нови проблема“.
func problemsSubject(n int) string {
	if n == 1 {
		return "АЛМАНАХ: 1 нов проблем"
	}
	return fmt.Sprintf("АЛМАНАХ: %d нови проблема", n)
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
