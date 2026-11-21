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

// Lines are what Приятели tells a player once, in a line over their friends, of what others did with them while they
// were away: a friend said yes to their request (AcceptedOf). Each is told once wherever the player is signed in (Told keeps it), and only while it's news (LinesRecent).

// LinesRecent is how long a line waits to be told: past it, it's old news.
const LinesRecent = 7 * 24 * time.Hour

// lineKey is what a told line is kept as: "friend:<their id>".
var lineKey = regexp.MustCompile(`^(friend):([0-9]{1,12})$`)

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
			AND NOT EXISTS (SELECT 1 FROM today_lines WHERE user_id = ?1 AND what = 'friend:' || f.friend_id)
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

// Told keeps a line as told to the player: it isn't told again, on any device.
func (g *Game) Told(ctx context.Context, userID int64, line string) error {
	m := lineKey.FindStringSubmatch(line)
	if m == nil {
		return ErrNoLine
	}
	// Only a line the player could have been told: of a friend of theirs (anything else would let a script fill the
	// table).
	id, _ := strconv.ParseInt(m[2], 10, 64)
	var ok bool
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?)`,
		userID, id).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrNoLine
	}
	_, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO today_lines (user_id, what, at) VALUES (?, ?, ?)`,
		userID, line, store.Ms(g.Now()))
	return err
}
