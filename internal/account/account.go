// Package account is who plays: guests who start at once, the email code that keeps an account across devices, the
// one-time link that brings a game from an app's own browser to the phone's (Handoff: handoff.go), the sessions that
// keep a browser signed in, and names.
//
// A session is one browser's: nobody else gets it. The notifications turned on in a browser (push_subs) are tied to
// the session that turned them on, and end with it. A browser signing in by email
// (Verify) gets a new session in place of the one it had, and its notifications go along to the new one. A handoff
// shares a guest's game with the phone's browser: the app's browser it came from stays signed in, and the one it
// comes to becomes the same guest with a session of its own, if it had no game of its own (a link joins no two games:
// only an email does). When a guest
// becomes a profile, every other session the guest had ends (the app's browser a handoff came from too): only the
// browser that proved the email is in it. SignOutOthers ends a player's
// other sessions on demand. A player suspended by whoever keeps the game (Suspend) loses every session and gets no new
// one until it's lifted (a guest so left without a session stays all the same, for as long as a session would have
// lasted: CleanUp); names are checked against fakes of the game's own (names.go). A guest who never plays is
// cleared after a few days unused (CleanUp), so that guests made and dropped don't stay.
//
// A player goes one way, whether they delete their account, are a guest cleared, a guest folded into an account, or a
// guest with nothing yet whose browser a game is brought to (remove): what's theirs goes with them, others' history of them stays without them (the game's Forget), and their
// address goes from everywhere it's kept.
//
// A sign-in code is the browser's that asked for it (SendCode gives it a token, which it keeps in a cookie): only that
// browser can try it, so nobody else can guess at it, use up its tries or replace it, and a player's own sign-in
// never waits on what others do with their address. What could still be guessed at is a code someone asks for with a
// player's address, mailed to the player: the wrong codes given for an address, from every browser, are counted in
// the database (Misses within MissesKept), and past them the address's codes are long (LongCodeDigits) instead of
// refused, so guessing gets nowhere and the player still signs in. Code mails are urgent in the outbox (sent first,
// dropped once dead). How many go is bounded so that nobody's flood stops others signing in: each site (a network the
// server names) has its share of each minute (CodesAMinute, apart for addresses with a profile and new ones), each
// address a few codes an hour and a day from anywhere (CodesPerAddressHour, counted in the database), and an address
// mail doesn't reach gets none (mail.Suppressed).
package account

import (
	"cmp"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/mail"
	"strconv"
	"strings"
	"sync"
	"time"

	mailer "github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/store"
)

// User is a player: a name of their choosing (anyone's, since names may repeat) and a tag that is theirs alone
// (@tag), by which friends find them.
type User struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Tag   string `json:"tag"`
	Email string `json:"email,omitempty"`
	Admin bool   `json:"admin,omitempty"`
}

// Guest is a player without an email yet: their progress lives on this browser only.
func (u *User) Guest() bool { return u.Email == "" }

// Drawn is whether the player still has the name drawn for them (createUser): their animal and three digits.
func (u User) Drawn() bool {
	rest, ok := strings.CutPrefix(u.Name, AnimalOf(u.ID).Name+" ")
	if !ok || len(rest) != 3 {
		return false
	}
	return strings.Trim(rest, "0123456789") == ""
}

// MarshalJSON is a player as their own screen knows them: with Drawn, wherever they're sent.
func (u User) MarshalJSON() ([]byte, error) {
	type plain User
	return json.Marshal(struct {
		plain
		Drawn bool `json:"drawn,omitempty"`
	}{plain(u), u.Drawn()})
}

