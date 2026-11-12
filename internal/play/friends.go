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

// Friends are two players who joined up through one's invite link. Each sees how the other did on the day's
// questions, they keep a record of their duels, and either can call the other to a duel now.

var (
	ErrNoInvite    = errors.New("no such invite")
	ErrOwnInvite   = errors.New("one's own invite")
	ErrNotFriends  = errors.New("not friends")
	ErrManyFriends = errors.New("too many friends")
)

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
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var already bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?)`, userID, id).
			Scan(&already); err != nil || already {
			return err
		}
		for _, who := range []int64{userID, id} {
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
			userID, id, now, id, userID, now)
		return err
	})
	return id, name, err
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
	Since int64  `json:"since"`
	Today *Score `json:"today,omitempty"` // their day's questions, once finished
	// The duels between the two, from the player's side.
	Won   int `json:"won"`
	Lost  int `json:"lost"`
	Drawn int `json:"drawn"`
}

// FriendsOf lists a player's friends: those who've played today first, best first, then the rest by name.
func (g *Game) FriendsOf(ctx context.Context, userID int64) ([]Friend, error) {
	db := g.DB.Read
	rows, err := db.QueryContext(ctx, `SELECT u.id, u.name, f.since, r.points, r.rights, r.ms
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
		if err := rows.Scan(&f.ID, &f.Name, &f.Since, &points, &rights, &ms); err != nil {
			rows.Close()
			return nil, err
		}
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
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.name, r.points, r.rights, r.ms, u.id = ? FROM runs r
		JOIN users u ON u.id = r.user_id
		WHERE r.kind = 'day' AND r.day = ? AND r.finished_at IS NOT NULL
		AND (r.user_id = ? OR r.user_id IN (SELECT friend_id FROM friends WHERE user_id = ?))
		ORDER BY r.points DESC, r.ms, r.id`, userID, day, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var board []Score
	others := false
	for rows.Next() {
		var s Score
		if err := rows.Scan(&s.Name, &s.Points, &s.Rights, &s.Ms, &s.Me); err != nil {
			return nil, err
		}
		others = others || !s.Me
		board = append(board, s)
	}
	if !others {
		return nil, rows.Err()
	}
	return board, rows.Err()
}
