package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"math/rand/v2"
	"slices"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// A room (package room) is played live, in memory; this is what the game knows of it: how its questions are drawn
// (DrawRoom), and what each player's game in it counts for once it's over (RecordRoom): a run of its own kind, 'room',
// that earns XP and whose answers count as seen. It counts for the day's goals and the achievements as a topic's game
// does only when someone else played it too (together), and for „Сто игри“ only with Length questions or more: alone,
// on easy questions, a room was a shortcut to both (review 2026-11-18, E10). It's on no board of the day and moves no rating; its XP is any game's in the week's league. A game is kept
// once for each player (by its id: RoomPlay.Game), and what playing it to its end earns is by the questions it was
// dealt, not those it was cut to: a game its host ended at the first question earns that question's share.

// Mix is how hard a room's questions are: its host chooses as they open it.
type Mix string

const (
	// MixEasy is easy and medium questions only: a grandparent at the table, a class of ten-year-olds.
	MixEasy Mix = "easy"
	// MixMixed is easy to hard, as a topic's game is for a player who knows as much as most.
	MixMixed Mix = "mixed"
	// MixHard is medium and hard questions only: a pub quiz.
	MixHard Mix = "hard"
)

// RoomLengths are the lengths a room's game may have.
var RoomLengths = []int{5, 10, 15, 20}

// ErrRoomGame is a room's game asked for with a length or a mix there isn't.
var ErrRoomGame = errors.New("no such room game")

// RoomGame checks a room's settings, the defaults in place of none (0, ""): ten questions, mixed.
func RoomGame(length int, mix Mix) (int, Mix, error) {
	if length == 0 {
		length = Length
	}
	if mix == "" {
		mix = MixMixed
	}
	if !slices.Contains(RoomLengths, length) || (mix != MixEasy && mix != MixMixed && mix != MixHard) {
		return 0, "", ErrRoomGame
	}
	return length, mix, nil
}

// roomSlots is a room's game of n questions: its difficulties easy to hard, in the mix's shares (a mixed game's are
// a topic's game's for most players), and among them, spread out, a question of every other type for each two —
// a true-or-not, an order, a match, a split (or clues) and a number in every ten, the rest choices.
func roomSlots(n int, mix Mix) []slot {
	levels := []bank.Difficulty{bank.Easy, bank.Medium, bank.Hard}
	var share [3]float64 // of each of levels
	switch mix {
	case MixEasy:
		share = [3]float64{0.6, 0.4, 0}
	case MixHard:
		share = [3]float64{0, 0.4, 0.6}
	default:
		for _, s := range topicSlots(0) {
			share[slices.Index(levels, s.difficulty)] += 1.0 / Length
		}
	}
	// Largest remainders: the counts add up to n.
	var count [3]int
	left := n
	for i, s := range share {
		count[i] = int(math.Floor(s * float64(n)))
		left -= count[i]
	}
	for ; left > 0; left-- {
		best := 0
		for i := range share {
			if share[i]*float64(n)-float64(count[i]) > share[best]*float64(n)-float64(count[best]) {
				best = i
			}
		}
		count[best]++
	}
	slots := make([]slot, 0, n)
	for i, c := range count {
		for range c {
			slots = append(slots, slot{difficulty: levels[i], typ: "choice"})
		}
	}
	others := []slot{{typ: "truefalse"}, {typ: "order"}, {typ: "match"}, {typ: "split", alt: "choice"}, {typ: "number"}}
	k := n / 2
	for j := range k {
		i := (2*j + 1) * n / (2 * k)
		o := others[j%len(others)]
		slots[i].typ, slots[i].alt = o.typ, o.alt
	}
	return slots
}

// DrawRoom draws a room's game: n questions of a topic ("" for all) in a mix, never one barred (the day's, those due
// for review: DayQuestions; and those the room has dealt already), a number an estimate where one is left (wishes). A
// mix that leaves out a difficulty never deals it, even if that makes the game shorter; the types give way first.
func DrawRoom(b *bank.Bank, category string, n int, mix Mix, barred map[string]bool, r *rand.Rand) []Pick {
	pool := b.Live(category, "")
	switch mix {
	case MixEasy:
		pool = slices.DeleteFunc(slices.Clone(pool), func(q bank.Question) bool { return q.Base().Difficulty == bank.Hard })
	case MixHard:
		pool = slices.DeleteFunc(slices.Clone(pool), func(q bank.Question) bool { return q.Base().Difficulty == bank.Easy })
	}
	taken := map[string]bool{}
	allowed := func(q bank.Question) bool { return !taken[q.Base().ID] && !barred[q.Base().ID] }
	fresh := func(bank.Question) bool { return true }
	var picks []Pick
	for _, s := range newKind(roomSlots(n, mix), r) {
		if q := choose(pool, s, allowed, fresh, wishes(s), r); q != nil {
			taken[q.Base().ID] = true
			// A room deals its game as it starts, and keeps it: the version too.
			picks = append(picks, Pick{ID: q.Base().ID, Seed: r.Uint64(), V: bank.Version(q)})
		}
	}
	return picks
}