const (
	// SessionDays is how long a session lasts unused; each day it's used pushes the end back (browsers keep a cookie
	// at most 400 days).
	SessionDays = 400
	// CodeTTL is how long a code works: time for a slow mail, not for a guess at leisure.
	CodeTTL = 15 * time.Minute
	// CodeTries is how many times the browser a code is for may try it: a typo or two, not a search.
	CodeTries = 5
	// CodeEvery is the least time between two codes to one browser and address.
	CodeEvery = time.Minute

	// CodeDigits is how long a code is, while its address has had fewer than Misses wrong codes within MissesKept
	// (from every browser, counted in the database, so no restart forgets them). A guesser gets at most Misses tries at
	// a short code a stretch: 10 × 12 in a year of a million codes, about 1 in 8000 a year for the most persistent.
	CodeDigits = 6
	Misses     = 10
	MissesKept = 30 * 24 * time.Hour
	// LongCodeDigits is how long an address's codes are past Misses: nobody is locked out by others' wrong guesses,
	// their code is longer. Even every code the game may mail to one address (CodesAMinute, each CodeTries tries) is
	// about 8 × 10⁷ guesses a year against 10¹²: under 1 in 10 000 for a guesser who takes all of them, all year.
	LongCodeDigits = 12

	// CodesAMinute is how many codes a minute go to addresses with a profile, and apart, to new ones, while every
	// site has its share: a flood of codes to made-up addresses can't stop players with a profile signing in. A site
	// (an IPv6 /48, an IPv4 /24: whatever the caller counts as one) takes at most SiteShare of them: most of a class
	// saving its games at once from its school's one address (the rest the next minute), while no one site takes the
	// whole minute. Past CodesAMinute, a site's first code of the minute still goes, up to CodesAMinuteMost: so filling
	// the minute stops nobody else, unless it's done from that many sites at once (review 2026-11-18, S5). The mail
	// worker sends one at a time, a few a second at best, so in a flood the codes queue: those of a site that asked for
	// many go after everyone else's (mail.Outbox.Urgent's rank), and they are the ones that die unsent.
	CodesAMinute     = 30
	SiteShare        = 20
	CodesAMinuteMost = 90

	// CodesPerAddressHour and CodesPerAddressDay are the most codes mailed to one address, whoever asks and from
	// wherever, counted in the database: a player needs one, a second when the first is slow or lost among the spam,
	// one for each device they sign in on. Nobody can flood an inbox with codes from many networks, nor spend the
	// domain's good name on it; the price is that someone who knows a player's address can make them wait (an hour,
	// at worst until the day's codes are a day old) to sign in on a new device, while the codes in their inbox say
	// so (S5).
	CodesPerAddressHour = 4
	CodesPerAddressDay  = 12
)

// Errors a player may see.
var (
	ErrBadEmail    = errors.New("bad email")
	ErrTooSoon     = errors.New("a code was just sent")
	ErrBadCode     = errors.New("wrong code")
	ErrCodeExpired = errors.New("the code expired")
	ErrCodeTries   = errors.New("the code ran out of tries")
	ErrCodesBusy   = errors.New("the most codes a minute were mailed")
	ErrAddressBusy = errors.New("the most codes an hour or a day were mailed to the address")
	ErrNoMail      = errors.New("mail doesn't reach the address")
)

// WrongCode is a wrong code that may still be tried again: Left tries remain (ErrBadCode).
type WrongCode struct{ Left int }

func (e WrongCode) Error() string        { return fmt.Sprintf("wrong code, %d tries left", e.Left) }
func (e WrongCode) Is(target error) bool { return target == ErrBadCode }

// TooSoon is a code asked for while the browser's last one, to the same address, is still alive and was sent less
// than CodeEvery ago: another may go in Wait (ErrTooSoon).
type TooSoon struct{ Wait time.Duration }

func (e TooSoon) Error() string        { return fmt.Sprintf("a code was just sent, again in %v", e.Wait) }
func (e TooSoon) Is(target error) bool { return target == ErrTooSoon }

// Accounts does the work; Merge, if set, moves a guest's progress into the account they sign in to, and Forget keeps
// others' history of a player who goes (each part of the game that keeps them adds its step).
type Accounts struct {
	DB     *store.DB
	Outbox *mailer.Outbox
	// Secret keys the codes' hashes: a copy of the database alone can't check a guess.
	Secret []byte
	// Merge moves what guest `from` has into account `to`, inside the sign-in's transaction; `from` is deleted after.
	Merge []func(tx *sql.Tx, from, to int64) error
	// Forget is told of a player about to be deleted, inside the deletion's transaction (remove).
	Forget []func(tx *sql.Tx, id int64) error
	// Unlimited lifts CodesAMinute, in development (as the server's limits are lifted there): the browser tests ask
	// for codes by the dozen.
	Unlimited bool

	// mailed counts the codes mailed this minute, to addresses with a profile [1] and new ones [0], in all and by
	// site (CodesAMinute): kept in memory, as a restart losing a minute's count lets through at most a minute's more.
	mu     sync.Mutex
	minute int64
	mailed [2]minuteCount
}

// minuteCount is the codes mailed in a minute to one kind of address: in all, and by the site that asked.
type minuteCount struct {
	all    int
	bySite map[string]int
}

