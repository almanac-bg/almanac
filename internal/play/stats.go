package play

import (
	"context"
	"strconv"
	"strings"
)

// Stats is how a player stands, as Профил shows them their own: their avatar and seal (rank.go), the streak (and the
// longest they've had), and their latest games. No lifetime totals (DECISIONS.md, „The direction“).
type Stats struct {
	Avatar   string   `json:"avatar"` // shape-tone (Look)
	Seal     *Seal    `json:"seal,omitempty"`
	Streak   int      `json:"streak"`
	Best     int      `json:"best"`     // the longest streak the player has had (StreakNow)
	Week     [7]bool  `json:"week"`     // this week's days played, Monday first
	Forgiven [7]bool  `json:"forgiven"` // this week's day missed that the streak forgave
	Spare    bool     `json:"spare"`    // whether this week has its day to forgive still
	Recent   []Played `json:"recent"`
}

// Played is a finished run, as a list of games shows it.
type Played struct {
	ID       int64  `json:"id"`
	Kind     string `json:"kind"`
	Day      string `json:"day,omitempty"`
	Issue    int    `json:"issue,omitempty"` // the day's ten's: the day's issue (Issue)
	Category string `json:"category,omitempty"`
	Rights   int    `json:"rights"`
	Total    int    `json:"total"` // the questions that count (day.go): what Rights is out of
	At       int64  `json:"at"`
	// A duel's: against whom, a recording or not, and how it ended.
	Opponent string `json:"opponent,omitempty"`
	Recorded bool   `json:"recorded,omitempty"`
	Outcome  string `json:"outcome,omitempty"`
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
	if s.Seal, err = g.SealOf(ctx, userID); err != nil {
		return s, err
	}
	page, err := g.GamesOf(ctx, userID, "", "", RecentGames)
	s.Recent = page.Games
	return s, err
}

// RecentGames is how many of the latest games Профил has; GamesPage, how many a page of all of them.
const (
	RecentGames = 20
	GamesPage   = 30
)

// Games is a page of a player's games, newest first, and where the next starts (none after the last).
type Games struct {
	Games []Played `json:"games"`
	Next  string   `json:"next,omitempty"`
}

// gameKinds are the games a list of them can be narrowed to: the day's ten, games of topics, and games with others.
var gameKinds = map[string]string{
	"day":    `AND kind = 'day'`,
	"topic":  `AND kind = 'topic'`,
	"others": `AND kind = 'duel'`,
}

// GamesOf reads a page of a player's finished games, newest first: of a kind (gameKinds; any other: all), from where the
// page before ended (its Next: when and which game it ended on; "": the newest), up to limit.
func (g *Game) GamesOf(ctx context.Context, userID int64, kind, from string, limit int) (Games, error) {
	out := Games{Games: []Played{}}
	only := gameKinds[kind] // one it doesn't know: all
	at, id := int64(1<<62), int64(1<<62)
	if a, b, cut := strings.Cut(from, ":"); cut {
		x, err1 := strconv.ParseInt(a, 10, 64)
		y, err2 := strconv.ParseInt(b, 10, 64)
		if err1 == nil && err2 == nil {
			at, id = x, y
		}
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT id, kind, coalesce(day, ''), coalesce(category, ''), rights,
		`+countedOf("questions")+`, finished_at, coalesce(opponent, ''), recorded, coalesce(outcome, '')
		FROM runs WHERE user_id = ? AND finished_at IS NOT NULL `+only+` AND (finished_at < ? OR finished_at = ? AND id < ?)
		ORDER BY finished_at DESC, id DESC LIMIT ?`, userID, at, at, id, limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var p Played
		if err := rows.Scan(&p.ID, &p.Kind, &p.Day, &p.Category, &p.Rights, &p.Total, &p.At, &p.Opponent, &p.Recorded, &p.Outcome); err != nil {
			return out, err
		}
		if p.Outcome != "" && p.Opponent == "" {
			p.Opponent = GoneName // a duel's result keeps no name of a player who has gone (Forget)
		}
		if p.Kind == "day" {
			p.Issue = Issue(p.Day)
		}
		out.Games = append(out.Games, p)
	}
	if len(out.Games) > limit {
		out.Games = out.Games[:limit]
		last := out.Games[limit-1]
		out.Next = strconv.FormatInt(last.At, 10) + ":" + strconv.FormatInt(last.ID, 10)
	}
	return out, rows.Err()
}

