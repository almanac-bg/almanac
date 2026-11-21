package play

import (
	"context"
	"database/sql"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Fair play: a game played quicker than a person plays (a script's, or a cheat's) counts for its player alone.
//
// The rule has one home, scriptPaced: more than MostQuick of a game's answers came under their question's Floor. A
// person who knew one or two at once is still a person; three in one game is a pattern. Questions not answered (given
// up, timed out) don't count. A run is judged as its answers come in (record calls judgeAnswer): only a quick answer
// can make it a script's, and once it is, it stays one, however the run ends (by its last answer, by its time, or
// left half-way).
//
// A marked run is a shadow (runs.shadow, ShadowScript): its player sees it as any other game, with its score, and
// their place among the others as if it were in, and nothing tells them otherwise; for everyone else it isn't there.
// One other run is a shadow, for another reason (ShadowGuest): a day's run a guest played and brought to an account
// that was there already, signing in (merge.go). Whoever played the day as several guests could otherwise sign in
// from the best of them, and the day's one game would be the best of many. It's left out of:
//   - the day's board, its count of players and its places, and friends' results of the day (BoardOf, FriendsBoard,
//     FriendsOf; fairFor);
//   - the questions' statistics: how players answered each (crowd.go), how hard each is (hardness, Calibrate) and
//     /admin's counts of answers (FairAnswers);
//   - the recordings a duel is played against (recordedRun).
//
// What it isn't left out of: the player's own numbers (their profile, Алманах, streak), which are
// theirs; and a duel, which is between two who know each other (or the player's alone, against a recording).

// Why a run is a shadow (runs.shadow; 0: it isn't one).
const (
	// ShadowScript is a run played at a script's speed (scriptPaced).
	ShadowScript = 1
	// ShadowGuest is a day's run a guest brought to an account that was there when it was played (merge.go).
	ShadowGuest = 2
)

// People is a SQL condition on a run (its columns, unaliased) that /admin counts it as a player's game: one population
// on the whole page, the same that its days played are (retention.go, personDays). Not one at a script's speed
// (ShadowScript), nor an admin's (whoever keeps the game, trying it). A guest's day brought to an account
// (ShadowGuest) was a person's, and counts, once: only one game of a day is ever an account's.
const People = personRun + ` AND user_id NOT IN (SELECT id FROM users WHERE admin)`

// personRun is People without the admins: the shadow that isn't a person's game (1: ShadowScript; TestPeopleShadows
// holds the number).
const personRun = `shadow <> 1`

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

// floorMost is the highest Floor of any kind.
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
	if r.shadow != 0 || gr.Given == nil {
		return nil
	}
	b := g.Bank()
	if q, ok := b.Get(r.picks[r.at].ID); !ok || time.Duration(ms)*time.Millisecond >= Floor(q) {
		return nil
	}
	is, err := judge(context.Background(), tx, b, r.id, r.picks, g.Now())
	if is {
		r.shadow = ShadowScript
	}
	return err
}

// judge marks a run if its answers so far were a script's (scriptPaced), and says whether they were. What its answers
// wrote in its player's book goes (ink.go: a script's game writes nothing).
func judge(ctx context.Context, tx *sql.Tx, b *bank.Bank, runID int64, picks []Pick, now time.Time) (bool, error) {
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
	var user int64
	if err := tx.QueryRow(`UPDATE runs SET shadow = ? WHERE id = ? RETURNING user_id`, ShadowScript, runID).
		Scan(&user); err != nil {
		return false, err
	}
	return true, rewriteBook(ctx, tx, b, user, now)
}

// FairAnswers is a SQL condition on an answer (its run_id) that leaves out the answers of shadow runs: what a
// question's statistics count is how people answer it, each once at a day's questions.
const FairAnswers = `run_id NOT IN (SELECT id FROM runs WHERE shadow OR pencil)`

// fairFor is a SQL condition on a run (its alias) that leaves it out if others don't see it (othersSee: a shadow, a
// second play), unless it's the viewer's own (a SQL expression; 0 for nobody signed in): a board as the viewer sees it.
func fairFor(run, viewer string) string {
	return `(` + othersSee(run) + ` OR ` + run + `.user_id = ` + viewer + `)`
}
