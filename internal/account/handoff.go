package account

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// The Handoff: how a guest's game begun in an app's own browser (Messenger, Instagram, Viber …), where it would stay,
// comes to the phone's own browser. The page that offers the way out holds a link's token (Handoff), written into its
// address's fragment only while the way out is offered, so that the app's „Open in browser“ carries it and nothing
// else (a fragment never reaches a server, nor a link's preview); the page in the phone's browser takes it
// (TakeHandoff). Taken, the game is in both browsers, as one player's two sessions: the app's stays signed in, so that
// whoever comes back through the app's link isn't split in two.
//
// A link is the way into a game, so it is guarded: once only, for HandoffTTL, the last HandoffsKept of a player's
// working; a guest's only (a profile is signed in to by its email); never joining two games (a browser with a game of
// its own, or a profile, is told how they're joined: by an email). And a browser that isn't plainly the same phone —
// another network (an IPv4 /24, an IPv6 /64) or another family of system than the one that made the link (Origin) —
// is asked for the two-digit number the making page shows (Offer.Number): a link that reached someone else is no way
// into the game without the phone it came from. A link copied by hand (CopiedHandoff) asks every browser, the same
// phone's too: a paste goes anywhere. A wrong number counts against the link, which dies after HandoffMisses. The
// network is kept as a keyed hash, never the address, and goes with the link.

// HandoffTTL is how long a handoff's link works (once).
const HandoffTTL = 30 * time.Minute

// HandoffRotate is the least time a link must still have to be offered again as it is (HeldHandoff): with less, the
// page is given a new one, so that a link written into an address doesn't die while it's being opened.
const HandoffRotate = 10 * time.Minute

// HandoffsKept is how many of a player's handoff links work at once: a newer one leaves the last few working, so
// that the link copied a moment ago isn't dead by the time it's pasted.
const HandoffsKept = 3

// HandoffMisses is how many wrong numbers a link takes before it stops working: two digits, three tries, one chance
// in thirty for a guess, and the link is made again only by its maker.
const HandoffMisses = 3

var (
	// ErrNoHandoff is a handoff's link that doesn't work: used, out of time, never made, wrong numbers past
	// HandoffMisses, or not a guest's.
	ErrNoHandoff = errors.New("no such handoff")
	// ErrHandoffSignedIn is a guest's game brought to a browser signed in to a profile: it isn't joined to it by a
	// link (a link from someone else would join their game, and their phone, to this profile), only by signing in
	// with the email where the game is.
	ErrHandoffSignedIn = errors.New("a handoff to a profile")
	// ErrHandoffHere is a guest's game brought to a browser with a guest's game of its own (hasGame): two games
	// aren't joined by a link either (someone else's would bring its friends into this one), only by an email, kept
	// in one and signed in to in the other.
	ErrHandoffHere = errors.New("a handoff to a game")
	// ErrHandoffNumber is a link taken by a browser not plainly the maker's (Origin) without the number its page shows.
	ErrHandoffNumber = errors.New("a handoff's number is asked for")
)

// WrongNumber is a wrong number given for a link that may still be tried: Left tries remain (ErrHandoffNumber).
type WrongNumber struct{ Left int }

func (e WrongNumber) Error() string {
	return fmt.Sprintf("a handoff's wrong number, %d tries left", e.Left)
}
func (e WrongNumber) Is(target error) bool { return target == ErrHandoffNumber }

// Origin is where a browser is, as a link compares the browser that takes it with the one that made it: its network,
// a keyed hash (the server's: nil when it can't tell), and its family of system ("ios", "android", "windows" …).
type Origin struct {
	Net []byte
	OS  string
}

// same says whether two origins are plainly one phone's.
func (o Origin) same(p Origin) bool { return bytes.Equal(o.Net, p.Net) && o.OS == p.OS }

// Offer is a link as the page that offers the way out holds it: its token (written into the page's address), the
// number a browser elsewhere is asked for, and whether it was made now (Fresh) or is the one the page had.
type Offer struct {
	Token  string `json:"token"`
	Number int    `json:"number"`
	Fresh  bool   `json:"-"`
}

