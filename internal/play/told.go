package play

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Told once: what Начало tells a player a single time is kept on the server, so that it's told once wherever they look
// (another phone, a private window), not once on each device.
//
//   - A game's news belongs to that game (NewsOf): its result tells it as it ends. A game that ended without its result
//     on screen (the day's last question let run out with the tab in the background, a game left at its last question,
//     a Роял whose evening ended) has its news told on Начало instead, once (Untold), and not after some later game.
//   - What came of the days just missed (a reserve day kept the streak, or it ended) is said once (StreakNotice,
//     TellStreak); and a broken streak that can be won back is counted as offered once.

// UntoldWithin is how long a game's untold news waits for Начало: older, it's let go (what it earned is the player's
// all the same, and its achievements are told with the next game's news).
const UntoldWithin = 3 * 24 * time.Hour

// Untold is the latest game the player finished whose news hasn't been told (0 for none): Начало tells it (NewsOf
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

// streakKey is what a streak notice is kept by: what came of it and the day it's about.
var streakKey = regexp.MustCompile(`^(kept|ended):\d{4}-\d{2}-\d{2}$`)

// ErrNotice is a streak notice that isn't one.
var ErrNotice = errors.New("no such notice")

// StreakTold is the last streak notice the player has been told ("kept:2026-11-15", "ended:2026-11-15"; "" for none).
func (g *Game) StreakTold(ctx context.Context, userID int64) (string, error) {
	var key string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT streak_told FROM users WHERE id = ?`, userID).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return key, err
}

// TellStreak keeps a streak notice as told: fresh is whether it wasn't before. A broken streak offered to be won back
// (repair) is told as its end, so that the player doesn't hear later that it ended; and counted as offered, once.
func (g *Game) TellStreak(ctx context.Context, userID int64, key string, repair bool) (fresh bool, err error) {
	if !streakKey.MatchString(key) {
		return false, ErrNotice
	}
	res, err := g.DB.Write.ExecContext(ctx, `UPDATE users SET streak_told = ? WHERE id = ? AND streak_told <> ?`,
		key, userID, key)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n > 0 && repair {
		err = g.Tally(ctx, "repair:offered", 1)
	}
	return n > 0, err
}
