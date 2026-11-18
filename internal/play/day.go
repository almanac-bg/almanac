package play

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The day's ten are one game for everyone who plays them that day, compared on one board and in one week's league:
// so they hold still for their day. As the day begins (the first time its questions are read on it, pinDay), each of
// them is kept as it is then, its version and its difficulty (Pick.V, Pick.D), in the day's own questions, which
// every run of the day copies: a reload of the bank later that day changes nothing of how they're dealt, graded or
// paid, for anyone.
//
// But a question can turn out wrong in the middle of its day (a player reports it, and its keeper retires it as untrue
// or puts its answer right), and then the day's players, those before the fix and those after it, can't all be graded
// on one key: those before got the wrong one. So such a question counts for nobody that day (void): one of the day
// that left play as untrue (bank.Tail.Untrue), left the bank, or changed in what it asks (another version) since the
// day began. Every run of the day, whenever it was played, plays the day as if it had nine (voidDay):
//
//   - who hasn't reached it passes over it, and never sees it;
//   - who is on it now goes on to the next;
//   - who answered it keeps the answer (its history, what it taught them, the XP it earned), but not its points: the
//     run's points are counted again without them, the row of right answers going over it as if it weren't there
//     (it neither adds to a row nor breaks one), and the run's right answers, and whether it got all of them, are out
//     of the questions that count.
//
// So the day's results stay comparable: everyone's is of the same questions, the same way. Voiding rather than
// regrading those who answered against the new key: the old answer was given to another question (its options, its
// order, its wording), and regraded it would say what the player never chose. A change to a day's question that isn't
// a fix (a typo) voids it all the same: the program can't tell a fix from a polish, and a day one question short
// is a far smaller harm than a day graded on two keys. A question is voided on its day only, as the day is kept up
// with each bank (EnsureDays); the days ahead are drawn again instead (ahead.go). More than maxVoid of a day at once
// is not a fix but a mistake (a version that moved for every question, say): then none is voided, and the log says
// so.

// maxVoid is the most of a day's questions that a bank may void at once; more, and it's taken as a mistake.
const maxVoid = Length / 2

// pinDay keeps a day's questions as they are now, on the day itself (today): the version and the difficulty of each
// that has none yet (those drawn ahead, or a day drawn this moment), in the day's questions, for every run of the day
// to copy. A question gone from the bank keeps none, and is void (voidDay).
func (g *Game) pinDay(tx *sql.Tx, day string, picks []Pick, b *bank.Bank) ([]Pick, error) {
	if day != g.Today() {
		return picks, nil
	}
	pinned := false
	for i, p := range picks {
		if p.V != "" {
			continue
		}
		if q, ok := b.Get(p.ID); ok {
			picks[i].V, picks[i].D = bank.Version(q), q.Base().Difficulty
			pinned = true
		}
	}
	if !pinned {
		return picks, nil
	}
	data, _ := json.Marshal(picks)
	_, err := tx.Exec(`UPDATE days SET questions = ? WHERE day = ?`, string(data), day)
	return picks, err
}

// voidDay voids the questions of a day, kept as the day began (pinDay), that b no longer plays as they were: retired
// as untrue, gone, or of another version now. Each is voided for every run of the day (voidQuestion). Only by the bank
// in play: one that has moved on since (a reload meanwhile) may be older than what the day was kept as, and the next
// keeping of the days (EnsureDays) comes with the newer one.
func (g *Game) voidDay(tx *sql.Tx, day string, b *bank.Bank) error {
	if b != g.Bank() {
		return nil
	}
	var stored string
	if err := tx.QueryRow(`SELECT questions FROM days WHERE day = ?`, day).Scan(&stored); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	var picks []Pick
	if err := json.Unmarshal([]byte(stored), &picks); err != nil {
		return err
	}
	var void []int
	already := 0
	for n, p := range picks {
		if p.Void {
			already++
			continue
		}
		q, ok := b.Get(p.ID)
		if !ok || q.Extra().Untrue() || p.V != "" && bank.Version(q) != p.V {
			void = append(void, n)
		}
	}
	if len(void) == 0 {
		return nil
	}
	if already+len(void) > maxVoid {
		slog.Error("the bank would void more of the day's questions than a fix does: none voided", "day", day,
			"void", already, "more", len(void))
		return nil
	}
	for _, n := range void {
		slog.Warn("a question of the day voided: it counts for nobody today", "day", day, "n", n+1,
			"question", picks[n].ID)
		if err := g.voidQuestion(tx, day, n); err != nil {
			return err
		}
	}
	return nil
}

