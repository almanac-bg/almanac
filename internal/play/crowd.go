package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Crowds: how players have answered each question (bank.Crowd), shown with its answer — what share picked each
// option, where the typed numbers fell, how many got it right. They're counted from the answer log now and then, in
// the background, so that showing one never waits on the count; a question shows its crowd once it has CrowdFrom
// answers since it last changed (a crowd that answered other options says nothing of these).

const (
	// CrowdFrom is how many answers a question needs before its crowd is shown: fewer say little.
	CrowdFrom = 20
	// CrowdFresh is how long a count stands before the next one.
	CrowdFresh = time.Hour
)

type crowdCache struct {
	counting sync.Mutex // held while a count runs: one at a time
	snap     atomic.Pointer[crowdSnap]
}

// crowdSnap is a count: when, of which bank, and each question's crowd.
type crowdSnap struct {
	at   time.Time
	bank *bank.Bank
	by   map[string]*bank.Crowd
}

// Crowd is how players have answered a question, as last counted: nil while it has too few answers (or before the
// first count). A count that's out of date, or of another bank, starts a new one in the background.
func (g *Game) Crowd(id string) *bank.Crowd {
	s := g.crowds.snap.Load()
	now, b := g.Now(), g.Bank()
	if (s == nil || s.bank != b || now.Sub(s.at) >= CrowdFresh || now.Before(s.at)) && g.crowds.counting.TryLock() {
		go func() {
			defer g.crowds.counting.Unlock()
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			if err := g.countCrowds(ctx, now, b); err != nil {
				slog.Warn("counting crowds", "err", err)
			}
		}()
	}
	if s == nil {
		return nil
	}
	return s.by[id]
}

// CountCrowds counts every question's crowd now, and waits for it: the server's first count, and tests.
func (g *Game) CountCrowds(ctx context.Context) error {
	g.crowds.counting.Lock()
	defer g.crowds.counting.Unlock()
	return g.countCrowds(ctx, g.Now(), g.Bank())
}

func (g *Game) countCrowds(ctx context.Context, now time.Time, b *bank.Bank) error {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT question_id, given, is_right, at FROM answers`)
	if err != nil {
		return err
	}
	defer rows.Close()
	since := map[string]int64{} // each question's last change, in ms (-1: not in the bank)
	tallies := map[string]map[string]*bank.Tally{}
	for rows.Next() {
		var id string
		var given sql.NullString
		var right bool
		var at int64
		if err := rows.Scan(&id, &given, &right, &at); err != nil {
			return err
		}
		from, ok := since[id]
		if !ok {
			from = -1
			if q, live := b.Get(id); live && !q.Extra().Retired {
				from = changedMs(q)
			}
			since[id] = from
		}
		if from < 0 || at < from {
			continue
		}
		byGiven := tallies[id]
		if byGiven == nil {
			byGiven = map[string]*bank.Tally{}
			tallies[id] = byGiven
		}
		t := byGiven[given.String]
		if t == nil {
			t = &bank.Tally{}
			if given.Valid {
				t.Given = json.RawMessage(given.String)
			}
			byGiven[given.String] = t
		}
		t.N++
		if right {
			t.Right++
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	by := map[string]*bank.Crowd{}
	for id, byGiven := range tallies {
		list, n := make([]bank.Tally, 0, len(byGiven)), 0
		for _, t := range byGiven {
			list = append(list, *t)
			n += t.N
		}
		if n < CrowdFrom {
			continue
		}
		q, _ := b.Get(id)
		by[id] = bank.CrowdOf(q, list)
	}
	g.crowds.snap.Store(&crowdSnap{at: now, bank: b, by: by})
	return nil
}

// changedMs is when a question last changed (its answers from before then were to another question), in ms: the
// start of that day in Bulgaria, or 0 if it hasn't.
func changedMs(q bank.Question) int64 {
	t := q.Extra()
	day := t.Updated
	if day == "" {
		day = t.Added
	}
	d, err := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	if err != nil {
		return 0
	}
	return d.UnixMilli()
}
