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

// A question new to the bank is held for the days the same way (unproven): out of chapter games and duels until a day
// has dealt it or it is NewHeld days old, so that the issue meets it first.
//
// The days ahead: the day's questions are drawn up to Ahead days before their day, and no other game deals them
// (dayQuestions), so that the day stays one attempt for everyone. Were only today's ten kept out, a question would
// reach a chapter game or a duel before its own day, and the players who play most would meet more and
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
// bank, or is due for review by its day (overdue), has that question replaced in its own place, the rest kept as drawn
// (mendDay); drawn again only if a place has no question that fits it so. One of a kind the game no longer deals
// (bank.Off) is replaced the same way, and a day after tomorrow whose question changed its kind is drawn again
// (shaped). All the days after tomorrow are drawn again when the draw's rules change (DayRules), so that a day drawn
// ahead is drawn by today's rules, never an older version's, or the bank's dated questions do (bank.Tail.On), so that
// each takes its date (drawnBy). Not when its questions about Bulgaria do: every day is drawn with BGFloor of them, a
// retired one is replaced by another, and a new one changes nothing a day drawn needs; a redraw gives back what drawing
// ahead kept from the other games, and a new Bulgarian question in nearly every batch redrew the season for nothing.
//
// Past the days drawn, the day and the other games keep apart by what they prefer, not by a bar: of the questions
// that fit, the day takes one nobody has answered (drawn on its morning too: by who had as KeepDays last read it,
// lastMet, if a player's game draws it first), and a chapter's game or a duel one somebody has (Draw), each while any
// is left. A question met in another game before an issue deals it is never ink for that player (ink.go), so a
// player who plays the chapters most would otherwise meet more and more of the days to come there, and lose their
// ink in the issue for it; this way the other games walk the bank already walked, and leave the untouched to the days.
//
// Ahead is three months, not a year (the owner's call, 16 Nov 2026): long enough that the players who play most meet
// no day as a rerun, and what the days hold out of every other game is a season's questions, not a year's 3,650; the
// runway warns a season and two months before a place runs out, early enough to write for it.
//
// The days ahead are kept apart from the players' games (KeepDays: as the server starts, then each minute when the
// day or the bank has changed), never in a player's: a game that rolls back can't take them with it. A player's game
// only reads them (days); today's, if it isn't drawn yet, is drawn there as it always was. Nor do they hold the game's
// one writer while they're drawn: drawing ninety days takes seconds on the server, and every answer, and the health
// probe's write, would wait for it (on 23 Nov 2026 a bank whose questions changed kind had every day after tomorrow
// drawn again in one transaction; the probe timed out, and the deploy under way went back for it). So today and the
// rules are kept in one short transaction, the days ahead are worked out from what it read, outside any (only
// EnsureDays writes them, one keeping at a time), and each day that changed is written in a transaction of its own.

// DayRules names the day's draw as it is, and the days after tomorrow are drawn again whenever it changes. It ends with
// what drawDay makes of a fixed bank on fixed days and seeds (TestDayRulesNameTheDraw): a change to how a day is drawn
// fails that test until DayRules says so, rather than reach the days drawn ahead a season late.
const DayRules = "2026-11-23 one puzzle a day (order, match, split in turn), a medium picture while any; draw 1d9fecb675e8bec5"

// Ahead is how many days ahead of today the day's questions are drawn.
const Ahead = 90

// RunwayWarn is how many days of a place's runway are enough, held at Supply times the day's need (runway.go, Cover):
// below it, `almanac bank check` warns, and the next batch writes for that place first. Ahead of them are drawn
// already; the other 60 are time to write.
const RunwayWarn = Ahead + 60

// dayBars are the questions no other game deals (all: today's, those due for review today, overdue, and the days
// ahead's), and the questions anyone has answered as the days were last drawn (met: answeredQuestions), which the
// other games deal first (Draw). Met is nil until KeepDays has drawn the days for this day and bank: the other games
// then draw as if nobody had.
type dayBars struct {
	all, met map[string]bool
}