// mailOne counts a code mailed to an address with a profile or a new one, asked for from a site, if this minute has
// room for it (CodesAMinute, SiteShare, CodesAMinuteMost), and says how many the site has had this minute with it: its
// rank, by which the outbox sends codes (the fewest first).
func (a *Accounts) mailOne(profile bool, site string, now time.Time) (int, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if m := now.Unix() / 60; m != a.minute {
		a.minute, a.mailed = m, [2]minuteCount{}
	}
	c := &a.mailed[0]
	if profile {
		c = &a.mailed[1]
	}
	n := c.bySite[site]
	open := (c.all < CodesAMinute && n < SiteShare) || (c.all < CodesAMinuteMost && n == 0)
	if !open && !a.Unlimited {
		return n, false
	}
	if c.bySite == nil {
		c.bySite = map[string]int{}
	}
	c.all++
	c.bySite[site] = n + 1
	return n + 1, true
}

// addressBusy says whether an address has had its codes for the hour or the day (CodesPerAddressHour,
// CodesPerAddressDay).
func addressBusy(tx *sql.Tx, email string, now time.Time) (bool, error) {
	var hour, day int
	err := tx.QueryRow(`SELECT count(*) FILTER (WHERE at > ?), count(*) FROM code_mails WHERE email = ? AND at > ?`,
		store.Ms(now.Add(-time.Hour)), email, store.Ms(now.Add(-24*time.Hour))).Scan(&hour, &day)
	return hour >= CodesPerAddressHour || day >= CodesPerAddressDay, err
}

// newToken makes a session token (what the cookie holds) and the hash the database keeps.
func newToken() (token string, hash []byte) {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, hashToken(token)
}

func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// SessionKey is what a session is kept under (its token's hash): what the notifications turned on in its browser are
// tied to (push_subs), so that they end with it.
func SessionKey(token string) []byte { return hashToken(token) }

// startSession signs a browser in as a player: a new session, unless the player is suspended (ErrSuspended).
func startSession(tx *sql.Tx, userID int64) (string, error) {
	var suspended bool
	if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM suspensions WHERE user_id = ?)`, userID).Scan(&suspended); err != nil {
		return "", err
	}
	if suspended {
		return "", ErrSuspended
	}
	token, hash := newToken()
	now := time.Now()
	_, err := tx.Exec(`INSERT INTO sessions (token_hash, user_id, created_at, seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
		hash, userID, store.Ms(now), store.Ms(now), store.Ms(now.AddDate(0, 0, SessionDays)))
	return token, err
}

