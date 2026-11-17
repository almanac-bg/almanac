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

// Misses is what a game's mistakes will make of the player's second chance: how many of its questions they got wrong
// and have never got right (each waits MistakesAfter), and how many wait or will in all, those included. The day's
// result says so when there'll be a game of them (MistakesFrom).
func (g *Game) Misses(ctx context.Context, userID, runID int64) (missed, all int, err error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id, a.run_id = ? FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ? GROUP BY a.question_id, a.run_id = ? HAVING max(a.is_right) = 0
			AND NOT EXISTS (SELECT 1 FROM answers b JOIN runs s ON s.id = b.run_id
				WHERE s.user_id = ? AND b.question_id = a.question_id AND b.is_right)`, runID, userID, runID, userID)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	b := g.Bank()
	seen := map[string]bool{}
	for rows.Next() {
		var id string
		var here bool
		if err := rows.Scan(&id, &here); err != nil {
			return 0, 0, err
		}
		if q, ok := b.Get(id); !ok || q.Extra().Retired {
			continue
		}
		if here {
			missed++
		}
		if !seen[id] {
			seen[id] = true
			all++
		}
	}
	return missed, all, rows.Err()
}

// Mistakes is how many questions are waiting for a player's second chance.
func (g *Game) Mistakes(ctx context.Context, userID int64) (int, error) {
	ids, err := g.waiting(ctx, g.DB.Read, userID, 0)
	return len(ids), err
}

// StartMistakes starts a run of the questions waiting for a second chance (ErrNoMistakes with fewer than
// MistakesFrom); or, if the player left one unfinished today, goes on with it where it stopped, as a topic's does.
func (g *Game) StartMistakes(ctx context.Context, userID int64) (State, error) {
	var s State
	var ended int64 // the run left unfinished, if its clock has just ended it
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		today, _ := time.ParseInLocation(time.DateOnly, g.Today(), Bulgaria)
		left, err := scanRun(tx.QueryRow(`SELECT `+runColumns+` FROM runs WHERE user_id = ? AND kind = 'mistakes'
			AND finished_at IS NULL AND started_at >= ? ORDER BY id DESC LIMIT 1`, userID, store.Ms(today)))
		switch {
		case err == nil:
			done, err := g.settle(tx, left)
			if err != nil {
				return err
			}
			if !done {
				s, err = g.state(tx, left)
				return err
			}
			ended = left.id
		case !errors.Is(err, ErrNoRun):
			return err
		}
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
	if err == nil && ended != 0 {
		err = g.finished(ctx, userID, ended)
	}
	return s, err
}
