package play

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"runtime"
	"slices"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/safe"
	"github.com/almanac-bg/almanac/internal/store"
)

// After a run: once its last answer is kept, a run has more to do, each in a write of its own: its duel is settled
// once both sides have played (settleRun), and what it earned is kept (afterRun: achievements and the day's goals).
// The transaction that finishes the run notes that it's due (runs_after, afterDue), so none of it is lost to a closed connection or a restart in between: the request that finished the run settles it at
// once, on a context of its own that the player leaving doesn't cancel (finished: the result shows the duel's outcome), and
// hands the rest to the background (afterLater), so that the last answer doesn't wait for every achievement to be
// measured again; the game's news waits for it instead (AfterWait: NewsOf, Начало), and gets it as soon as it's
// done. The sweep each minute does whatever that left (AfterDue), a few times more, waiting longer each time, before
// it gives up. All of it may be done again safely: a duel is settled once, an achievement or a goal kept once.
//
// What a run earned is judged by the run, never by the clock it's looked at on (played): a run of the day's questions
// counts for its own day though its last answer came after midnight (DayGrace), and so does the sweep's retry of it
// hours later. That day's goals are the ones it moves. A game played across midnight moved the goals of both days.
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

// finished does what follows a run that has just ended (by an answer, or by its clock in settle):
// its duel settled before the answer or the run goes back, so that the screen with the result has it,
// and the rest in the background (afterLater). The player leaving doesn't cut it short, and what fails is left to the
// sweep (AfterDue).
func (g *Game) finished(ctx context.Context, userID, runID int64) {
	settle, cancel := context.WithTimeout(context.WithoutCancel(ctx), afterFor)
	defer cancel()
	err := g.settleRun(settle, runID)
	if err != nil {
		slog.Error("after a run: settling it", "run", runID, "err", err)
	}
	g.afterLater(userID, runID, err == nil)
}

// afterWorkers is how many runs' follow-ups are done at once in the background: each is a few reads over the
// player's history and a few writes, and the database does them no faster side by side than its cores (and the read
// pool's few more: store.Open), so the rest wait their turn rather than slow the requests down.
var afterWorkers = max(4, runtime.NumCPU())

// laters are the follow-ups of runs under way in the background (afterLater), by player: how many, and a channel
// closed once the last of them is done.
type laters struct {
	mu    sync.Mutex
	by    map[int64]*later
	slots chan struct{} // afterWorkers of them
}

type later struct {
	n    int
	done chan struct{}
}

// afterLater does what follows a run (after; but its settling, once settled) in the background, afterWorkers at
// once, within afterFor.
func (g *Game) afterLater(userID, runID int64, settled bool) {
	l := &g.later
	l.mu.Lock()
	if l.by == nil {
		l.by, l.slots = map[int64]*later{}, make(chan struct{}, max(1, afterWorkers))
	}
	w := l.by[userID]
	if w == nil {
		w = &later{done: make(chan struct{})}
		l.by[userID] = w
	}
	w.n++
	slots := l.slots
	l.mu.Unlock()
	safe.Go("after a run", func() {
		defer func() {
			l.mu.Lock()
			defer l.mu.Unlock()
			if w.n--; w.n == 0 {
				close(w.done)
				delete(l.by, userID)
			}
		}()
		slots <- struct{}{}
		defer func() { <-slots }()
		ctx, cancel := context.WithTimeout(context.Background(), afterFor)
		defer cancel()
		do := g.after
		if settled {
			do = g.afterSettled
		}
		if err := do(ctx, userID, runID); err != nil {
			slog.Error("after a run", "run", runID, "err", err)
		}
	})
}

// AfterWait waits until what follows the player's runs just finished is done (afterLater), or ctx is: what reads
// what a game earned (its news, Начало) reads it whole. Nothing to wait for, it doesn't.
func (g *Game) AfterWait(ctx context.Context, userID int64) {
	g.later.mu.Lock()
	w := g.later.by[userID]
	g.later.mu.Unlock()
	if w == nil {
		return
	}
	select {
	case <-w.done:
	case <-ctx.Done():
	}
}