// sessionUser is who a browser's session (its token, maybe "") signs in: nil for no one, or a session that ended.
func sessionUser(tx *sql.Tx, token string) (*User, error) {
	if token == "" {
		return nil, nil
	}
	var u User
	var email sql.NullString
	err := tx.QueryRow(`SELECT u.id, u.name, u.tag, u.email, u.admin FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, hashToken(token), store.Now()).
		Scan(&u.ID, &u.Name, &u.Tag, &email, &u.Admin)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u.Email = email.String
	return &u, nil
}

// moveSession signs a browser in as player userID: a new session in place of the one it had (old, "" for none),
// which ends, and the notifications turned on in the browser come along, to the new session and its player.
func moveSession(tx *sql.Tx, old string, userID int64) (string, error) {
	token, err := startSession(tx, userID)
	if err != nil || old == "" {
		return token, err
	}
	if _, err := tx.Exec(`UPDATE push_subs SET session = ?, user_id = ? WHERE session = ?`,
		hashToken(token), userID, hashToken(old)); err != nil {
		return "", err
	}
	_, err = tx.Exec(`DELETE FROM sessions WHERE token_hash = ?`, hashToken(old))
	return token, err
}

// endSessions ends every session of a player but the one kept (keep, a SessionKey; nil: every one), and with them the
// notifications of their browsers (by the schema). A browser's notifications not tied to any session (turned on
// before they were tied, and not told to the server since) go too: whose they are, nobody can tell, and a browser of
// the player's own tells its own again (push.ts pushOn). It says how many sessions ended.
func endSessions(tx *sql.Tx, userID int64, keep []byte) (int, error) {
	q, args := `DELETE FROM sessions WHERE user_id = ?`, []any{userID}
	if keep != nil {
		q, args = q+` AND token_hash <> ?`, append(args, keep)
	}
	res, err := tx.Exec(q, args...)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if _, err := tx.Exec(`DELETE FROM push_subs WHERE user_id = ? AND session IS NULL`, userID); err != nil {
		return 0, err
	}
	return int(n), nil
}

// Guest makes a new guest with a session.
func (a *Accounts) Guest(ctx context.Context) (User, string, error) {
	var u User
	var token string
	err := a.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if u, err = createUser(tx, ""); err != nil {
			return err
		}
		token, err = startSession(tx, u.ID)
		return err
	})
	return u, token, err
}

// createUser makes a player with a name and a tag drawn for them, until they choose their own: one animal for both,
// the one their avatar starts as (Animals), and a number.
func createUser(tx *sql.Tx, email string) (User, error) {
	now := store.Now()
	var mail any
	if email != "" {
		mail = email
	}
	// The id picks the animal, so the player is made first, under a tag of its own, and named after.
	var u User
	for range 50 {
		tag := "new" + digits(9)
		res, err := tx.Exec(`INSERT INTO users (name, tag, email, created_at, seen_at) VALUES ('', ?, ?, ?, ?)
			ON CONFLICT (tag) DO NOTHING`, tag, mail, now, now)
		if err != nil {
			return User{}, err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			id, _ := res.LastInsertId()
			u = User{ID: id, Tag: tag, Email: email}
			break
		}
	}
	if u.ID == 0 {
		return User{}, errors.New("no free tag")
	}
	var err error
	u.Name, u.Tag, err = draw(tx, u.ID)
	return u, err
}

// draw gives a player the name and tag drawn for them: their animal (the one their avatar starts as: Animals) and a
// number. Every tag of the animal taken, the tag is "new" and nine digits.
func draw(tx *sql.Tx, id int64) (name, tag string, err error) {
	a := AnimalOf(id)
	name = a.Name + " " + digits(3)
	for i := range 60 {
		tag = a.Tag + digits(4)
		if i >= 50 {
			tag = "new" + digits(9)
		}
		res, err := tx.Exec(`UPDATE OR IGNORE users SET name = ?, tag = ? WHERE id = ?`, name, tag, id)
		if err != nil {
			return "", "", err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			return name, tag, nil
		}
	}
	return "", "", errors.New("no free tag")
}

// Session finds who a token signs in, and keeps the session alive while it's used: each day it's used (once a day at
// most) its end moves SessionDays on, and renewed says so, for the browser's cookie to move on with it.
func (a *Accounts) Session(ctx context.Context, token string) (*User, bool, error) {
	if token == "" {
		return nil, false, nil
	}
	hash := hashToken(token)
	var u User
	var email sql.NullString
	var seen, expires int64
	err := a.DB.Read.QueryRowContext(ctx, `SELECT u.id, u.name, u.tag, u.email, u.admin, s.seen_at, s.expires_at
		FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, hash,
	).Scan(&u.ID, &u.Name, &u.Tag, &email, &u.Admin, &seen, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	now := time.Now()
	if expires <= store.Ms(now) {
		return nil, false, nil
	}
	u.Email = email.String
	// Once a day at most: a write per request would be a write per request.
	renewed := store.Ms(now)-seen > int64(24*time.Hour/time.Millisecond)
	if renewed {
		// Two statements, not one Exec: the driver binds each statement of a multi-statement Exec from the first
		// argument, so the second never matched.
		_, err := a.DB.Write.ExecContext(ctx, `UPDATE sessions SET seen_at = ?, expires_at = ? WHERE token_hash = ?`,
			store.Ms(now), store.Ms(now.AddDate(0, 0, SessionDays)), hash)
		if err != nil {
			return nil, false, err
		}
		if _, err := a.DB.Write.ExecContext(ctx, `UPDATE users SET seen_at = ? WHERE id = ?`, store.Ms(now), u.ID); err != nil {
			return nil, false, err
		}
	}
	return &u, renewed, nil
}

// Delete deletes a player and, with them, everything of theirs (remove).
func (a *Accounts) Delete(ctx context.Context, userID int64) error {
	return a.DB.Tx(ctx, func(tx *sql.Tx) error { return a.remove(tx, userID) })
}

// remove deletes a player, inside the caller's transaction: every way a player goes (Delete, CleanUp, a guest folded
// into an account, a guest a game is brought to: TakeHandoff) comes here. What's theirs goes with them by the schema (ON DELETE CASCADE: sessions, runs and
// answers, friends, ...); what others keep of them is kept without them, by the schema (SET NULL: the other side of a
// duel) and by each part of the game's Forget, told first; and their address goes from wherever else it's kept: mail
// on its way to it, codes, wrong codes and codes mailed counted, and whether mail reaches it (mail.Unqueue).
func (a *Accounts) remove(tx *sql.Tx, id int64) error {
	var email sql.NullString
	if err := tx.QueryRow(`SELECT email FROM users WHERE id = ?`, id).Scan(&email); errors.Is(err, sql.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	for _, forget := range a.Forget {
		if err := forget(tx, id); err != nil {
			return err
		}
	}
	if email.Valid {
		for _, q := range []string{
			`DELETE FROM sign_in_codes WHERE email = ?`,
			`DELETE FROM code_misses WHERE email = ?`,
			`DELETE FROM code_mails WHERE email = ?`,
		} {
			if _, err := tx.Exec(q, email.String); err != nil {
				return err
			}
		}
		if err := mailer.Unqueue(tx, email.String); err != nil {
			return err
		}
	}
	_, err := tx.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

// SignOut ends a session, and the notifications turned on in its browser (by the schema).
func (a *Accounts) SignOut(ctx context.Context, token string) error {
	_, err := a.DB.Write.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, hashToken(token))
	return err
}

// SignOutOthers ends every session but this one (token) of the player it signs in: a phone lost, a computer left
// signed in. It says how many ended.
func (a *Accounts) SignOutOthers(ctx context.Context, token string) (int, error) {
	var n int
	err := a.DB.Tx(ctx, func(tx *sql.Tx) error {
		u, err := sessionUser(tx, token)
		if err != nil || u == nil {
			return err
		}
		n, err = endSessions(tx, u.ID, hashToken(token))
		return err
	})
	return n, err
}

// IdleGuestDays is how long a guest who never played (no game of any kind) nor has a friend is kept while unused.
// They'd lose nothing but a drawn name: a guest is made as a player first plays, so one without a game is someone
// who left at once, or a flood of guests made and dropped, which this keeps from staying for a session's 400 days.
const IdleGuestDays = 3

// cleanBatch is how many players CleanUp deletes in one transaction: a flood's worth of guests goes in many short
// writes, with the game's own between them, not in one that holds the writer for seconds.
const cleanBatch = 200

// EmailRequestDays is how long a friend request sent to an address is kept unanswered: the address is someone
// else's, given by a player, and not kept for good.
const EmailRequestDays = 60

// ReportDays is how long a question's report (what a player wrote of it) is kept once it has been seen to: a while,
// for a fix to be looked at again, and then not at all (the privacy page says so).
const ReportDays = 30

// hasGame is a SQL condition on a player (u) that they have something of their own to lose: a game of any kind, a
// friend, a friend request sent or waiting. A guest without one is nobody yet: one made and dropped (CleanUp), or a
// browser a game is brought to (TakeHandoff).
const hasGame = `(EXISTS (SELECT 1 FROM runs r WHERE r.user_id = u.id)
	OR EXISTS (SELECT 1 FROM friends f WHERE f.user_id = u.id)
	OR EXISTS (SELECT 1 FROM friend_requests q WHERE q.from_id = u.id)
	OR EXISTS (SELECT 1 FROM friend_requests q WHERE q.to_id = u.id))`

// CleanUp drops expired sessions, codes and handoffs, the wrong codes counted for an address once their stretch is
// over (MissesKept), the codes mailed counted once a day old, friend requests to an address older than
// EmailRequestDays, questions' reports seen to more than ReportDays ago, and the guests nobody can use or does: those whose sessions are gone (nothing of theirs can come
// back), and those who never played nor have a friend, unseen for IdleGuestDays; but not a guest suspended (Suspend ends
// their sessions, and keeps their games), until SessionDays after it, as long as a session would have lasted. Their
// days played stay counted, as nobody's (play.Forget).
func (a *Accounts) CleanUp(ctx context.Context) error {
	now := store.Now()
	for _, q := range []string{
		`DELETE FROM sessions WHERE expires_at <= ?`,
		`DELETE FROM sign_in_codes WHERE expires_at <= ?`,
		`DELETE FROM handoffs WHERE expires_at <= ?`,
	} {
		if _, err := a.DB.Write.ExecContext(ctx, q, now); err != nil {
			return err
		}
	}
	if _, err := a.DB.Write.ExecContext(ctx, `DELETE FROM code_misses WHERE since <= ?`,
		store.Ms(time.Now().Add(-MissesKept))); err != nil {
		return err
	}
	if _, err := a.DB.Write.ExecContext(ctx, `DELETE FROM code_mails WHERE at <= ?`,
		store.Ms(time.Now().Add(-24*time.Hour))); err != nil {
		return err
	}
	if _, err := a.DB.Write.ExecContext(ctx, `DELETE FROM friend_requests WHERE to_email IS NOT NULL AND at <= ?`,
		store.Ms(time.Now().AddDate(0, 0, -EmailRequestDays))); err != nil {
		return err
	}
	if _, err := a.DB.Write.ExecContext(ctx, `DELETE FROM reports WHERE resolved_at <= ?`,
		store.Ms(time.Now().AddDate(0, 0, -ReportDays))); err != nil {
		return err
	}
	idle := store.Ms(time.Now().AddDate(0, 0, -IdleGuestDays))
	suspended := store.Ms(time.Now().AddDate(0, 0, -SessionDays))
	for _, q := range []struct {
		where string
		args  []any
	}{
		{`NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id)`, nil},
		{`u.seen_at < ? AND u.created_at < ? AND NOT ` + hasGame, []any{idle, idle}},
	} {
		for {
			var n int
			err := a.DB.Tx(ctx, func(tx *sql.Tx) error {
				rows, err := tx.Query(`SELECT u.id FROM users u WHERE u.email IS NULL
					AND NOT EXISTS (SELECT 1 FROM suspensions x WHERE x.user_id = u.id AND x.at > ?)
					AND `+q.where+` LIMIT `+strconv.Itoa(cleanBatch), append([]any{suspended}, q.args...)...)
				if err != nil {
					return err
				}
				var ids []int64
				for rows.Next() {
					var id int64
					if err := rows.Scan(&id); err != nil {
						rows.Close()
						return err
					}
					ids = append(ids, id)
				}
				rows.Close()
				if err := rows.Err(); err != nil {
					return err
				}
				n = len(ids)
				for _, id := range ids {
					if err := a.remove(tx, id); err != nil {
						return err
					}
				}
				return nil
			})
			if err != nil {
				return err
			}
			if n < cleanBatch {
				break
			}
		}
	}
	return nil
}

// NormalEmail is an address as the game keeps it, or ErrBadEmail.
func NormalEmail(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || len(s) > 254 || !strings.Contains(s[strings.IndexByte(s, '@'):], ".") {
		return "", ErrBadEmail
	}
	return s, nil
}

func (a *Accounts) codeHash(email, code string) []byte {
	m := hmac.New(sha256.New, a.Secret)
	m.Write([]byte(email + "\x00" + code))
	return m.Sum(nil)
}

// Asked is a code on its way to an address, for the browser that asked: Token is what that browser keeps (a cookie,
// for CodeTTL), without which the code works nowhere; Digits is how long the code is.
type Asked struct {
	Token  string
	Digits int
}

// SendCode mails a sign-in code to an address, for the browser that asks (asked: the token it kept from its last
// code, maybe ""), from a site (the network the caller counts the browser's share of the minute by). That browser's
// last code is replaced, and its mail dropped if it hasn't gone yet; while it's alive and to the same address, not
// within CodeEvery (TooSoon). Nobody else's code is touched: each browser has its own. The code is long once the
// address has had Misses wrong codes (LongCodeDigits). None goes to an address mail doesn't reach (ErrNoMail), past
// the address's codes for the hour or the day (ErrAddressBusy), nor past the minute's (ErrCodesBusy).
func (a *Accounts) SendCode(ctx context.Context, email, asked, site string) (Asked, error) {
	email, err := NormalEmail(email)
	if err != nil {
		return Asked{}, err
	}
	token, asker := newToken()
	out := Asked{Token: token, Digits: CodeDigits}
	now := time.Now()
	err = a.DB.Tx(ctx, func(tx *sql.Tx) error {
		misses, err := missesOf(tx, email, now)
		if err != nil {
			return err
		}
		if misses >= Misses {
			out.Digits = LongCodeDigits
		}
		if err := a.replace(tx, asked, email, out.Digits, now); err != nil {
			return err
		}
		if off, err := mailer.Suppressed(tx, email, now); err != nil || off {
			return cmp.Or(err, ErrNoMail)
		}
		if busy, err := addressBusy(tx, email, now); err != nil || (busy && !a.Unlimited) {
			return cmp.Or(err, ErrAddressBusy)
		}
		var profile bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM users WHERE email = ?)`, email).Scan(&profile); err != nil {
			return err
		}
		rank, ok := a.mailOne(profile, site, now)
		if !ok {
			return ErrCodesBusy
		}
		code := newCode(out.Digits)
		mail, err := a.Outbox.Urgent(tx, codeMail(email, code), now.Add(CodeTTL), rank)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO code_mails (email, at) VALUES (?, ?)`, email, store.Ms(now)); err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO sign_in_codes (asker, email, code_hash, digits, sent_at, expires_at, mail)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			asker, email, a.codeHash(email, code), out.Digits, store.Ms(now), store.Ms(now.Add(CodeTTL)), mail)
		return err
	})
	if err != nil {
		return Asked{}, err
	}
	a.Outbox.Wake()
	return out, nil
}

