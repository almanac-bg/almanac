package play

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Втори шанс: the questions a player got wrong come back, a few days later, until they get them right. A question
// waits once the player has never answered it right and their last answer to it is MistakesAfter old; the oldest
// come first, up to a run's Length. A right answer here is the first right answer to that question, so its fact goes
// into the Almanac then (almanac.go), and the answer says so (Result.Learned). A run of them is its own kind
// ("mistakes"): it earns XP like a topic's, and counts for no topic's goals or achievements.

// MistakesAfter is how long a missed question waits before it's asked again: long enough to be a real test of
// memory, not of the last few minutes.
const MistakesAfter = 3 * 24 * time.Hour

// ErrNoMistakes is a second chance asked for with too few questions waiting for one.
var ErrNoMistakes = errors.New("too few mistakes waiting")

// MistakesFrom is how many must be waiting before the way in shows: a run of two or three isn't a game.
const MistakesFrom = 5

// mistakesAfter is how long a missed question waits for its second chance in this game.
func (g *Game) mistakesAfter() time.Duration {
	if g.MistakesAfter > 0 {
		return g.MistakesAfter
	}
	return MistakesAfter
}

// waiting are the questions waiting for a second chance, oldest miss first; still in play only.
func (g *Game) waiting(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, userID int64, limit int) ([]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT a.question_id FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ? GROUP BY a.question_id HAVING max(a.is_right) = 0 AND max(a.at) <= ?
		ORDER BY min(a.at)`, userID, store.Ms(g.Now().Add(-g.mistakesAfter())))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	b := g.Bank()
	var ids []string
	for rows.Next() && (limit == 0 || len(ids) < limit) {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		if q, ok := b.Get(id); ok && !q.Extra().Retired {
			ids = append(ids, id)
		}
	}
	return ids, rows.Err()
}

// Mistakes is how many questions are waiting for a player's second chance.
func (g *Game) Mistakes(ctx context.Context, userID int64) (int, error) {
	ids, err := g.waiting(ctx, g.DB.Read, userID, 0)
	return len(ids), err
}

// StartMistakes starts a run of the questions waiting for a second chance (ErrNoMistakes with fewer than
// MistakesFrom).
func (g *Game) StartMistakes(ctx context.Context, userID int64) (State, error) {
	var s State
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		ids, err := g.waiting(ctx, tx, userID, Length)
		if err != nil {
			return err
		}
		if len(ids) < MistakesFrom {
			return ErrNoMistakes
		}
		picks := make([]Pick, len(ids))
		for i, id := range ids {
			picks[i] = Pick{ID: id, Seed: newSeed()}
		}
		r, err := g.insertRun(tx, userID, "mistakes", nil, nil, picks)
		if err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, err
}
