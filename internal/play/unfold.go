package play

import (
	"context"
	"database/sql"
	"slices"
	"strings"
)

// The game unfolds: a new player meets its systems one at a time, as each starts to matter, by what they have done
// (the days they've played, a duel or a Роял), never by the date.
//
//   - From the first game: the game's points (how well it went, and the day's board), the streak, the topics, and the
//     achievements a game earns with what they unlock (but what the level unlocks).
//   - From the second day played (XPFromDay): XP, with the level it makes (anyone's: a first day sees no level on
//     another's avatar either), what the level unlocks, and the day's goals that pay it.
//   - From the first game that moved the rating (a duel, a Роял): the rating, being set; its division once it is
//     (rating.go, Placed).
//
// Nothing waits to be earned, only to be shown: XP, achievements, unlocks and the rating all count
// from the first game, and what was held is told when its system opens (NewsOf), not lost. Each system is told once,
// quietly, as it opens: a line in that game's news (News.Opened). A topic's mastery needs no rule here: it shows as a
// first estimate once a topic has a few answers (Mastery.First), and with its tier once its mark is sure
// (Mastery.Sure). Награди (ProgressOf) shows the achievements of the systems open, and their XP once XP is.

// XPFromDay is the day played that XP, the level and the day's goals show from.
const XPFromDay = 2

// Open is which of the game's systems a player has met: what their screens show.
type Open struct {
	// Points are the game's score: open from the first game finished.
	Points bool `json:"points"`
	// XP is what playing earns, with the level and the day's goals.
	XP bool `json:"xp"`
	// Rating is strength in duels and Роял, with its division.
	Rating bool `json:"rating"`
}

// Systems are the systems a player meets, in the order they usually come, by the names News.Opened tells them by.
var Systems = []string{"points", "xp", "rating"}

// OpenTo is what a player who has played on so many days, and had so many games that moved their rating, has met.
func OpenTo(days, rated int) Open {
	return Open{Points: days >= 1, XP: days >= XPFromDay, Rating: rated > 0}
}

// has is whether a system, by name, is open.
func (o Open) has(system string) bool {
	switch system {
	case "points":
		return o.Points
	case "xp":
		return o.XP
	case "rating":
		return o.Rating
	}
	return false
}

// OpenOf is what a player has met: from the days they've finished a game on (in Bulgaria) and their rated games.
func (g *Game) OpenOf(ctx context.Context, userID int64) (Open, error) {
	return openOf(ctx, g.DB.Read, userID)
}

func openOf(ctx context.Context, db interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, userID int64) (Open, error) {
	var days, rated int
	err := db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM (SELECT DISTINCT `+bulgarianDate("finished_at")+` FROM runs
			WHERE user_id = ?1 AND finished_at IS NOT NULL LIMIT ?2)),
		coalesce((SELECT rated FROM users WHERE id = ?1), 0)`, userID, XPFromDay).Scan(&days, &rated)
	return OpenTo(days, rated), err
}

// systemOf is the system an achievement belongs to, held while it's closed ("" for one told from the first game): a
// day's goals done are XP's.
func systemOf(id string) string {
	switch id {
	case "fullDay", "fullDays30":
		return "xp"
	}
	return ""
}

// opened are the systems open now that a player hasn't been told of (told: the ones they have, space-separated).
func opened(o Open, told string) []string {
	have := strings.Fields(told)
	var out []string
	for _, s := range Systems {
		if o.has(s) && !slices.Contains(have, s) {
			out = append(out, s)
		}
	}
	return out
}
