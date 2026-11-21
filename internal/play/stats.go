package play

import (
	"context"
)

// Stats is how a player stands, as Профил shows them their own: their avatar and seal (rank.go), the streak (and the
// longest they've had). No lifetime totals, and no list of past games: a game isn't gone over after its day
// (DECISIONS.md, „The direction“ and „Removed to keep the game simple“).
type Stats struct {
	Avatar string `json:"avatar"` // shape-tone (Look)
	Seal   *Seal  `json:"seal,omitempty"`
	// Ink is the worn seal's chapter's ink as the book has it now, the number its Алманах card shows (InkOf: an issue
	// still being played in it too, which the seal counts as it finishes).
	Ink      int     `json:"ink,omitempty"`
	Streak   int     `json:"streak"`
	Best     int     `json:"best"`     // the longest streak the player has had (StreakNow)
	Week     [7]bool `json:"week"`     // this week's days played, Monday first
	Forgiven [7]bool `json:"forgiven"` // this week's day missed that the streak forgave
	Spare    bool    `json:"spare"`    // whether this week has a day to forgive still
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
	s.Streak, s.Best, s.Spare, s.Forgiven = streak.Days, streak.Best, streak.Spare, g.InWeek(streak.Forgiven)
	if s.Week, err = g.Week(ctx, userID); err != nil {
		return s, err
	}
	if s.Seal, err = g.SealOf(ctx, userID); err != nil || s.Seal == nil {
		return s, err
	}
	ink, err := g.InkOf(ctx, userID)
	s.Ink = ink[s.Seal.Chapter]
	return s, err
}
