package play

import (
	"context"
	"database/sql"
	"slices"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The seal (DECISIONS.md, „The direction“, as the Fable review amended it): a player's seal in a chapter says how much
// of it their book holds in ink (ink.go). Its states are named for the book, not the person: Бележка at 1, Страница
// at 5, Тетрадка at 15, Книга at 40, Том at 100, Летопис at 250, then „Летопис · 2“ at 350 and another for each
// further 100 (RankAt). With a player only the seal shows, on their avatar's corner, never its word: the word is the
// Алманах's and a rank-up's.
// The seals are the only levels, titles and unlocks the game has. In code a seal's state is its rank.
//
// A rank is kept, never worked out on view (ranks): it's counted as a day's issue is finished (afterRun: only the
// issue writes ink), and it never falls, whatever the bank does to the facts under it later. With it is kept the
// chapter's ink as counted and how far it is to the next rank in quarters (Quarter); a player is shown the way from
// one rank's ink to the next's (ChapterRank: From, NextAt) as a bar. There's no check of guessing: a tapper climbs as slowly as their ink does.
//
// A rank risen is told once, with the game's news (NewsOf: Rose), several at once as one; Бележка, the first, never.
// A seal's reward is the seal itself: it unlocks nothing (an avatar is an animal: progress.go, SetAvatar). The player
// wears their best seal on their avatar's corner, never chosen (sealOf: the highest rank, the more ink on a tie, then
// the chapter whose rank came first). It goes with their look (progress.go: Look) wherever others see their name
// (boards, friends, requests, duels, the profile), read from the ranks kept like all of this.

// Rank is a step of the ladder: its name, and the ink it starts at.
type Rank struct {
	Name string `json:"name"`
	From int    `json:"from"`
}

// Ranks are the ladder's named steps (level 1 to 6); past the last, each further LetopisEvery is another „Летопис“.
var Ranks = []Rank{
	{"Бележка", 1}, {"Страница", 5}, {"Тетрадка", 15}, {"Книга", 40}, {"Том", 100}, {"Летопис", 250},
}

// LetopisEvery is how much more ink each „Летопис · N“ past the first takes.
const LetopisEvery = 100

// RankAt is the level a chapter's ink makes: 0 none, 1 Бележка … 6 Летопис, 7 „Летопис · 2“ and on.
func RankAt(ink int) int {
	last := Ranks[len(Ranks)-1]
	if ink >= last.From {
		return len(Ranks) + (ink-last.From)/LetopisEvery
	}
	level := 0
	for i, r := range Ranks {
		if ink >= r.From {
			level = i + 1
		}
	}
	return level
}

// RankFrom is the ink a level starts at.
func RankFrom(level int) int {
	switch {
	case level <= 0:
		return 0
	case level <= len(Ranks):
		return Ranks[level-1].From
	}
	return Ranks[len(Ranks)-1].From + (level-len(Ranks))*LetopisEvery
}

// RankName is a level's name: „Тетрадка“, „Летопис · 3“; "" for none.
func RankName(level int) string {
	switch {
	case level <= 0:
		return ""
	case level <= len(Ranks):
		return Ranks[level-1].Name
	}
	return Ranks[len(Ranks)-1].Name + " · " + strconv.Itoa(level-len(Ranks)+1)
}

// Quarter is how many quarters of the way from a level to the next a chapter's ink is: 0 to 3.
func Quarter(level, ink int) int {
	from, to := RankFrom(level), RankFrom(level+1)
	return min(3, max(0, 4*(ink-from)/(to-from)))
}

// ChapterRank is a player's rank in a chapter, as kept: its level and name, the ink it starts at (From), the
// chapter's ink as counted then, and the next rank and the ink it starts at: the way from From to NextAt is the bar
// beside a seal (web/src/ui.ts, standing). The quarters toward the next are the kept rank's own (countRanks).
type ChapterRank struct {
	Chapter string `json:"chapter"`
	Level   int    `json:"level"`
	Name    string `json:"name"`
	From    int    `json:"from"`
	Quarter int    `json:"-"`
	Ink     int    `json:"ink"`
	Next    string `json:"next"`
	NextAt  int    `json:"nextAt"`
	// Day is the day it rose to its level (YYYY-MM-DD): of two best seals alike, the one that came first is worn.
	Day string `json:"-"`
}

func chapterRank(chapter string, k keptRank) ChapterRank {
	return ChapterRank{Chapter: chapter, Level: k.level, Name: RankName(k.level), From: RankFrom(k.level),
		Quarter: k.quarter, Ink: k.ink, Next: RankName(k.level + 1), NextAt: RankFrom(k.level + 1), Day: k.day}
}

// rightChance is the chance a guess at a question of each kind is right: one of four options; one of two; an order of
// three (bank.OrderDealt), one of 6; four pairs, one of 24; a split of four or five, about one of 16; a number typed
// blind, next to none. How hard a question is (countHardness, Calibrate) and how well a player knows a topic
// (ability.learn) count the guesses so.
var rightChance = map[string]float64{"choice": 0.25, "clues": 0.25, "truefalse": 0.5, "order": 1.0 / 6,
	"match": 1.0 / 24, "split": 1.0 / 16, "number": 0.02}

// keptRank is a chapter's rank as the ranks table keeps it.
type keptRank struct {
	level, quarter, ink, told int
	day                       string
}

// ranksOf reads a player's kept ranks, by chapter.
func ranksOf(ctx context.Context, db querier, userID int64) (map[string]keptRank, error) {
	rows, err := db.QueryContext(ctx, `SELECT chapter, level, quarter, ink, told, day FROM ranks WHERE user_id = ?`,
		userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]keptRank{}
	for rows.Next() {
		var c string
		var k keptRank
		if err := rows.Scan(&c, &k.level, &k.quarter, &k.ink, &k.told, &k.day); err != nil {
			return nil, err
		}
		out[c] = k
	}
	return out, rows.Err()
}

// countRanks counts a player's ranks again from their book's ink, as a day's issue finishes (afterRun): each chapter
// of the bank's at the rank its ink makes (the ink of games that can't be played on now: an issue still being played,
// yesterday's finished after midnight or one brought by a merge, counts when it finishes, or once its day is over if
// it's left: writtenIn), never lower than it was. A rank risen waits to be told (told below level).
func (g *Game) countRanks(ctx context.Context, userID int64, day string) error {
	return countRanksIn(ctx, g.DB.Read, g.DB.Write, g.Bank(), userID, day, g.Now())
}

// execer is what writes: the database, or a transaction.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// countRanksIn is countRanks, read by r and written by w (a transaction, both, where the book was just written again
// in it: rewriteBook), by bank b, at the time now (what counts: writtenIn).
func countRanksIn(ctx context.Context, r querier, w execer, b *bank.Bank, userID int64, day string, now time.Time) error {
	ink, err := inkIn(ctx, r, b, userID, now)
	if err != nil {
		return err
	}
	kept, err := ranksOf(ctx, r, userID)
	if err != nil {
		return err
	}
	for _, c := range b.Categories {
		n := ink[c.ID]
		level := RankAt(n)
		was, ok := kept[c.ID]
		level = max(level, was.level)
		if level == 0 {
			continue
		}
		quarter := Quarter(level, n)
		told := 0 // a chapter's first rank waits to be told; a rank kept already keeps what was told of it
		if ok && level == was.level && quarter == was.quarter && n == was.ink {
			continue
		}
		if _, err := w.ExecContext(ctx, `INSERT INTO ranks (user_id, chapter, level, quarter, ink, day, told)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT (user_id, chapter) DO UPDATE SET
				level = max(ranks.level, excluded.level), quarter = excluded.quarter, ink = excluded.ink,
				day = CASE WHEN excluded.level > ranks.level THEN excluded.day ELSE ranks.day END`,
			userID, c.ID, level, quarter, n, day, told); err != nil {
			return err
		}
	}
	return nil
}

// RanksOf are a player's ranks, as kept, by the bank's chapters (those with none at level 0).
func (g *Game) RanksOf(ctx context.Context, userID int64) ([]ChapterRank, error) {
	kept, err := ranksOf(ctx, g.DB.Read, userID)
	if err != nil {
		return nil, err
	}
	ranks := []ChapterRank{}
	for _, c := range g.Bank().Categories {
		ranks = append(ranks, chapterRank(c.ID, kept[c.ID]))
	}
	return ranks, nil
}

// Worn is a seal as it shows on a player's avatar to others (Look): its chapter and level, no more (its word is
// the Алманах's, never beside a name; the way to the next shows on the player's own pages).
type Worn struct {
	Chapter string `json:"chapter"`
	Level   int    `json:"level"`
}

// Seal is the seal a player wears: a chapter's rank (ChapterRank), drawn.
type Seal = ChapterRank

// SealOf is the seal a player wears: their best (sealOf); nil with no rank at all.
func (g *Game) SealOf(ctx context.Context, userID int64) (*Seal, error) {
	ranks, err := g.RanksOf(ctx, userID)
	if err != nil {
		return nil, err
	}
	return sealOf(ranks), nil
}

// sealOf is the seal a player's ranks make theirs, never chosen (DECISIONS.md: the badge is the best seal): the
// highest rank, then the more ink in its chapter, then the chapter whose rank came first (its day), then the bank's
// order (ranks are in it); nil before any rank.
func sealOf(ranks []ChapterRank) *Seal {
	var best *Seal
	for i, r := range ranks {
		if r.Level == 0 {
			continue
		}
		if best == nil || r.Level > best.Level || r.Level == best.Level && (r.Ink > best.Ink ||
			r.Ink == best.Ink && r.Day != "" && (best.Day == "" || r.Day < best.Day)) {
			best = &ranks[i]
		}
	}
	return best
}

// Rose is the ranks risen since the player was last told, told once as one (News.Rose): each chapter's from and to,
// and whether the player's best rank rose with them (Best: the one big moment).
type Rose struct {
	Ranks []RankUp `json:"ranks"`
	Best  bool     `json:"best,omitempty"`
}

// RankUp is a chapter's rank risen: from the level last told (0: none) to the level now, and the ink it was counted
// from (the best rank's line says it: „40 факта от История са с мастило“).
type RankUp struct {
	Chapter string `json:"chapter"`
	From    int    `json:"from"`
	To      int    `json:"to"`
	Name    string `json:"name"`
	Ink     int    `json:"ink"`
}

// roseOf tells the ranks risen since last told, and marks them told: nil if none worth telling (Бележка alone is
// never told).
func roseOf(tx *sql.Tx, userID int64) (*Rose, error) {
	rows, err := tx.Query(`SELECT chapter, level, told, ink FROM ranks WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	var r Rose
	before, after := 0, 0
	for rows.Next() {
		var chapter string
		var level, told, ink int
		if err := rows.Scan(&chapter, &level, &told, &ink); err != nil {
			rows.Close()
			return nil, err
		}
		before, after = max(before, min(told, level)), max(after, level)
		if level > told && level > 1 {
			r.Ranks = append(r.Ranks, RankUp{Chapter: chapter, From: told, To: level, Name: RankName(level), Ink: ink})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`UPDATE ranks SET told = level WHERE user_id = ? AND told < level`, userID); err != nil {
		return nil, err
	}
	if len(r.Ranks) == 0 {
		return nil, nil
	}
	slices.SortFunc(r.Ranks, func(a, b RankUp) int { return b.To - a.To })
	r.Best = after > before
	return &r, nil
}

// Step is the chapter nearest its next rank, as the reminder says it („История: още 2 до Тетрадка“): the chapter,
// the ink it still needs (Left), the rank's name (Next), and the rank it has (Level, 0 before any).
type Step struct {
	Chapter string
	Left    int
	Next    string
	Level   int
}

// StepOf is a player's chapter nearest its next rank, by the ink their ranks are counted from (inkIn, now: an issue
// still being played isn't in it yet, as it isn't in the ranks) and their ranks as kept (the fewest ink still needed;
// the bank's order on a tie); nil before any ink. The reminders' last word names it.
func (g *Game) StepOf(ctx context.Context, userID int64) (*Step, error) {
	ink, err := inkIn(ctx, g.DB.Read, g.Bank(), userID, g.Now())
	if err != nil {
		return nil, err
	}
	kept, err := ranksOf(ctx, g.DB.Read, userID)
	if err != nil {
		return nil, err
	}
	var best *Step
	for _, c := range g.Bank().Categories {
		n := ink[c.ID]
		if n == 0 {
			continue
		}
		level := max(RankAt(n), kept[c.ID].level)
		left := RankFrom(level+1) - n
		if left <= 0 {
			left = 1 // the next rank, held for a day's count
		}
		if best == nil || left < best.Left {
			best = &Step{Chapter: c.ID, Left: left, Next: RankName(level + 1), Level: level}
		}
	}
	return best, nil
}
