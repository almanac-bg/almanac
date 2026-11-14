package play

import "context"

// Stats is how a player has done: the streak, how much they've played, and how well they know each topic.
type Stats struct {
	Streak  int      `json:"streak"`
	Week    [7]bool  `json:"week"`    // this week's days played, Monday first
	Saved   [7]bool  `json:"saved"`   // this week's days a reserve day kept the streak through
	Reserve int      `json:"reserve"` // reserve days in hand
	Days    int      `json:"days"`    // days' questions finished
	Games   int      `json:"games"`   // runs finished, of every kind
	Answers int      `json:"answers"` // questions answered (or timed out)
	Duels   int      `json:"duels"`
	Won     int      `json:"won"`
	Right   int      `json:"right"`
	Recent  []Played `json:"recent"`
	// Mastery is how well the player knows each topic, in the bank's order.
	Mastery []Mastery `json:"mastery"`
}

// Played is a finished run, as a list of games shows it.
type Played struct {
	ID       int64  `json:"id"`
	Kind     string `json:"kind"`
	Day      string `json:"day,omitempty"`
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
	s.Streak, s.Reserve, s.Saved = streak.Days, streak.Reserve, g.InWeek(streak.Saved)
	if s.Week, err = g.Week(ctx, userID); err != nil {
		return s, err
	}
	db := g.DB.Read
	err = db.QueryRowContext(ctx, `SELECT count(*), count(*) FILTER (WHERE kind = 'day'), count(*) FILTER (WHERE kind = 'duel'),
		count(*) FILTER (WHERE outcome = 'won') FROM runs WHERE user_id = ? AND finished_at IS NOT NULL`, userID).
		Scan(&s.Games, &s.Days, &s.Duels, &s.Won)
	if err != nil {
		return s, err
	}
	if s.Answers, s.Right, err = g.answered(ctx, userID); err != nil {
		return s, err
	}
	if s.Mastery, err = g.MasteryOf(ctx, userID); err != nil {
		return s, err
	}
	rows, err := db.QueryContext(ctx, `SELECT id, kind, coalesce(day, ''), coalesce(category, ''), rights, points,
		json_array_length(questions), finished_at, coalesce(opponent, ''), recorded, coalesce(outcome, '')
		FROM runs WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 20`, userID)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	s.Recent = []Played{}
	for rows.Next() {
		var p Played
		if err := rows.Scan(&p.ID, &p.Kind, &p.Day, &p.Category, &p.Rights, &p.Points, &p.Total, &p.At, &p.Opponent, &p.Recorded, &p.Outcome); err != nil {
			return s, err
		}
		s.Recent = append(s.Recent, p)
	}
	return s, rows.Err()
}

// answered is how many questions a player has answered (or let run out of time), and how many of them right.
func (g *Game) answered(ctx context.Context, userID int64) (answers, right int, err error) {
	err = g.DB.Read.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(a.is_right), 0) FROM answers a
		JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?`, userID).Scan(&answers, &right)
	return answers, right, err
}
