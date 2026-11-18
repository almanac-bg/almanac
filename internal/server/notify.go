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

// A player's devices are few: a session is one browser's (account), so it keeps one subscription and one phone's
// token, the last it told; and a player keeps pushDevices of each, the newest. Each is told again at most
// pushTellsPerHour times an hour by a player, pushTellsPerNet from a network (clientNet): the app tells its token at every start.
const (
	pushDevices      = 5
	pushTellsPerHour = 60
	pushTellsPerNet  = 600
	pushTellsPerSite = 3000 // a site (/48, /24) is many networks: five of them at full use, as the other limits count
)

// mayTell says whether a player may tell a device now (pushTellsPerHour, pushTellsPerNet, pushTellsPerSite).
func (s *Server) mayTell(r *http.Request, userID int64) bool {
	return s.limits.allow("push:user:"+strconv.FormatInt(userID, 10), pushTellsPerHour, time.Hour) &&
		s.allowFrom(r, "push:net", pushTellsPerNet, pushTellsPerSite, time.Hour)
}

// keepDevice keeps a device told by a session (an upsert into table, keyed by column), and makes it the session's
// only one there, and its player's only pushDevices there.
func (s *Server) keepDevice(ctx context.Context, table, column, key string, userID int64, session []byte, upsert string, args ...any) error {
	return s.db.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, upsert, args...); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE session = ? AND `+column+` <> ?`, session, key); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE user_id = ?1 AND `+column+` NOT IN (SELECT `+column+`
			FROM `+table+` WHERE user_id = ?1 ORDER BY created_at DESC, `+column+` LIMIT ?2)`, userID, pushDevices)
		return err
	})
}

// subscribe keeps a browser's push subscription, for its player, tied to the browser's session: it ends with it
// (account), and is the session's one (keepDevice). Told again, it's tied to the session the browser has now.
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
	session := account.SessionKey(s.session(r))
	err = s.keepDevice(r.Context(), "push_subs", "endpoint", sub.Endpoint, u.ID, session, `INSERT INTO push_subs (endpoint,
		user_id, session, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET
		user_id = excluded.user_id, session = excluded.session, p256dh = excluded.p256dh, auth = excluded.auth`,
		sub.Endpoint, u.ID, session, sub.Keys.P256dh, sub.Keys.Auth, store.Now())
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
// player allows notifications, and again whenever it opens (a token can change). Like a browser's subscription, it's
// tied to the app's session, and ends with it; and it's the session's one (keepDevice).
func (s *Server) addPhone(w http.ResponseWriter, r *http.Request) error {
	u, err := s.mustUser(r)
	if err != nil {
		return err
	}
	if s.phones == nil {
		return errNotFound
	}
	if !s.mayTell(r, u.ID) {
		return errTooMany
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
	session := account.SessionKey(s.session(r))
	err = s.keepDevice(r.Context(), "phones", "token", in.Token, u.ID, session, `INSERT INTO phones (token, user_id,
		session, platform, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id,
		session = excluded.session, platform = excluded.platform`,
		in.Token, u.ID, session, in.Platform, store.Now())
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
	// pushDay is the reminder of the day's questions, at the player's own hour (remind.go).
	pushDay pushKind = "day"
	// pushFriends is word from people and of games played: someone asks to be friends by one's link, a friend calls
	// to a duel (those from people go through notifyFrom: capped, never from one blocked), how a duel
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

// unratedWords say why a duel between two people moved no rating (play.DuelView.Unrated), as a notification tells
// it; the client says the same on the duel's result (screens/outcome.ts).
var unratedWords = map[string]string{
	"again":     "Дуел без рейтинг: днес вече сте играли.",
	"network":   "Дуел без рейтинг: играете от една и съща мрежа.",
	"newcomers": "Дуел без рейтинг: с нови играчи рейтингът се променя до пет пъти на ден.",
	"known":     "Дуел без рейтинг: някой друг вече беше изиграл това предизвикателство.",
}

// problemsSubject is the subject of the mail about new problems: „1 нов проблем“, „3 нови проблема“.
func problemsSubject(n int) string {
	if n == 1 {
		return "АЛМАНАХ: 1 нов проблем"
	}
	return fmt.Sprintf("АЛМАНАХ: %d нови проблема", n)
}

// place is a player's place among others, said of the place so that it reads the same to everyone: „3-то място от 12“.
func place(n, of int) string { return fmt.Sprintf("%s място от %d", ordinal(n, ordNeuter), of) }

// The endings of an ordinal's word (ordinal): a neuter one („място“: 1-во), a feminine one („седмица“: 1-ва), and a
// masculine one with its article („на 1-вия ден“).
const (
	ordNeuter    = "о"
	ordFeminine  = "а"
	ordMasculine = "ия"
)

// ordinal is n as an ordinal in digits, as Bulgarian writes it, with its word's ending (ordNeuter and the others): the
// letters after the number's own stem, 1-во, 2-ро, 3-то, 4-то, 5-о … 11-о … 21-во, 100-тно, 1000-но; 1-ва, 5-а;
// 1-вия, 2-рия, 5-ия.
func ordinal(n int, end string) string {
	switch tens := n % 100; {
	case n > 0 && n%1000 == 0:
		end = "н" + end
	case n > 0 && tens == 0:
		end = "тн" + end
	case tens >= 11 && tens <= 19:
	case n%10 == 1:
		end = "в" + end
	case n%10 == 2:
		end = "р" + end
	case n%10 == 3, n%10 == 4:
		end = "т" + end
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
