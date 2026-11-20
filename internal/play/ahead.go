package play

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	mrand "math/rand/v2"
	"slices"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The days ahead: the day's questions are drawn up to Ahead days before their day, and no other game deals them
// (dayQuestions), so that the day stays one attempt for everyone. Were only today's ten kept out, a question would
// reach a topic game or a duel before its own day, and the players who play most would meet more and
// more of the day as a rerun, with its answer known. The questions that belong to a date („На този ден“) are kept out
// the same way however far off their date is, until a day has dealt them (waiting): a date has only a few, one a year.
//
// A day ahead is drawn only while every one of its places has a question that fits it just so (none short in drawDay):
// when a place runs short (the estimates, say), the days stop there, with a warning in the log, and go on as the bank
// grows, rather than fill a day months off with what's at hand: a day drawn short ahead would keep its stand-in (or a
// question an earlier day had) even after the batch written for it, while a day drawn on its morning takes whatever
// the bank has by then. The stop should never come: the day's runway (runway.go, `almanac bank check` with the days'
// questions) warns RunwayWarn days before a place runs out: Ahead of them before the stop, and 60 more to write the
// batch. Of the questions that fit, those nobody has answered come first. A day ahead whose question has left the
// bank, or is due for review by its day (overdue), is drawn again; so are all the days after tomorrow when the draw's
// rules change (DayRules) or the bank's days and Bulgarian questions do (bank.Tail.On, BG): a day drawn ahead is drawn
// by today's rules, never an older version's.
//
// Ahead is three months, not a year (the owner's call, 16 Nov 2026): long enough that the players who play most meet
// no day as a rerun, and what the days hold out of every other game is a season's questions, not a year's 3,650; the
// runway warns a season and two months before a place runs out, early enough to write for it.
//
// The days ahead are drawn in a transaction of their own (KeepDays: as the server starts, then each minute when the
// day or the bank has changed), never in a player's: a game that rolls back can't take them with it. A player's game
// only reads them (days); today's, if it isn't drawn yet, is drawn there as it always was.

// DayRules names the day's draw as it is, and the days after tomorrow are drawn again whenever it changes. It ends with
// what drawDay makes of a fixed bank on fixed days and seeds (TestDayRulesNameTheDraw): a change to how a day is drawn
// fails that test until DayRules says so, rather than reach the days drawn ahead a season late.
const DayRules = "2026-11-20 the number last, a week apart (recent subjects), estimates count no list; draw 23ab9debaea5283c"

// Ahead is how many days ahead of today the day's questions are drawn.
const Ahead = 90

// RunwayWarn is how many days of a place's runway are enough, held at Supply times the day's need (runway.go, Cover):
// below it, `almanac bank check` warns, and the next batch writes for that place first. Ahead of them are drawn
// already; the other 60 are time to write.
const RunwayWarn = Ahead + 60

// dayBars are the questions no game deals now (now: today's, and those due for review today, overdue), and those no
// other game deals but a recording that has them already (all: those, and the days ahead's).
type dayBars struct {
	now, all map[string]bool
}

type daysCache struct {
	mu   sync.Mutex
	day  string     // the day the bars are for
	bank *bank.Bank // and the bank they were drawn from
	bars dayBars
}

// days are today's questions and the days ahead's, as KeepDays last drew them for this day and bank; until it has (a
// new day's first minute, a bank just reloaded), as the database holds them, today's drawn if it isn't yet.
func (g *Game) days(tx *sql.Tx) (dayBars, error) {
	today, b := g.Today(), g.Bank()
	g.daysAhead.mu.Lock()
	day, drawnFrom, bars := g.daysAhead.day, g.daysAhead.bank, g.daysAhead.bars
	g.daysAhead.mu.Unlock()
	if day == today && drawnFrom == b {
		return bars, nil
	}
	if _, err := g.day(tx, today, b); err != nil && !errors.Is(err, ErrNoQuestion) {
		return dayBars{}, err
	}
	stored, err := storedDays(tx, "")
	if err != nil {
		return dayBars{}, err
	}
	return barsOf(stored, today, b), nil
}

