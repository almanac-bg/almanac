package play

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The seal (DECISIONS.md, „The direction“, as the Fable review amended it): a player's seal in a chapter says how much
// of it their book holds in ink (ink.go). Its states are named for the book, not the person: Бележка at 1, Страница
// at 5, Тетрадка at 15, Книга at 40, Том at 100, Летопис at 250, then „Летопис · 2“ at 350 and another for each
// further 100 (RankAt). Beside a name only the seal shows, never its word: the word is the Алманах's and a rank-up's.
// The seals are the only levels, titles and unlocks the game has. In code a seal's state is its rank.
//
// A rank is kept, never worked out on view (ranks): it's counted as a day's issue is finished (afterRun: only the
// issue writes ink), and it never falls, whatever the bank does to the facts under it later. With it is kept the
// chapter's ink as counted and how far it is to the next rank in quarters (Quarter): the seal fills in quarters
// between ranks. There's no check of guessing: a tapper climbs as slowly as their ink does.
//
// A rank risen is told once, with the game's news (NewsOf: Rose), several at once as one; Бележка, the first, never.
// At Страница a chapter's art becomes the player's to wear as their avatar (progress.go: SetAvatar); the animals are
// everyone's. The player wears one chapter's seal beside their name, the one they choose (users.seal, SetSeal), or else
// their best (the highest, the more ink on a tie). It goes with their look (progress.go: Look) wherever others see
// their name (boards, friends, requests, duels, the profile), read from the ranks kept like all of this.

// Rank is a step of the ladder: its name, and the ink it starts at.
type Rank struct {
	Name string `json:"name"`
	From int    `json:"from"`
}

// Ranks are the ladder's named steps (level 1 to 6); past the last, each further LetopisEvery is another „Летопис“.
var Ranks = []Rank{
	{"Бележка", 1}, {"Страница", 5}, {"Тетрадка", 15}, {"Книга", 40}, {"Том", 100}, {"Летопис", 250},
}

const (
	// LetopisEvery is how much more ink each „Летопис · N“ past the first takes.
	LetopisEvery = 100
	// RankArt is the level whose chapter's art the player may wear (Страница).
	RankArt = 2
)

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

// ChapterRank is a player's rank in a chapter, as kept: its level and name, the quarters toward the next, the
// chapter's ink as counted then, and the next rank and the ink it starts at.
type ChapterRank struct {
	Chapter string `json:"chapter"`
	Level   int    `json:"level"`
	Name    string `json:"name"`
	Quarter int    `json:"quarter"`
	Ink     int    `json:"ink"`
	Next    string `json:"next"`
	NextAt  int    `json:"nextAt"`
}

func chapterRank(chapter string, level, quarter, ink int) ChapterRank {
	return ChapterRank{Chapter: chapter, Level: level, Name: RankName(level), Quarter: quarter, Ink: ink,
		Next: RankName(level + 1), NextAt: RankFrom(level + 1)}
}

// rightChance is the chance a guess at a question of each kind is right (not its score: calibrate.go's chance): one of
// four options; one of two; an order of four, one of 24; four pairs, one of 24; a split of four or five, about one
// of 16; a number typed blind, next to none. What a recording is expected to be, by a player's mastery
// (expectedRights), counts the guesses so.
var rightChance = map[string]float64{"choice": 0.25, "clues": 0.25, "truefalse": 0.5, "order": 1.0 / 24,
	"match": 1.0 / 24, "split": 1.0 / 16, "number": 0.02}

// keptRank is a chapter's rank as the ranks table keeps it.
type keptRank struct {
	level, quarter, ink, told int
}

