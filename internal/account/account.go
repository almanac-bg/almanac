// Package account is who plays: guests who start at once, the email code that keeps an account across devices, the
// one-time link that brings a game from an app's own browser to the phone's (Handoff), the sessions that keep a
// browser signed in, and names.
//
// A session is one browser's (or one phone's app's): nobody else gets it. The notifications turned on in a browser
// (push_subs and phones) are tied to the session that turned them on, and end with it. A browser signing in by email
// (Verify) gets a new session in place of the one it had, and its notifications go along to the new one. A handoff
// moves a game, it doesn't share it: the browser it came from is signed out. When a guest becomes a profile, every
// other session the guest had ends: only the browser that proved the email is in it. SignOutOthers ends a player's
// other sessions on demand. A guest who never plays is cleared after a few days unused (CleanUp), so that guests
// made and dropped don't stay.
//
// A sign-in code is the browser's that asked for it (SendCode gives it a token, which it keeps in a cookie): only that
// browser can try it, so nobody else can guess at it, use up its tries or replace it, and a player's own sign-in
// never waits on what others do with their address. What could still be guessed at is a code someone asks for with a
// player's address, mailed to the player: the wrong codes given for an address, from every browser, are counted in
// the database (Misses within MissesKept), and past them the address's codes are long (LongCodeDigits) instead of
// refused, so guessing gets nowhere and the player still signs in. Code mails are urgent in the outbox (sent first,
// dropped once dead), and there are at most CodesAMinute of them, apart for addresses with a profile and new ones.
package account

import (
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
	"unicode"
	"unicode/utf8"

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

// Drawn is whether the player still has the name drawn for them (createUser): their animal and three digits. A room
// asks such a player for a name as they come in.
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

	// CodesAMinute is the most codes mailed a minute to addresses with a profile, and apart, to new ones: well past
	// what players need (a class saving its games at once), well under what one mail worker sends, so that codes never
	// queue past their time; and a flood of codes to made-up addresses can't stop players with a profile signing in.
	CodesAMinute = 30
)

