package play

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"math"
	"sync"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Versions: a question changes now and then while it's in play (its answer fixed, an option reworded, a decoy added,
// its picture swapped), and the bank is reloaded while players are in the middle of it. A play is graded against
// exactly what it showed all the same: as a question goes on screen, its run keeps which version it is (Pick.V,
// bank.Version), and dealing the pick again (to grade it, to show it after a refresh, to go over it after the game)
// deals that version, from the bank in play while it's still that, else as the game kept it. The game keeps every
// version of every question it has played (question_versions, Keep), so this holds over a restart too, and for good:
// a game is gone over (Review) with the versions it showed however long ago, and the bank's copies keep their
// pictures for as long (bank.Copy). A duel's second side is dealt the first's picks, versions and all, so the two
// play the same ten. The day's ten are pinned
// as their day begins, the same for everyone that day, and one changed or found untrue during it counts for nobody
// (day.go).
//
// Each answer keeps the version it was to (answers.version), so that how players answered a question (its crowd,
// how hard it is, its calibration) counts only the answers to it as it is now (counted). The answers from before
// versions were kept count for a question's first version kept, from the day it was last changed (as that was all
// there was to tell them apart by), and for no later one.

// versions are the versions kept, as the game knows them: read once, then kept up with each bank (Keep).
type versions struct {
	mu     sync.Mutex
	loaded bool
	rows   map[versionKey]versionRow
	first  map[string]int64 // each question's first version kept: its row
	past   map[versionKey]bank.Question
}

type versionKey struct{ id, version string }

type versionRow struct{ id, since int64 }

// pastKept is how many versions no longer in the bank are kept read back at most (the latest reloads' changes).
const pastKept = 2048

