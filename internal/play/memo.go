package play

import (
	"context"
	"sync"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Some of what's worked out from all of a player's answers is asked for far more often than their answers change:
// their abilities (a mastery, a profile, a duel's draw, every achievement's measure). Going over the answers takes
// milliseconds and a sort, growing with every game the player plays; so they're kept per player (memo), with the
// version of the player's games they were worked out from (history), and worked out again only once that has moved.
//
// The version is read from the database, from the index of a player's games alone (runs_user), not told by the
// writes: no write that changes a player's games (an answer, a game's end, a game merged in or taken away) can forget
// to tell it. It's read before what it versions, so what's kept is never older than its version says.

// history is the version of a player's games: how many, the last of them, how many answers they hold, and how many
// have ended. An answer adds to answers; a game's end, to ended; a game begun, merged in or taken away changes games.
type history struct {
	games, last, answers, ended int64
}

// historyOf is the version of a player's games, as they stand now.
func (g *Game) historyOf(ctx context.Context, userID int64) (history, error) {
	var h history
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*), coalesce(max(id), 0), coalesce(sum(at), 0), count(finished_at)
		FROM runs WHERE user_id = ?`, userID).Scan(&h.games, &h.last, &h.answers, &h.ended)
	return h, err
}

// memoOf is what a kept value was worked out from: the player's games, the bank, and the questions' hardness.
type memoOf struct {
	history history
	bank    *bank.Bank
	hard    *hardnesses
}

// memoSize is how many values a memo keeps at most: the players about at once, and then some. Past it, one is let
// go to make room (any one: they're cheap to work out again, and a player who plays has theirs worked out anyway).
const memoSize = 20000

// memo keeps values worked out from players' answers, by key (with the player in it), each with what it's from.
type memo[K comparable, V any] struct {
	mu sync.Mutex
	m  map[K]memoed[V]
}

type memoed[V any] struct {
	of memoOf
	v  V
}

// get is the value kept for a key, if it's from of.
func (m *memo[K, V]) get(k K, of memoOf) (V, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.m[k]
	if !ok || e.of != of {
		var zero V
		return zero, false
	}
	return e.v, true
}

// put keeps a value for a key, from of.
func (m *memo[K, V]) put(k K, of memoOf, v V) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.m == nil {
		m.m = map[K]memoed[V]{}
	}
	if _, ok := m.m[k]; !ok && len(m.m) >= memoSize {
		for old := range m.m {
			delete(m.m, old)
			break
		}
	}
	m.m[k] = memoed[V]{of, v}
}

// memoized is the value for a key as kept, if it's from the player's games as they stand (and the bank and hardness
// given), or else worked out by work and kept.
func memoized[K comparable, V any](ctx context.Context, g *Game, m *memo[K, V], k K, userID int64, b *bank.Bank,
	hard *hardnesses, work func() (V, error)) (V, error) {
	h, err := g.historyOf(ctx, userID)
	if err != nil {
		var zero V
		return zero, err
	}
	of := memoOf{h, b, hard}
	if v, ok := m.get(k, of); ok {
		return v, nil
	}
	v, err := work()
	if err == nil {
		m.put(k, of, v)
	}
	return v, err
}
