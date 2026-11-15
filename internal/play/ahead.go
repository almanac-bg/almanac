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
	mrand "math/rand/v2"
	"slices"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The days ahead: the day's questions are drawn up to Ahead days before their day, and no other game deals them
// (dayQuestions), so that the day stays one attempt for everyone. Were only today's ten kept out, a question would
// reach a topic game, a duel, a room or Роял before its own day, and the players who play most would meet more and
// more of the day as a rerun, with its answer known.
//
// A day ahead is drawn only while every one of its places has a question that fits it just so (drawDay's exact): when a
// place runs short (the pictures, say), the days stop there, and go on as the bank grows, rather than fill a day a
// year off with what's at hand. Of the questions that fit, those nobody has answered come first. A day ahead whose
// question has left the bank is drawn again; so are all the days after tomorrow when the draw's rules change
// (DayRules) or the bank's days and Bulgarian questions do (bank.Tail.On, BG): a day drawn ahead is drawn by today's
// rules, never a year-old version's.
//
// The days ahead are drawn in a transaction of their own (KeepDays: as the server starts, then each minute when the
// day or the bank has changed), never in a player's: a game that rolls back can't take them with it. A player's game
// only reads them (days); today's, if it isn't drawn yet, is drawn there as it always was.

// DayRules names the day's draw as it is: change it whenever drawDay draws differently, and the days after tomorrow
// are drawn again by the new rules.
const DayRules = "2026-11-15 picture-first, on, bg, estimate"

// Ahead is how many days ahead of today the day's questions are drawn.
const Ahead = 365

// dayBars are the questions no other game deals: today's, and all of them (today's and the days ahead).
type dayBars struct {
	today, all map[string]bool
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
	if _, err := g.day(tx, today); err != nil && !errors.Is(err, ErrNoQuestion) {
		return dayBars{}, err
	}
	stored, err := storedDays(tx, today)
	if err != nil {
		return dayBars{}, err
	}
	return barsOf(stored, today), nil
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
	var bars dayBars
	err := g.DB.Tx(context.WithoutCancel(ctx), func(tx *sql.Tx) error {
		var err error
		bars, err = g.drawAhead(tx, today, b)
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

// drawAhead draws today if it isn't yet, the days after tomorrow again if the rules or the bank's dated and Bulgarian
// questions changed since they were drawn, a day ahead again if a question of it left the bank, and the days missing
// up to Ahead (while they can be drawn exactly); it says what today and the days ahead hold.
func (g *Game) drawAhead(tx *sql.Tx, today string, b *bank.Bank) (dayBars, error) {
	if _, err := g.day(tx, today); err != nil && !errors.Is(err, ErrNoQuestion) {
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
		// A day ahead with a question the bank no longer has is drawn again; nobody has played it.
		if day > today && !allLive(b, picks) {
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
	answered, err := answeredQuestions(tx)
	if err != nil {
		return dayBars{}, err
	}
	r := mrand.New(mrand.NewPCG(newSeed(), newSeed()))
	for range Ahead {
		d = d.AddDate(0, 0, 1)
		day := d.Format(time.DateOnly)
		if _, ok := all[day]; ok {
			continue
		}
		picks, exact := drawDay(b, day, used, answered, r)
		if !exact {
			break // a place has run short: the days ahead stop here until the bank grows
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
	return barsOf(all, today), nil
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

// barsOf are the questions of today and the days after it.
func barsOf(days map[string][]Pick, today string) dayBars {
	bars := dayBars{today: map[string]bool{}, all: map[string]bool{}}
	for day, picks := range days {
		if day < today {
			continue
		}
		for _, p := range picks {
			bars.all[p.ID] = true
			if day == today {
				bars.today[p.ID] = true
			}
		}
	}
	return bars
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

// answeredQuestions are the questions anyone has answered.
func answeredQuestions(tx *sql.Tx) (map[string]bool, error) {
	rows, err := tx.Query(`SELECT DISTINCT question_id FROM answers`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}
