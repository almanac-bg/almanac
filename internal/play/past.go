package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Минали броеве: any past day's ten, played after their day, once, by a player who didn't finish them on it. A past
// issue is a game of its own (kind 'past', with the issue's day): scored as a topic's game is (its points, the XP of a
// game, not the day's), and outside everything that's the day's alone: its board, the streak, the week's league, the
// day's goals. It never moves a day's board or a league, and a player can't play the day in it twice. It replaced
// „Всички теми“, the game of every topic (owner, 2026-11-18, review O9): a new system replaces one.
//
// The questions are the day's as the day kept them (pinDay), dealt the same: each player of the issue meets the same
// questions in the same order as that day's players did, so that how they went can be told against them (PastStanding:
// „По-добре от 64% от играчите на този брой“). A question that counted for nobody on its day (day.go) counts for nobody
// here; one found untrue since, or gone from the bank, counts for nobody either (it would teach what isn't so), and one
// changed since is played as it is now (the fix in it). A past issue opens once its day has settled (DaySettled): a
// player still on the day's ten after midnight can't look its answers up in the archive.
//
// The missed issue is also how a broken streak is won back (repair.go): playing the day missed, and today's.

// Errors of the past issues.
var (
	// ErrNoIssue is a day that isn't a past issue (yet): before the first, today or later, or not settled yet.
	ErrNoIssue = errors.New("no such past issue")
	// ErrIssuePlayed is a past issue its player finished on its own day: the day's game is that one.
	ErrIssuePlayed = errors.New("the issue was played on its day")
)

// PastIssue is a past issue as Минали броеве lists it: its day and number, how many played it on its day, and the
// player's own game of it, if any (that day's, or one played since).
type PastIssue struct {
	Day     string    `json:"day"`
	Issue   int       `json:"issue"`
	Players int       `json:"players"`
	Mine    *PastGame `json:"mine,omitempty"`
}

// PastGame is a player's game of an issue: of the day itself (Kind "day", finished) or of the past issue ("past",
// finished or left on question At); its right answers of how many count.
type PastGame struct {
	ID     int64  `json:"id"`
	Kind   string `json:"kind"`
	Rights int    `json:"rights"`
	Total  int    `json:"total"`
	At     int    `json:"at"`
	Done   bool   `json:"done"`
}

// pastOpen says whether a day is a past issue open to play now: an issue, before today, its day settled.
func (g *Game) pastOpen(day string) bool {
	if _, err := time.Parse(time.DateOnly, day); err != nil || Issue(day) == 0 || day >= g.Today() {
		return false
	}
	return g.DaySettled(day)
}

