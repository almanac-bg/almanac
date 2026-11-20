package play

import (
	"context"
	"database/sql"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Late answers. The clock is the server's (Limit), and the trip to it is no part of a player's time: an answer the
// player's screen timed within the question's limit that reaches the server after it (a slow line, a phone between
// masts, a server restarting) is taken while it comes within LateGrace of the limit's end. Any other answer counts
// within Grace only. The screen's word can't be checked, and LateGrace is time to look an answer up, so each answer
// taken late is kept (late_answers: its run, its place, how late) and /admin counts them by player (LateAnswerers), as
// it counts the days played after throwaway guests (fair.go): a player with many of them, often, has a screen that
// says what it shouldn't, and only a person can tell.

// LateGrace is how late an answer the player's screen timed within its question's limit may reach the server.
const LateGrace = 15 * time.Second

// LateKept is how long the late answers are kept for /admin: a month of them.
const LateKept = 30 * 24 * time.Hour

// keepLate keeps an answer taken late: question n of run runID, late after its limit, taken at at.
func keepLate(tx *sql.Tx, runID int64, n int, late time.Duration, at time.Time) error {
	_, err := tx.Exec(`INSERT OR IGNORE INTO late_answers (run_id, n, late_ms, at) VALUES (?, ?, ?, ?)`,
		runID, n, late.Milliseconds(), store.Ms(at))
	return err
}

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
	for _, k := range []string{"truefalse", "choice", "number", "order", "match", "split", "clues"} {
		if t := by[k]; t != nil {
			list = append(list, *t)
		}
	}
	return list, rows.Err()
}

// LateAnswerer is a player whose answers were taken late (LateGrace) within LateKept: how many, of how many answers
// they gave in that time, and how late the latest came.
type LateAnswerer struct {
	Name, Tag string
	Late      int
	Answers   int
	MostMs    int64
}

// LateAnswerers are the n players with the most answers taken late within LateKept, the most first (JudgeNets lets
// go of the older ones).
func (g *Game) LateAnswerers(ctx context.Context, n int) ([]LateAnswerer, error) {
	since := store.Ms(g.Now().Add(-LateKept))
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.name, u.tag, count(*), max(l.late_ms),
			(SELECT count(*) FROM runs r2 JOIN answers a ON a.run_id = r2.id WHERE r2.user_id = u.id AND a.at >= ?1)
		FROM late_answers l JOIN runs r ON r.id = l.run_id JOIN users u ON u.id = r.user_id
		WHERE l.at >= ?1 GROUP BY u.id ORDER BY count(*) DESC, u.id LIMIT ?2`, since, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LateAnswerer
	for rows.Next() {
		var l LateAnswerer
		if err := rows.Scan(&l.Name, &l.Tag, &l.Late, &l.MostMs, &l.Answers); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
