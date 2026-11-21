package account

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// The Handoff: how a guest's game begun in an app's own browser (Messenger, Instagram, Viber …), where it would stay,
// comes to the phone's own browser. The page that offers the way out holds a link's token (Handoff), written into its
// address's fragment only while the way out is offered, so that the app's „Open in browser“ carries it and nothing
// else (a fragment never reaches a server, nor a link's preview); the page in the phone's browser says whose game it
// brings (LookHandoff) and takes it with a tap that names it (TakeHandoff). Taken, the game is in both browsers, as one
// player's two sessions: the app's stays signed in, so that whoever comes back through the app's link isn't split in
// two.
//
// A link is the way into a game, so it is guarded: once only, for HandoffTTL; a guest's only (a profile is signed in
// to by its email, and a guest's links die the moment it becomes one); never taken unseen (the tap names the game);
// and never joining two games (a browser with a game of its own, or a profile, is told how they're joined: by an
// email).

// HandoffTTL is how long a handoff's link works (once).
const HandoffTTL = 30 * time.Minute

var (
	// ErrNoHandoff is a handoff's link that doesn't work: used, out of time, never made, or not a guest's.
	ErrNoHandoff = errors.New("no such handoff")
	// ErrHandoffSignedIn is a guest's game brought to a browser signed in to a profile: it isn't joined to it by a
	// link (a link from someone else would join their game, and their phone, to this profile), only by signing in
	// with the email where the game is.
	ErrHandoffSignedIn = errors.New("a handoff to a profile")
	// ErrHandoffHere is a guest's game brought to a browser with a guest's game of its own (hasGame): two games
	// aren't joined by a link either (someone else's would bring its friends into this one), only by an email, kept
	// in one and signed in to in the other.
	ErrHandoffHere = errors.New("a handoff to a game")
)

// Handoff makes a link that brings a guest's game to another browser, once, within HandoffTTL: its token. Only a
// guest's: a profile moves by signing in with its email, and a link to it would sign in whoever it reached. A
// player's earlier links work on till they're used or out of time, so that one copied a moment ago isn't dead by the
// time it's pasted.
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
		_, err := tx.Exec(`INSERT INTO handoffs (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
			hash, userID, store.Ms(time.Now().Add(HandoffTTL)))
		return err
	})
	if err != nil {
		return "", err
	}
	return token, nil
}

// handing reads, for a handoff's token taken in the browser of session (its token, maybe ""), whose game the link
// brings (from) and who the browser is (current, nil for no one), or why it can't be taken there: the link doesn't
// work (ErrNoHandoff), the browser is a profile's (ErrHandoffSignedIn), or a guest's with a game of their own
// (ErrHandoffHere). Opened where it was made, current is the link's player.
func handing(tx *sql.Tx, token, session string) (from User, current *User, err error) {
	var email sql.NullString
	err = tx.QueryRow(`SELECT u.id, u.name, u.tag, u.email, u.admin FROM handoffs h JOIN users u ON u.id = h.user_id
		WHERE h.token_hash = ? AND h.expires_at > ?`, hashToken(token), store.Now()).
		Scan(&from.ID, &from.Name, &from.Tag, &email, &from.Admin)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && email.Valid) { // a profile's (the guest kept it since): none
		return from, nil, ErrNoHandoff
	}
	if err != nil {
		return from, nil, err
	}
	if current, err = sessionUser(tx, session); err != nil || current == nil || current.ID == from.ID {
		return from, current, err
	}
	if !current.Guest() {
		return from, current, ErrHandoffSignedIn // the link stays good, for the browser it was meant for
	}
	var own bool
	if err := tx.QueryRow(`SELECT `+hasGame+` FROM users u WHERE u.id = ?`, current.ID).Scan(&own); err != nil {
		return from, current, err
	}
	if own {
		return from, current, ErrHandoffHere // the link stays good here too
	}
	return from, current, nil
}

// Handing is the game a handoff's link brings, as the page that takes it shows it (LookHandoff): whose it is, and
// whether this is the browser that made it (Mine: nothing to take). Any other browser takes it with one tap that names
// the game.
type Handing struct {
	Name string `json:"name"`
	Mine bool   `json:"mine,omitempty"`
}

// LookHandoff says whose game a handoff's token brings to the browser of session, before it's taken (Handing), or
// why it can't be taken there (handing's errors). It takes nothing.
func (a *Accounts) LookHandoff(ctx context.Context, token, session string) (Handing, error) {
	tx, err := a.DB.Read.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return Handing{}, err
	}
	defer tx.Rollback() //nolint:errcheck // a read: nothing to keep
	from, current, err := handing(tx, token, session)
	if err != nil {
		return Handing{}, err
	}
	return Handing{Name: from.Name, Mine: current != nil && current.ID == from.ID}, nil
}

// TakeHandoff brings the game of the guest who made a handoff's token to the browser of session (its token, maybe
// ""), once. The game is shared, not moved: the browser it came from stays signed in, and this one becomes the same
// player with a session of its own, keeping its own notifications; a guest it was, who had nothing yet (hasGame),
// goes. A browser with a game of its own, a profile's or a guest's, isn't joined to another by a link
// (ErrHandoffSignedIn, ErrHandoffHere): two games are joined only by signing in with an email. The session token is
// "" when the browser keeps the one it has (opened where it was made: nothing changes, and the link stays good).
func (a *Accounts) TakeHandoff(ctx context.Context, token, session string) (User, string, error) {
	var u User
	var started string
	err := a.DB.Tx(ctx, func(tx *sql.Tx) error {
		from, current, err := handing(tx, token, session)
		if err != nil {
			return err
		}
		if current != nil && current.ID == from.ID { // opened where it was made: nothing changes
			u = *current
			return nil
		}
		if _, err := tx.Exec(`DELETE FROM handoffs WHERE token_hash = ?`, hashToken(token)); err != nil {
			return err
		}
		u = from
		if current == nil {
			started, err = startSession(tx, u.ID)
			return err
		}
		if started, err = moveSession(tx, session, u.ID); err != nil {
			return err
		}
		return a.remove(tx, current.ID)
	})
	if err != nil {
		return User{}, "", err
	}
	return u, started, nil
}