// Keep keeps the versions of a bank's questions that the game hasn't yet, as they are: the bank's first, every
// question; later ones, those that changed. It's done before a bank goes into play (and for the bank a server starts
// with), so that every version shown can be dealt again once the bank has moved on.
func (g *Game) Keep(ctx context.Context, b *bank.Bank) error {
	v := &g.versions
	if err := g.loadVersions(ctx); err != nil {
		return err
	}
	type fresh struct {
		key            versionKey
		category, body string
		since          int64
	}
	now := g.Now().UnixMilli()
	var list []fresh
	v.mu.Lock()
	for _, q := range b.Questions {
		h := q.Base()
		key := versionKey{h.ID, bank.Version(q)}
		if _, ok := v.rows[key]; ok {
			continue
		}
		body, err := bank.Encode(q)
		if err != nil {
			v.mu.Unlock()
			return err
		}
		f := fresh{key: key, category: h.Category, body: string(body), since: now}
		if _, ok := v.first[h.ID]; !ok {
			f.since = changedMs(q)
		}
		list = append(list, f)
	}
	v.mu.Unlock()
	// In chunks: a bank's first keeping is every question, and the game's one writer mustn't wait on it all at once.
	for len(list) > 0 {
		chunk := list[:min(len(list), 500)]
		list = list[len(chunk):]
		ids := make([]int64, len(chunk))
		err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
			for i, f := range chunk {
				err := tx.QueryRow(`INSERT INTO question_versions (question_id, version, category, body, since)
					VALUES (?, ?, ?, ?, ?)
					ON CONFLICT (question_id, version) DO UPDATE SET question_id = excluded.question_id RETURNING id`,
					f.key.id, f.key.version, f.category, f.body, f.since).Scan(&ids[i])
				if err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		v.mu.Lock()
		for i, f := range chunk {
			v.rows[f.key] = versionRow{id: ids[i], since: f.since}
			if _, ok := v.first[f.key.id]; !ok {
				v.first[f.key.id] = ids[i]
			}
		}
		v.mu.Unlock()
	}
	return nil
}

// loadVersions reads the versions kept, the first time.
func (g *Game) loadVersions(ctx context.Context) error {
	v := &g.versions
	v.mu.Lock()
	loaded := v.loaded
	v.mu.Unlock()
	if loaded {
		return nil
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT id, question_id, version, since FROM question_versions ORDER BY id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	all, first := map[versionKey]versionRow{}, map[string]int64{}
	for rows.Next() {
		var k versionKey
		var r versionRow
		if err := rows.Scan(&r.id, &k.id, &k.version, &r.since); err != nil {
			return err
		}
		all[k] = r
		if _, ok := first[k.id]; !ok {
			first[k.id] = r.id
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.loaded {
		v.rows, v.first, v.past, v.loaded = all, first, map[versionKey]bank.Question{}, true
	}
	return nil
}

// question is a pick's question, as the run has it: the version it holds (Pick.V: the one it showed, or the day's from
// the day's start), or, none yet, the bank's now. False if there's none: gone from the bank, or a version the game
// never kept. A past version is read through db: the transaction the caller holds, or the read pool where it holds
// none (pastVersion).
func (g *Game) question(db querier, p Pick) (bank.Question, bool) {
	q, ok := g.Bank().Get(p.ID)
	if ok && (p.V == "" || bank.Version(q) == p.V) {
		return q, true
	}
	if p.V == "" {
		return nil, false
	}
	return g.pastVersion(db, p.ID, p.V)
}

// deal deals a pick's question, the version it showed (question), read through db.
func (g *Game) deal(db querier, p Pick) (bank.Dealt, bool) {
	q, ok := g.question(db, p)
	if !ok {
		return nil, false
	}
	return q.Deal(p.Seed), true
}

// Deal deals a pick as a run has it: the version it showed, if it did (a duel's, played second), else as the
// bank has it now. False if it can't be.
func (g *Game) Deal(p Pick) (bank.Dealt, bool) { return g.deal(g.DB.Read, p) }

// pastVersion is a version of a question no longer in the bank, as the game kept it, read through db: a caller that
// holds a transaction reads in it, never asking the read pool for a second connection. A few at once, each holding one
// and waiting for another, would wait on each other (the writer with them, in Show or Answer); and the version a run
// holds was kept (Keep) before it was ever shown, so any transaction that sees the run sees its versions.
func (g *Game) pastVersion(db querier, id, version string) (bank.Question, bool) {
	key := versionKey{id, version}
	v := &g.versions
	v.mu.Lock()
	q, ok := v.past[key]
	v.mu.Unlock()
	if ok {
		return q, true
	}
	var category, body string
	err := db.QueryRowContext(context.Background(), `SELECT category, body FROM question_versions WHERE question_id = ? AND version = ?`,
		id, version).Scan(&category, &body)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			slog.Warn("reading a question's past version", "question", id, "version", version, "err", err)
		}
		return nil, false
	}
	q, err = bank.Decode([]byte(body), category)
	if err != nil || bank.Version(q) != version {
		slog.Error("a question's past version can't be read back", "question", id, "version", version, "err", err)
		return nil, false
	}
	v.mu.Lock()
	if v.past == nil || len(v.past) >= pastKept {
		v.past = map[versionKey]bank.Question{}
	}
	v.past[key] = q
	v.mu.Unlock()
	return q, true
}

// versionOf is the row of a pick's version, as answers keep it (nil when it isn't known: not shown, or not kept).
func (g *Game) versionOf(p Pick) any {
	if p.V == "" {
		return nil
	}
	v := &g.versions
	v.mu.Lock()
	defer v.mu.Unlock()
	if r, ok := v.rows[versionKey{p.ID, p.V}]; ok {
		return r.id
	}
	return nil
}

// Counted says which answers to a question count for it as it is now (its crowd, its hardness, its calibration): those
// to its version, and, of those from before versions were kept, the ones since From. Counts tells of one answer.
type Counted struct {
	// Version is the row of the question's version (answers.version), 0 when the game kept none.
	Version int64
	// From is when the answers without a version start to count (ms); math.MaxInt64 for none.
	From int64
}

// Counts says whether an answer counts: of its version (NULL: from before versions were kept), given at at (ms).
func (c Counted) Counts(version sql.NullInt64, at int64) bool {
	if version.Valid {
		return version.Int64 == c.Version
	}
	return at >= c.From
}

// CountedOf is which answers count for a question, as this version of it. A game that keeps no versions itself (a
// tool's) reads those kept, once (if it can't, by the day each question last changed).
func (g *Game) CountedOf(q bank.Question) Counted {
	_ = g.loadVersions(context.Background())
	id := q.Base().ID
	v := &g.versions
	v.mu.Lock()
	defer v.mu.Unlock()
	r, ok := v.rows[versionKey{id, bank.Version(q)}]
	switch {
	case !ok: // a version the game didn't keep (a game that keeps none: tools, tests): by the day it last changed
		return Counted{From: changedMs(q)}
	case v.first[id] == r.id:
		return Counted{Version: r.id, From: r.since}
	}
	return Counted{Version: r.id, From: math.MaxInt64}
}