// Settled waits until nothing the game started in the background is still under way: the follow-ups of runs
// (AftersDone) and the counts over everyone's answers (snapshot), or until ctx is done. A test calls it before its
// database closes, so no count writes into a database (or a folder) that is going away.
func (g *Game) Settled(ctx context.Context) {
	g.AftersDone(ctx)
	settled := make(chan struct{})
	safe.Go("settling the counts", func() {
		defer close(settled)
		g.hard.settle()
		g.crowds.settle()
		g.known.settle()
	})
	select {
	case <-settled:
	case <-ctx.Done():
	}
}

// AftersDone waits until every follow-up under way in the background is done, or ctx is (a server stopping; tests):
// one cut off is the sweep's after the restart.
func (g *Game) AftersDone(ctx context.Context) {
	for {
		g.later.mu.Lock()
		var w *later
		for _, x := range g.later.by {
			w = x
			break
		}
		g.later.mu.Unlock()
		if w == nil {
			return
		}
		select {
		case <-w.done:
		case <-ctx.Done():
			return
		}
	}
}

// after does what follows a finished run, and once it's all done, crosses it off.
func (g *Game) after(ctx context.Context, userID, runID int64) error {
	if err := g.settleRun(ctx, runID); err != nil {
		return err
	}
	return g.afterSettled(ctx, userID, runID)
}

// afterSettled does what follows a finished run once it's settled, and crosses it off.
func (g *Game) afterSettled(ctx context.Context, userID, runID int64) error {
	p, err := g.playedOf(ctx, userID, runID)
	switch {
	case errors.Is(err, ErrNoRun): // gone with its player: nothing to keep
	case err != nil:
		return err
	default:
		if err := g.afterRun(ctx, p); err != nil {
			return err
		}
	}
	_, err = g.DB.Write.ExecContext(ctx, `DELETE FROM runs_after WHERE run_id = ?`, runID)
	return err
}

// played is a finished game as what follows it sees it: whose, what kind, and the days it counts on.
type played struct {
	user, run int64
	kind      string
	// day is the day it counts for: a run of the day's questions, its own day; any other game, the day it ended.
	day string
	// began is the day it began on: a game played across midnight moved that day's goals too.
	began string
}

// playedOf is a player's finished run as what follows it sees it (ErrNoRun: no such run of theirs).
func (g *Game) playedOf(ctx context.Context, userID, runID int64) (played, error) {
	p := played{user: userID, run: runID}
	var started int64
	var finished sql.NullInt64
	err := g.DB.Read.QueryRowContext(ctx, `SELECT kind, coalesce(day, ''), started_at, finished_at FROM runs
		WHERE id = ? AND user_id = ?`, runID, userID).Scan(&p.kind, &p.day, &started, &finished)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNoRun
	}
	if err != nil {
		return p, err
	}
	p.began = dayOf(time.UnixMilli(started))
	if p.kind != "day" || p.day == "" {
		end := g.Now()
		if finished.Valid {
			end = time.UnixMilli(finished.Int64)
		}
		p.day = dayOf(end)
	}
	return p, nil
}

// dayOf is the day a moment is in, in Bulgaria (YYYY-MM-DD).
func dayOf(t time.Time) string { return t.In(Bulgaria).Format(time.DateOnly) }

// afterRun keeps what a player's game, just finished, earned them, on the days it counts on (played): achievements
// and the day's goals.
func (g *Game) afterRun(ctx context.Context, p played) error {
	if _, err := g.Award(ctx, p.user); err != nil {
		return err
	}
	// A goal done is kept, with its XP, whether or not the player looks: on the days the game was played on, and
	// today, when a duel won has only now been settled.
	for _, day := range unique(p.began, p.day, g.Today()) {
		if _, err := g.goalsOn(ctx, p.user, day); err != nil {
			return err
		}
	}
	return nil
}

// unique are the days given, each once, in their order.
func unique(days ...string) []string {
	var out []string
	for _, d := range days {
		if !slices.Contains(out, d) {
			out = append(out, d)
		}
	}
	return out
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
