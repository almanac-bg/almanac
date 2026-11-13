package play

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"slices"
	"strings"

	"github.com/almanac-bg/almanac/internal/store"
)

// Friends are two players who joined up: through one's invite link, or a request by tag or email that the other
// accepted. Each sees how the other did on the day's questions, they keep a record of their duels, and either can
// call the other to a duel now.

var (
	ErrNoInvite     = errors.New("no such invite")
	ErrOwnInvite    = errors.New("one's own invite")
	ErrNotFriends   = errors.New("not friends")
	ErrManyFriends  = errors.New("too many friends")
	ErrNoPlayer     = errors.New("no player with that tag")
	ErrNoRequest    = errors.New("no such request")
	ErrManyRequests = errors.New("too many requests waiting")
)

// MaxRequests is how many friend requests a player may have waiting for an answer.
const MaxRequests = 50

// MaxFriends is how many friends a player may have: plenty for the people they know, too few for a list of strangers.
const MaxFriends = 200

// inviteLetters make the codes of invite links: no 0, o, 1 or l, which are easy to mix up when read out.
const inviteLetters = "abcdefghijkmnpqrstuvwxyz23456789"

func newInviteCode() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = inviteLetters[int(b[i])%len(inviteLetters)] // 256 is a multiple of 32: no letter more likely
	}
	return string(b)
}

// InviteCode is the code of a player's invite link, made the first time they ask for it and the same ever after.
func (g *Game) InviteCode(ctx context.Context, userID int64) (string, error) {
	for range 3 {
		var code sql.NullString
		err := g.DB.Read.QueryRowContext(ctx, `SELECT invite FROM users WHERE id = ?`, userID).Scan(&code)
		if err != nil {
			return "", err
		}
		if code.Valid {
			return code.String, nil
		}
		// Another tab may make one at the same moment: the first one kept wins, and the loop reads it.
		if _, err := g.DB.Write.ExecContext(ctx, `UPDATE users SET invite = ? WHERE id = ? AND invite IS NULL`,
			newInviteCode(), userID); err != nil && !strings.Contains(err.Error(), "UNIQUE") {
			return "", err
		}
	}
	return "", errors.New("no free invite code")
}

// Inviter is whose invite link a code is.
func (g *Game) Inviter(ctx context.Context, code string) (id int64, name string, err error) {
	err = g.DB.Read.QueryRowContext(ctx, `SELECT id, name FROM users WHERE invite = ?`, code).Scan(&id, &name)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNoInvite
	}
	return id, name, err
}

// Befriend makes a player and the owner of an invite link friends (and changes nothing if they already are). It
// returns the friend.
func (g *Game) Befriend(ctx context.Context, userID int64, code string) (id int64, name string, err error) {
	id, name, err = g.Inviter(ctx, code)
	if err != nil {
		return 0, "", err
	}
	if id == userID {
		return 0, "", ErrOwnInvite
	}
	return id, name, g.befriend(ctx, userID, id)
}

// befriend makes two players friends (if they aren't yet), settles any requests between them, and awards what that
// earns them.
func (g *Game) befriend(ctx context.Context, a, b int64) error {
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM friend_requests WHERE (from_id = ?1 AND (to_id = ?2
			OR to_email = (SELECT email FROM users WHERE id = ?2))) OR (from_id = ?2 AND (to_id = ?1
			OR to_email = (SELECT email FROM users WHERE id = ?1)))`, a, b); err != nil {
			return err
		}
		var already bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?)`, a, b).
			Scan(&already); err != nil || already {
			return err
		}
		for _, who := range []int64{a, b} {
			var n int
			if err := tx.QueryRow(`SELECT count(*) FROM friends WHERE user_id = ?`, who).Scan(&n); err != nil {
				return err
			}
			if n >= MaxFriends {
				return ErrManyFriends
			}
		}
		now := store.Ms(g.Now())
		_, err := tx.Exec(`INSERT OR IGNORE INTO friends (user_id, friend_id, since) VALUES (?, ?, ?), (?, ?, ?)`,
			a, b, now, b, a, now)
		return err
	})
	if err != nil {
		return err
	}
	for _, who := range []int64{a, b} {
		if _, err := g.Award(ctx, who); err != nil {
			return err
		}
	}
	return nil
}

