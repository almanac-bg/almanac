package play

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Lines are what Начало tells a player once, in a line above the day, of what others did with them while they were
// away: a friend said yes to their request (AcceptedOf), or what came of a live duel they left (LeftOf: it went on
// without them). Each is told once wherever the player is signed in (Told keeps it), and only while it's news (LinesRecent).

// LinesRecent is how long a line waits to be told: past it, it's old news.
const LinesRecent = 7 * 24 * time.Hour

// lineKey is what a told line is kept as: "friend:<their id>", "left:<the duel's id>".
var lineKey = regexp.MustCompile(`^(friend|left):([0-9]{1,12})$`)

// ErrNoLine is a line that isn't one of the game's.
var ErrNoLine = errors.New("no such line")

// Accepted is a friend who said yes to the player's request.
type Accepted struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	// Line is what it's told as (Told).
	Line string `json:"line"`
}

// AcceptedOf is the latest friend who said yes to the player in the last LinesRecent and hasn't been told of yet; or
// nil.
func (g *Game) AcceptedOf(ctx context.Context, userID int64) (*Accepted, error) {
	var a Accepted
	err := g.DB.Read.QueryRowContext(ctx, `SELECT f.friend_id, u.name FROM friends f JOIN users u ON u.id = f.friend_id
		WHERE f.user_id = ?1 AND f.asked = 1 AND f.since >= ?2
			AND NOT EXISTS (SELECT 1 FROM home_lines WHERE user_id = ?1 AND what = 'friend:' || f.friend_id)
		ORDER BY f.since DESC LIMIT 1`, userID, store.Ms(g.Now().Add(-LinesRecent))).Scan(&a.ID, &a.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a.Line = fmt.Sprintf("friend:%d", a.ID)
	return &a, nil
}

// Left is a live duel the player left under way, and what came of it: it went on without them.
type Left struct {
	DuelID int64  `json:"id"`
	Them   string `json:"them"`
	// After is how many questions they had played when they left.
	After int `json:"after"`
	// State is how it ended for them: won, lost or draw.
	State string `json:"state"`
	Delta int    `json:"delta,omitempty"`
	Line  string `json:"line"`
}

// LeftOf is the latest live duel the player left under way, in the last LinesRecent, not told of yet; or nil.
func (g *Game) LeftOf(ctx context.Context, userID int64) (*Left, error) {
	var l Left
	var mine bool
	var outcome string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT d.id, d.a_id = ?1, d.outcome, u.name,
			CASE WHEN d.a_id = ?1 THEN d.a_left ELSE d.b_left END,
			coalesce(CASE WHEN d.a_id = ?1 THEN d.a_delta ELSE d.b_delta END, 0)
		FROM duels d JOIN users u ON u.id = CASE WHEN d.a_id = ?1 THEN d.b_id ELSE d.a_id END
		WHERE (d.a_id = ?1 AND d.a_left IS NOT NULL OR d.b_id = ?1 AND d.b_left IS NOT NULL)
			AND d.outcome IN ('a', 'b', 'draw') AND d.ended_at >= ?2
			AND NOT EXISTS (SELECT 1 FROM home_lines WHERE user_id = ?1 AND what = 'left:' || d.id)
		ORDER BY d.ended_at DESC LIMIT 1`, userID, store.Ms(g.Now().Add(-LinesRecent))).
		Scan(&l.DuelID, &mine, &outcome, &l.Them, &l.After, &l.Delta)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	won := map[bool]string{true: "a", false: "b"}[mine]
	switch outcome {
	case won:
		l.State = "won"
	case "draw":
		l.State = "draw"
	default:
		l.State = "lost"
	}
	l.Line = fmt.Sprintf("left:%d", l.DuelID)
	return &l, nil
}

// Told keeps a line as told to the player: it isn't told again, on any device.
func (g *Game) Told(ctx context.Context, userID int64, line string) error {
	m := lineKey.FindStringSubmatch(line)
	if m == nil {
		return ErrNoLine
	}
	// Only a line the player could have been told: of a friend of theirs, or a duel of theirs (anything else would
	// let a script fill the table).
	id, _ := strconv.ParseInt(m[2], 10, 64)
	q := `SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?)`
	if m[1] == "left" {
		q = `SELECT EXISTS (SELECT 1 FROM duels WHERE (a_id = ?1 OR b_id = ?1) AND id = ?2)`
	}
	var ok bool
	if err := g.DB.Read.QueryRowContext(ctx, q, userID, id).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrNoLine
	}
	_, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO home_lines (user_id, what, at) VALUES (?, ?, ?)`,
		userID, line, store.Ms(g.Now()))
	return err
}

// LeftLive keeps that a player left a live duel for good after playing `after` of its questions (it went on without
// them): its result says so.
func (g *Game) LeftLive(ctx context.Context, duelID, userID int64, after int) error {
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE duels SET
			a_left = CASE WHEN a_id = ?2 THEN ?3 ELSE a_left END,
			b_left = CASE WHEN b_id = ?2 THEN ?3 ELSE b_left END
		WHERE id = ?1`, duelID, userID, after)
	return err
}
