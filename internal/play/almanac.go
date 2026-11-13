package play

import (
	"context"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Моят Алманах is a player's collection of what they've learned: the fact behind every question they've answered
// right, by topic, out of all the facts the topic has.

// Learned is one fact in a player's almanac: the question, its answer, and the fact behind it.
type Learned struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Question string `json:"question"`
	Answer   string `json:"answer"`
	Fact     string `json:"fact"`
	At       int64  `json:"at"` // when it was first answered right
}

// Almanac is a player's collection, newest first, and how many facts each topic has in all.
type Almanac struct {
	Facts []Learned      `json:"facts"`
	Of    map[string]int `json:"of"`
}

// AlmanacOf reads a player's collection.
func (g *Game) AlmanacOf(ctx context.Context, userID int64) (Almanac, error) {
	b := g.Bank()
	out := Almanac{Facts: []Learned{}, Of: map[string]int{}}
	for _, q := range b.Live("", "") {
		if q.Extra().Fact != "" {
			out.Of[q.Base().Category]++
		}
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id, min(a.at) FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ? AND a.is_right GROUP BY a.question_id ORDER BY min(a.at) DESC`, userID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var at int64
		if err := rows.Scan(&id, &at); err != nil {
			return out, err
		}
		q, ok := b.Get(id)
		if !ok || q.Extra().Fact == "" {
			continue
		}
		out.Facts = append(out.Facts, Learned{
			ID: id, Category: q.Base().Category, Question: q.Base().Text, Answer: bank.AnswerText(q), Fact: q.Extra().Fact, At: at,
		})
	}
	return out, rows.Err()
}