// replace ends the last code of the browser that kept the token asked, as it asks for another (to email, of so many
// digits): not within CodeEvery while it's alive and to the same address (TooSoon; a short one is dead once the next
// is long), and its mail goes no more if it's still waiting.
func (a *Accounts) replace(tx *sql.Tx, asked, email string, digits int, now time.Time) error {
	if asked == "" {
		return nil
	}
	var to string
	var sent, expires int64
	var was, tries int
	var mail sql.NullInt64
	err := tx.QueryRow(`SELECT email, digits, sent_at, expires_at, tries, mail FROM sign_in_codes WHERE asker = ?`,
		hashToken(asked)).Scan(&to, &was, &sent, &expires, &tries, &mail)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	alive := to == email && expires > store.Ms(now) && tries < CodeTries && was >= digits
	if wait := CodeEvery - time.Duration(store.Ms(now)-sent)*time.Millisecond; alive && wait > 0 {
		return TooSoon{Wait: wait}
	}
	if mail.Valid {
		if err := a.Outbox.Drop(tx, mail.Int64); err != nil {
			return err
		}
	}
	_, err = tx.Exec(`DELETE FROM sign_in_codes WHERE asker = ?`, hashToken(asked))
	return err
}

// missesOf is how many wrong codes an address has had in its stretch of MissesKept.
func missesOf(tx *sql.Tx, email string, now time.Time) (int, error) {
	var n int
	err := tx.QueryRow(`SELECT misses FROM code_misses WHERE email = ? AND since > ?`,
		email, store.Ms(now.Add(-MissesKept))).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return n, err
}

