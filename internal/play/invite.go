package play

import (
	"context"
	"database/sql"
	"errors"
)

// A player's invite link (DECISIONS.md, the direction's people bullet: the owner's delegation, 21 Nov 2026): one per
// player who has finished a game, /f/<code>, made the first time they ask for it (InviteOf), the code ten random
// letters and digits (50 bits), so that nobody finds one by counting, and nothing in it says whose it is. Shared, it is
// the inviter's yes; opened (Invited), it shows who it's from (their name, avatar and the seal they wear: what anyone
// sees of them beside their name); taken (TakeInvite), the opener's tap is theirs, and the two are friends at once, the
// inviter as the one who asked (told of the yes, AcceptedOf). A new link (NewInvite) takes the old one's place: the old
// one ends.
//
// Bounded as friends are (MaxFriends for each of the two), and one link makes InviteADay friends a day at most,
// counted on the link's row and kept over a new link, so that making one gives no budget back; nobody takes their own
// (ErrSelf); a friend already is told so. A suspended player's link is no link while they are. The link goes with its
// player: a deletion takes it, a guest's comes to the account they sign in to unless it has one (merge.go).

// InviteADay is how many friends one link makes a day at most: a group, a class, a team in a day; not a list of
// strangers that a link posted in public would bring.
const InviteADay = 20

// InviteCodeLength is how long a link's code is: ten of codeLetters' 32, 50 bits.
const InviteCodeLength = 10

var (
	// ErrNoInvite is a link that isn't one, or is no more (a new one took its place, its player went).
	ErrNoInvite = errors.New("no such invite")
	// ErrInviteSpent is a link that has made InviteADay friends today.
	ErrInviteSpent = errors.New("invite spent for today")
)

// Invite is a link as the one who opens it sees it: whose it is, and how the opener stands with them.
type Invite struct {
	Code string `json:"code"`
	Name string `json:"name"`
	Tag  string `json:"tag"`
	Look
	// Mine is the opener's own link; Friends, the two are friends already.
	Mine    bool `json:"mine,omitempty"`
	Friends bool `json:"friends,omitempty"`
}

// inviteCode is a new link's code: InviteCodeLength of codeLetters.
func inviteCode() string { return newCode() + newCode()[:InviteCodeLength-CodeLength] }

// InviteOf is the code of a player's link, made the first time it's asked for.
func (g *Game) InviteOf(ctx context.Context, userID int64) (string, error) {
	var code string
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRow(`SELECT code FROM invites WHERE user_id = ?`, userID).Scan(&code)
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		code, err = g.newInviteIn(tx, userID)
		return err
	})
	return code, err
}

// HasInvite is whether a player has a link already (Приятели offers a new one only then).
func (g *Game) HasInvite(ctx context.Context, userID int64) (bool, error) {
	var has bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM invites WHERE user_id = ?)`, userID).Scan(&has)
	return has, err
}

// NewInvite gives a player a new link in place of the one they had, which ends: its count of the day stays.
func (g *Game) NewInvite(ctx context.Context, userID int64) (string, error) {
	var code string
	err := g.DB.Tx(ctx, func(tx *sql.Tx) (err error) {
		code, err = g.newInviteIn(tx, userID)
		return err
	})
	return code, err
}

func (g *Game) newInviteIn(tx *sql.Tx, userID int64) (string, error) {
	// A code taken already (one in a quadrillion): another.
	for range 3 {
		code := inviteCode()
		var taken bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM invites WHERE code = ?)`, code).Scan(&taken); err != nil {
			return "", err
		}
		if taken {
			continue
		}
		_, err := tx.Exec(`INSERT INTO invites (user_id, code, made_at) VALUES (?, ?, ?)
			ON CONFLICT (user_id) DO UPDATE SET code = excluded.code, made_at = excluded.made_at`,
			userID, code, g.Now().UnixMilli())
		return code, err
	}
	return "", errors.New("invite: no free code")
}

// inviter is the player whose link a code is, unless it isn't one, or theirs is suspended.
func inviter(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, code string) (int64, error) {
	if len(code) != InviteCodeLength {
		return 0, ErrNoInvite
	}
	var id int64
	err := q.QueryRowContext(ctx, `SELECT i.user_id FROM invites i WHERE i.code = ?
		AND NOT EXISTS (SELECT 1 FROM suspensions s WHERE s.user_id = i.user_id)`, code).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNoInvite
	}
	return id, err
}

// Invited is a link as one who opens it sees it (viewer: 0 for nobody signed in), or ErrNoInvite.
func (g *Game) Invited(ctx context.Context, code string, viewer int64) (Invite, error) {
	from, err := inviter(ctx, g.DB.Read, code)
	if err != nil {
		return Invite{}, err
	}
	in := Invite{Code: code, Mine: from == viewer}
	var look string
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT u.name, u.tag, `+lookColumns+` FROM users u WHERE u.id = ?`, from).
		Scan(&in.Name, &in.Tag, &look); err != nil {
		return Invite{}, err
	}
	in.Look = g.lookOf(from, look)
	if viewer != 0 && !in.Mine {
		if err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?)`,
			viewer, from).Scan(&in.Friends); err != nil {
			return Invite{}, err
		}
	}
	return in, nil
}

// Taken is what came of a link taken: whose it was, and whether the two were friends already.
type Taken struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Already bool   `json:"already,omitempty"`
}

// TakeInvite makes the player who opened a link friends with whose it is: at once, the inviter as the one who asked.
// ErrNoInvite for a link that isn't; ErrSelf for one's own; Already for a friend already (whatever the day's count);
// ErrInviteSpent once the link has made InviteADay friends today; ErrManyFriends when either list is full.
func (g *Game) TakeInvite(ctx context.Context, code string, userID int64) (Taken, error) {
	var t Taken
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		from, err := inviter(ctx, tx, code)
		if err != nil {
			return err
		}
		if from == userID {
			return ErrSelf
		}
		t.ID = from
		var day string
		var took int
		if err := tx.QueryRow(`SELECT u.name, i.day, i.took, EXISTS (SELECT 1 FROM friends WHERE user_id = ?2 AND friend_id = ?1)
			FROM invites i JOIN users u ON u.id = i.user_id WHERE i.user_id = ?1`, from, userID).
			Scan(&t.Name, &day, &took, &t.Already); err != nil || t.Already {
			return err
		}
		today := g.Today()
		if day != today {
			took = 0
		}
		if took >= InviteADay {
			return ErrInviteSpent
		}
		made, err := g.befriendIn(tx, from, userID)
		if err != nil || !made {
			t.Already = !made
			return err
		}
		_, err = tx.Exec(`UPDATE invites SET day = ?, took = ? WHERE user_id = ?`, today, took+1, from)
		return err
	})
	if err != nil {
		return Taken{}, err
	}
	return t, nil
}
