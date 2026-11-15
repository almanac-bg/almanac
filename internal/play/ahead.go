package play

import (
	"database/sql"
	"encoding/json"
	"errors"
	mrand "math/rand/v2"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The days ahead: the day's questions are drawn up to Ahead days before their day, and no other game deals them
// (dayQuestions), so that the day stays one attempt for everyone. Were only today's ten kept out, a question would
// reach a topic game, a duel, a room or Роял before its own day, and the players who play most would meet more and
// more of the day as a rerun, with its answer known.
//
// A day ahead is drawn only while every one of its places has a question that fits just so (drawDay's exact): when a
// place runs short (the pictures, say), the days stop there, and go on as the bank grows, rather than fill a day a
// year off with what's at hand. Of the questions that fit, those nobody has answered come first. A day ahead whose
// question has left the bank is drawn again. Today is drawn whatever happens (runs.go: day).
//
// It runs once a day, and again when the bank is reloaded: the days and what they hold are kept in memory (daysCache)
// between.

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

// days are today's questions and the days ahead's, drawing whatever is missing first (once a day, or a bank).
func (g *Game) days(tx *sql.Tx) (dayBars, error) {
	today, b := g.Today(), g.Bank()
	g.daysAhead.mu.Lock()
	defer g.daysAhead.mu.Unlock()
	if c := &g.daysAhead; c.day == today && c.bank == b {
		return c.bars, nil
	}
	// Today first, as before: drawn whatever the bank has left.
	if _, err := g.day(tx, today); err != nil && !errors.Is(err, ErrNoQuestion) {
		return dayBars{}, err
	}
	stored := map[string][]Pick{}
	used := map[string]bool{}
	rows, err := tx.Query(`SELECT day, questions FROM days`)
	if err != nil {
		return dayBars{}, err
	}
	for rows.Next() {
		var day, s string
		var picks []Pick
		if err := rows.Scan(&day, &s); err != nil || json.Unmarshal([]byte(s), &picks) != nil {
			rows.Close()
			return dayBars{}, errors.Join(err, errors.New("a stored day can't be read"))
		}
		stored[day] = picks
	}
	rows.Close()
	for day, picks := range stored {
		// A day ahead with a question the bank no longer has is drawn again; nobody has played it.
		if day > today && !allLive(b, picks) {
			if _, err := tx.Exec(`DELETE FROM days WHERE day = ?`, day); err != nil {
				return dayBars{}, err
			}
			delete(stored, day)
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
	d, _ := time.Parse(time.DateOnly, today)
	for range Ahead {
		d = d.AddDate(0, 0, 1)
		day := d.Format(time.DateOnly)
		if _, ok := stored[day]; ok {
			continue
		}
		picks, exact := drawDay(b, used, answered, r)
		if !exact {
			break // a place has run short: the days ahead stop here until the bank grows
		}
		data, _ := json.Marshal(picks)
		if _, err := tx.Exec(`INSERT INTO days (day, questions) VALUES (?, ?)`, day, string(data)); err != nil {
			return dayBars{}, err
		}
		stored[day] = picks
		for _, p := range picks {
			used[p.ID] = true
		}
	}
	bars := dayBars{today: map[string]bool{}, all: map[string]bool{}}
	for day, picks := range stored {
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
	// Kept for the day. (Every write runs one at a time, on the one connection: no other transaction is between. Should
	// this one roll back, the days ahead it drew aren't kept, and are drawn anew tomorrow; meanwhile their questions
	// stay out of the other games, which costs nothing.)
	g.daysAhead.day, g.daysAhead.bank, g.daysAhead.bars = today, b, bars
	return bars, nil
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