// HeldHandoff is the link a page holds (held, its token), offered again as it is while it's the player's and works
// for HandoffRotate more at least; ok is false otherwise, and the page is to be given a new one (Handoff).
func (a *Accounts) HeldHandoff(ctx context.Context, userID int64, held string) (Offer, bool, error) {
	if held == "" {
		return Offer{}, false, nil
	}
	var n int
	err := a.DB.Read.QueryRowContext(ctx, `SELECT number FROM handoffs WHERE token_hash = ? AND user_id = ?
		AND expires_at > ? AND misses < ?`, hashToken(held), userID, store.Ms(time.Now().Add(HandoffRotate)),
		HandoffMisses).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return Offer{}, false, nil
	}
	return Offer{Token: held, Number: n}, err == nil, err
}

// Handoff makes a link that brings a guest's game to another browser, once, within HandoffTTL, made where from is:
// its token and its number. Only a guest's: a profile moves by signing in with its email, and a link to it would sign
// in whoever it reached.
func (a *Accounts) Handoff(ctx context.Context, userID int64, from Origin) (Offer, error) {
	token, hash := newToken()
	out := Offer{Token: token, Number: twoDigits(), Fresh: true}
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
		_, err := tx.Exec(`INSERT INTO handoffs (token_hash, user_id, expires_at, net, os, number) VALUES (?1, ?2,
				max(?3, (SELECT coalesce(max(expires_at), 0) + 1 FROM handoffs WHERE user_id = ?2)), ?4, ?5, ?6)`,
			hash, userID, store.Ms(time.Now().Add(HandoffTTL)), from.Net, from.OS, out.Number)
		return err
	})
	if err != nil {
		return Offer{}, err
	}
	return out, nil
}

// CopiedHandoff marks a player's link as copied by hand („Копирай връзката“): from then on every browser that takes it
// gives its number, the same phone's too. A token that isn't the player's changes nothing.
func (a *Accounts) CopiedHandoff(ctx context.Context, userID int64, token string) error {
	_, err := a.DB.Write.ExecContext(ctx, `UPDATE handoffs SET copied = 1 WHERE token_hash = ? AND user_id = ?`,
		hashToken(token), userID)
	return err
}

// twoDigits is a number from 10 to 99.
func twoDigits() int {
	n, _ := rand.Int(rand.Reader, big.NewInt(90))
	return 10 + int(n.Int64())
}

// handoff is a link as it's kept.
type handoff struct {
	from   User
	origin Origin
	number int
	misses int
	copied bool // copied by hand (CopiedHandoff)
}

// asks says whether a browser at origin, not the link's own, gives the link's number: one not plainly the maker's
// phone, or any once the link was copied by hand.
func (h handoff) asks(at Origin) bool { return h.copied || !h.origin.same(at) }

// handing reads, for a handoff's token taken in the browser of session (its token, maybe ""), the link (whose game
// it brings, where it was made, its number) and who the browser is (current, nil for no one), or why it can't be taken
// there: the link doesn't work (ErrNoHandoff), the browser is a profile's (ErrHandoffSignedIn), or a guest's with a
// game of their own (ErrHandoffHere). Opened where it was made, current is the link's player.
func handing(tx *sql.Tx, token, session string) (h handoff, current *User, err error) {
	var email sql.NullString
	err = tx.QueryRow(`SELECT u.id, u.name, u.tag, u.email, u.admin, h.net, h.os, h.number, h.misses, h.copied
		FROM handoffs h JOIN users u ON u.id = h.user_id WHERE h.token_hash = ? AND h.expires_at > ? AND h.misses < ?`,
		hashToken(token), store.Now(), HandoffMisses).
		Scan(&h.from.ID, &h.from.Name, &h.from.Tag, &email, &h.from.Admin, &h.origin.Net, &h.origin.OS, &h.number, &h.misses,
			&h.copied)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && email.Valid) { // a profile's (made before only guests'): none
		return h, nil, ErrNoHandoff
	}
	if err != nil {
		return h, nil, err
	}
	if current, err = sessionUser(tx, session); err != nil || current == nil || current.ID == h.from.ID {
		return h, current, err
	}
	if !current.Guest() {
		return h, current, ErrHandoffSignedIn // the link stays good, for the browser it was meant for
	}
	var own bool
	if err := tx.QueryRow(`SELECT `+hasGame+` FROM users u WHERE u.id = ?`, current.ID).Scan(&own); err != nil {
		return h, current, err
	}
	if own {
		return h, current, ErrHandoffHere // the link stays good here too
	}
	return h, current, nil
}

