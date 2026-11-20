package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"maps"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Fair play: a game played quicker than a person plays (a script's, or a cheat's) counts for its player alone.
//
// The rule has one home, scriptPaced: more than MostQuick of a game's answers came under their question's Floor. A
// person who knew one or two at once is still a person; three in one game is a pattern. Questions not answered (given
// up, timed out) don't count. A run is judged as its answers come in (record calls judgeAnswer): only a quick answer
// can make it a script's, and once it is, it stays one, however the run ends (by its last answer, by its time, or
// left half-way). The runs played before the mark were judged once, as the server started (JudgeRuns).
//
// A marked run is a shadow (runs.shadow, ShadowScript): its player sees it as any other game, with its score, and
// their place among the others as if it were in, and nothing tells them otherwise; for everyone else it isn't there.
// One other run is a shadow, for another reason (ShadowGuest): a day's run a guest played and brought to an account
// that was there already, signing in (merge.go). Whoever played the day as several guests could otherwise sign in
// from the best of them, and the day's one game would be the best of many. It's left out of:
//   - the day's board, its count of players and its places, and friends' results of the day (BoardOf, FriendsBoard,
//     FriendsOf; fairFor);
//   - the questions' statistics: how players answered each (crowd.go), how hard each is (hardness, Calibrate) and
//     /admin's tallies (FairAnswers);
//   - the recordings a duel is played against (recordedRun).
//
// What it isn't left out of: the player's own numbers (their profile, Алманах, streak), which are
// theirs; and a duel, which is between two who know each other (or the player's alone, against a recording).
//
// A third reason (ShadowThrowaway) is the day played as throwaway guests to read its answers, or to try it several
// times, before the player plays it as themselves. Each game is kept with the network it was started from (FromNet,
// run_nets: a keyed hash, never the address; let go after NetsKept). JudgeNets, every few minutes, looks at today's
// and yesterday's days: where, from one network, ThrowawayFew to ThrowawayMost throwaway guests (no email, made that
// day, the day their only game) had finished the day before a player who isn't one (an account, or a guest from before
// that day) started theirs, those guests' days are shadows, and the player's day is a signal for /admin
// (fair_signals), never a shadow by itself: a strong player is quick and right too, and only a person can tell. It
// can't wrong a family or a class: a guest who comes back (plays anything again, or adds an email) is a player, and
// their day is let out of the shadow; a guest who never does sees nothing; more than ThrowawayMost guests are a group
// playing together (a class, a carrier's shared address), and are left alone; and the player's own day is never
// touched. A guest's day brought into the account by signing in is a shadow already (ShadowGuest).

// Why a run is a shadow (runs.shadow; 0: it isn't one).
const (
	// ShadowScript is a run played at a script's speed (scriptPaced).
	ShadowScript = 1
	// ShadowGuest is a day's run a guest brought to an account that was there when it was played (merge.go).
	ShadowGuest = 2
	// ShadowThrowaway is a throwaway guest's day, played from a network before a player's own day there (JudgeNets).
	ShadowThrowaway = 3
)

// People is a SQL condition on a run (its columns, unaliased) that /admin counts it as a player's game: one population
// on the whole page, the same that its days played are (retention.go, personDays). Not one at a script's speed
// (ShadowScript), nor an admin's (whoever keeps the game, trying it). A throwaway guest's day (ShadowThrowaway) is a
// person's, and counts: it's a shadow only for the others' boards and the questions' numbers. Left out of /admin, it
// would come in only when its guest came back (JudgeNets lets them out), and the newcomers would seem to come back
// more than they do. A guest's day brought to an account (ShadowGuest) was a person's, and counts, once: only one game
// of a day is ever an account's.
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

// judge marks a run if its answers so far were a script's (scriptPaced), and says whether they were. What its answers
// wrote in its player's book goes (ink.go: a script's game writes nothing).
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
	var user int64
	if err := tx.QueryRow(`UPDATE runs SET shadow = ? WHERE id = ? RETURNING user_id`, ShadowScript, runID).
		Scan(&user); err != nil {
		return false, err
	}
	return true, rewriteFacts(tx, user)
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