// miss counts a wrong code given for an address: in its stretch, or as the first of a new one once MissesKept is out.
func miss(tx *sql.Tx, email string, now time.Time) error {
	_, err := tx.Exec(`INSERT INTO code_misses (email, misses, since) VALUES (?1, 1, ?2)
		ON CONFLICT (email) DO UPDATE SET
			misses = CASE WHEN since > ?3 THEN misses + 1 ELSE 1 END,
			since = CASE WHEN since > ?3 THEN since ELSE ?2 END`,
		email, store.Ms(now), store.Ms(now.Add(-MissesKept)))
	return err
}

// newCode is a code of n random digits.
func newCode(n int) string {
	most := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil)
	c, _ := rand.Int(rand.Reader, most)
	return fmt.Sprintf("%0*s", n, c.String())
}

// spaced is a code as a mail shows it: a long one in fours, to be read and typed in pieces.
func spaced(code string) string {
	if len(code) <= CodeDigits {
		return code
	}
	var b strings.Builder
	for i, r := range code {
		if i > 0 && i%4 == 0 {
			b.WriteByte(' ')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// onlyDigits is a code as it was typed or pasted, without the spaces (or anything else) between its digits.
func onlyDigits(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, s)
}

// codeMail is the mail that brings a code.
func codeMail(email, code string) mailer.Message {
	text := "Кодът ти за вход в АЛМАНАХ е:\n\n    " + spaced(code) + "\n\n" +
		fmt.Sprintf("Важи %d минути и само в браузъра, от който го поиска. ", int(CodeTTL/time.Minute)) +
		"Ако не очакваш такъв код, просто не обръщай внимание на писмото.\n\n"
	if len(code) > CodeDigits {
		text += "Този път кодът е по-дълъг: напоследък някой въвежда грешни кодове за този имейл.\n\n"
	}
	return mailer.Message{To: email, Subject: "Кодът ти за АЛМАНАХ: " + spaced(code), Text: text + "almanac.bg\n"}
}

// Proof is what signs a browser in by email: the address, the code mailed to it, and the token the browser kept when
// it asked for the code (Asked.Token).
type Proof struct{ Email, Code, Asked string }

// Verify checks a code and signs its address in, in the browser of session (its token, maybe ""), with a new session
// in place of that one (moveSession). Only the browser that asked for the code can (p.Asked): to any other, as once
// its time is out, there's no code (ErrCodeExpired). A wrong one counts a try (WrongCode, with the tries left) and a
// miss for the address; the last try used up, the code is dead (ErrCodeTries), and so is a short one once the address
// has had Misses (the next code is long). The player the browser was is kept when they can be: a guest giving a new
// address keeps their account, and every other session they had ends (one made anywhere else, before the email was
// proved here, must not come into the profile); a guest signing in to an account that has the address brings their
// progress along (Merge) and is gone after.
func (a *Accounts) Verify(ctx context.Context, p Proof, session string) (User, string, error) {
	email, err := NormalEmail(p.Email)
	if err != nil {
		return User{}, "", err
	}
	code := onlyDigits(p.Code)
	asker := hashToken(p.Asked)
	var u User
	var token string
	var wrong error
	err = a.DB.Tx(ctx, func(tx *sql.Tx) error {
		now := time.Now()
		var to string
		var hash []byte
		var digits, tries int
		var expires int64
		err := tx.QueryRow(`SELECT email, code_hash, digits, expires_at, tries FROM sign_in_codes WHERE asker = ?`,
			asker).Scan(&to, &hash, &digits, &expires, &tries)
		switch {
		case p.Asked == "", errors.Is(err, sql.ErrNoRows), err == nil && (to != email || expires <= store.Ms(now)):
			return ErrCodeExpired
		case err != nil:
			return err
		case tries >= CodeTries:
			return ErrCodeTries
		}
		misses, err := missesOf(tx, email, now)
		if err != nil {
			return err
		}
		short := digits < LongCodeDigits
		if short && misses >= Misses { // dead from now on, so that a new one goes at once
			wrong = ErrCodeTries
			_, err := tx.Exec(`UPDATE sign_in_codes SET tries = ? WHERE asker = ?`, CodeTries, asker)
			return err
		}
		if !hmac.Equal(hash, a.codeHash(email, code)) {
			wrong = WrongCode{Left: CodeTries - tries - 1}
			if tries+1 >= CodeTries || short && misses+1 >= Misses {
				wrong = ErrCodeTries
			}
			if err := miss(tx, email, now); err != nil {
				return err
			}
			_, err := tx.Exec(`UPDATE sign_in_codes SET tries = tries + 1 WHERE asker = ?`, asker)
			return err // the try counts: committed below, then the wrong code's error
		}
		if _, err := tx.Exec(`DELETE FROM sign_in_codes WHERE asker = ?`, asker); err != nil {
			return err
		}
		current, err := sessionUser(tx, session)
		if err != nil {
			return err
		}

		var owner User
		var fold, upgraded bool
		err = tx.QueryRow(`SELECT id, name, tag, admin FROM users WHERE email = ?`, email).
			Scan(&owner.ID, &owner.Name, &owner.Tag, &owner.Admin)
		switch {
		case err == nil:
			owner.Email = email
			fold = current != nil && current.Guest() && current.ID != owner.ID
			u = owner
		case errors.Is(err, sql.ErrNoRows) && current != nil && current.Guest():
			if _, err := tx.Exec(`UPDATE users SET email = ? WHERE id = ?`, email, current.ID); err != nil {
				return err
			}
			u = *current
			u.Email = email
			upgraded = true
		case errors.Is(err, sql.ErrNoRows):
			if u, err = createUser(tx, email); err != nil {
				return err
			}
		default:
			return err
		}
		// The browser's notifications move to its new session first: a guest folded away takes its sessions along.
		old := ""
		if current != nil {
			old = session
		}
		if token, err = moveSession(tx, old, u.ID); err != nil {
			return err
		}
		if upgraded {
			if _, err := endSessions(tx, u.ID, hashToken(token)); err != nil {
				return err
			}
		}
		if fold {
			return a.fold(tx, current.ID, owner.ID)
		}
		return nil
	})
	if wrong != nil && err == nil {
		err = wrong
	}
	if err != nil {
		return User{}, "", err
	}
	return u, token, nil
}

// fold moves what player `from` has into player `to` (Merge), and deletes `from`.
func (a *Accounts) fold(tx *sql.Tx, from, to int64) error {
	for _, merge := range a.Merge {
		if err := merge(tx, from, to); err != nil {
			return err
		}
	}
	return a.remove(tx, from)
}

// Animal is what a new player starts as, until they choose: a name (with a number), a tag (with digits) and the
// avatar of the same animal.
type Animal struct {
	Name  string // in Bulgarian, as players read it
	Tag   string // in Latin letters, as tags are
	Shape string // the avatar's shape (play.Starters, in the same order)
}

// Animals are what new players start as: the starters' animals, in play.Starters's order (a test keeps it).
var Animals = []Animal{
	{"Лисица", "fox", "fox"}, {"Мечка", "bear", "bear"}, {"Котка", "cat", "cat"}, {"Заек", "hare", "hare"},
	{"Таралеж", "hedgehog", "hedgehog"}, {"Куче", "dog", "dog"}, {"Елен", "deer", "deer"},
	{"Щъркел", "stork", "stork"}, {"Жаба", "frog", "frog"},
}

// AnimalOf is the animal a player starts as: the same one play.DefaultAvatar draws for them.
func AnimalOf(userID int64) Animal { return Animals[max(userID, 0)%int64(len(Animals))] }

// digits are n random digits, the first not a zero.
func digits(n int) string {
	lo := int64(1)
	for range n - 1 {
		lo *= 10
	}
	d, _ := rand.Int(rand.Reader, big.NewInt(9*lo))
	return fmt.Sprint(lo + d.Int64())
}
