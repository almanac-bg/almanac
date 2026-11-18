package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Fair play: a game played quicker than a person plays (a script's, or a cheat's) counts for its player alone.
//
// The rule has one home, scriptPaced: more than MostQuick of a game's answers came under their question's Floor. A
// person who knew one or two at once is still a person; three in one game is a pattern. Questions not answered (given
// up, timed out) don't count. A run is judged as its answers come in (record calls judgeAnswer): only a quick answer
// can make it a script's, and once it is, it stays one, however the run ends (by its last answer, by its time, with
// its Роял, or left half-way). The runs played before the mark were judged once, as the server started (JudgeRuns).
//
// A marked run is a shadow (runs.shadow, ShadowScript): its player sees it as any other game, with its score, and
// their place among the others as if it were in, and nothing tells them otherwise; for everyone else it isn't there.
// One other run is a shadow, for another reason (ShadowGuest): a day's run a guest played and brought to an account
// that was there already, signing in (merge.go). Whoever played the day as several guests could otherwise sign in
// from the best of them, and the day's one game would be the best of many. It's left out of:
//   - the day's board, its count of players and its places, and friends' results of the day (BoardOf, FriendsBoard,
//     FriendsOf; fairFor);
//   - the week's league: a day's run at a script's speed counts in its player's own view of the race, never against
//     the others in it (standingsFor);
//   - the Знания board (KnowledgeBoard);
//   - the questions' statistics: how players answered each (crowd.go), how hard each is (hardness, Calibrate) and
//     /admin's tallies (FairAnswers);
//   - the recordings a duel is played against (recordedRun).
//
// What it isn't left out of: the player's own numbers (their profile, level, achievements, goals, streak), which are
// theirs; and the rating, one number everyone sees, which a duel or a Роял moves as it ends (a live game is played
// in front of the others anyway).

// Why a run is a shadow (runs.shadow; 0: it isn't one).
const (
	// ShadowScript is a run played at a script's speed (scriptPaced).
	ShadowScript = 1
	// ShadowGuest is a day's run a guest brought to an account that was there when it was played (merge.go).
	ShadowGuest = 2
)

// ByPerson is a SQL condition on a run (its columns, unaliased) that a person played it: one at a script's speed
// wasn't. A guest's day brought to an account was, and counts with the games people played (/admin's), once: only one
// game of a day is ever an account's.
const ByPerson = `shadow <> 1`

// Floor is the least time a person takes to answer a question of its kind, as the server times it (from when it
// showed the question to when the answer came, so the trip to the server and back is in it too). Seeing four options
// and tapping one takes about half a second before reading a word (choice reaction time), so a tap under 0.7 s
// wasn't read: a true-or-not, a choice, a clue. A number is read, typed and sent: 1.2 s. An order, a match or a
// split is four taps or more after reading: 2 s. Each is well under what a quick player takes (they rarely answer
// under a second) and well over a script (tens of milliseconds).
func Floor(q bank.Question) time.Duration {
	switch q.Base().Type {
	case "number":
		return 1200 * time.Millisecond
	case "order", "match", "split":
		return floorMost
	}
	return 700 * time.Millisecond
}

// floorMost is the highest Floor of any kind (migration 0035 lists the runs to judge by it).
const floorMost = 2 * time.Second

// MostQuick is the most answers under their Floor that a person's game has.
const MostQuick = 2

// scriptPaced is whether a game was played at a script's speed: more than MostQuick of its answers came under their
// question's Floor. times is how long each answer took, by its place in the run: the answered ones only.
func scriptPaced(b *bank.Bank, picks []Pick, times map[int]int64) bool {
	quick := 0
	for n, ms := range times {
		if n < 0 || n >= len(picks) {
			continue
		}
		if q, ok := b.Get(picks[n].ID); ok && time.Duration(ms)*time.Millisecond < Floor(q) {
			quick++
		}
	}
	return quick > MostQuick
}

// judgeAnswer marks a run as played at a script's speed if the answer just kept (to question r.at, in ms) makes it
// one: only a quick answer can.
func (g *Game) judgeAnswer(tx *sql.Tx, r *run, gr bank.Graded, ms int64) error {
	if r.shadow || gr.Given == nil {
		return nil
	}
	b := g.Bank()
	if q, ok := b.Get(r.picks[r.at].ID); !ok || time.Duration(ms)*time.Millisecond >= Floor(q) {
		return nil
	}
	var err error
	r.shadow, err = judge(tx, b, r.id, r.picks)
	return err
}

// judge marks a run if its answers so far were a script's (scriptPaced), and says whether they were.
func judge(tx *sql.Tx, b *bank.Bank, runID int64, picks []Pick) (bool, error) {
	rows, err := tx.Query(`SELECT n, ms FROM answers WHERE run_id = ? AND given IS NOT NULL`, runID)
	if err != nil {
		return false, err
	}
	times := map[int]int64{}
	for rows.Next() {
		var n int
		var ms int64
		if err := rows.Scan(&n, &ms); err != nil {
			rows.Close()
			return false, err
		}
		times[n] = ms
	}
	rows.Close()
	if err := rows.Err(); err != nil || !scriptPaced(b, picks, times) {
		return false, err
	}
	_, err = tx.Exec(`UPDATE runs SET shadow = ? WHERE id = ?`, ShadowScript, runID)
	return true, err
}

// JudgeRuns judges the runs a migration left for the bank to judge (runs_unjudged: whether an answer came under its
// Floor depends on its question's kind, which only the bank knows), marks those played at a script's speed, and
// clears the list. The server runs it as it starts, before it serves; it says how many it marked.
func (g *Game) JudgeRuns(ctx context.Context) (int, error) {
	marked := 0
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT r.id, r.questions FROM runs_unjudged u JOIN runs r ON r.id = u.run_id`)
		if err != nil {
			return err
		}
		type unjudged struct {
			id    int64
			picks []Pick
		}
		var list []unjudged
		for rows.Next() {
			var u unjudged
			var raw string
			if err := rows.Scan(&u.id, &raw); err != nil {
				rows.Close()
				return err
			}
			if json.Unmarshal([]byte(raw), &u.picks) == nil {
				list = append(list, u)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		b := g.Bank()
		for _, u := range list {
			is, err := judge(tx, b, u.id, u.picks)
			if err != nil {
				return err
			}
			if is {
				marked++
			}
		}
		_, err = tx.Exec(`DELETE FROM runs_unjudged`)
		return err
	})
	return marked, err
}

// FairAnswers is a SQL condition on an answer (its run_id) that leaves out the answers of shadow runs: what a
// question's statistics count is how people answer it, each once at a day's questions.
const FairAnswers = `run_id NOT IN (SELECT id FROM runs WHERE shadow)`

// fairFor is a SQL condition on a run (its alias) that leaves it out if it's a shadow, unless it's the viewer's own (a SQL expression; 0 for nobody signed in): a board as the viewer sees it.
func fairFor(run, viewer string) string {
	return `(NOT ` + run + `.shadow OR ` + run + `.user_id = ` + viewer + `)`
}
