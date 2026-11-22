package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/safe"
)

// Crowds: how players have answered each question (bank.Crowd), shown with its answer — what share picked each
// option, where the typed numbers fell, how many got it right. They're counted from the answer log now and then, in
// the background (snapshot.go), so that showing one never waits on the count; a question shows its crowd once it has
// CrowdFrom answers to it as it is now (versions.go: a crowd that answered other options says nothing of these), and a
// version other than the one counted (the bank changed since, or a play showing one kept) shows none. A crowd is
// people's: the answers of games played at a script's speed aren't in it (fair.go).
//
// The day's ten are the same for everyone, so a question of the day shows how that day's other players answered it
// („… от играчите днес“), counted with each answer, once DayCrowdFrom of them have; until then everyone's.

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

// crowds are the questions' crowds as counted, by id, each of the version it was counted for.
type crowds map[string]versionCrowd

type versionCrowd struct {
	version string
	c       *bank.Crowd
}

// Crowd is how players have answered a question, this version of it, as last counted: nil while it has too few
// answers (or before the first count, or for a version the count didn't have). A count that's out of date, or of
// another bank, starts a new one in the background.
func (g *Game) Crowd(q bank.Question) *bank.Crowd {
	s := g.crowds.peek(g.Now(), g.Bank(), g.crowdCounter())
	if s == nil {
		return nil
	}
	if k, ok := s.v[q.Base().ID]; ok && k.version == bank.Version(q) {
		return k.c
	}
	return nil
}

// Count counts what's kept counted for everyone (the questions' crowds and hardness), the two at once, and waits for
// them: the server's first counts, made as it starts. Until they're in, what was kept of
// the last ones (snapshot.go) is shown, so no player waits on them unless none was ever kept.
func (g *Game) Count(ctx context.Context) error {
	now, b := g.Now(), g.Bank()
	errs := make([]error, 2)
	var wg sync.WaitGroup
	// A panic in a count is the count's (errCountBroke: snapshot.go); one around it is stopped here.
	wg.Go(func() {
		safe.Do("counting: crowds", func() { _, errs[0] = g.crowds.refresh(ctx, now, b, g.crowdCounter()) })
	})
	wg.Go(func() {
		safe.Do("counting: hardness", func() { _, errs[1] = g.hard.refresh(ctx, now, b, g.hardCounter()) })
	})
	wg.Wait()
	return errors.Join(errs...)
}

// CountCrowds counts every question's crowd now, and waits for it: tests, and tools.
func (g *Game) CountCrowds(ctx context.Context) error {
	_, err := g.crowds.refresh(ctx, g.Now(), g.Bank(), g.crowdCounter())
	return err
}

// savedCrowd is a question's crowd as the database keeps it (snapshot.go): of which version.
type savedCrowd struct {
	Version string
	Crowd   *bank.Crowd
}

// crowdCounter counts the crowds, and keeps them as they are.
func (g *Game) crowdCounter() counter[crowds] {
	return counter[crowds]{db: g.DB, name: "crowds", fresh: CrowdFresh, count: g.countCrowds,
		keep: func(c crowds) ([]byte, error) {
			kept := make(map[string]savedCrowd, len(c))
			for id, k := range c {
				kept[id] = savedCrowd{k.version, k.c}
			}
			return gobbed(kept)
		},
		take: func(raw []byte, _ *bank.Bank) (crowds, error) {
			kept, err := ungobbed[map[string]savedCrowd](raw)
			if err != nil {
				return nil, err
			}
			c := make(crowds, len(kept))
			for id, k := range kept {
				c[id] = versionCrowd{k.Version, k.Crowd}
			}
			return c, nil
		}}
}

