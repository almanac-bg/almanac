package play

import (
	"context"
)

// Stats is how a player stands, as Профил shows them their own: their avatar, each chapter's ink (rank.go: Профил's seals), the streak as it is
// now (never the longest: an ended streak's number is never named). No lifetime totals, and no list of past games: a
// game isn't gone over after its day (DECISIONS.md, „The direction“ and „Removed to keep the game simple“).
type Stats struct {
	Avatar string `json:"avatar"` // a shape (Look)
	// Ink is each chapter's ink as the book has it now, the number its Алманах card shows (InkOf: an issue still being
	// played in it too, which the ranks count as it finishes): Профил's seals say it beside each rank.
	Ink      map[string]int `json:"ink,omitempty"`
	Streak   int            `json:"streak"`
	Week     [7]bool        `json:"week"`     // this week's days played, Monday first
	Forgiven [7]bool        `json:"forgiven"` // this week's day missed that the streak forgave
	Spare    bool           `json:"spare"`    // whether this week has a day to forgive still
}

// StatsOf reads a player's stats.
func (g *Game) StatsOf(ctx context.Context, userID int64) (Stats, error) {
	var s Stats
	look, err := g.LookOf(ctx, userID)
	if err != nil {
		return s, err
	}
	s.Avatar = look.Avatar
	streak, err := g.StreakOf(ctx, userID)
	if err != nil {
		return s, err
	}
	s.Streak, s.Spare, s.Forgiven = streak.Days, streak.Spare, g.InWeek(streak.Forgiven)
	if s.Week, err = g.Week(ctx, userID); err != nil {
		return s, err
	}
	s.Ink, err = g.InkOf(ctx, userID)
	return s, err
}