// voidQuestion makes question n of a day count for nobody: the day's questions and every run's say so, a run on it goes
// on past it, and a run that answered it is counted again without it (recount).
func (g *Game) voidQuestion(tx *sql.Tx, day string, n int) error {
	path := "$[" + strconv.Itoa(n) + "].void"
	if _, err := tx.Exec(`UPDATE days SET questions = json_set(questions, ?, json('true')) WHERE day = ?`, path, day); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE runs SET questions = json_set(questions, ?, json('true')) WHERE kind = 'day' AND day = ?`,
		path, day); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT `+runColumns+` FROM runs WHERE kind = 'day' AND day = ?`, day)
	if err != nil {
		return err
	}
	var runs []*run
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			rows.Close()
			return err
		}
		runs = append(runs, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, r := range runs {
		if n >= len(r.picks) {
			continue
		}
		switch {
		case r.at > n:
			err = g.recount(tx, r)
		case r.at == n && !r.finished:
			err = g.passVoid(tx, r)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// recount counts a run's points and right answers again from its answers, without those to questions that count for
// nobody: the answers after the first of those earn again as the row they make now (the same score, time and
// difficulty: Pick.D), and a run done earns AllRight if every answer that counts was right.
func (g *Game) recount(tx *sql.Tx, r *run) error {
	type answer struct {
		n      int
		score  float64
		ms     int64
		right  bool
		points int
	}
	rows, err := tx.Query(`SELECT n, score, ms, is_right, points FROM answers WHERE run_id = ? ORDER BY n`, r.id)
	if err != nil {
		return err
	}
	var all []answer
	for rows.Next() {
		var a answer
		if err := rows.Scan(&a.n, &a.score, &a.ms, &a.right, &a.points); err != nil {
			rows.Close()
			return err
		}
		all = append(all, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	points, rights, inRow, after := 0, 0, 0, false
	for _, a := range all {
		was := a.points
		switch {
		case a.n >= len(r.picks):
		case r.picks[a.n].Void:
			a.points, after = 0, true
		default:
			if a.right {
				inRow++
				rights++
			} else {
				inRow = 0
			}
			if q, ok := g.question(r.picks[a.n]); ok && after {
				row := 0
				if a.right {
					row = inRow
				}
				a.points = r.picks[a.n].worth(q, a.score, time.Duration(a.ms)*time.Millisecond, row).Points
			}
		}
		if a.points != was {
			if _, err := tx.Exec(`UPDATE answers SET points = ? WHERE run_id = ? AND n = ?`, a.points, r.id, a.n); err != nil {
				return err
			}
		}
		points += a.points
	}
	r.points, r.rights = points, rights
	if r.finished && r.allRight() {
		r.points += AllRight
	}
	_, err = tx.Exec(`UPDATE runs SET points = ?, rights = ? WHERE id = ?`, r.points, r.rights, r.id)
	return err
}

// counted is how many of a run's questions count: all but those void.
func (r *run) counted() int {
	n := 0
	for _, p := range r.picks {
		if !p.Void {
			n++
		}
	}
	return n
}

// voidNow is whether the question a run stands at counts for nobody.
func (r *run) voidNow() bool { return !r.finished && r.at < len(r.picks) && r.picks[r.at].Void }

// skipVoid moves a run on past the questions where it stands that count for nobody.
func (r *run) skipVoid() {
	for r.at < len(r.picks) && r.picks[r.at].Void {
		r.at++
	}
}

// passVoid moves a run that stands at a question that counts for nobody on to the next that counts, or to its end:
// nothing is answered, nothing shown.
func (g *Game) passVoid(tx *sql.Tx, r *run) error {
	r.skipVoid()
	r.shownAt = sql.NullInt64{}
	if r.at >= len(r.picks) {
		return g.finish(tx, r)
	}
	_, err := tx.Exec(`UPDATE runs SET at = ?, shown_at = NULL WHERE id = ?`, r.at, r.id)
	return err
}

// markAt is an answer's mark, by the question it answered.
type markAt struct {
	n int
	m Mark
}

// trailOf is a run's trail from its answers' marks (in order): each answer's, and, in its place, a question that
// counts for nobody, answered or passed over before at.
func trailOf(picks []Pick, at int, marks []markAt) []Mark {
	out := []Mark{}
	next := 0 // the first question not in the trail yet
	voids := func(upto int) {
		for ; next < upto && next < len(picks); next++ {
			if picks[next].Void {
				out = append(out, Mark{Void: true})
			}
		}
	}
	for _, a := range marks {
		voids(a.n)
		m := a.m
		if a.n < len(picks) && picks[a.n].Void {
			m = Mark{Void: true}
		}
		m.Partial = m.Points > 0 && !m.Right
		out = append(out, m)
		next = a.n + 1
	}
	voids(at)
	return out
}
