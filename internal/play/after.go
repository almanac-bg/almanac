package play

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// After a run: once its last answer is kept, a run has more to do, each in a write of its own: a challenge's time
// starts and the friends it was sent to are told (sent), its duel is settled once both sides have played
// (settleRun), and what it earned is kept (afterRun: a streak mended, achievements, the day's goals, a place in the
// week's league). The transaction that finishes the run notes that it's due (runs_after, afterDue), so none of it is
// lost to a closed connection or a restart in between: the request that finished the run does it at once, on a
// context of its own that the player leaving doesn't cancel (finished), and the sweep each minute does whatever that
// left (AfterDue), a few times more, waiting longer each time, before it gives up. All of it may be done again
// safely: a duel is settled once, an achievement or a goal kept once.
//
// It never fails the request that finished the run: the answer is kept, whatever happens after it.
//
// A Роял's runs aren't noted here: the evening keeps what they earned off its clock (AfterRoyal).
const (
	// afterFor is the most the request that finished a run gives what follows it.
	afterFor = 30 * time.Second
	// afterOwn is how long what follows a run is the finishing request's alone, before the sweep may take it.
	afterOwn = time.Minute
	// afterTries is how many times the sweep tries what follows a run before it gives up (with an error in the log).
	afterTries = 8
	// afterBatch is how many runs one sweep takes.
	afterBatch = 100
)

// afterDue notes, in the transaction that finishes a run, that what follows it is due.
func (g *Game) afterDue(tx *sql.Tx, runID int64) error {
	_, err := tx.Exec(`INSERT OR IGNORE INTO runs_after (run_id, due) VALUES (?, ?)`, runID,
		store.Ms(g.Now().Add(afterOwn)))
	return err
}

// finished does what follows a run that has just ended (by an answer, by its clock in settle, or kept from a room),
// before the answer or the run goes back, so that the screen with the result can tell of it. The player leaving
// doesn't cut it short, and what fails is left to the sweep (AfterDue).
func (g *Game) finished(ctx context.Context, userID, runID int64) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), afterFor)
	defer cancel()
	if err := g.after(ctx, userID, runID); err != nil {
		slog.Error("after a run", "run", runID, "err", err)
	}
}

// after does what follows a finished run, and once it's all done, crosses it off.
func (g *Game) after(ctx context.Context, userID, runID int64) error {
	if err := g.settleRun(ctx, runID); err != nil {
		return err
	}
	if err := g.afterRun(ctx, userID); err != nil {
		return err
	}
	_, err := g.DB.Write.ExecContext(ctx, `DELETE FROM runs_after WHERE run_id = ?`, runID)
	return err
}

// AfterDue does what follows the finished runs that their own requests left undone (cut off by a restart, or failed),
// each taken in turn by this sweep alone; and gives up, with an error in the log, on one that has failed afterTries
// times. Run every minute.
func (g *Game) AfterDue(ctx context.Context) error {
	now := g.Now()
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.run_id, r.user_id, a.tries FROM runs_after a
		JOIN runs r ON r.id = a.run_id WHERE a.due <= ? ORDER BY a.due LIMIT ?`, store.Ms(now), afterBatch)
	if err != nil {
		return err
	}
	type due struct {
		run, user int64
		tries     int
	}
	var list []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.run, &d.user, &d.tries); err != nil {
			rows.Close()
			return err
		}
		list = append(list, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	var errs []error
	for _, d := range list {
		if d.tries >= afterTries {
			slog.Error("after a run: given up", "run", d.run, "user", d.user, "tries", d.tries)
			if _, err := g.DB.Write.ExecContext(ctx, `DELETE FROM runs_after WHERE run_id = ?`, d.run); err != nil {
				return err
			}
			continue
		}
		// Taken: the next try (should this one fail) waits a minute, then two, four… The update takes it only if
		// nothing else has meanwhile (single writer: one of two sweeps gets it).
		wait := afterOwn << d.tries
		res, err := g.DB.Write.ExecContext(ctx, `UPDATE runs_after SET due = ?, tries = tries + 1
			WHERE run_id = ? AND tries = ? AND due <= ?`, store.Ms(now.Add(wait)), d.run, d.tries, store.Ms(now))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}
		if err := g.after(ctx, d.user, d.run); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
