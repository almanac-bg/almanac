package play

import (
	"context"
	"slices"
	"strconv"
	"strings"
)

// Stats is how a player has done: the streak (and the longest they've had), how much they've played, the facts
// they've collected, and how well they know each topic.
type Stats struct {
	Streak  int     `json:"streak"`
	Best    int     `json:"best"`    // the longest streak the player has had (StreakNow)
	Week    [7]bool `json:"week"`    // this week's days played, Monday first
	Saved   [7]bool `json:"saved"`   // this week's days a reserve day or a repair kept the streak through
	Reserve int     `json:"reserve"` // reserve days in hand
	Next    int     `json:"next"`    // days in a row to the next reserve day (0: they are full)
	// Repair is a broken streak on offer to be won back today (repair.go), as Начало offers it: the streak shows as
	// that, not as none.
	Repair  *Repair `json:"repair,omitempty"`
	Days    int     `json:"days"`    // days' questions finished
	Games   int     `json:"games"`   // runs finished, of every kind
	Answers int     `json:"answers"` // questions answered (or timed out)
	Duels   int     `json:"duels"`
	Won     int     `json:"won"`
	Right   int     `json:"right"`
	Facts   int     `json:"facts"` // facts in the player's almanac (almanac.go)
	// Spread is how the day's ten have gone, over every day played: how many days had 0 right, 1, … 10. Today is
	// today's right answers, -1 before they're played.
	Spread [Length + 1]int `json:"spread"`
	Today  int             `json:"today"`
	Recent []Played        `json:"recent"`
	// Mastery is how well the player knows each topic, in the bank's order.
	Mastery []Mastery `json:"mastery"`
}

// Played is a finished run, as a list of games shows it.
type Played struct {
	ID       int64  `json:"id"`
	Kind     string `json:"kind"`
	Day      string `json:"day,omitempty"`
	Issue    int    `json:"issue,omitempty"` // the day's ten's: the day's issue (Issue)
	Category string `json:"category,omitempty"`
	Rights   int    `json:"rights"`
	Total    int    `json:"total"`
	Points   int    `json:"points"`
	At       int64  `json:"at"`
	// A duel's: against whom, a recording or not, and how it ended.
	Opponent string `json:"opponent,omitempty"`
	Recorded bool   `json:"recorded,omitempty"`
	Outcome  string `json:"outcome,omitempty"`
}

// StatsOf reads a player's stats.
func (g *Game) StatsOf(ctx context.Context, userID int64) (Stats, error) {
	var s Stats
	streak, err := g.StreakOf(ctx, userID)
	if err != nil {
		return s, err
	}
	s.Streak, s.Best, s.Reserve, s.Next, s.Saved = streak.Days, streak.Best, streak.Reserve, streak.Next, g.InWeek(slices.Concat(streak.Saved, streak.Mended))
	if s.Week, err = g.Week(ctx, userID); err != nil {
		return s, err
	}
	if s.Repair, err = g.RepairOf(ctx, userID); err != nil {
		return s, err
	}
	db := g.DB.Read
	err = db.QueryRowContext(ctx, `SELECT count(*), count(*) FILTER (WHERE kind = 'day'),
		(SELECT count(*) FROM `+duelResults+`), (SELECT count(*) FROM `+duelResults+` WHERE outcome = 'won')
		FROM runs WHERE user_id = ?1 AND finished_at IS NOT NULL`, userID).
		Scan(&s.Games, &s.Days, &s.Duels, &s.Won)
	if err != nil {
		return s, err
	}
	if s.Answers, s.Right, err = g.answered(ctx, userID, false); err != nil {
		return s, err
	}
	f, err := g.factsOf(ctx, userID)
	if err != nil {
		return s, err
	}
	s.Facts = f.n
	if s.Mastery, err = g.MasteryOf(ctx, userID); err != nil {
		return s, err
	}
	if err := g.spread(ctx, userID, &s); err != nil {
		return s, err
	}
	page, err := g.GamesOf(ctx, userID, "", "", RecentGames)
	s.Recent = page.Games
	return s, err
}

// spread counts the day's ten played by their right answers, and today's (Stats.Spread, Stats.Today).
func (g *Game) spread(ctx context.Context, userID int64, s *Stats) error {
	s.Today = -1
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT day, rights FROM runs WHERE user_id = ? AND kind = 'day'
		AND finished_at IS NOT NULL`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	today := g.Today()
	for rows.Next() {
		var day string
		var rights int
		if err := rows.Scan(&day, &rights); err != nil {
			return err
		}
		rights = min(max(rights, 0), Length)
		s.Spread[rights]++
		if day == today {
			s.Today = rights
		}
	}
	return rows.Err()
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

// gameKinds are the games a list of them can be narrowed to: the day's ten, games of topics (a second chance is
// one), and games with others.
var gameKinds = map[string]string{
	"day":    `AND kind IN ('day', 'past')`,
	"topic":  `AND kind IN ('topic', 'mistakes')`,
	"others": `AND kind IN ('duel', 'challenge', 'royal', 'room')`,
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
		points, json_array_length(questions), finished_at, coalesce(opponent, ''), recorded, coalesce(outcome, '')
		FROM runs WHERE user_id = ? AND finished_at IS NOT NULL `+only+` AND (finished_at < ? OR finished_at = ? AND id < ?)
		ORDER BY finished_at DESC, id DESC LIMIT ?`, userID, at, at, id, limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var p Played
		if err := rows.Scan(&p.ID, &p.Kind, &p.Day, &p.Category, &p.Rights, &p.Points, &p.Total, &p.At, &p.Opponent, &p.Recorded, &p.Outcome); err != nil {
			return out, err
		}
		if p.Outcome != "" && p.Opponent == "" {
			p.Opponent = GoneName // a duel's result keeps no name of a player who has gone (Forget)
		}
		if p.Kind == "day" || p.Kind == "past" {
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

// answered is how many questions a player has answered (or let run out of time), and how many of them right; finished:
// in the games they finished only (what others see of them, ProfileOf: never a game under way, answer by answer).
func (g *Game) answered(ctx context.Context, userID int64, finished bool) (answers, right int, err error) {
	err = g.DB.Read.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(a.is_right), 0) FROM answers a
		JOIN runs r ON r.id = a.run_id WHERE r.user_id = ? AND (NOT ? OR r.finished_at IS NOT NULL)`, userID, finished).
		Scan(&answers, &right)
	return answers, right, err
}