// Sent is what came of a friend request: sent, or (when the other had asked first) friends at once.
type Sent struct {
	Friends bool   `json:"friends,omitempty"`
	Name    string `json:"name,omitempty"` // whom it went to, when asked by tag (an email's owner stays unknown)
}

// Request asks a player to be friends: by their tag, or by an email address. An email request waits for whoever has
// the address, or signs in with it later, and the sender learns nothing about whether anyone does. to is already a
// normal tag or email (account.NormalTag, account.NormalEmail); byEmail says which.
func (g *Game) Request(ctx context.Context, from int64, to string, byEmail bool) (Sent, error) {
	var mine sql.NullString // the sender's email: requests to it are to them
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT email FROM users WHERE id = ?`, from).Scan(&mine); err != nil {
		return Sent{}, err
	}
	var other int64 // whom the request is to, when known
	var name string
	var err error
	if byEmail {
		if mine.Valid && to == mine.String {
			return Sent{}, ErrOwnInvite
		}
		// Told only to someone this address's owner has already asked: they know each other.
		err = g.DB.Read.QueryRowContext(ctx, `SELECT u.id, u.name FROM users u JOIN friend_requests r ON r.from_id = u.id
			WHERE u.email = ? AND (r.to_id = ? OR r.to_email = ?)`, to, from, mine.String).Scan(&other, &name)
		if errors.Is(err, sql.ErrNoRows) {
			other, err = 0, nil
		}
	} else {
		err = g.DB.Read.QueryRowContext(ctx, `SELECT id, name FROM users WHERE tag = ?`, to).Scan(&other, &name)
		if errors.Is(err, sql.ErrNoRows) {
			return Sent{}, ErrNoPlayer
		}
	}
	if err != nil {
		return Sent{}, err
	}
	if other == from {
		return Sent{}, ErrOwnInvite
	}
	if other != 0 {
		if _, err := g.Friend(ctx, from, other); err == nil {
			return Sent{Friends: true, Name: name}, nil
		}
		var asked bool // the other asked first: friends now
		if err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM friend_requests WHERE from_id = ?
			AND (to_id = ? OR to_email = ?))`, other, from, mine.String).Scan(&asked); err != nil {
			return Sent{}, err
		}
		if asked {
			if err := g.befriend(ctx, from, other); err != nil {
				return Sent{}, err
			}
			return Sent{Friends: true, Name: name}, nil
		}
	}
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRow(`SELECT count(*) FROM friend_requests WHERE from_id = ?`, from).Scan(&n); err != nil {
			return err
		}
		if n >= MaxRequests {
			return ErrManyRequests
		}
		now := store.Ms(g.Now())
		if byEmail {
			_, err := tx.Exec(`INSERT INTO friend_requests (from_id, to_email, at) VALUES (?, ?, ?)
				ON CONFLICT (from_id, to_email) WHERE to_email IS NOT NULL DO UPDATE SET at = excluded.at`, from, to, now)
			return err
		}
		_, err := tx.Exec(`INSERT INTO friend_requests (from_id, to_id, at) VALUES (?, ?, ?)
			ON CONFLICT (from_id, to_id) WHERE to_id IS NOT NULL DO UPDATE SET at = excluded.at`, from, other, now)
		return err
	})
	if byEmail {
		name = ""
	}
	return Sent{Name: name}, err
}

// FriendRequest is a friend request as one of the two sees it: who asked (to the one asked), or whom it went to (to
// the one who asked: a player, or an email address).
type FriendRequest struct {
	ID   int64  `json:"id"`
	At   int64  `json:"at"`
	Name string `json:"name,omitempty"`
	Tag  string `json:"tag,omitempty"`
	// Email is the address a request went to, shown only to its sender.
	Email string `json:"email,omitempty"`
	Look  *Look  `json:"look,omitempty"`
}

