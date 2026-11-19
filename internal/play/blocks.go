package play

import (
	"context"
	"database/sql"
	"errors"

	"github.com/almanac-bg/almanac/internal/store"
)

// A player may block another (Block): a stranger who keeps asking, a friend they no longer want near. From then on
// the two are no friends, and neither reaches the other: a request between them (by tag, by email, from a room, by
// opening the other's invite link) is kept nowhere, though its sender is told it went, as any (a block isn't
// announced); neither can take the other's challenge, nor sees the other among those who took theirs; and no push
// from one goes to the other (the server asks Blocked). Blocking ends what waited between them: requests, and
// challenges not started. Only the one who blocked can lift it (Unblock); lifted, the two are strangers again.

// MaxBlocks is how many players one may block: far more than anyone needs, a bound on the table.
const MaxBlocks = 1000

var (
	// ErrBlocked is something between two players one of whom has blocked the other.
	ErrBlocked = errors.New("blocked")
	// ErrManyBlocks is a player with MaxBlocks blocked already.
	ErrManyBlocks = errors.New("too many blocked")
)

// blockedBetween is the SQL condition that one of the players a and b (SQL expressions) has blocked the other.
func blockedBetween(a, b string) string {
	return `EXISTS (SELECT 1 FROM blocks WHERE (user_id = ` + a + ` AND blocked_id = ` + b + `)
		OR (user_id = ` + b + ` AND blocked_id = ` + a + `))`
}

// Blocked is whether one of two players has blocked the other.
func (g *Game) Blocked(ctx context.Context, a, b int64) (bool, error) {
	var blocked bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT `+blockedBetween("?1", "?2"), a, b).Scan(&blocked)
	return blocked, err
}

// BlockedWith are the players one of whom a player has blocked or been blocked by: never met live (internal/live).
func (g *Game) BlockedWith(ctx context.Context, userID int64) (map[int64]bool, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT blocked_id FROM blocks WHERE user_id = ?1
		UNION SELECT user_id FROM blocks WHERE blocked_id = ?1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// Block blocks the player with a tag (a normal one: account.NormalTag), for the player userID: friends no more, and
// what waited between them gone. Their name.
func (g *Game) Block(ctx context.Context, userID int64, tag string) (string, error) {
	var other int64
	var name string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT id, name FROM users WHERE tag = ?`, tag).Scan(&other, &name)
	if errors.Is(err, sql.ErrNoRows) || other == userID {
		return "", ErrNoPlayer
	}
	if err != nil {
		return "", err
	}
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRow(`SELECT count(*) FROM blocks WHERE user_id = ?`, userID).Scan(&n); err != nil {
			return err
		}
		if n >= MaxBlocks {
			return ErrManyBlocks
		}
		now := store.Ms(g.Now())
		for _, q := range []string{
			`INSERT OR IGNORE INTO blocks (user_id, blocked_id, at) VALUES (?1, ?2, ?3)`,
			`DELETE FROM friends WHERE (user_id = ?1 AND friend_id = ?2) OR (user_id = ?2 AND friend_id = ?1)`,
			`DELETE FROM friend_requests WHERE (from_id = ?1 AND (to_id = ?2
				OR to_email = (SELECT email FROM users WHERE id = ?2))) OR (from_id = ?2 AND (to_id = ?1
				OR to_email = (SELECT email FROM users WHERE id = ?1)))`,
			// Challenges between the two not started yet: over, as if said no to.
			`UPDATE duels SET outcome = 'declined', ended_at = ?3 WHERE kind = 'challenge' AND a_run IS NULL
				AND ended_at IS NULL AND ((a_id = ?1 AND b_id = ?2) OR (a_id = ?2 AND b_id = ?1))`,
		} {
			if _, err := tx.Exec(q, userID, other, now); err != nil {
				return err
			}
		}
		return nil
	})
	return name, err
}

// Unblock lifts a player's block of the player with a tag.
func (g *Game) Unblock(ctx context.Context, userID int64, tag string) error {
	res, err := g.DB.Write.ExecContext(ctx, `DELETE FROM blocks WHERE user_id = ?
		AND blocked_id = (SELECT id FROM users WHERE tag = ?)`, userID, tag)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoPlayer
	}
	return nil
}

// BlockedPlayer is a player someone has blocked, as their list shows them.
type BlockedPlayer struct {
	Name string `json:"name"`
	Tag  string `json:"tag"`
	At   int64  `json:"at"`
}

// BlockedOf are the players a player has blocked, the latest first.
func (g *Game) BlockedOf(ctx context.Context, userID int64) ([]BlockedPlayer, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.name, u.tag, b.at FROM blocks b JOIN users u ON u.id = b.blocked_id
		WHERE b.user_id = ? ORDER BY b.at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BlockedPlayer{}
	for rows.Next() {
		var b BlockedPlayer
		if err := rows.Scan(&b.Name, &b.Tag, &b.At); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