// RoomPlay is one player's game in a room, as the room kept it: the game's questions, the points it gave them (the
// room's own, with any bonus), and their answers from the question they came in on.
type RoomPlay struct {
	// Game tells the game from every other, in any room ("": none to tell it by, kept as a new one each time).
	Game     string
	Category string
	// Picks are the questions asked; Length how many the game was dealt (more, if its host ended it early).
	Picks   []Pick
	Length  int
	Points  int
	Answers []RoomAnswer
	// Players is how many played the game: gave an answer in it, this player too.
	Players int
}

// together is a SQL condition on a run (r): that it isn't a room's game played alone. A room's game kept before its
// players were (NULL) counts, as it did then.
func together(r string) string {
	return `(` + r + `.kind <> 'room' OR coalesce(` + r + `.players, 2) > 1)`
}

// RoomAnswer is one answer of a player's game in a room, as the room graded it.
type RoomAnswer struct {
	N int // its question's place in the game
	// Given and Shown are the answer, nil if the time ran out on it.
	Given, Shown json.RawMessage
	Score        float64
	Right        bool
	Points       int
	Ms           int64
	At           time.Time
}

// RecordRoom keeps a player's game in a room as a finished run, and what it earned them (after.go), and says which
// run it is. The run has the game's questions; those before the player came in have no answer, and count as nothing
// (what playing to the end earns is in the share of all the game's questions answered right, of all it was dealt).
// The same game kept again for the player is the run it was kept as, earning nothing more.
func (g *Game) RecordRoom(ctx context.Context, userID int64, p RoomPlay) (int64, error) {
	var runID int64
	var game any
	if p.Game != "" {
		game = p.Game + ":" + strconv.FormatInt(userID, 10)
	}
	again := false
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		if game != nil {
			err := tx.QueryRow(`SELECT id FROM runs WHERE room_game = ?`, game).Scan(&runID)
			if err == nil {
				again = true
				return nil
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		var category any
		if p.Category != "" {
			category = p.Category
		}
		r, err := g.insertRun(ctx, tx, userID, "room", nil, category, p.Picks)
		if err != nil {
			return err
		}
		runID = r.id
		gained, given := 0, false
		for _, a := range p.Answers {
			if a.N < 0 || a.N >= len(p.Picks) {
				continue
			}
			var giv, shown any
			if a.Given != nil {
				giv, shown, given = string(a.Given), string(a.Shown), true
			}
			if _, err := tx.Exec(`INSERT INTO answers (run_id, n, question_id, given, shown, score, points, is_right, ms, at, version)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, a.N, p.Picks[a.N].ID, giv, shown, a.Score, a.Points, a.Right,
				a.Ms, store.Ms(a.At), g.versionOf(p.Picks[a.N])); err != nil {
				return err
			}
			gained += xp(bank.Graded{Given: a.Given, Score: a.Score})
			if a.Right {
				r.rights++
			}
			r.ms += a.Ms
		}
		if given {
			if err := g.markActive(tx, userID); err != nil {
				return err
			}
		}
		if _, err := judge(tx, g.Bank(), r.id, p.Picks); err != nil {
			return err
		}
		r.xp = gained + finishXP("room", r.rights, max(p.Length, len(p.Picks)))
		if _, err := tx.Exec(`UPDATE runs SET at = ?, points = ?, rights = ?, xp = ?, ms = ?, finished_at = ?, room_game = ?,
			players = ? WHERE id = ?`, len(p.Picks), p.Points, r.rights, r.xp, r.ms, store.Ms(g.Now()), game,
			max(p.Players, 1), r.id); err != nil {
			return err
		}
		return g.afterDue(tx, r.id)
	})
	if err != nil {
		return 0, err
	}
	if !again { // what follows a run kept before is that run's (after.go): done, or due
		g.finished(ctx, userID, runID)
	}
	return runID, nil
}
