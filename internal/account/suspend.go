package account

import (
	"context"
	"database/sql"
	"errors"

	"github.com/almanac-bg/almanac/internal/store"
)

// ErrSuspended is a player whoever keeps the game has suspended (Suspend): no session starts for them.
var ErrSuspended = errors.New("the player is suspended")

// Suspend stops a player from playing (whoever keeps the game does, for a player who abuses it): every session of
// theirs ends, with the notifications of their browsers, and none starts again (startSession: a sign-in by email, a
// handoff) until Unsuspend. Their games and what others keep of them stay as they were: a guest's too, though no session
// is left them (CleanUp keeps a suspended guest SessionDays from the suspension).
func (a *Accounts) Suspend(ctx context.Context, userID int64) error {
	return a.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.Exec(`INSERT INTO suspensions (user_id, at) SELECT id, ? FROM users WHERE id = ?
			ON CONFLICT (user_id) DO NOTHING`, store.Now(), userID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			var exists bool
			if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM users WHERE id = ?)`, userID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return sql.ErrNoRows
			}
		}
		_, err = endSessions(tx, userID, nil)
		return err
	})
}

// Unsuspend lets a suspended player sign in again.
func (a *Accounts) Unsuspend(ctx context.Context, userID int64) error {
	_, err := a.DB.Write.ExecContext(ctx, `DELETE FROM suspensions WHERE user_id = ?`, userID)
	return err
}

// Suspended is whether a player is suspended, and since when (ms).
func (a *Accounts) Suspended(ctx context.Context, userID int64) (bool, int64, error) {
	var at int64
	err := a.DB.Read.QueryRowContext(ctx, `SELECT at FROM suspensions WHERE user_id = ?`, userID).Scan(&at)
	if errors.Is(err, sql.ErrNoRows) {
		return false, 0, nil
	}
	return err == nil, at, err
}
