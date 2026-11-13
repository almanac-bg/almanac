package play

import (
	"context"
	"slices"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Calibration checks each question's difficulty against what players have done with it. A label is a writer's
// judgement; answers are the truth. The game leans on difficulty — a run goes from easy to hard, a topic run follows
// how well a player knows it, Роял's rounds are easy, medium, hard — so a label that disagrees with the answers is
// worth judging again.
//
// A score is compared after taking away what guessing alone would get (a quarter on a choice, half on a true-or-not,
// what an order or a match put down at random is worth, nothing on a number): what's left is how much players knew.

// CalibrateFrom is how many answers a question needs before its answers say how hard it is.
const CalibrateFrom = 30

// Knowledge bands: what players knew, above chance, for each difficulty (the rubric in .claude/skills/questions).
const (
	EasyFrom   = 0.65 // most players know it
	MediumFrom = 0.35 // about half do
)

// chance is the score a guess gets on average, by kind of question.
// An order's and a match's grading already takes most of the luck out (bank.orderScore, bank.matchScore): at random,
// four items in order are worth 7/36 on average, four pairs 1/8.
var chance = map[string]float64{"choice": 0.25, "truefalse": 0.5, "order": 7.0 / 36, "match": 0.125, "number": 0}

// KnownToDifficulty is the difficulty a share of knowledge (above chance) points to.
func KnownToDifficulty(known float64) bank.Difficulty {
	switch {
	case known >= EasyFrom:
		return bank.Easy
	case known >= MediumFrom:
		return bank.Medium
	}
	return bank.Hard
}

// Calibrated is a question as its answers show it.
type Calibrated struct {
	ID       string          `json:"id"`
	Category string          `json:"category"`
	Type     string          `json:"type"`
	Labelled bank.Difficulty `json:"labelled"`
	Answers  int             `json:"answers"`
	Score    float64         `json:"score"` // the mean, 0–1
	Known    float64         `json:"known"` // above chance, 0–1
	Observed bank.Difficulty `json:"observed"`
}

// Calibrate reads every live question with enough answers, the ones whose label disagrees with them first (the
// furthest off first).
func (g *Game) Calibrate(ctx context.Context) ([]Calibrated, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT question_id, count(*), avg(score) FROM answers
		GROUP BY question_id HAVING count(*) >= ?`, CalibrateFrom)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	b := g.Bank()
	var out []Calibrated
	for rows.Next() {
		var c Calibrated
		if err := rows.Scan(&c.ID, &c.Answers, &c.Score); err != nil {
			return nil, err
		}
		q, ok := b.Get(c.ID)
		if !ok || q.Extra().Retired {
			continue
		}
		h := q.Base()
		c.Category, c.Type, c.Labelled = h.Category, h.Type, h.Difficulty
		guess := chance[h.Type]
		c.Known = max(0, (c.Score-guess)/(1-guess))
		c.Observed = KnownToDifficulty(c.Known)
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rank := map[bank.Difficulty]int{bank.Easy: 0, bank.Medium: 1, bank.Hard: 2}
	off := func(c Calibrated) int {
		return max(rank[c.Observed]-rank[c.Labelled], rank[c.Labelled]-rank[c.Observed])
	}
	slices.SortStableFunc(out, func(a, b Calibrated) int {
		if d := off(b) - off(a); d != 0 {
			return d
		}
		return b.Answers - a.Answers
	})
	return out, nil
}