// Requests are a player's friend requests: those waiting for their answer, and those they sent.
func (g *Game) Requests(ctx context.Context, userID int64) (in, out []FriendRequest, err error) {
	db := g.DB.Read
	rows, err := db.QueryContext(ctx, `SELECT r.id, r.at, u.id, u.name, u.tag, `+lookColumns+`
		FROM friend_requests r JOIN users u ON u.id = r.from_id
		WHERE r.to_id = ?1 OR r.to_email = (SELECT email FROM users WHERE id = ?1)
		ORDER BY r.at DESC`, userID)
	if err != nil {
		return nil, nil, err
	}
	in = []FriendRequest{}
	for rows.Next() {
		var r FriendRequest
		var id int64
		var avatar, title string
		var points int
		if err := rows.Scan(&r.ID, &r.At, &id, &r.Name, &r.Tag, &avatar, &title, &points); err != nil {
			rows.Close()
			return nil, nil, err
		}
		look := lookOf(id, avatar, title, points)
		r.Look = &look
		in = append(in, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	rows, err = db.QueryContext(ctx, `SELECT r.id, r.at, coalesce(u.name, ''), coalesce(u.tag, ''), coalesce(r.to_email, '')
		FROM friend_requests r LEFT JOIN users u ON u.id = r.to_id WHERE r.from_id = ? ORDER BY r.at DESC`, userID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	out = []FriendRequest{}
	for rows.Next() {
		var r FriendRequest
		if err := rows.Scan(&r.ID, &r.At, &r.Name, &r.Tag, &r.Email); err != nil {
			return nil, nil, err
		}
		out = append(out, r)
	}
	return in, out, rows.Err()
}

// Accept says yes to a friend request sent to this player: the two are friends.
func (g *Game) Accept(ctx context.Context, userID, requestID int64) (name string, err error) {
	var from int64
	err = g.DB.Read.QueryRowContext(ctx, `SELECT r.from_id, u.name FROM friend_requests r JOIN users u ON u.id = r.from_id
		WHERE r.id = ?1 AND (r.to_id = ?2 OR r.to_email = (SELECT email FROM users WHERE id = ?2))`, requestID, userID).
		Scan(&from, &name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNoRequest
	}
	if err != nil {
		return "", err
	}
	if from == userID {
		return "", ErrOwnInvite
	}
	return name, g.befriend(ctx, from, userID)
}

// Withdraw drops a friend request: its sender calls it off, or the one asked says no (the sender isn't told).
func (g *Game) Withdraw(ctx context.Context, userID, requestID int64) error {
	res, err := g.DB.Write.ExecContext(ctx, `DELETE FROM friend_requests WHERE id = ?1 AND (from_id = ?2 OR to_id = ?2
		OR to_email = (SELECT email FROM users WHERE id = ?2))`, requestID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoRequest
	}
	return nil
}

// RequestsWaiting is how many friend requests wait for a player's answer (for the dot on Заедно).
func (g *Game) RequestsWaiting(ctx context.Context, userID int64) (int, error) {
	var n int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FROM friend_requests
		WHERE to_id = ?1 OR to_email = (SELECT email FROM users WHERE id = ?1)`, userID).Scan(&n)
	return n, err
}

// Unfriend ends a friendship, for both.
func (g *Game) Unfriend(ctx context.Context, userID, friendID int64) error {
	_, err := g.DB.Write.ExecContext(ctx, `DELETE FROM friends WHERE (user_id = ? AND friend_id = ?)
		OR (user_id = ? AND friend_id = ?)`, userID, friendID, friendID, userID)
	return err
}

// Friend returns a friend's name, or ErrNotFriends.
func (g *Game) Friend(ctx context.Context, userID, friendID int64) (string, error) {
	var name string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT u.name FROM friends f JOIN users u ON u.id = f.friend_id
		WHERE f.user_id = ? AND f.friend_id = ?`, userID, friendID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFriends
	}
	return name, err
}

// Friend is a friend as the player's list shows them: how they did today, and the duels between the two.
type Friend struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Tag   string `json:"tag"`
	Since int64  `json:"since"`
	Look
	Today *Score `json:"today,omitempty"` // their day's questions, once finished
	// The duels between the two, from the player's side.
	Won   int `json:"won"`
	Lost  int `json:"lost"`
	Drawn int `json:"drawn"`
}

// FriendsOf lists a player's friends: those who've played today first, best first, then the rest by name.
func (g *Game) FriendsOf(ctx context.Context, userID int64) ([]Friend, error) {
	db := g.DB.Read
	rows, err := db.QueryContext(ctx, `SELECT u.id, u.name, u.tag, f.since, r.points, r.rights, r.ms, `+lookColumns+`
		FROM friends f JOIN users u ON u.id = f.friend_id
		LEFT JOIN runs r ON r.user_id = u.id AND r.kind = 'day' AND r.day = ? AND r.finished_at IS NOT NULL
		WHERE f.user_id = ?`, g.Today(), userID)
	if err != nil {
		return nil, err
	}
	var list []Friend
	at := map[int64]int{}
	for rows.Next() {
		var f Friend
		var points, rights, ms sql.NullInt64
		var avatar, title string
		var total int
		if err := rows.Scan(&f.ID, &f.Name, &f.Tag, &f.Since, &points, &rights, &ms, &avatar, &title, &total); err != nil {
			rows.Close()
			return nil, err
		}
		f.Look = lookOf(f.ID, avatar, title, total)
		if points.Valid {
			f.Today = &Score{Name: f.Name, Points: int(points.Int64), Rights: int(rights.Int64), Ms: ms.Int64}
		}
		at[f.ID] = len(list)
		list = append(list, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = db.QueryContext(ctx, `SELECT opponent_id, outcome, count(*) FROM runs
		WHERE user_id = ? AND kind = 'duel' AND opponent_id IS NOT NULL GROUP BY opponent_id, outcome`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var outcome string
		var n int
		if err := rows.Scan(&id, &outcome, &n); err != nil {
			return nil, err
		}
		i, ok := at[id]
		if !ok {
			continue // a duel with someone who isn't a friend (any more)
		}
		switch outcome {
		case "won":
			list[i].Won = n
		case "lost":
			list[i].Lost = n
		default:
			list[i].Drawn = n
		}
	}
	slices.SortStableFunc(list, func(a, b Friend) int {
		switch {
		case a.Today != nil && b.Today == nil:
			return -1
		case a.Today == nil && b.Today != nil:
			return 1
		case a.Today != nil && a.Today.Points != b.Today.Points:
			return b.Today.Points - a.Today.Points
		}
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	return list, rows.Err()
}

// FriendsBoard is the day's board among a player and their friends: everyone of them who finished it, best first.
// Empty while none of their friends has.
func (g *Game) FriendsBoard(ctx context.Context, day string, userID int64) ([]Score, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.id, u.name, r.points, r.rights, r.ms, `+lookColumns+` FROM runs r
		JOIN users u ON u.id = r.user_id
		WHERE r.kind = 'day' AND r.day = ? AND r.finished_at IS NOT NULL
		AND (r.user_id = ? OR r.user_id IN (SELECT friend_id FROM friends WHERE user_id = ?))
		ORDER BY r.points DESC, r.ms, r.id`, day, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var board []Score
	others := false
	for rows.Next() {
		var s Score
		var id int64
		var avatar, title string
		var total int
		if err := rows.Scan(&id, &s.Name, &s.Points, &s.Rights, &s.Ms, &avatar, &title, &total); err != nil {
			return nil, err
		}
		s.Me, s.Look = id == userID, lookOf(id, avatar, title, total)
		others = others || !s.Me
		board = append(board, s)
	}
	if !others {
		return nil, rows.Err()
	}
	return board, rows.Err()
}
