package play

import (
	"context"
	"time"
)

// Late answers. The clock is the server's (Limit), and the trip to it is no part of a player's time: an answer the
// player's screen timed within the question's limit that reaches the server after it (a slow line, a phone between
// masts, a server restarting) is taken while it comes within LateGrace of the limit's end. Any other answer counts
// within Grace only. The screen's word can't be checked: LateGrace is kept short.

// LateGrace is how late an answer the player's screen timed within its question's limit may reach the server.
const LateGrace = 15 * time.Second

// TimedOut is how many of people's answers of a kind of question ran out of time (Of: all of them), since a day: what
// the clock's floors are set by (Limit: under 2% each).
type TimedOut struct {
	Kind  string
	N, Of int
}

// TimedOutSince counts people's answers by kind since a day (YYYY-MM-DD), and those that ran out of time: no answer,
// kept at the question's whole limit (settle keeps a time run out as its limit, in whole seconds; a give-up keeps when
// it came), in games not a script's or a second play's (FairAnswers).
func (g *Game) TimedOutSince(ctx context.Context, day string) ([]TimedOut, error) {
	start, _ := dayBounds(day)
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT question_id, given IS NULL AND ms % 1000 = 0 AND ms >= 15000
		FROM answers WHERE at >= ? AND `+FairAnswers, start)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	b := g.Bank()
	by := map[string]*TimedOut{}
	for rows.Next() {
		var id string
		var out bool
		if err := rows.Scan(&id, &out); err != nil {
			return nil, err
		}
		q, ok := b.Get(id)
		if !ok {
			continue
		}
		k := q.Base().Type
		if by[k] == nil {
			by[k] = &TimedOut{Kind: k}
		}
		by[k].Of++
		if out {
			by[k].N++
		}
	}
	var list []TimedOut
	for _, k := range []string{"truefalse", "choice", "number", "order"} {
		if t := by[k]; t != nil {
			list = append(list, *t)
		}
	}
	return list, rows.Err()
}