// PastIssues are the past issues open to play, the newest first, each with how the player went in it.
func (g *Game) PastIssues(ctx context.Context, userID int64) ([]PastIssue, error) {
	today := g.Today()
	db := g.DB.Read
	rows, err := db.QueryContext(ctx, `SELECT d.day, (SELECT count(*) FROM runs r WHERE r.kind = 'day' AND r.day = d.day
			AND r.finished_at IS NOT NULL AND NOT r.shadow)
		FROM days d WHERE d.day >= ? AND d.day < ? ORDER BY d.day DESC`, FirstIssue, today)
	if err != nil {
		return nil, err
	}
	out := []PastIssue{}
	at := map[string]int{}
	for rows.Next() {
		var p PastIssue
		if err := rows.Scan(&p.Day, &p.Players); err != nil {
			rows.Close()
			return nil, err
		}
		if !g.pastOpen(p.Day) {
			continue
		}
		p.Issue = Issue(p.Day)
		at[p.Day] = len(out)
		out = append(out, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	mine, err := g.pastGames(ctx, userID)
	if err != nil {
		return nil, err
	}
	for day, m := range mine {
		if i, ok := at[day]; ok {
			out[i].Mine = m
		}
	}
	return out, nil
}

// pastGames are a player's games of the issues by their day: the day's own, finished, or else a past issue's.
func (g *Game) pastGames(ctx context.Context, userID int64) (map[string]*PastGame, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT `+runColumns+` FROM runs WHERE user_id = ?
		AND (kind = 'day' AND finished_at IS NOT NULL OR kind = 'past') ORDER BY kind = 'day'`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]*PastGame{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out[r.day] = r.pastGame() // the day's own last: it's the one
	}
	return out, rows.Err()
}

func (r *run) pastGame() *PastGame {
	return &PastGame{ID: r.id, Kind: r.kind, Rights: r.rights, Total: r.counted(), At: r.at, Done: r.finished}
}

// PastIssueOf is one past issue as PastIssues has it (ErrNoIssue for a day that isn't one open to play).
func (g *Game) PastIssueOf(ctx context.Context, userID int64, day string) (PastIssue, error) {
	if !g.pastOpen(day) {
		return PastIssue{}, ErrNoIssue
	}
	p := PastIssue{Day: day, Issue: Issue(day)}
	var there bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM days WHERE day = ?1), (SELECT count(*) FROM runs
		WHERE kind = 'day' AND day = ?1 AND finished_at IS NOT NULL AND NOT shadow)`, day).Scan(&there, &p.Players)
	if err != nil {
		return p, err
	}
	if !there {
		return p, ErrNoIssue
	}
	r, err := scanRun(g.DB.Read.QueryRowContext(ctx, `SELECT `+runColumns+` FROM runs WHERE user_id = ? AND day = ?
		AND (kind = 'day' AND finished_at IS NOT NULL OR kind = 'past') ORDER BY kind = 'day' DESC LIMIT 1`, userID, day))
	switch {
	case err == nil:
		p.Mine = r.pastGame()
	case !errors.Is(err, ErrNoRun):
		return p, err
	}
	return p, nil
}

// LatestPast is the newest past issue open to play that the player hasn't finished, on its day or since (nil: none):
// where „Още десет“ goes after the day, as the game of every topic did.
func (g *Game) LatestPast(ctx context.Context, userID int64) (*PastIssue, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.day FROM days d WHERE d.day >= ? AND d.day < ?
		AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.user_id = ? AND r.day = d.day AND r.kind IN ('day', 'past')
			AND r.finished_at IS NOT NULL)
		ORDER BY d.day DESC LIMIT 2`, FirstIssue, g.Today(), userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		if err := rows.Scan(&day); err != nil {
			return nil, err
		}
		if g.pastOpen(day) { // yesterday's opens a quarter of an hour after midnight: the one before it meanwhile
			return &PastIssue{Day: day, Issue: Issue(day)}, nil
		}
	}
	return nil, rows.Err()
}

// StartPast is the player's game of a past issue: the one they have (left half-way, or finished: its result), or a
// new one. ErrNoIssue for a day that isn't one open to play, ErrIssuePlayed for one they finished on its day.
func (g *Game) StartPast(ctx context.Context, userID int64, day string) (State, error) {
	if !g.pastOpen(day) {
		return State{}, ErrNoIssue
	}
	var s State
	var runID int64
	ended := false
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var played bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM runs WHERE user_id = ? AND kind = 'day' AND day = ?
			AND finished_at IS NOT NULL)`, userID, day).Scan(&played); err != nil {
			return err
		}
		if played {
			return ErrIssuePlayed
		}
		r, err := scanRun(tx.QueryRow(`SELECT `+runColumns+` FROM runs WHERE user_id = ? AND kind = 'past' AND day = ?`,
			userID, day))
		if errors.Is(err, ErrNoRun) {
			var picks []Pick
			if picks, err = g.pastPicks(tx, day); err != nil {
				return err
			}
			r, err = g.insertRun(ctx, tx, userID, "past", day, nil, picks)
		}
		if err != nil {
			return err
		}
		runID = r.id
		if ended, err = g.settle(tx, r); err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	if err == nil && ended {
		g.finished(ctx, userID, runID)
	}
	return s, err
}