// Errors a player may see.
var (
	ErrBadEmail    = errors.New("bad email")
	ErrTooSoon     = errors.New("a code was just sent")
	ErrBadCode     = errors.New("wrong code")
	ErrCodeExpired = errors.New("the code expired")
	ErrCodeTries   = errors.New("the code ran out of tries")
	ErrCodesBusy   = errors.New("the most codes a minute were mailed")
	ErrBadName     = errors.New("bad name")
	ErrBadTag      = errors.New("bad tag")
	ErrTagTaken    = errors.New("tag taken")
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

// Accounts does the work; Merge, if set, moves a guest's progress into the account they sign in to (each part of the
// game that keeps progress adds its step).
type Accounts struct {
	DB     *store.DB
	Outbox *mailer.Outbox
	// Secret keys the codes' hashes: a copy of the database alone can't check a guess.
	Secret []byte
	// Merge moves what guest `from` has into account `to`, inside the sign-in's transaction; `from` is deleted after.
	Merge []func(tx *sql.Tx, from, to int64) error
	// Unlimited lifts CodesAMinute, in development (as the server's limits are lifted there): the browser tests ask
	// for codes by the dozen.
	Unlimited bool

	// mailed counts the codes mailed this minute, to addresses with a profile [1] and new ones [0] (CodesAMinute):
	// kept in memory, as a restart losing a minute's count lets through at most a minute's more.
	mu     sync.Mutex
	minute int64
	mailed [2]int
}

// mailOne counts a code mailed to an address with a profile or a new one, if this minute has room for it.
func (a *Accounts) mailOne(profile bool, now time.Time) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if m := now.Unix() / 60; m != a.minute {
		a.minute, a.mailed = m, [2]int{}
	}
	i := 0
	if profile {
		i = 1
	}
	if a.mailed[i] >= CodesAMinute && !a.Unlimited {
		return false
	}
	a.mailed[i]++
	return true
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
// tied to (push_subs, phones), so that they end with it.
func SessionKey(token string) []byte { return hashToken(token) }

func startSession(tx *sql.Tx, userID int64) (string, error) {
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
	for _, q := range []string{
		`UPDATE push_subs SET session = ?, user_id = ? WHERE session = ?`,
		`UPDATE phones SET session = ?, user_id = ? WHERE session = ?`,
	} {
		if _, err := tx.Exec(q, hashToken(token), userID, hashToken(old)); err != nil {
			return "", err
		}
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
	for _, q := range []string{
		`DELETE FROM push_subs WHERE user_id = ? AND session IS NULL`,
		`DELETE FROM phones WHERE user_id = ? AND session IS NULL`,
	} {
		if _, err := tx.Exec(q, userID); err != nil {
			return 0, err
		}
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
	a := AnimalOf(u.ID)
	u.Name = a.Name + " " + digits(3)
	for range 50 {
		tag := a.Tag + digits(4)
		res, err := tx.Exec(`UPDATE OR IGNORE users SET name = ?, tag = ? WHERE id = ?`, u.Name, tag, u.ID)
		if err != nil {
			return User{}, err
		}
		if n, _ := res.RowsAffected(); n == 1 {
			u.Tag = tag
			return u, nil
		}
	}
	_, err := tx.Exec(`UPDATE users SET name = ? WHERE id = ?`, u.Name, u.ID) // every tag of the animal taken: keep "new…"
	return u, err
}

// Session finds who a token signs in, and keeps the session alive while it's used.
func (a *Accounts) Session(ctx context.Context, token string) (*User, error) {
	if token == "" {
		return nil, nil
	}
	hash := hashToken(token)
	var u User
	var email sql.NullString
	var seen, expires int64
	err := a.DB.Read.QueryRowContext(ctx, `SELECT u.id, u.name, u.tag, u.email, u.admin, s.seen_at, s.expires_at
		FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, hash,
	).Scan(&u.ID, &u.Name, &u.Tag, &email, &u.Admin, &seen, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if expires <= store.Ms(now) {
		return nil, nil
	}
	u.Email = email.String
	// Once a day at most: a write per request would be a write per request.
	if store.Ms(now)-seen > int64(24*time.Hour/time.Millisecond) {
		// Two statements, not one Exec: the driver binds each statement of a multi-statement Exec from the first
		// argument, so the second never matched.
		_, err := a.DB.Write.ExecContext(ctx, `UPDATE sessions SET seen_at = ?, expires_at = ? WHERE token_hash = ?`,
			store.Ms(now), store.Ms(now.AddDate(0, 0, SessionDays)), hash)
		if err != nil {
			return nil, err
		}
		if _, err := a.DB.Write.ExecContext(ctx, `UPDATE users SET seen_at = ? WHERE id = ?`, store.Ms(now), u.ID); err != nil {
			return nil, err
		}
	}
	return &u, nil
}

// Delete deletes a player and, with them, everything of theirs (sessions; runs and answers through the schema).
func (a *Accounts) Delete(ctx context.Context, userID int64) error {
	_, err := a.DB.Write.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, userID)
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

// cleanBatch is how many players CleanUp deletes in one statement: a flood's worth of guests goes in many short
// writes, with the game's own between them, not in one that holds the writer for seconds.
const cleanBatch = 500

// CleanUp drops expired sessions, codes and handoffs, the wrong codes counted for an address once their stretch is
// over (MissesKept), and the guests nobody can use or does: those whose sessions are gone (nothing of theirs can come
// back), and those who never played nor have a friend, unseen for IdleGuestDays. Their days played stay counted
// (play.Retention: active_days keeps no link to a player).
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
	idle := store.Ms(time.Now().AddDate(0, 0, -IdleGuestDays))
	for _, q := range []struct {
		where string
		args  []any
	}{
		{`NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id)`, nil},
		{`u.seen_at < ? AND u.created_at < ?
			AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.user_id = u.id)
			AND NOT EXISTS (SELECT 1 FROM friends f WHERE f.user_id = u.id)
			AND NOT EXISTS (SELECT 1 FROM friend_requests q WHERE q.from_id = u.id)
			AND NOT EXISTS (SELECT 1 FROM friend_requests q WHERE q.to_id = u.id)`, []any{idle, idle}},
	} {
		for {
			res, err := a.DB.Write.ExecContext(ctx, `DELETE FROM users WHERE id IN (SELECT u.id FROM users u
				WHERE u.email IS NULL AND `+q.where+` LIMIT `+strconv.Itoa(cleanBatch)+`)`, q.args...)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n < cleanBatch {
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
// code, maybe ""). That browser's last code is replaced, and its mail dropped if it hasn't gone yet; while it's alive
// and to the same address, not within CodeEvery (TooSoon). Nobody else's code is touched: each browser has its own.
// The code is long once the address has had Misses wrong codes (LongCodeDigits); past CodesAMinute, none goes
// (ErrCodesBusy).
func (a *Accounts) SendCode(ctx context.Context, email, asked string) (Asked, error) {
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
		var profile bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM users WHERE email = ?)`, email).Scan(&profile); err != nil {
			return err
		}
		if !a.mailOne(profile, now) {
			return ErrCodesBusy
		}
		code := newCode(out.Digits)
		mail, err := a.Outbox.Urgent(tx, codeMail(email, code), now.Add(CodeTTL))
		if err != nil {
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
		fmt.Sprintf("Важи %d минути и само там, където го поиска. ", int(CodeTTL/time.Minute)) +
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
	_, err := tx.Exec(`DELETE FROM users WHERE id = ?`, from)
	return err
}

// HandoffTTL is how long a handoff's link works (once).
const HandoffTTL = 30 * time.Minute

// HandoffsKept is how many of a player's handoff links work at once: a newer one leaves the last few working, so
// that the link copied a moment ago isn't dead by the time it's pasted.
const HandoffsKept = 3

var (
	// ErrNoHandoff is a handoff's link that doesn't work: used, out of time, never made, or not a guest's.
	ErrNoHandoff = errors.New("no such handoff")
	// ErrHandoffSignedIn is a guest's game brought to a browser signed in to a profile: it isn't joined to it by a
	// link (a link from someone else would join their game, and their phone, to this profile), only by signing in
	// with the email where the game is.
	ErrHandoffSignedIn = errors.New("a handoff to a profile")
)

// Handoff makes the token of a link that brings a guest's game to another browser, once, within HandoffTTL: how a
// game begun in an app's own browser (Messenger, Instagram …), which a guest's game would never leave, moves to the
// phone's browser. Only a guest's: a profile moves by signing in with its email, and a link to it would sign in
// whoever it reached.
func (a *Accounts) Handoff(ctx context.Context, userID int64) (string, error) {
	token, hash := newToken()
	err := a.DB.Tx(ctx, func(tx *sql.Tx) error {
		var guest bool
		if err := tx.QueryRow(`SELECT email IS NULL FROM users WHERE id = ?`, userID).Scan(&guest); err != nil {
			return err
		}
		if !guest {
			return ErrNoHandoff
		}
		if _, err := tx.Exec(`DELETE FROM handoffs WHERE expires_at <= ? OR token_hash IN (SELECT token_hash
				FROM handoffs WHERE user_id = ? ORDER BY expires_at DESC LIMIT -1 OFFSET ?)`,
			store.Now(), userID, HandoffsKept-1); err != nil {
			return err
		}
		// Each later than the player's last, if only by a millisecond: which are the last few is never a tie.
		_, err := tx.Exec(`INSERT INTO handoffs (token_hash, user_id, expires_at) VALUES (?1, ?2,
				max(?3, (SELECT coalesce(max(expires_at), 0) + 1 FROM handoffs WHERE user_id = ?2)))`,
			hash, userID, store.Ms(time.Now().Add(HandoffTTL)))
		return err
	})
	return token, err
}

// TakeHandoff brings the game of the guest who made a handoff's token (from) to the browser of session (its token,
// maybe ""), once. The game moves, it isn't shared: every session `from` had ends, with the notifications of its
// browsers and its other links, so the browser it came from is signed out (whoever made a link that reached someone
// else keeps no way into the game it gave away). With no one here, the browser becomes `from`, with a new session;
// with a guest here, the game brought along is folded into it, as signing in by email joins them. A profile here
// isn't joined by a link (ErrHandoffSignedIn). The session token is "" when the browser keeps the one it has.
func (a *Accounts) TakeHandoff(ctx context.Context, token, session string) (User, string, error) {
	var u User
	var started string
	err := a.DB.Tx(ctx, func(tx *sql.Tx) error {
		var from User
		var email sql.NullString
		err := tx.QueryRow(`SELECT u.id, u.name, u.tag, u.email, u.admin FROM handoffs h JOIN users u ON u.id = h.user_id
			WHERE h.token_hash = ? AND h.expires_at > ?`, hashToken(token), store.Now()).
			Scan(&from.ID, &from.Name, &from.Tag, &email, &from.Admin)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && email.Valid) { // a profile's (made before only guests'): none
			return ErrNoHandoff
		}
		if err != nil {
			return err
		}
		current, err := sessionUser(tx, session)
		if err != nil {
			return err
		}
		if current != nil && current.ID != from.ID && !current.Guest() {
			return ErrHandoffSignedIn // the link stays good, for the browser it was meant for
		}
		if current != nil && current.ID == from.ID { // opened where it was made: nothing moves
			_, err := tx.Exec(`DELETE FROM handoffs WHERE token_hash = ?`, hashToken(token))
			u = *current
			return err
		}
		// The game leaves where it was: its sessions (and their notifications), and every link to it.
		if _, err := endSessions(tx, from.ID, nil); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM handoffs WHERE user_id = ?`, from.ID); err != nil {
			return err
		}
		if current == nil {
			u = from
			started, err = startSession(tx, u.ID)
			return err
		}
		u = *current
		return a.fold(tx, from.ID, current.ID)
	})
	if err != nil {
		return User{}, "", err
	}
	return u, started, nil
}

// Rename gives a player a new name (anyone's: names may repeat; the tag tells players apart).
func (a *Accounts) Rename(ctx context.Context, userID int64, name string) (string, error) {
	name, err := NormalName(name)
	if err != nil {
		return "", err
	}
	_, err = a.DB.Write.ExecContext(ctx, `UPDATE users SET name = ? WHERE id = ?`, name, userID)
	return name, err
}

// Retag gives a player a new tag, if it's free.
func (a *Accounts) Retag(ctx context.Context, userID int64, tag string) (string, error) {
	tag, err := NormalTag(tag)
	if err != nil {
		return "", err
	}
	_, err = a.DB.Write.ExecContext(ctx, `UPDATE users SET tag = ? WHERE id = ?`, tag, userID)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return "", ErrTagTaken
	}
	return tag, err
}

const (
	NameMin = 2
	NameMax = 30
	TagMin  = 3
	TagMax  = 20
)

// NormalTag is a tag as it's kept — 3 to 20 latin letters, digits and underscores, starting with a letter,
// lowercase, without the @ it's written with — or ErrBadTag.
func NormalTag(s string) (string, error) {
	s = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(s), "@"))
	if len(s) < TagMin || len(s) > TagMax || s[0] < 'a' || s[0] > 'z' || reserved[s] {
		return "", ErrBadTag
	}
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
			return "", ErrBadTag
		}
	}
	return s, nil
}

// NormalName is a name as players see it — 2 to 30 letters, digits, single spaces, dots, dashes and underscores — or
// ErrBadName.
func NormalName(s string) (string, error) {
	s = strings.Join(strings.Fields(s), " ")
	n := utf8.RuneCountInString(s)
	if n < NameMin || n > NameMax {
		return "", ErrBadName
	}
	letters := 0
	for _, r := range s {
		switch {
		case unicode.IsLetter(r):
			letters++
		case unicode.IsDigit(r), r == ' ', r == '.', r == '-', r == '_':
		default:
			return "", ErrBadName
		}
	}
	if letters == 0 || reserved[strings.ToLower(s)] {
		return "", ErrBadName
	}
	return s, nil
}

var reserved = map[string]bool{
	"алманах": true, "almanac": true, "admin": true, "админ": true, "администратор": true, "administrator": true,
	"support": true, "help": true, "root": true, "system": true,
}

// Animal is what a new player starts as, until they choose: a name (with a number), a tag (with digits) and the
// avatar of the same animal.
type Animal struct {
	Name  string // in Bulgarian, as players read it
	Tag   string // in Latin letters, as tags are
	Shape string // the avatar's shape (play.FreeShapes, in the same order)
}

// Animals are what new players start as: the free avatars' animals, in play.FreeShapes's order (a test keeps it).
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