const (
	// NetsKept is how long a game's network is kept: three days, over the two days JudgeNets looks at (a game of
	// yesterday's begun at its start is judged up to 48 hours later), and no longer.
	NetsKept = 3 * 24 * time.Hour
	// ThrowawayFew is how many throwaway guests' days from one network, before a player's own, make the pattern: one
	// is a friend who tried the game on the player's wifi; two in a day before the player plays is a habit.
	ThrowawayFew = 2
	// ThrowawayMost is the most there may be: more are a group playing together on one network (a class, a club, a
	// carrier's shared address), not one person's windows.
	ThrowawayMost = 8
	// signalsKept is how long /admin is shown a signal.
	signalsKept = 30 * 24 * time.Hour
)

// netsKey keeps in a context the networks its players play from (FromNet), by player.
type netsKey struct{}

// FromNet is ctx with the network a player plays from (a keyed hash of it: server/address.go, netMark): a game
// started for them in it keeps it (run_nets). Nothing for an empty net (one that can't be told: a test's, the
// machine's own).
func FromNet(ctx context.Context, userID int64, net []byte) context.Context {
	if len(net) == 0 {
		return ctx
	}
	was, _ := ctx.Value(netsKey{}).(map[int64][]byte)
	nets := make(map[int64][]byte, len(was)+1)
	maps.Copy(nets, was)
	nets[userID] = net
	return context.WithValue(ctx, netsKey{}, nets)
}

// netOf is the network a player plays from in ctx (FromNet), or nil.
func netOf(ctx context.Context, userID int64) []byte {
	nets, _ := ctx.Value(netsKey{}).(map[int64][]byte)
	return nets[userID]
}

// keepNet keeps the network a game was started from, if ctx has its player's (FromNet).
func (g *Game) keepNet(ctx context.Context, tx *sql.Tx, userID, runID int64) error {
	net := netOf(ctx, userID)
	if net == nil {
		return nil
	}
	_, err := tx.Exec(`INSERT OR IGNORE INTO run_nets (run_id, net, at) VALUES (?, ?, ?)`, runID, net, store.Ms(g.Now()))
	return err
}

// JudgeNets lets go of the networks kept past NetsKept (and the late answers past LateKept: late.go), lets a guest who came back out of the shadow, and judges
// today's and yesterday's days by their networks (see above): the throwaway guests' days before a player's own become
// shadows, and the player's day a signal for /admin. It says how many signals are new.
func (g *Game) JudgeNets(ctx context.Context) (int, error) {
	now := g.Now()
	signals := 0
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		signals = 0
		if _, err := tx.Exec(`DELETE FROM run_nets WHERE at < ?`, store.Ms(now.Add(-NetsKept))); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM fair_signals WHERE at < ?`, store.Ms(now.Add(-signalsKept))); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM late_answers WHERE at < ?`, store.Ms(now.Add(-LateKept))); err != nil {
			return err
		}
		// A guest who played again, or kept their game with an email, is a player, not a window thrown away.
		if _, err := tx.Exec(`UPDATE runs SET shadow = 0 WHERE shadow AND shadow = ?1
			AND (EXISTS (SELECT 1 FROM runs o WHERE o.user_id = runs.user_id AND o.id <> runs.id)
				OR (SELECT email FROM users WHERE id = runs.user_id) IS NOT NULL)`, ShadowThrowaway); err != nil {
			return err
		}
		today := now.In(Bulgaria)
		for _, d := range []time.Time{today.AddDate(0, 0, -1), today} {
			began := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, Bulgaria)
			n, err := judgeNetsOf(tx, began.Format(time.DateOnly), store.Ms(began), store.Ms(now))
			if err != nil {
				return err
			}
			signals += n
		}
		return nil
	})
	return signals, err
}