// pastPicks are a past issue's questions as a game of it plays them: the day's, dealt as they were; those that counted
// for nobody on the day, or have been found untrue or have left the bank since, void; those changed since, as they are
// now.
func (g *Game) pastPicks(tx *sql.Tx, day string) ([]Pick, error) {
	var stored string
	err := tx.QueryRow(`SELECT questions FROM days WHERE day = ?`, day).Scan(&stored)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoIssue
	}
	if err != nil {
		return nil, err
	}
	var picks []Pick
	if err := json.Unmarshal([]byte(stored), &picks); err != nil {
		return nil, err
	}
	b := g.Bank()
	counted := 0
	for i, p := range picks {
		if p.Void {
			continue
		}
		q, ok := b.Get(p.ID)
		switch {
		case !ok || q.Extra().Untrue():
			picks[i].Void = true
			continue
		case p.V != "" && bank.Version(q) != p.V:
			picks[i].V, picks[i].D = "", "" // pinned again as it shows (versions.go)
		}
		counted++
	}
	if counted == 0 {
		return nil, ErrNoQuestion
	}
	return picks, nil
}

// PastStanding is how a game of a past issue went against that day's players: how many played it then, how many
// right they had on average (from DayCrowdFrom of them), and the share of them it did better than (by right
// answers, then points, then time, as the day's board orders them), rounded down.
type PastStanding struct {
	Players int     `json:"players"`
	Average float64 `json:"average,omitempty"`
	Better  int     `json:"better"`
}

// PastStandingOf is how a player's finished game of a past issue went against that day's players.
func (g *Game) PastStandingOf(ctx context.Context, userID, runID int64) (PastStanding, error) {
	var out PastStanding
	r, err := load(g.DB.Read, userID, runID)
	if err != nil {
		return out, err
	}
	if r.kind != "past" || !r.finished {
		return out, ErrNoRun
	}
	runs, err := g.issueRuns(ctx, r)
	if err != nil {
		return out, err
	}
	out.Players = len(runs)
	if out.Players == 0 {
		return out, nil
	}
	mine := boardRun{id: -1, rights: r.rights, points: r.points, ms: r.ms}
	better, rights := 0, 0
	for _, o := range runs {
		rights += o.rights
		if mine.ahead(o) {
			better++
		}
	}
	if out.Players >= DayCrowdFrom {
		out.Average = math.Round(10*float64(rights)/float64(out.Players)) / 10
	}
	out.Better = 100 * better / out.Players
	return out, nil
}

// issueRuns are the fair games of a past issue's day, as its board has them; counted on the questions a game of it
// counts on, when some have been voided since the day (pastPicks): then without them.
func (g *Game) issueRuns(ctx context.Context, r *run) ([]boardRun, error) {
	var stored string
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT questions FROM days WHERE day = ?`, r.day).Scan(&stored); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	var dayPicks []Pick
	if err := json.Unmarshal([]byte(stored), &dayPicks); err != nil {
		return nil, err
	}
	var since []int // voided for the game of the issue, not on the day
	for n, p := range r.picks {
		if p.Void && (n >= len(dayPicks) || !dayPicks[n].Void) {
			since = append(since, n)
		}
	}
	if len(since) == 0 {
		d, err := g.dayBoard(ctx, r.day)
		if err != nil {
			return nil, err
		}
		return d.runs, nil
	}
	list, _ := json.Marshal(since)
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT r.id, r.rights - coalesce(sum(a.is_right), 0),
			r.points - coalesce(sum(a.points), 0), r.ms
		FROM runs r LEFT JOIN answers a ON a.run_id = r.id AND a.n IN (SELECT value FROM json_each(?2))
		WHERE r.kind = 'day' AND r.day = ?1 AND r.finished_at IS NOT NULL AND NOT r.shadow GROUP BY r.id`,
		r.day, string(list))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []boardRun
	for rows.Next() {
		var b boardRun
		if err := rows.Scan(&b.id, &b.rights, &b.points, &b.ms); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
