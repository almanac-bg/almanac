package play

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Told once: what Днес tells a player a single time is kept on the server, so that it's told once wherever they look
// (another phone, a private window), not once on each device.
//
//   - A game's news belongs to that game (NewsOf): its result tells it as it ends. A game that ended without its result
//     on screen (the day's last question let run out with the tab in the background, or a game left at its last
//     question) has its news told on Днес instead, once (Untold), and not after some later game.
//   - What came of the days just missed (the week forgave one, or the streak ended) is said once (StreakNotice,
//     TellStreak). A player back after days away (BackFrom) is welcomed back once, with the longest streak they've
//     had, in the same way.

// UntoldWithin is how long a game's untold news waits for Днес: older, it's let go (what it brought is the player's
// all the same, and its notes are told with the next game's news).
const UntoldWithin = 3 * 24 * time.Hour

// Untold is the latest game the player finished whose news hasn't been told (0 for none): Днес tells it (NewsOf
// with it marks it, and every game before it, as told).
func (g *Game) Untold(ctx context.Context, userID int64) (int64, error) {
	var id int64
	err := g.DB.Read.QueryRowContext(ctx, `SELECT id FROM runs WHERE user_id = ? AND NOT told AND finished_at >= ?
		ORDER BY finished_at DESC LIMIT 1`, userID, store.Ms(g.Now().Add(-UntoldWithin))).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return id, err
}

// streakKey is what a streak notice is kept by: what came of it and the day it's about (back: the last day played
// before a player came back, BackFrom).
var streakKey = regexp.MustCompile(`^(forgiven|ended|back):\d{4}-\d{2}-\d{2}$`)

// BackFrom is how many days after the last day played a player who comes back is welcomed back (BackOf): two days
// missed or more, so further back than a streak's end that Днес tells (StreakNotice).
const BackFrom = 3

// LastDay is the last day before today that a player finished the day's ten on ("" for none).
func (g *Game) LastDay(ctx context.Context, userID int64) (string, error) {
	var day sql.NullString
	err := g.DB.Read.QueryRowContext(ctx, `SELECT max(day) FROM runs WHERE user_id = ? AND kind = 'day'
		AND finished_at IS NOT NULL AND day < ?`, userID, g.Today()).Scan(&day)
	return day.String, err
}

// Away is whether a player whose last day played before today was this one has been away long enough to be
// welcomed back (BackFrom).
func (g *Game) Away(last string) bool {
	return last != "" && daysBetween(last, g.Today()) >= BackFrom
}

// ErrNotice is a streak notice that isn't one.
var ErrNotice = errors.New("no such notice")

// StreakTold is the last streak notice the player has been told ("forgiven:2026-11-15", "ended:2026-11-15"; "" for none).
func (g *Game) StreakTold(ctx context.Context, userID int64) (string, error) {
	var key string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT streak_told FROM users WHERE id = ?`, userID).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return key, err
}

// TellStreak keeps a streak notice as told: fresh is whether it wasn't before.
func (g *Game) TellStreak(ctx context.Context, userID int64, key string) (fresh bool, err error) {
	if !streakKey.MatchString(key) {
		return false, ErrNotice
	}
	res, err := g.DB.Write.ExecContext(ctx, `UPDATE users SET streak_told = ? WHERE id = ? AND streak_told <> ?`,
		key, userID, key)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
