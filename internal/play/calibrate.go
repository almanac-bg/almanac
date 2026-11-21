package play

import (
	"context"
	"database/sql"
	"slices"
	"strings"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Calibration checks each question's difficulty against what players have done with it. A label is a writer's
// judgement; answers are the truth. The game leans on difficulty — a run goes from easy to hard, a topic run follows
// how well a player knows it — so a label that disagrees with the answers is
// worth judging again. The answers are people's: a game played at a script's speed says nothing of how hard a
// question is (fair.go).
//
// The share of right answers is compared after taking away what guessing alone would get right (rightChance: a
// quarter on a choice, half on a true-or-not, one in six on an order): what's left is how much players knew. Right,
// not a score: a close number counts as not right, as everywhere else.

// CalibrateFrom is how many answers a question needs before its answers say how hard it is.
const CalibrateFrom = 30

// Knowledge bands: what players knew, above chance, for each difficulty (the rubric in .claude/skills/questions).
const (
	EasyFrom   = 0.65 // most players know it
	MediumFrom = 0.35 // about half do
)

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
	Right    float64         `json:"right"` // the share right, 0–1
	Known    float64         `json:"known"` // above chance, 0–1
	Observed bank.Difficulty `json:"observed"`
}

// Calibrate reads every live question with enough answers, the ones whose label disagrees with them first (the
// furthest off first).
func (g *Game) Calibrate(ctx context.Context) ([]Calibrated, error) {
	// By version, and by the hour, so that only the answers to a question as it is now count (versions.go: those from
	// before versions were kept, by the day it last changed).
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT question_id, version, at / 3600000, count(*), sum(is_right) FROM answers
		WHERE `+FairAnswers+` GROUP BY question_id, version, at / 3600000`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	b := g.Bank()
	sums := map[string]*Calibrated{}
	for rows.Next() {
		var id string
		var version sql.NullInt64
		var hour int64
		var n int
		var sum int
		if err := rows.Scan(&id, &version, &hour, &n, &sum); err != nil {
			return nil, err
		}
		q, ok := b.Get(id)
		if !ok || q.Extra().Retired {
			continue
		}
		if c := g.CountedOf(q); version.Valid && version.Int64 != c.Version || !version.Valid && (hour+1)*3600000 <= c.From {
			continue
		}
		c := sums[id]
		if c == nil {
			c = &Calibrated{ID: id}
			sums[id] = c
		}
		c.Answers += n
		c.Right += float64(sum)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []Calibrated
	for _, s := range sums {
		if s.Answers < CalibrateFrom {
			continue
		}
		c := *s
		c.Right /= float64(c.Answers)
		q, _ := b.Get(c.ID)
		h := q.Base()
		c.Category, c.Type, c.Labelled = h.Category, h.Type, h.Difficulty
		guess := rightChance[h.Type]
		c.Known = max(0, (c.Right-guess)/(1-guess))
		c.Observed = KnownToDifficulty(c.Known)
		out = append(out, c)
	}
	rank := map[bank.Difficulty]int{bank.Easy: 0, bank.Medium: 1, bank.Hard: 2}
	off := func(c Calibrated) int {
		return max(rank[c.Observed]-rank[c.Labelled], rank[c.Labelled]-rank[c.Observed])
	}
	slices.SortStableFunc(out, func(a, b Calibrated) int {
		if d := off(b) - off(a); d != 0 {
			return d
		}
		if d := b.Answers - a.Answers; d != 0 {
			return d
		}
		return strings.Compare(a.ID, b.ID)
	})
	return out, nil
}
