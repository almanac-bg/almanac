package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/store"
)

// A player's browsers are few: a session is one browser's (account), so it keeps one subscription, the last it told;
// and a player keeps pushDevices, the newest. A subscription is told at most pushTellsPerHour times an hour by a
// player, pushTellsPerNet from a network (clientNet).
const (
	pushDevices      = 5
	pushTellsPerHour = 60
	pushTellsPerNet  = 600
	pushTellsPerSite = 3000 // a site (/48, /24) is many networks: five of them at full use, as the other limits count
)

// mayTell says whether a player may tell a subscription now (pushTellsPerHour, pushTellsPerNet, pushTellsPerSite).
func (s *Server) mayTell(r *http.Request, userID int64) bool {
	return s.limits.allow("push:user:"+strconv.FormatInt(userID, 10), pushTellsPerHour, time.Hour) &&
		s.allowFrom(r, "push:net", pushTellsPerNet, pushTellsPerSite, time.Hour)
}

// keepSubscription keeps a browser's subscription told by a session, and makes it the session's only one, and one of
// its player's newest pushDevices.
func (s *Server) keepSubscription(ctx context.Context, sub push.Subscription, userID int64, session []byte) error {
	return s.db.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO push_subs (endpoint, user_id, session, p256dh, auth, created_at)
			VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id,
			session = excluded.session, p256dh = excluded.p256dh, auth = excluded.auth`,
			sub.Endpoint, userID, session, sub.Keys.P256dh, sub.Keys.Auth, store.Now()); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM push_subs WHERE session = ? AND endpoint <> ?`, session, sub.Endpoint); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM push_subs WHERE user_id = ?1 AND endpoint NOT IN (SELECT endpoint
			FROM push_subs WHERE user_id = ?1 ORDER BY created_at DESC, endpoint LIMIT ?2)`, userID, pushDevices)
		return err
	})
}

// subscribe keeps a browser's push subscription, for its player, tied to the browser's session: it ends with it
// (account), and is the session's one (keepSubscription). Told again, it's tied to the session the browser has now.
func (s *Server) subscribe(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if s.push == nil {
		return errNotFound
	}
	if !s.mayTell(r, u.ID) {
		return errTooMany
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
	if err := s.keepSubscription(r.Context(), sub, u.ID, account.SessionKey(s.session(r))); err != nil {
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

// pushKind is what a notification is about. Each player chooses which kinds they get (push_prefs); a kind they
// haven't chosen for is at its default.
type pushKind string

const (
	// pushDay is the reminder of the day's questions, at the player's own hour (remind.go).
	pushDay pushKind = "day"
	// pushFriends is word from people: someone asks to be friends (it goes through notifyFrom: capped).
	pushFriends pushKind = "friends"
)

// pushKinds are the kinds a player chooses, with their defaults.
var pushKinds = map[pushKind]bool{pushDay: true, pushFriends: true}

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

// days is a number of days in words: „1 ден“, „12 дни“.
func days(n int) string {
	if n == 1 {
		return "1 ден"
	}
	return fmt.Sprintf("%d дни", n)
}

// problemsSubject is the subject of the mail about new problems: „1 нов проблем“, „3 нови проблема“.
func problemsSubject(n int) string {
	if n == 1 {
		return "АЛМАНАХ: 1 нов проблем"
	}
	return fmt.Sprintf("АЛМАНАХ: %d нови проблема", n)
}

// pushKey is what a browser subscribes with (empty: no notifications here).
func (s *Server) pushKey() string {
	if s.push == nil {
		return ""
	}
	return s.push.Keys.Public
}
