// Package account is who plays: guests who start at once, the email code that keeps an account across devices, the
// sessions that keep a browser signed in, and names.
package account

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"net/mail"
	"strings"
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

const (
	// SessionDays is how long a session lasts unused; each day it's used pushes the end back (browsers keep a cookie
	// at most 400 days).
	SessionDays = 400
	CodeTTL     = 15 * time.Minute
	CodeTries   = 5
	// CodeEvery is the least time between two codes to one address.
	CodeEvery = time.Minute
)

// Errors a player may see.
var (
	ErrBadEmail    = errors.New("bad email")
	ErrTooSoon     = errors.New("a code was just sent")
	ErrBadCode     = errors.New("wrong code")
	ErrCodeExpired = errors.New("the code expired or ran out of tries")
	ErrBadName     = errors.New("bad name")
	ErrBadTag      = errors.New("bad tag")
	ErrTagTaken    = errors.New("tag taken")
)

// Accounts does the work; Merge, if set, moves a guest's progress into the account they sign in to (each part of the
// game that keeps progress adds its step).
type Accounts struct {
	DB     *store.DB
	Outbox *mailer.Outbox
	// Secret keys the codes' hashes: a copy of the database alone can't check a guess.
	Secret []byte
	// Merge moves what guest `from` has into account `to`, inside the sign-in's transaction; `from` is deleted after.
	Merge []func(tx *sql.Tx, from, to int64) error
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

func startSession(tx *sql.Tx, userID int64) (string, error) {
	token, hash := newToken()
	now := time.Now()
	_, err := tx.Exec(`INSERT INTO sessions (token_hash, user_id, created_at, seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
		hash, userID, store.Ms(now), store.Ms(now), store.Ms(now.AddDate(0, 0, SessionDays)))
	return token, err
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
		_, err := a.DB.Write.ExecContext(ctx, `UPDATE sessions SET seen_at = ?, expires_at = ? WHERE token_hash = ?;
			UPDATE users SET seen_at = ? WHERE id = ?`,
			store.Ms(now), store.Ms(now.AddDate(0, 0, SessionDays)), hash, store.Ms(now), u.ID)
		if err != nil {
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

// SignOut ends a session.
func (a *Accounts) SignOut(ctx context.Context, token string) error {
	_, err := a.DB.Write.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, hashToken(token))
	return err
}

// CleanUp drops expired sessions and codes, and guests nobody has used for a while (nothing of theirs can come back:
// their session is gone).
func (a *Accounts) CleanUp(ctx context.Context) error {
	now := time.Now()
	_, err := a.DB.Write.ExecContext(ctx, `
		DELETE FROM sessions WHERE expires_at <= ?;
		DELETE FROM email_codes WHERE expires_at <= ?;
		DELETE FROM users WHERE email IS NULL AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id);`,
		store.Ms(now), store.Ms(now))
	return err
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

// SendCode mails a sign-in code to an address. A new code replaces the one before.
func (a *Accounts) SendCode(ctx context.Context, email string) error {
	email, err := NormalEmail(email)
	if err != nil {
		return err
	}
	n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
	code := fmt.Sprintf("%06d", n.Int64())
	now := time.Now()
	err = a.DB.Tx(ctx, func(tx *sql.Tx) error {
		var sent int64
		err := tx.QueryRow(`SELECT sent_at FROM email_codes WHERE email = ?`, email).Scan(&sent)
		if err == nil && store.Ms(now)-sent < CodeEvery.Milliseconds() {
			return ErrTooSoon
		}
		_, err = tx.Exec(`INSERT INTO email_codes (email, code_hash, sent_at, expires_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, sent_at = excluded.sent_at,
				expires_at = excluded.expires_at, tries = 0`,
			email, a.codeHash(email, code), store.Ms(now), store.Ms(now.Add(CodeTTL)))
		if err != nil {
			return err
		}
		return a.Outbox.Enqueue(tx, mailer.Message{
			To:      email,
			Subject: "Кодът ти за АЛМАНАХ: " + code,
			Text: "Кодът ти за вход в АЛМАНАХ е:\n\n    " + code + "\n\n" +
				"Важи 15 минути. Ако не ти трябва, просто не го използвай.\n\nalmanac.bg\n",
		})
	})
	if err == nil {
		a.Outbox.Wake()
	}
	return err
}

// Verify checks a code and signs its address in. The player who asked (current, maybe nil) is kept when they can be:
// a guest giving a new address keeps their account; a guest signing in to an account that has the address brings their
// progress along (Merge) and is gone after.
func (a *Accounts) Verify(ctx context.Context, email, code string, current *User) (User, string, error) {
	email, err := NormalEmail(email)
	if err != nil {
		return User{}, "", err
	}
	code = strings.TrimSpace(code)
	var u User
	var token string
	var wrong bool
	err = a.DB.Tx(ctx, func(tx *sql.Tx) error {
		var hash []byte
		var expires int64
		var tries int
		err := tx.QueryRow(`SELECT code_hash, expires_at, tries FROM email_codes WHERE email = ?`, email).
			Scan(&hash, &expires, &tries)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && (expires <= store.Now() || tries >= CodeTries)) {
			return ErrCodeExpired
		}
		if err != nil {
			return err
		}
		if !hmac.Equal(hash, a.codeHash(email, code)) {
			wrong = true
			_, err := tx.Exec(`UPDATE email_codes SET tries = tries + 1 WHERE email = ?`, email)
			return err // the try counts: committed below, then ErrBadCode
		}
		if _, err := tx.Exec(`DELETE FROM email_codes WHERE email = ?`, email); err != nil {
			return err
		}

		var owner User
		err = tx.QueryRow(`SELECT id, name, tag, admin FROM users WHERE email = ?`, email).
			Scan(&owner.ID, &owner.Name, &owner.Tag, &owner.Admin)
		switch {
		case err == nil:
			owner.Email = email
			if current != nil && current.Guest() && current.ID != owner.ID {
				for _, merge := range a.Merge {
					if err := merge(tx, current.ID, owner.ID); err != nil {
						return err
					}
				}
				if _, err := tx.Exec(`DELETE FROM users WHERE id = ?`, current.ID); err != nil {
					return err
				}
			}
			u = owner
		case errors.Is(err, sql.ErrNoRows) && current != nil && current.Guest():
			if _, err := tx.Exec(`UPDATE users SET email = ? WHERE id = ?`, email, current.ID); err != nil {
				return err
			}
			u = *current
			u.Email = email
		case errors.Is(err, sql.ErrNoRows):
			if u, err = createUser(tx, email); err != nil {
				return err
			}
		default:
			return err
		}
		token, err = startSession(tx, u.ID)
		return err
	})
	if wrong && err == nil {
		err = ErrBadCode
	}
	if err != nil {
		return User{}, "", err
	}
	return u, token, nil
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