// judgeNetsOf judges a day's networks (JudgeNets), given when the day began and the time now. It says how many
// signals are new.
func judgeNetsOf(tx *sql.Tx, day string, began, now int64) (int, error) {
	// The day's games from the networks with more than ThrowawayFew of them: the only ones it could be.
	rows, err := tx.Query(`WITH played AS (
			SELECT r.id, r.user_id, r.started_at, r.finished_at, r.rights, n.net FROM runs r
			JOIN run_nets n ON n.run_id = r.id WHERE r.kind = 'day' AND r.day = ?1 AND r.finished_at IS NOT NULL),
		many AS (SELECT net FROM played GROUP BY net HAVING count(*) > ?2)
		SELECT p.id, p.started_at, p.finished_at, p.rights, p.net,
			u.email IS NULL AND u.created_at >= ?3
				AND NOT EXISTS (SELECT 1 FROM runs o WHERE o.user_id = p.user_id AND o.id <> p.id),
			u.email IS NOT NULL OR u.created_at < ?3
		FROM played p JOIN users u ON u.id = p.user_id WHERE p.net IN (SELECT net FROM many)`, day, ThrowawayFew, began)
	if err != nil {
		return 0, err
	}
	type game struct {
		id, started, finished int64
		rights                int
		throwaway, player     bool
	}
	byNet := map[string][]game{}
	for rows.Next() {
		var gm game
		var net []byte
		if err := rows.Scan(&gm.id, &gm.started, &gm.finished, &gm.rights, &net, &gm.throwaway, &gm.player); err != nil {
			rows.Close()
			return 0, err
		}
		byNet[string(net)] = append(byNet[string(net)], gm)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	signals := 0
	for _, games := range byNet {
		var guests []game
		for _, gm := range games {
			if gm.throwaway {
				guests = append(guests, gm)
			}
		}
		if len(guests) < ThrowawayFew || len(guests) > ThrowawayMost {
			continue
		}
		for _, p := range games {
			if !p.player {
				continue
			}
			var before []game
			best := 0
			for _, gm := range guests {
				if gm.finished <= p.started {
					before = append(before, gm)
					best = max(best, gm.rights)
				}
			}
			if len(before) < ThrowawayFew {
				continue
			}
			for _, gm := range before {
				if _, err := tx.Exec(`UPDATE runs SET shadow = ? WHERE id = ? AND shadow = 0`, ShadowThrowaway, gm.id); err != nil {
					return 0, err
				}
			}
			res, err := tx.Exec(`INSERT OR IGNORE INTO fair_signals (run_id, day, guests, best, at) VALUES (?, ?, ?, ?, ?)`,
				p.id, day, len(before), best, now)
			if err != nil {
				return 0, err
			}
			if n, _ := res.RowsAffected(); n > 0 {
				signals++
				continue
			}
			if _, err := tx.Exec(`UPDATE fair_signals SET guests = ?1, best = ?2 WHERE run_id = ?3 AND guests < ?1`,
				len(before), best, p.id); err != nil {
				return 0, err
			}
		}
	}
	return signals, nil
}

// FairSignal is a player's day played after several throwaway guests from the same network (JudgeNets), as /admin
// shows it.
type FairSignal struct {
	Day       string
	Name, Tag string
	Rights    int
	Guests    int
	Best      int
	// Shadow is the player's day a shadow already (brought from a guest, or played at a script's speed).
	Shadow bool
}

// FairSignals are the latest n signals, the newest first.
func (g *Game) FairSignals(ctx context.Context, n int) ([]FairSignal, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT s.day, u.name, u.tag, r.rights, s.guests, s.best, r.shadow <> 0
		FROM fair_signals s JOIN runs r ON r.id = s.run_id JOIN users u ON u.id = r.user_id
		ORDER BY s.at DESC LIMIT ?`, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FairSignal
	for rows.Next() {
		var f FairSignal
		if err := rows.Scan(&f.Day, &f.Name, &f.Tag, &f.Rights, &f.Guests, &f.Best, &f.Shadow); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
