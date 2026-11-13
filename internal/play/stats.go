package play

import (
	"context"
	"slices"
)

// Stats is how a player has done: the streak, how much they've played, and how well in each topic.
type Stats struct {
	Streak  int          `json:"streak"`
	Week    [7]bool      `json:"week"`    // this week's days played, Monday first
	Days    int          `json:"days"`    // days' questions finished
	Games   int          `json:"games"`   // runs finished, of every kind
	Answers int          `json:"answers"` // questions answered (or timed out)
	Duels   int          `json:"duels"`
	Won     int          `json:"won"`
	Right   int          `json:"right"`
	Topics  []TopicStats `json:"topics"`
	Recent  []Played     `json:"recent"`
}

type TopicStats struct {
	Category string `json:"category"`
	Answers  int    `json:"answers"`
	Right    int    `json:"right"`
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
	var err error
	if s.Streak, err = g.Streak(ctx, userID); err != nil {
		return s, err
	}
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
	if s.Topics, s.Answers, s.Right, err = g.topicStats(ctx, userID); err != nil {
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
	slices.SortStableFunc(s.Topics, func(a, b TopicStats) int { return b.Answers - a.Answers })
	return s, rows.Err()
}

// topicStats is how a player has done in each topic (in the bank's order, those they've played), and over all their
// answers.
func (g *Game) topicStats(ctx context.Context, userID int64) (topics []TopicStats, answers, right int, err error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id, a.is_right FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ?`, userID)
	if err != nil {
		return nil, 0, 0, err
	}
	defer rows.Close()
	b := g.Bank()
	byTopic := map[string]*TopicStats{}
	for rows.Next() {
		var id string
		var ok bool
		if err := rows.Scan(&id, &ok); err != nil {
			return nil, 0, 0, err
		}
		answers++
		if ok {
			right++
		}
		q, found := b.Get(id)
		if !found {
			continue
		}
		c := q.Base().Category
		if byTopic[c] == nil {
			byTopic[c] = &TopicStats{Category: c}
		}
		byTopic[c].Answers++
		if ok {
			byTopic[c].Right++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, 0, 0, err
	}
	topics = []TopicStats{}
	for _, c := range b.Categories { // in the bank's order
		if t := byTopic[c.ID]; t != nil {
			topics = append(topics, *t)
		}
	}
	return topics, answers, right, nil
}
