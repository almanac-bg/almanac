package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Crowds: how players have answered each question (bank.Crowd), shown with its answer — what share picked each
// option, where the typed numbers fell, how many got it right. They're counted from the answer log now and then, in
// the background, so that showing one never waits on the count; a question shows its crowd once it has CrowdFrom
// answers since it last changed (a crowd that answered other options says nothing of these). A crowd is people's: the
// answers of games played at a script's speed aren't in it (fair.go).
//
// The day's ten are the same for everyone, so a question of the day shows how that day's other players answered it
// („… от играчите днес“), counted with each answer, once DayCrowdFrom of them have; until then everyone's. The share
// of the day's players right is also what a shared result tells of its rarest right answer (RarestRight).

const (
	// CrowdFrom is how many answers a question needs before its crowd is shown: fewer say little.
	CrowdFrom = 20
	// CrowdFresh is how long a count stands before the next one.
	CrowdFresh = time.Hour
	// DayCrowdFrom is how many of the day's other players need to have answered a question of the day before theirs
	// is the crowd shown. Fewer than CrowdFrom: they answered the same question in the same place, and on a young game
	// twenty would take half the day; fewer than ten, early in the morning, would make one player's luck a statistic.
	DayCrowdFrom = 10
	// dayCrowdKeep is how big a day's crowd is kept for dayCrowdFresh rather than counted again with every answer:
	// from there one more answer moves its share right by less than a rounding.
	dayCrowdKeep  = 250
	dayCrowdFresh = time.Minute
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

// Count counts what's kept counted for everyone (the questions' crowds and hardness, the boards of knowledge), the
// three at once, and waits for them: the server's first counts, made as it starts so that no player waits on them.
func (g *Game) Count(ctx context.Context) error {
	errs := make([]error, 3)
	var wg sync.WaitGroup
	wg.Go(func() { errs[0] = g.CountCrowds(ctx) })
	wg.Go(func() { _, errs[1] = g.hardness(ctx) })
	wg.Go(func() { _, errs[2] = g.knowledge(ctx) })
	wg.Wait()
	return errors.Join(errs...)
}

// CountCrowds counts every question's crowd now, and waits for it: the server's first count, and tests.
func (g *Game) CountCrowds(ctx context.Context) error {
	g.crowds.counting.Lock()
	defer g.crowds.counting.Unlock()
	return g.countCrowds(ctx, g.Now(), g.Bank())
}

func (g *Game) countCrowds(ctx context.Context, now time.Time, b *bank.Bank) error {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT question_id, given, is_right, at FROM answers WHERE `+FairAnswers)
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
		if n < g.crowdFrom(CrowdFrom) {
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

// crowdFrom is how many answers a crowd needs before it's shown: from, unless the game says otherwise (CrowdMin).
func (g *Game) crowdFrom(from int) int {
	if g.CrowdMin > 0 {
		return g.CrowdMin
	}
	return from
}

// crowdOf is how other players have answered a question of a run: for the day's ten, that day's players, once enough
// of them have; otherwise everyone, as last counted.
func (g *Game) crowdOf(ctx context.Context, db querier, r *run, q bank.Question) (*bank.Crowd, error) {
	if r.kind == "day" {
		c, err := g.dayCrowd(ctx, db, r.day, q, r.userID)
		if c != nil || err != nil {
			return c, err
		}
	}
	return g.Crowd(q.Base().ID), nil
}

// dayCrowd is how the other players of a day have answered one of its questions (since it last changed): nil while
// fewer than DayCrowdFrom have. A player's own answer is never in it, but in a crowd big enough to be kept a while
// (dayCrowdKeep), where it can't change what shows. A kept crowd is counted again once it's dayCrowdFresh old, by one
// answer in the background, while the others are shown the last count: the count costs as much as the day has
// players, so it's never made by every answer that comes in while it runs.
func (g *Game) dayCrowd(ctx context.Context, db querier, day string, q bank.Question, userID int64) (*bank.Crowd, error) {
	id, now, b := q.Base().ID, g.Now(), g.Bank()
	key := day + " " + id
	c, recount := g.dayCrowds.get(key, now, b)
	if recount {
		go func() {
			ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Minute)
			defer cancel()
			c, n, err := g.countDayCrowd(ctx, g.DB.Read, day, q, 0)
			if err != nil || n < dayCrowdKeep { // fewer than it had: answers left with a script's runs, counted each time
				if err != nil {
					slog.Warn("counting a day's crowd", "question", id, "err", err)
				}
				g.dayCrowds.drop(key)
				return
			}
			g.dayCrowds.put(key, c, now, b)
		}()
	}
	if c != nil {
		return c, nil
	}
	c, n, err := g.countDayCrowd(ctx, db, day, q, userID)
	if err != nil || c == nil {
		return nil, err
	}
	if n >= dayCrowdKeep {
		g.dayCrowds.put(key, c, now, b)
	}
	return c, nil
}

// countDayCrowd counts how the other players of a day (all but userID) have answered one of its questions, and how
// many have: a nil crowd while fewer than DayCrowdFrom.
func (g *Game) countDayCrowd(ctx context.Context, db querier, day string, q bank.Question, userID int64) (*bank.Crowd, int, error) {
	start, err := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	if err != nil {
		return nil, 0, err
	}
	// The question's answers since the day began (answers_question), each run looked up by its key: CROSS JOIN keeps
	// that order, which the planner wouldn't choose without statistics (it would go through every day's runs).
	rows, err := db.QueryContext(ctx, `SELECT a.given, count(*), sum(a.is_right) FROM answers a CROSS JOIN runs r ON r.id = a.run_id
		WHERE a.question_id = ? AND a.at >= ? AND r.kind = 'day' AND r.day = ? AND r.user_id <> ? AND NOT r.scripted
		GROUP BY a.given`,
		q.Base().ID, max(start.UnixMilli(), changedMs(q)), day, userID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var tallies []bank.Tally
	n := 0
	for rows.Next() {
		var given sql.NullString
		var t bank.Tally
		if err := rows.Scan(&given, &t.N, &t.Right); err != nil {
			return nil, 0, err
		}
		if given.Valid {
			t.Given = json.RawMessage(given.String)
		}
		tallies = append(tallies, t)
		n += t.N
	}
	if err := rows.Err(); err != nil || n < g.crowdFrom(DayCrowdFrom) {
		return nil, n, err
	}
	c := bank.CrowdOf(q, tallies)
	c.Today = true
	return c, n, nil
}

// dayCrowdCache keeps the days' crowds big enough (dayCrowdKeep): fresh for dayCrowdFresh, and then, while one is
// counted again, shown as they were, for up to dayCrowdUsable.
type dayCrowdCache struct {
	mu sync.Mutex
	by map[string]*keptCrowd
}

// dayCrowdUsable is how long a kept crowd may still be shown while it's counted again.
const dayCrowdUsable = 10 * time.Minute

type keptCrowd struct {
	at       time.Time
	bank     *bank.Bank
	c        *bank.Crowd
	counting bool // counted again now
}

// age is how old a kept crowd is, or false if it can't be shown (of another bank, or from the clock's future).
func (k *keptCrowd) age(now time.Time, b *bank.Bank) (time.Duration, bool) {
	age := now.Sub(k.at)
	return age, k.bank == b && age >= 0 && age < dayCrowdUsable
}

// get is a kept crowd, if there's one to show, and whether this caller is to count it again (only one is, at a time).
func (d *dayCrowdCache) get(key string, now time.Time, b *bank.Bank) (*bank.Crowd, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	k := d.by[key]
	if k == nil {
		return nil, false
	}
	age, ok := k.age(now, b)
	if !ok {
		return nil, false
	}
	if age < dayCrowdFresh || k.counting {
		return k.c, false
	}
	k.counting = true
	return k.c, true
}

func (d *dayCrowdCache) put(key string, c *bank.Crowd, now time.Time, b *bank.Bank) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.by == nil {
		d.by = map[string]*keptCrowd{}
	}
	for k, kept := range d.by {
		if _, ok := kept.age(now, b); !ok {
			delete(d.by, k)
		}
	}
	d.by[key] = &keptCrowd{at: now, bank: b, c: c}
}

// drop forgets a kept crowd: the next answer counts it.
func (d *dayCrowdCache) drop(key string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.by, key)
}

// FewRight is a right answer in the day's ten and how few of the day's other players got it right: its place in the
// ten, and the share of them that did.
type FewRight struct {
	N     int     `json:"n"`
	Right float64 `json:"right"`
}

// RarestRight is the player's right answer in a day's ten, finished, that the fewest of that day's other players got
// right (of the questions enough of them have answered): nil for none.
func (g *Game) RarestRight(ctx context.Context, userID int64, day string) (*FewRight, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.n, a.question_id FROM runs r JOIN answers a ON a.run_id = r.id
		WHERE r.user_id = ? AND r.kind = 'day' AND r.day = ? AND r.finished_at IS NOT NULL AND a.is_right ORDER BY a.n`,
		userID, day)
	if err != nil {
		return nil, err
	}
	type right struct {
		n  int
		id string
	}
	var rights []right
	for rows.Next() {
		var it right
		if err := rows.Scan(&it.n, &it.id); err != nil {
			rows.Close()
			return nil, err
		}
		rights = append(rights, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var rare *FewRight
	for _, it := range rights {
		q, ok := g.Bank().Get(it.id)
		if !ok {
			continue
		}
		c, err := g.dayCrowd(ctx, g.DB.Read, day, q, userID)
		if err != nil {
			return nil, err
		}
		if c != nil && (rare == nil || c.Right < rare.Right) {
			rare = &FewRight{N: it.n, Right: c.Right}
		}
	}
	return rare, nil
}