func (g *Game) countCrowds(ctx context.Context, now time.Time, b *bank.Bank) (crowds, error) {
	// Which of each question's answers count (versions.go), worked out before the answers are read: what it reads,
	// it reads on a read connection of its own, and the count holds one already.
	of := make(map[string]Counted, len(b.Questions)) // the questions in the bank, and in play
	for _, q := range b.Questions {
		if !q.Extra().Retired {
			of[q.Base().ID] = g.CountedOf(q)
		}
	}
	rows, err := g.DB.Scan.QueryContext(ctx, `SELECT question_id, version, given, is_right, at FROM answers WHERE `+FairAnswers)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tallies := map[string]map[string]*bank.Tally{}
	var id []byte
	for rows.Next() {
		var version sql.NullInt64
		var given sql.NullString
		var right bool
		var at int64
		if err := rows.Scan(&id, &version, &given, &right, &at); err != nil {
			return nil, err
		}
		counted, live := of[string(id)] // no copy of the id for a lookup
		if !live || !counted.Counts(version, at) {
			continue
		}
		byGiven := tallies[string(id)]
		if byGiven == nil {
			byGiven = map[string]*bank.Tally{}
			tallies[string(id)] = byGiven
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
		return nil, err
	}
	by := crowds{}
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
		by[id] = versionCrowd{bank.Version(q), bank.CrowdOf(q, list)}
	}
	return by, nil
}