// Handing is the game a handoff's link brings, as the page that takes it shows it (LookHandoff): whose it is, how
// many days it was played on, whether the number the making page shows is asked for here, and whether this is the
// browser that made it (Mine: nothing to take). Any other browser takes it with one tap that names the game, or with
// the number.
type Handing struct {
	Name   string `json:"name"`
	Days   int    `json:"days"`
	Number bool   `json:"number,omitempty"`
	Mine   bool   `json:"mine,omitempty"`
}

// LookHandoff says what game a handoff's token brings to the browser of session, at origin, before it's taken
// (Handing), or why it can't be taken there (handing's errors). It takes nothing.
func (a *Accounts) LookHandoff(ctx context.Context, token, session string, at Origin) (Handing, error) {
	var out Handing
	tx, err := a.DB.Read.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback() //nolint:errcheck // a read: nothing to keep
	h, current, err := handing(tx, token, session)
	if err != nil {
		return out, err
	}
	out.Name = h.from.Name
	out.Mine = current != nil && current.ID == h.from.ID
	out.Number = !out.Mine && h.asks(at)
	err = tx.QueryRow(`SELECT count(*) FROM active_days WHERE user_id = ?`, h.from.ID).Scan(&out.Days)
	return out, err
}

// TakeHandoff brings the game of the guest who made a handoff's token to the browser of session (its token, maybe
// ""), at origin, once; number is the number given for it (0: none). The game is shared, not moved: the browser it
// came from stays signed in, and this one becomes the same player with a session of its own, keeping its own
// notifications; a guest it was, who had nothing yet (hasGame), goes. A browser not plainly the maker's (Origin), or
// any once the link was copied (CopiedHandoff), gives the link's number first (ErrHandoffNumber; WrongNumber, which
// counts against the link). A browser with a game of its
// own, a profile's or a guest's, isn't joined to another by a link (ErrHandoffSignedIn, ErrHandoffHere): two games are
// joined only by signing in with an email. The session token is "" when the browser keeps the one it has (opened
// where it was made: nothing changes, and the link stays good).
func (a *Accounts) TakeHandoff(ctx context.Context, token, session string, at Origin, number int) (User, string, error) {
	var u User
	var started string
	var wrong error
	err := a.DB.Tx(ctx, func(tx *sql.Tx) error {
		h, current, err := handing(tx, token, session)
		if err != nil {
			return err
		}
		if current != nil && current.ID == h.from.ID { // opened where it was made: nothing changes
			u = *current
			return nil
		}
		if h.asks(at) && number != h.number {
			if number == 0 {
				return ErrHandoffNumber
			}
			left := HandoffMisses - h.misses - 1
			wrong = WrongNumber{Left: left}
			if left <= 0 {
				wrong = ErrNoHandoff
			}
			_, err := tx.Exec(`UPDATE handoffs SET misses = misses + 1 WHERE token_hash = ?`, hashToken(token))
			return err // the miss counts: committed, then the wrong number's error
		}
		if _, err := tx.Exec(`DELETE FROM handoffs WHERE token_hash = ?`, hashToken(token)); err != nil {
			return err
		}
		u = h.from
		if current == nil {
			started, err = startSession(tx, u.ID)
			return err
		}
		if started, err = moveSession(tx, session, u.ID); err != nil {
			return err
		}
		return a.remove(tx, current.ID)
	})
	if wrong != nil && err == nil {
		err = wrong
	}
	if err != nil {
		return User{}, "", err
	}
	return u, started, nil
}