type daysCache struct {
	keeping sync.Mutex // held by EnsureDays: the days ahead are kept by one at a time

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
	if _, err := g.day(tx, today, b, g.lastMet()); err != nil && !errors.Is(err, ErrNoQuestion) {
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

// EnsureDays draws today and the days ahead that are missing (or due again), and keeps what they hold for the games of
// the day (days). Nothing to do if this day and bank are done already. Today and the rules are kept in a transaction
// of their own (keepToday), the days ahead drawn outside any (drawAhead), and each day that changed written in its own
// (writeDays): the game's one writer is never held for long.
func (g *Game) EnsureDays(ctx context.Context) error {
	g.daysAhead.keeping.Lock()
	defer g.daysAhead.keeping.Unlock()
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
	var stored map[string][]Pick
	err = g.DB.Tx(context.WithoutCancel(ctx), func(tx *sql.Tx) error {
		var err error
		stored, err = g.keepToday(tx, today, b, answered)
		return err
	})
	if err != nil {
		return err
	}
	all := g.drawAhead(today, b, stored, answered)
	// While the days are written, one at a time, the other games keep out of the days ahead both as they were and as
	// they will be.
	bars := barsOf(all, today, b)
	both := dayBars{all: maps.Clone(bars.all), met: answered}
	for day, picks := range stored {
		for _, p := range picks {
			if day >= today {
				both.all[p.ID] = true
			}
		}
	}
	g.keptDays(today, b, both)
	if err := g.writeDays(ctx, today, stored, all); err != nil {
		// The games read the days from the database, and the next minute tries again; who has answered what stays, for
		// the new today a player may draw meanwhile (lastMet).
		g.keptDays("", nil, dayBars{met: answered})
		if errors.Is(err, errDayTurned) {
			return nil
		}
		return err
	}
	bars.met = answered
	g.keptDays(today, b, bars)
	return nil
}

// keptDays keeps what the days hold for the games of a day and bank (days).
func (g *Game) keptDays(day string, b *bank.Bank, bars dayBars) {
	g.daysAhead.mu.Lock()
	defer g.daysAhead.mu.Unlock()
	g.daysAhead.day, g.daysAhead.bank, g.daysAhead.bars = day, b, bars
}

// lastMet are the questions anyone had answered as KeepDays last read them, whatever the day and bank it drew for
// since (nil until it first has): a player's game that draws today, before KeepDays has (a new day's first minute, the
// day turned while the days were written), prefers by them, at most a day old, rather than read every answer inside
// the one write.
func (g *Game) lastMet() map[string]bool {
	g.daysAhead.mu.Lock()
	defer g.daysAhead.mu.Unlock()
	return g.daysAhead.bars.met
}

// keepToday draws today if it isn't yet (those nobody has answered first), voids today's questions the bank no longer
// plays as the day began (day.go), and lets go of the days after tomorrow if the rules or the bank's dated questions
// changed since they were drawn (drawnBy: drawAhead draws them again); it says which days are stored.
func (g *Game) keepToday(tx *sql.Tx, today string, b *bank.Bank, answered map[string]bool) (map[string][]Pick, error) {
	if _, err := g.day(tx, today, b, answered); err != nil && !errors.Is(err, ErrNoQuestion) {
		return nil, err
	}
	if err := g.voidDay(tx, today, b); err != nil {
		return nil, err
	}
	rules := drawnBy(b)
	var was string
	if err := tx.QueryRow(`SELECT value FROM kv WHERE key = 'days_drawn_by'`).Scan(&was); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if was != rules {
		if _, err := tx.Exec(`DELETE FROM days WHERE day > ?`, DayShift(today, 1)); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(`INSERT INTO kv (key, value) VALUES ('days_drawn_by', ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`, rules); err != nil {
			return nil, err
		}
	}
	return storedDays(tx, "")
}

// drawAhead is what the days should hold, from those stored (left as they are): a day after tomorrow whose kinds
// aren't the day's (shaped: a question's kind changed since) drawn again; a day ahead mended if a question of it left
// the bank, is of a kind the game no longer deals, or is due for review by then (mendDay: drawn again if it can't be);
// and the days missing up to Ahead drawn (while none is short, else it warns in the log). Of the questions that fit,
// those not answered (by anyone) come first. It reads and writes nothing: writeDays stores what it drew.
func (g *Game) drawAhead(today string, b *bank.Bank, stored map[string][]Pick, answered map[string]bool) map[string][]Pick {
	all := maps.Clone(stored)
	d, _ := time.Parse(time.DateOnly, today)
	tomorrow := d.AddDate(0, 0, 1).Format(time.DateOnly)
	used := map[string]bool{}
	for _, picks := range all {
		for _, p := range picks {
			used[p.ID] = true
		}
	}
	r := mrand.New(mrand.NewPCG(newSeed(), newSeed()))
	for _, day := range slices.Sorted(maps.Keys(all)) {
		// A day ahead with a question the bank no longer has, or one due for review by then, has it replaced in its
		// place, else is drawn again; nobody has played it. So is one after tomorrow whose kinds aren't the day's any
		// more (shaped), its question's kind changed since.
		if picks := all[day]; day > tomorrow && !shaped(b, picks) {
			delete(all, day)
			for _, p := range picks { // its questions are free for it, drawn again, or another day
				delete(used, p.ID)
			}
			continue
		}
		if picks := all[day]; day > today && !dealsOn(b, picks, day) {
			if mended, ok := mendDay(b, day, picks, used, answered, recentSubjects(b, all, day), r); ok {
				all[day] = mended
				for _, p := range mended {
					used[p.ID] = true
				}
				continue
			}
			delete(all, day)
		}
	}
	for range Ahead {
		d = d.AddDate(0, 0, 1)
		day := d.Format(time.DateOnly)
		if _, ok := all[day]; ok {
			continue
		}
		picks, short := drawDay(b, day, used, answered, recentSubjects(b, all, day), r)
		if g.drawn != nil {
			g.drawn(day)
		}
		if len(short) > 0 {
			// A place has run short: the days ahead stop here until the bank grows.
			slog.Warn("days ahead stop short: the bank needs questions for the day", "day", day, "short", short)
			break
		}
		all[day] = picks
		for _, p := range picks {
			used[p.ID] = true
		}
	}
	return all
}

// writeDays stores the days after today that drawAhead changed from those stored, each in a transaction of its own, so
// that the game's other writes go between them. Only EnsureDays writes them, one keeping at a time, so none has
// changed since it read them; but the day may turn meanwhile, and then it stops (errDayTurned), with nothing more
// written: the new today is drawn as a player first asks for it, and the next keeping goes on from there. It stops
// too if ctx ends.
func (g *Game) writeDays(ctx context.Context, today string, stored, all map[string][]Pick) error {
	days := slices.Collect(maps.Keys(stored))
	for day := range all {
		if _, ok := stored[day]; !ok {
			days = append(days, day)
		}
	}
	slices.Sort(days)
	for _, day := range days {
		was, had := stored[day]
		picks, has := all[day]
		if day <= today || had == has && slices.Equal(was, picks) {
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		data, _ := json.Marshal(picks)
		err := g.DB.Tx(context.WithoutCancel(ctx), func(tx *sql.Tx) error {
			if g.Today() != today {
				return errDayTurned
			}
			var err error
			switch {
			case !has:
				_, err = tx.Exec(`DELETE FROM days WHERE day = ?`, day)
			case !had:
				_, err = tx.Exec(`INSERT INTO days (day, questions) VALUES (?, ?)`, day, string(data))
			default:
				_, err = tx.Exec(`UPDATE days SET questions = ? WHERE day = ?`, string(data), day)
			}
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// errDayTurned stops writeDays: the days ahead were drawn for a day that has ended.
var errDayTurned = errors.New("the day turned while the days ahead were written")

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

// barsOf are the questions of today and the days after it, those of the bank due for review today, and the questions
// that wait for their date (waiting): days holds the days played too, to tell which have had theirs.
func barsOf(days map[string][]Pick, today string, b *bank.Bank) dayBars {
	bars := dayBars{all: map[string]bool{}}
	dealt := map[string]bool{}
	for day, picks := range days {
		for _, p := range picks {
			if day < today {
				dealt[p.ID] = true
				continue
			}
			bars.all[p.ID] = true
		}
	}
	for _, id := range Overdue(b, today) {
		bars.all[id] = true
	}
	for _, q := range b.Live("", "") {
		if id := q.Base().ID; !dealt[id] && (waiting(q, today) || unproven(q, today)) {
			bars.all[id] = true
		}
	}
	return bars
}

// NewHeld is how long a question new to the bank is kept out of every game but the day's, unless a day has dealt it
// before (DECISIONS.md, „The direction“: freshness): its first meeting is the issue's, in ink, for everyone who plays
// the days, and a chapter's game or a duel never spends it first. NewHeldFrom is the first day it holds for: the bank
// as it was the day before (nearly all of it written in the month before) plays as it did, or chapter games and duels
// would have had nothing to deal for months.
const (
	NewHeld     = 120
	NewHeldFrom = "2026-11-21"
)

// unproven is whether a question is new to the bank (bank.Tail.Added: from NewHeldFrom on, NewHeld days at most before
// today) and so held for the days: one without a date of joining is old.
func unproven(q bank.Question, today string) bool {
	added := q.Extra().Added
	return added >= NewHeldFrom && added > DayShift(today, -NewHeld)
}

// waiting is whether a question belongs to a date still to come (bank.Tail.On: every year's, or that year's from today
// on): it waits for it, out of every other game, until a day has dealt it. „На този ден“ has a few questions a date,
// each for one year; a chapter game or a duel that dealt one first would leave its date empty a year sooner,
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

// drawnBy names what the days ahead were drawn by: the rules, and the bank's dated questions, never its questions
// about Bulgaria (in them, they drew the days again on 18 of the 28 bank commits that did from 15 to 24 Nov 2026: audit
// 24 Nov, C-29.1).
func drawnBy(b *bank.Bank) string {
	var dated []string
	for _, q := range b.Live("", "") {
		if on := q.Extra().On; len(on) > 0 {
			dated = append(dated, fmt.Sprintf("%s %v", q.Base().ID, on))
		}
	}
	slices.Sort(dated)
	h := sha256.New()
	for _, s := range dated {
		h.Write([]byte(s + "\n"))
	}
	return DayRules + " " + hex.EncodeToString(h.Sum(nil))[:16]
}

// dealsOn is whether a day's questions can all be dealt on it: each live (allLive), none due for review by then.
func dealsOn(b *bank.Bank, picks []Pick, day string) bool {
	return allLive(b, picks) && !slices.ContainsFunc(picks, func(p Pick) bool {
		q, _ := b.Get(p.ID)
		return overdue(q, day)
	})
}

// mendDay replaces each question of a day drawn ahead that can't be dealt on it (dealsOn: retired, of a kind the game
// no longer deals, or due for review by then) with another in its own place: of the same chapter, difficulty, kind (a
// split for clues, which share its place: newKinds) and picture (fitsPlace: an estimate for the number), about
// Bulgaria if it was, dealable on the day, never a question another day has, naming no subject the
// day's other questions do; those nobody has answered first, then those apart from the days before (recent). The rest
// of the day stays as drawn, its shape and its chapters too. Not mended (false) if a question has gone from the bank
// altogether (its place is unknown) or a place has none that fits: the day is drawn again.
func mendDay(b *bank.Bank, day string, picks []Pick, used, answered, recent map[string]bool,
	r *mrand.Rand) ([]Pick, bool) {
	bad := func(q bank.Question) bool { return !bank.Playable(q) || overdue(q, day) }
	named := map[string]bool{}
	for _, p := range picks {
		q, ok := b.Get(p.ID)
		if !ok {
			return nil, false
		}
		if !bad(q) {
			for _, k := range bank.Subjects(q) {
				named[k] = true
			}
		}
	}
	taken := map[string]bool{}
	out := slices.Clone(picks)
	for i, p := range picks {
		old, _ := b.Get(p.ID)
		if !bad(old) {
			continue
		}
		h := old.Base()
		s := slot{difficulty: h.Difficulty, typ: h.Type, picture: noPicture}
		if !bank.KindOn(s.typ) && slices.Contains(sharedKinds, s.typ) && len(newKinds) > 0 {
			s.typ = newKinds[0]
		}
		if bank.HasPictures(old) {
			s.picture = withPicture
		}
		var found []bank.Question
		for _, q := range b.Live(h.Category, s.typ) {
			t, id := q.Extra(), q.Base().ID
			if !used[id] && !taken[id] && !bad(q) && (len(t.On) == 0 || t.OnDay(day)) && fitsPlace(b, q, s, s.typ) &&
				(t.BG || !old.Extra().BG) && !slices.ContainsFunc(bank.Subjects(q), func(k string) bool { return named[k] }) {
				found = append(found, q)
			}
		}
		if len(found) == 0 {
			return nil, false
		}
		r.Shuffle(len(found), func(i, j int) { found[i], found[j] = found[j], found[i] })
		apart := func(q bank.Question) bool {
			return !slices.ContainsFunc(bank.Subjects(q), func(k string) bool { return recent[k] })
		}
		slices.SortStableFunc(found, func(x, y bank.Question) int {
			return 2*(b2i(answered[x.Base().ID])-b2i(answered[y.Base().ID])) + b2i(!apart(x)) - b2i(!apart(y))
		})
		q := found[0]
		out[i] = Pick{ID: q.Base().ID, Seed: r.Uint64()}
		taken[q.Base().ID] = true
		for _, k := range bank.Subjects(q) {
			named[k] = true
		}
	}
	return out, true
}

// allLive is whether the bank has each of the picks, live: not retired, and of a kind the game deals (bank.Playable).
func allLive(b *bank.Bank, picks []Pick) bool {
	for _, p := range picks {
		if q, ok := b.Get(p.ID); !ok || !bank.Playable(q) {
			return false
		}
	}
	return true
}

// shaped is whether a day's questions are of the day's kinds (daySlots; an order, a match or a split in the puzzle's
// place): every day is drawn so, but a question whose kind changed since (a choice made a match again) leaves its day
// misshapen, and that day is drawn again.
func shaped(b *bank.Bank, picks []Pick) bool {
	want := map[string]int{}
	for _, s := range daySlots {
		want[s.typ]++
	}
	for _, p := range picks {
		q, ok := b.Get(p.ID)
		if !ok {
			return false
		}
		k := q.Base().Type
		if slices.Contains(puzzleKinds, k) {
			k = puzzle
		}
		want[k]--
	}
	for _, n := range want {
		if n != 0 {
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
