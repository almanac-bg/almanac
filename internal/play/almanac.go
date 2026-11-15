package play

import (
	"context"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Моят Алманах is a player's collection of what they've learned: the fact behind every question they've answered
// right, by topic, out of all the facts the topic has. It's part of progress (progress.go): the facts collected make
// achievements of their own (a hundred, a thousand, five thousand, and every fact of a topic), and Профил says how
// many there are.

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

// factsIn is how many facts each topic has: its live questions with a fact.
func factsIn(b *bank.Bank) map[string]int {
	of := map[string]int{}
	for _, q := range b.Live("", "") {
		if q.Extra().Fact != "" {
			of[q.Base().Category]++
		}
	}
	return of
}

// learned calls fn with every question a player has answered right that has a fact (a retired one too: what was
// learned stays), newest first, with when it was first answered right.
func (g *Game) learned(ctx context.Context, userID int64, fn func(q bank.Question, at int64)) error {
	b := g.Bank()
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id, min(a.at) FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ? AND a.is_right GROUP BY a.question_id ORDER BY min(a.at) DESC`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var at int64
		if err := rows.Scan(&id, &at); err != nil {
			return err
		}
		if q, ok := b.Get(id); ok && q.Extra().Fact != "" {
			fn(q, at)
		}
	}
	return rows.Err()
}

// AlmanacOf reads a player's collection.
func (g *Game) AlmanacOf(ctx context.Context, userID int64) (Almanac, error) {
	out := Almanac{Facts: []Learned{}, Of: factsIn(g.Bank())}
	err := g.learned(ctx, userID, func(q bank.Question, at int64) {
		out.Facts = append(out.Facts, Learned{ID: q.Base().ID, Category: q.Base().Category, Question: q.Base().Text,
			Answer: bank.AnswerText(q), Fact: q.Extra().Fact, At: at})
	})
	return out, err
}

// facts are how many facts a player's almanac has, and whether it has every fact of a topic (of the topic's live
// questions: a retired question's fact counts in n, never towards a topic's whole).
type facts struct {
	n     int
	whole bool
}

// factsOf counts a player's almanac, as its achievements and Профил do.
func (g *Game) factsOf(ctx context.Context, userID int64) (facts, error) {
	var f facts
	byTopic := map[string]int{}
	err := g.learned(ctx, userID, func(q bank.Question, _ int64) {
		f.n++
		if !q.Extra().Retired {
			byTopic[q.Base().Category]++
		}
	})
	for topic, n := range factsIn(g.Bank()) {
		if byTopic[topic] >= n {
			f.whole = true
		}
	}
	return f, err
}