// ranksOf reads a player's kept ranks, by chapter.
func ranksOf(ctx context.Context, db querier, userID int64) (map[string]keptRank, error) {
	rows, err := db.QueryContext(ctx, `SELECT chapter, level, quarter, ink, told FROM ranks WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]keptRank{}
	for rows.Next() {
		var c string
		var k keptRank
		if err := rows.Scan(&c, &k.level, &k.quarter, &k.ink, &k.told); err != nil {
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
		k := kept[c.ID]
		ranks = append(ranks, chapterRank(c.ID, k.level, k.quarter, k.ink))
	}
	return ranks, nil
}

// Worn is a seal as it shows beside a player's name to others (Look): its chapter and level, no more (its word is
// the Алманах's, never beside a name; its quarters show from 32px, on the player's own pages).
type Worn struct {
	Chapter string `json:"chapter"`
	Level   int    `json:"level"`
}

// ErrNoSeal is a seal of a chapter the player has no rank in.
var ErrNoSeal = errors.New("no rank in that chapter")

// Seal is the seal a player wears: a chapter's rank (ChapterRank), drawn.
type Seal = ChapterRank

// SealOf is the seal a player wears: the chapter they chose (users.seal), while they have a rank in it; else their
// best (the highest level, the more ink on a tie, the bank's order after that); nil with no rank at all.
func (g *Game) SealOf(ctx context.Context, userID int64) (*Seal, error) {
	var chosen sql.NullString
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT seal FROM users WHERE id = ?`, userID).Scan(&chosen); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	ranks, err := g.RanksOf(ctx, userID)
	if err != nil {
		return nil, err
	}
	return sealOf(ranks, chosen.String), nil
}

// sealOf is the seal of a player's ranks: the chosen chapter's, if they have a rank there, else the best.
func sealOf(ranks []ChapterRank, chosen string) *Seal {
	var best *Seal
	for i, r := range ranks {
		if r.Level == 0 {
			continue
		}
		if r.Chapter == chosen {
			return &ranks[i]
		}
		if best == nil || r.Level > best.Level || r.Level == best.Level && r.Ink > best.Ink {
			best = &ranks[i]
		}
	}
	return best
}

// SetSeal chooses the chapter whose seal the player wears: one they have a rank in (ErrNoSeal otherwise); "" for
// their best, whichever it is.
func (g *Game) SetSeal(ctx context.Context, userID int64, chapter string) error {
	if chapter != "" {
		var level int
		err := g.DB.Read.QueryRowContext(ctx, `SELECT level FROM ranks WHERE user_id = ? AND chapter = ?`, userID, chapter).
			Scan(&level)
		if errors.Is(err, sql.ErrNoRows) || err == nil && level == 0 {
			return ErrNoSeal
		}
		if err != nil {
			return err
		}
	}
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE users SET seal = nullif(?, '') WHERE id = ?`, chapter, userID)
	return err
}

// HasArt is whether a player may wear a chapter's art as their avatar: their rank there is RankArt or more.
func (g *Game) HasArt(ctx context.Context, userID int64, chapter string) (bool, error) {
	var has bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM ranks WHERE user_id = ? AND chapter = ?
		AND level >= ?)`, userID, chapter, RankArt).Scan(&has)
	return has, err
}

// Rose is the ranks risen since the player was last told, told once as one (News.Rose): each chapter's from and to,
// whether it brings its art (Art: Страница reached), and whether the player's best rank rose with them (Best: the
// one big moment).
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
	Art     bool   `json:"art,omitempty"`
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
			r.Ranks = append(r.Ranks, RankUp{Chapter: chapter, From: told, To: level, Name: RankName(level),
				Ink: ink, Art: told < RankArt && level >= RankArt})
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

// Step is the chapter nearest its next rank, as the day's result and its reminder say it („История: още 2 до
// Тетрадка“): the chapter, the ink it still needs (Left), and the rank's name (Next); the rank it has (Level, 0 before
// any) and the quarters of the way to the next (Quarter), for its seal and pips.
type Step struct {
	Chapter string `json:"chapter"`
	Left    int    `json:"left"`
	Next    string `json:"next"`
	Level   int    `json:"level"`
	Quarter int    `json:"quarter"`
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
			best = &Step{Chapter: c.ID, Left: left, Next: RankName(level + 1), Level: level, Quarter: Quarter(level, n)}
		}
	}
	return best, nil
}

// chapterOfArt is the chapter whose art an avatar's shape is, if it's one (a chapter's id: SetAvatar).
func chapterOfArt(b *bank.Bank, shape string) (string, bool) {
	return shape, slices.ContainsFunc(b.Categories, func(c bank.Category) bool { return c.ID == shape })
}