// KeepDays draws the days ahead as the server starts, then every minute that the day or the bank has changed, until
// ctx ends.
func (g *Game) KeepDays(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		if err := g.EnsureDays(ctx); err != nil && ctx.Err() == nil {
			slog.Error("days ahead", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// EnsureDays draws today and the days ahead that are missing (or due again), in a transaction of its own, and keeps
// what they hold for the games of the day (days). Nothing to do if this day and bank are done already.
func (g *Game) EnsureDays(ctx context.Context) error {
	today, b := g.Today(), g.Bank()
	g.daysAhead.mu.Lock()
	done := g.daysAhead.day == today && g.daysAhead.bank == b
	g.daysAhead.mu.Unlock()
	if done {
		return nil
	}
	// Which questions anyone has answered is read first, alongside the game: never in the one write, which every
	// answer waits on, at the moment the day changes.
	answered, err := g.answeredQuestions(ctx)
	if err != nil {
		return err
	}
	var bars dayBars
	err = g.DB.Tx(context.WithoutCancel(ctx), func(tx *sql.Tx) error {
		var err error
		bars, err = g.drawAhead(tx, today, b, answered)
		return err
	})
	if err != nil {
		return err
	}
	g.daysAhead.mu.Lock()
	g.daysAhead.day, g.daysAhead.bank, g.daysAhead.bars = today, b, bars
	g.daysAhead.mu.Unlock()
	return nil
}

// drawAhead draws today if it isn't yet, voids today's questions the bank no longer plays as the day began (day.go),
// draws the days after tomorrow again if the rules or the bank's dated and Bulgarian questions changed since they were
// drawn, a day ahead again if a question of it left the bank or is due for review by then, and the days missing up to
// Ahead (while none is short, else it warns in the log); it says what today and the days ahead hold. Of the questions
// that fit, those not answered (by anyone) come first.
func (g *Game) drawAhead(tx *sql.Tx, today string, b *bank.Bank, answered map[string]bool) (dayBars, error) {
	if _, err := g.day(tx, today, b); err != nil && !errors.Is(err, ErrNoQuestion) {
		return dayBars{}, err
	}
	if err := g.voidDay(tx, today, b); err != nil {
		return dayBars{}, err
	}
	d, _ := time.Parse(time.DateOnly, today)
	tomorrow := d.AddDate(0, 0, 1).Format(time.DateOnly)
	rules := drawnBy(b)
	var was string
	if err := tx.QueryRow(`SELECT value FROM kv WHERE key = 'days_drawn_by'`).Scan(&was); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return dayBars{}, err
	}
	if was != rules {
		if _, err := tx.Exec(`DELETE FROM days WHERE day > ?`, tomorrow); err != nil {
			return dayBars{}, err
		}
		if _, err := tx.Exec(`INSERT INTO kv (key, value) VALUES ('days_drawn_by', ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`, rules); err != nil {
			return dayBars{}, err
		}
	}
	all, err := storedDays(tx, "")
	if err != nil {
		return dayBars{}, err
	}
	used := map[string]bool{}
	for day, picks := range all {
		// A day ahead with a question the bank no longer has, or one due for review by then, is drawn again; nobody has
		// played it.
		if day > today && (!allLive(b, picks) || slices.ContainsFunc(picks, func(p Pick) bool {
			q, _ := b.Get(p.ID)
			return overdue(q, day)
		})) {
			if _, err := tx.Exec(`DELETE FROM days WHERE day = ?`, day); err != nil {
				return dayBars{}, err
			}
			delete(all, day)
			continue
		}
		for _, p := range picks {
			used[p.ID] = true
		}
	}
	r := mrand.New(mrand.NewPCG(newSeed(), newSeed()))
	for range Ahead {
		d = d.AddDate(0, 0, 1)
		day := d.Format(time.DateOnly)
		if _, ok := all[day]; ok {
			continue
		}
		picks, short := drawDay(b, day, used, answered, recentSubjects(b, all, day), r)
		if len(short) > 0 {
			// A place has run short: the days ahead stop here until the bank grows.
			slog.Warn("days ahead stop short: the bank needs questions for the day", "day", day, "short", short)
			break
		}
		data, _ := json.Marshal(picks)
		if _, err := tx.Exec(`INSERT INTO days (day, questions) VALUES (?, ?)`, day, string(data)); err != nil {
			return dayBars{}, err
		}
		all[day] = picks
		for _, p := range picks {
			used[p.ID] = true
		}
	}
	return barsOf(all, today, b), nil
}

// storedDays are the days stored from `from` on (every day for "").
func storedDays(tx *sql.Tx, from string) (map[string][]Pick, error) {
	rows, err := tx.Query(`SELECT day, questions FROM days WHERE day >= ?`, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]Pick{}
	for rows.Next() {
		var day, s string
		var picks []Pick
		if err := rows.Scan(&day, &s); err != nil || json.Unmarshal([]byte(s), &picks) != nil {
			return nil, errors.Join(err, errors.New("a stored day can't be read"))
		}
		out[day] = picks
	}
	return out, rows.Err()
}

// barsOf are the questions of today and the days after it, those of the bank due for review today, and (in all only)
// the questions that wait for their date (waiting): days holds the days played too, to tell which have had theirs.
func barsOf(days map[string][]Pick, today string, b *bank.Bank) dayBars {
	bars := dayBars{now: map[string]bool{}, all: map[string]bool{}}
	dealt := map[string]bool{}
	for day, picks := range days {
		for _, p := range picks {
			if day < today {
				dealt[p.ID] = true
				continue
			}
			bars.all[p.ID] = true
			if day == today {
				bars.now[p.ID] = true
			}
		}
	}
	for _, id := range Overdue(b, today) {
		bars.now[id], bars.all[id] = true, true
	}
	for _, q := range b.Live("", "") {
		if id := q.Base().ID; !dealt[id] && waiting(q, today) {
			bars.all[id] = true
		}
	}
	return bars
}

// waiting is whether a question belongs to a date still to come (bank.Tail.On: every year's, or that year's from today
// on): it waits for it, out of every other game, until a day has dealt it. „На този ден“ has a few questions a date,
// each for one year; a topic game or a duel that dealt one first would leave its date empty a year sooner,
// and show its answer before its day.
func waiting(q bank.Question, today string) bool {
	for _, d := range q.Extra().On {
		if len(d) != len(time.DateOnly) || d >= today {
			return true
		}
	}
	return false
}

// DaysUsed are the questions the days have had (Used): every day stored, played or drawn ahead. `almanac bank used`
// prints them for the day's runway; they are question ids and days, nothing of a player's.
func (g *Game) DaysUsed(ctx context.Context) (Used, error) {
	tx, err := g.DB.Read.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return Used{}, err
	}
	defer tx.Rollback() //nolint:errcheck // a read: nothing to keep
	days, err := storedDays(tx, "")
	used := Used{IDs: map[string]bool{}}
	for day, picks := range days {
		used.Through = max(used.Through, day)
		for _, p := range picks {
			used.IDs[p.ID] = true
		}
	}
	return used, err
}

// Drawn is a day's ten as drawn: its date, and its questions in the day's order.
type Drawn struct {
	Day   string `json:"day"`
	Picks []Pick `json:"picks"`
}

// DaysDrawn are the days stored from `from` on, n of them at most, in order: the issues to come, as `almanac bank
// days` prints them for a review before they go live. Question ids and days, nothing of a player's. With them, the
// Recent days before `from`, so that a review can tell a subject that comes back within a week (recentSubjects).
func (g *Game) DaysDrawn(ctx context.Context, from string, n int) (before, days []Drawn, err error) {
	tx, err := g.DB.Read.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback() //nolint:errcheck // a read: nothing to keep
	d, err := time.Parse(time.DateOnly, from)
	if err != nil {
		return nil, nil, err
	}
	stored, err := storedDays(tx, d.AddDate(0, 0, -Recent).Format(time.DateOnly))
	if err != nil {
		return nil, nil, err
	}
	for _, day := range slices.Sorted(maps.Keys(stored)) {
		if day < from {
			before = append(before, Drawn{day, stored[day]})
		} else if len(days) < n {
			days = append(days, Drawn{day, stored[day]})
		}
	}
	return before, days, nil
}

// drawnBy names what the days ahead were drawn by: the rules, and the bank's dated and Bulgarian questions.
func drawnBy(b *bank.Bank) string {
	var tagged []string
	for _, q := range b.Live("", "") {
		if t := q.Extra(); len(t.On) > 0 || t.BG {
			tagged = append(tagged, fmt.Sprintf("%s %v %v", q.Base().ID, t.On, t.BG))
		}
	}
	slices.Sort(tagged)
	h := sha256.New()
	for _, s := range tagged {
		h.Write([]byte(s + "\n"))
	}
	return DayRules + " " + hex.EncodeToString(h.Sum(nil))[:16]
}

// allLive is whether the bank has each of the picks, live.
func allLive(b *bank.Bank, picks []Pick) bool {
	for _, p := range picks {
		if q, ok := b.Get(p.ID); !ok || q.Extra().Retired {
			return false
		}
	}
	return true
}

// answeredQuestions are the questions anyone has answered, read on the read pool: one step of the index on answers'
// questions from each to the next (as many steps as questions, however many answers each has), not a pass over every
// answer ever given.
func (g *Game) answeredQuestions(ctx context.Context) (map[string]bool, error) {
	out := map[string]bool{}
	err := g.read(ctx, func(tx *sql.Tx) error {
		after := ""
		for {
			var id sql.NullString
			if err := tx.QueryRowContext(ctx, `SELECT min(question_id) FROM answers WHERE question_id > ?`, after).
				Scan(&id); err != nil {
				return err
			}
			if !id.Valid {
				return nil
			}
			out[id.String], after = true, id.String
		}
	})
	return out, err
}