// changedMs is when what a question asks last changed (its answers from before then were to another question;
// bank.Tail.AskedSince: a fix to its fact doesn't count), in ms: the start of that day in Bulgaria, or 0 if unknown.
// It tells apart only the answers from before versions were kept; the others keep theirs (versions.go).
func changedMs(q bank.Question) int64 {
	d, err := time.ParseInLocation(time.DateOnly, q.Extra().AskedSince(), Bulgaria)
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

// crowdOf is how other players have answered a question of a run, the version it showed: for the day's ten, that day's
// players, once enough of them have; otherwise everyone, as last counted.
func (g *Game) crowdOf(ctx context.Context, db querier, r *run, q bank.Question) (*bank.Crowd, error) {
	if r.kind == "day" {
		c, err := g.dayCrowd(ctx, db, r.day, q, r.userID)
		if c != nil || err != nil {
			return c, err
		}
	}
	return g.Crowd(q), nil
}

// dayCrowd is how the other players of a day have answered one of its questions (this version of it): nil while fewer
// than DayCrowdFrom have. A player's own answer is never in it, but in a crowd big enough to be kept a while
// (dayCrowdKeep), where it can't change what shows. A kept crowd is counted again once it's dayCrowdFresh old, by one
// answer in the background, while the others are shown the last count: the count costs as much as the day has
// players, so it's never made by every answer that comes in while it runs. Nor is the first: with none kept (the
// server just started, or the question changed), the first answer counts everyone's, and those that come meanwhile
// wait for it. Only a crowd too small to keep is counted by each answer, for its player: it's cheap.
func (g *Game) dayCrowd(ctx context.Context, db querier, day string, q bank.Question, userID int64) (*bank.Crowd, error) {
	id, now, version := q.Base().ID, g.Now(), bank.Version(q)
	key := day + " " + id
	k, lead, recount := g.dayCrowds.look(key, version, now)
	if lead {
		c, n, err := g.countDayCrowd(context.WithoutCancel(ctx), g.DB.Read, day, q, 0)
		if err != nil {
			slog.Warn("counting a day's crowd", "question", id, "err", err)
		}
		g.dayCrowds.first(key, k, c, n, err)
	} else {
		select {
		case <-k.ready:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if recount {
		// A count that panics leaves no crowd kept: the next answer counts it again.
		safe.Go("counting a day's crowd", func() {
			ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Minute)
			defer cancel()
			c, n, err := g.countDayCrowd(ctx, g.DB.Read, day, q, 0)
			if err != nil || n < dayCrowdKeep { // fewer than it had: answers left with a script's runs
				if err != nil {
					slog.Warn("counting a day's crowd", "question", id, "err", err)
				}
				g.dayCrowds.drop(key)
				return
			}
			g.dayCrowds.put(key, version, c, now)
		}, func() { g.dayCrowds.drop(key) })
	}
	if c := g.dayCrowds.crowd(k); c != nil {
		return c, nil
	}
	// Too few to keep: counted for this player, without their own answer.
	c, n, err := g.countDayCrowd(ctx, db, day, q, userID)
	if err != nil || c == nil {
		return nil, err
	}
	if n >= dayCrowdKeep {
		g.dayCrowds.put(key, version, c, now)
	}
	return c, nil
}

// countDayCrowd counts how the other players of a day (all but userID) have answered one of its questions, this
// version of it (versions.go), and how many have: a nil crowd while fewer than DayCrowdFrom.
func (g *Game) countDayCrowd(ctx context.Context, db querier, day string, q bank.Question, userID int64) (*bank.Crowd, int, error) {
	start, err := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	if err != nil {
		return nil, 0, err
	}
	counted := g.CountedOf(q)
	// The question's answers since the day began (answers_question), each run looked up by its key: CROSS JOIN keeps
	// that order, which the planner wouldn't choose without statistics (it would go through every day's runs).
	rows, err := db.QueryContext(ctx, `SELECT a.given, count(*), sum(a.is_right) FROM answers a CROSS JOIN runs r ON r.id = a.run_id
		WHERE a.question_id = ? AND a.at >= ? AND (a.version = ? OR a.version IS NULL AND a.at >= ?)
			AND r.kind = 'day' AND r.day = ? AND r.user_id <> ? AND `+othersSee("r")+`
		GROUP BY a.given`,
		q.Base().ID, start.UnixMilli(), counted.Version, counted.From, day, userID)
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

// dayCrowdCache keeps the days' crowds, each of one version of its question: those big enough (dayCrowdKeep), fresh
// for dayCrowdFresh, and then, while one is counted again, shown as they were, for up to dayCrowdUsable; and, for as
// long, that one is too small to keep (each answer counts its own then).
type dayCrowdCache struct {
	mu sync.Mutex
	by map[string]*keptCrowd
}

// dayCrowdUsable is how long a kept crowd may still be shown while it's counted again.
const dayCrowdUsable = 10 * time.Minute

type keptCrowd struct {
	at       time.Time
	version  string
	c        *bank.Crowd   // nil: too small to keep, or not counted yet
	ready    chan struct{} // closed once its first count is in
	counting bool          // counted again now
}

// ready is a channel closed already: a crowd kept has its count.
var ready = func() chan struct{} {
	c := make(chan struct{})
	close(c)
	return c
}()

// usable says whether a kept crowd can be shown: of this version, and not from the clock's future, nor too old.
func (k *keptCrowd) usable(now time.Time, version string) bool {
	age := now.Sub(k.at)
	return k.version == version && age >= 0 && age < dayCrowdUsable
}

// look is what's kept of a day's question, this version of it: made if there's nothing usable, and then this caller is
// the one to count it first (lead), those that come meanwhile waiting for it (ready); and whether this caller is to
// count a kept crowd again (only one is, at a time, once it's dayCrowdFresh old).
func (d *dayCrowdCache) look(key, version string, now time.Time) (k *keptCrowd, lead, recount bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.by == nil {
		d.by = map[string]*keptCrowd{}
	}
	k = d.by[key]
	if k == nil || !k.usable(now, version) {
		k = &keptCrowd{at: now, version: version, ready: make(chan struct{})}
		d.by[key] = k
		return k, true, false
	}
	if k.c != nil && now.Sub(k.at) >= dayCrowdFresh && !k.counting {
		k.counting = true
		return k, false, true
	}
	return k, false, false
}

// first takes a kept crowd's first count (everyone's: n answers), and lets those waiting for it go on: kept if it's
// big enough, else for each to count; forgotten if it failed, for the next to count again.
func (d *dayCrowdCache) first(key string, k *keptCrowd, c *bank.Crowd, n int, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if err == nil && n >= dayCrowdKeep {
		k.c = c
	}
	if err != nil && d.by[key] == k {
		delete(d.by, key)
	}
	close(k.ready)
}

// crowd is a kept crowd to show, if it's big enough to be kept.
func (d *dayCrowdCache) crowd(k *keptCrowd) *bank.Crowd {
	d.mu.Lock()
	defer d.mu.Unlock()
	return k.c
}

// put keeps a crowd big enough, counted at now, and forgets those too old.
func (d *dayCrowdCache) put(key, version string, c *bank.Crowd, now time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.by == nil {
		d.by = map[string]*keptCrowd{}
	}
	for other, k := range d.by {
		if age := now.Sub(k.at); age < 0 || age >= dayCrowdUsable {
			delete(d.by, other)
		}
	}
	d.by[key] = &keptCrowd{at: now, version: version, c: c, ready: ready}
}

// drop forgets a kept crowd: the next answer counts it.
func (d *dayCrowdCache) drop(key string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.by, key)
}
