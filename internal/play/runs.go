package play

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"math/big"
	mrand "math/rand/v2"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// day reads a day's questions, drawing them the first time the day is asked for.
func (g *Game) day(tx *sql.Tx, day string) ([]Pick, error) {
	var stored string
	err := tx.QueryRow(`SELECT questions FROM days WHERE day = ?`, day).Scan(&stored)
	if err == nil {
		var picks []Pick
		return picks, json.Unmarshal([]byte(stored), &picks)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	used := map[string]bool{}
	rows, err := tx.Query(`SELECT questions FROM days`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s string
		var picks []Pick
		if err := rows.Scan(&s); err != nil || json.Unmarshal([]byte(s), &picks) != nil {
			rows.Close()
			return nil, errors.Join(err, errors.New("a stored day can't be read"))
		}
		for _, p := range picks {
			used[p.ID] = true
		}
	}
	rows.Close()
	picks := drawDay(g.Bank(), used, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
	if len(picks) == 0 {
		return nil, ErrNoQuestion
	}
	data, _ := json.Marshal(picks)
	_, err = tx.Exec(`INSERT INTO days (day, questions) VALUES (?, ?)`, day, string(data))
	return picks, err
}

func (g *Game) insertRun(tx *sql.Tx, userID int64, kind string, day, category, code any, picks []Pick) (*run, error) {
	data, _ := json.Marshal(picks)
	res, err := tx.Exec(`INSERT INTO runs (user_id, kind, day, category, challenge, questions, started_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, userID, kind, day, category, code, string(data), store.Ms(g.Now()))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return load(tx, userID, id)
}

// StartDay is the player's run of today's questions: the one they have, or a new one. One a day.
func (g *Game) StartDay(ctx context.Context, userID int64) (State, error) {
	var s State
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		today := g.Today()
		r, err := scanRun(tx.QueryRow(`SELECT `+runColumns+` FROM runs WHERE user_id = ? AND kind = 'day' AND day = ?`, userID, today))
		if errors.Is(err, ErrNoRun) {
			picks, derr := g.day(tx, today)
			if derr != nil {
				return derr
			}
			r, err = g.insertRun(tx, userID, "day", today, nil, nil, picks)
		}
		if err != nil {
			return err
		}
		if _, err := g.settle(tx, r); err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, err
}

// skillWindow is how many of a player's latest answers in a topic tell how well they know it.
const skillWindow = 40

// StartTopic starts a run of a topic ("" for all of them), shaped by how well the player knows it.
func (g *Game) StartTopic(ctx context.Context, userID int64, category string) (State, error) {
	b := g.Bank()
	if category != "" && !slices.ContainsFunc(b.Categories, func(c bank.Category) bool { return c.ID == category }) {
		return State{}, ErrNoTopic
	}
	var s State
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		seen := map[string]bool{}
		rows, err := tx.Query(`SELECT a.question_id FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?`, userID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			seen[id] = true
		}
		rows.Close()
		skill, err := g.skill(tx, userID, category)
		if err != nil {
			return err
		}
		picks := Draw(b, category, skill, seen, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
		if len(picks) == 0 {
			return ErrNoQuestion
		}
		r, err := g.insertRun(tx, userID, "topic", nil, category, nil, picks)
		if err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, err
}

// skill is how often a player has been right lately in a topic (all topics for ""); a middling 0.6 before they've
// played it.
func (g *Game) skill(tx *sql.Tx, userID int64, category string) (float64, error) {
	rows, err := tx.Query(`SELECT a.question_id, a.score FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ? ORDER BY a.at DESC LIMIT 1000`, userID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	b := g.Bank()
	total, n := 0.0, 0
	for rows.Next() && n < skillWindow {
		var id string
		var score float64
		if err := rows.Scan(&id, &score); err != nil {
			return 0, err
		}
		if q, ok := b.Get(id); ok && (category == "" || q.Base().Category == category) {
			total += score
			n++
		}
	}
	if n < 5 {
		return 0.6, rows.Err()
	}
	return total / float64(n), rows.Err()
}

// Challenge makes (or finds) the link to a finished run's questions, for anyone to play.
func (g *Game) Challenge(ctx context.Context, userID, runID int64) (string, error) {
	var code string
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		r, err := load(tx, userID, runID)
		if err != nil {
			return err
		}
		if !r.finished {
			return ErrOutOfStep
		}
		if r.kind == "challenge" { // a challenge's run passes the same challenge on
			code = r.code
			return nil
		}
		err = tx.QueryRow(`SELECT code FROM challenges WHERE run_id = ?`, r.id).Scan(&code)
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		for range 10 {
			code = newCode()
			res, err := tx.Exec(`INSERT INTO challenges (code, run_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
				code, r.id, store.Ms(g.Now()))
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 1 {
				return nil
			}
		}
		return errors.New("no free challenge code")
	})
	return code, err
}

// codeLetters are a challenge code's: no 0/O or 1/I/L to mix up when read out.
const codeLetters = "23456789abcdefghjkmnpqrstuvwxyz"

func newCode() string {
	b := make([]byte, 6)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(codeLetters))))
		b[i] = codeLetters[n.Int64()]
	}
	return string(b)
}

// ChallengeInfo is a challenge as anyone sees it: whose it is, what they scored, and everyone who played it.
type ChallengeInfo struct {
	Code    string  `json:"code"`
	By      string  `json:"by"`
	Total   int     `json:"total"`
	Players []Score `json:"players"`
	// Mine is the viewer's own run of it, if they have one.
	Mine int64 `json:"mine,omitempty"`
}

// Score is one player's finished run, on a board.
type Score struct {
	Name   string `json:"name"`
	Points int    `json:"points"`
	Rights int    `json:"rights"`
	Ms     int64  `json:"ms"`
	Me     bool   `json:"me,omitempty"`
}

// ChallengeOf reads a challenge for a viewer (0: nobody signed in).
func (g *Game) ChallengeOf(ctx context.Context, code string, viewer int64) (ChallengeInfo, error) {
	c := ChallengeInfo{Code: code}
	var source int64
	var picks string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT c.run_id, u.name, r.questions FROM challenges c
		JOIN runs r ON r.id = c.run_id JOIN users u ON u.id = r.user_id WHERE c.code = ?`, code).Scan(&source, &c.By, &picks)
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrNoRun
	}
	if err != nil {
		return c, err
	}
	var p []Pick
	_ = json.Unmarshal([]byte(picks), &p)
	c.Total = len(p)
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT r.id, r.user_id, u.name, r.points, r.rights, r.ms, r.finished_at IS NOT NULL
		FROM runs r JOIN users u ON u.id = r.user_id WHERE r.id = ? OR r.challenge = ?
		ORDER BY r.points DESC, r.ms, r.id`, source, code)
	if err != nil {
		return c, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, user int64
		var s Score
		var done bool
		if err := rows.Scan(&id, &user, &s.Name, &s.Points, &s.Rights, &s.Ms, &done); err != nil {
			return c, err
		}
		s.Me = user == viewer
		if s.Me && id != source {
			c.Mine = id
		}
		if done {
			c.Players = append(c.Players, s)
		}
	}
	return c, rows.Err()
}

// StartChallenge is the player's run of a challenge: the one they have, or a new one. The challenge's maker plays
// it no more: theirs is the run it came from.
func (g *Game) StartChallenge(ctx context.Context, userID int64, code string) (State, error) {
	var s State
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var picks string
		var owner, source int64
		err := tx.QueryRow(`SELECT r.questions, r.user_id, r.id FROM challenges c JOIN runs r ON r.id = c.run_id
			WHERE c.code = ?`, code).Scan(&picks, &owner, &source)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNoRun
		}
		if err != nil {
			return err
		}
		var r *run
		if owner == userID {
			r, err = load(tx, userID, source)
		} else {
			r, err = scanRun(tx.QueryRow(`SELECT `+runColumns+` FROM runs WHERE user_id = ? AND challenge = ?`, userID, code))
			if errors.Is(err, ErrNoRun) {
				var p []Pick
				if err := json.Unmarshal([]byte(picks), &p); err != nil {
					return err
				}
				// The same questions, dealt the same way: options in the same places for both.
				r, err = g.insertRun(tx, userID, "challenge", nil, nil, code, p)
			}
		}
		if err != nil {
			return err
		}
		if _, err := g.settle(tx, r); err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, err
}

// Board is a day's results: the best, and the viewer's place among everyone.
type Board struct {
	Day     string  `json:"day"`
	Players int     `json:"players"`
	Top     []Score `json:"top"`
	// Place is the viewer's (1 for the best), 0 if they haven't finished the day.
	Place int    `json:"place,omitempty"`
	Mine  *Score `json:"mine,omitempty"`
}

// BoardOf reads a day's board for a viewer (0: nobody signed in).
func (g *Game) BoardOf(ctx context.Context, day string, viewer int64) (Board, error) {
	b := Board{Day: day, Top: []Score{}}
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FROM runs WHERE kind = 'day' AND day = ? AND finished_at IS NOT NULL`, day).
		Scan(&b.Players)
	if err != nil {
		return b, err
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.id, u.name, r.points, r.rights, r.ms FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind = 'day' AND r.day = ? AND r.finished_at IS NOT NULL ORDER BY r.points DESC, r.ms, r.id LIMIT 20`, day)
	if err != nil {
		return b, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var s Score
		if err := rows.Scan(&id, &s.Name, &s.Points, &s.Rights, &s.Ms); err != nil {
			return b, err
		}
		s.Me = id == viewer
		b.Top = append(b.Top, s)
	}
	if err := rows.Err(); err != nil || viewer == 0 {
		return b, err
	}
	var mine Score
	var runID int64
	err = g.DB.Read.QueryRowContext(ctx, `SELECT r.id, u.name, r.points, r.rights, r.ms FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind = 'day' AND r.day = ? AND r.user_id = ? AND r.finished_at IS NOT NULL`, day, viewer).
		Scan(&runID, &mine.Name, &mine.Points, &mine.Rights, &mine.Ms)
	if errors.Is(err, sql.ErrNoRows) {
		return b, nil
	}
	if err != nil {
		return b, err
	}
	mine.Me = true
	b.Mine = &mine
	err = g.DB.Read.QueryRowContext(ctx, `SELECT 1 + count(*) FROM runs WHERE kind = 'day' AND day = ? AND finished_at IS NOT NULL
		AND (points > ? OR (points = ? AND (ms < ? OR (ms = ? AND id < ?))))`,
		day, mine.Points, mine.Points, mine.Ms, mine.Ms, runID).Scan(&b.Place)
	return b, err
}

// Streak is how many days in a row, up to today or yesterday, a player has finished the day's questions.
func (g *Game) Streak(ctx context.Context, userID int64) (int, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT day FROM runs WHERE user_id = ? AND kind = 'day'
		AND finished_at IS NOT NULL ORDER BY day DESC LIMIT 3660`, userID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	expect, _ := time.Parse(time.DateOnly, g.Today())
	streak := 0
	for rows.Next() {
		var day string
		if err := rows.Scan(&day); err != nil {
			return 0, err
		}
		d, _ := time.Parse(time.DateOnly, day)
		if streak == 0 && d.Equal(expect.AddDate(0, 0, -1)) {
			expect = d // today not played yet: the streak runs to yesterday
		}
		if !d.Equal(expect) {
			break
		}
		streak++
		expect = expect.AddDate(0, 0, -1)
	}
	return streak, rows.Err()
}

// Week is which days of this week, Monday first, a player has finished the day's questions on: the streak's strip.
func (g *Game) Week(ctx context.Context, userID int64) ([7]bool, error) {
	var week [7]bool
	today, _ := time.Parse(time.DateOnly, g.Today())
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT day FROM runs WHERE user_id = ? AND kind = 'day'
		AND finished_at IS NOT NULL AND day >= ? AND day <= ?`, userID, monday.Format(time.DateOnly), today.Format(time.DateOnly))
	if err != nil {
		return week, err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		if err := rows.Scan(&day); err != nil {
			return week, err
		}
		d, _ := time.Parse(time.DateOnly, day)
		if i := int(d.Sub(monday) / (24 * time.Hour)); i >= 0 && i < len(week) {
			week[i] = true
		}
	}
	return week, rows.Err()
}

// Merge moves a guest's runs and friends to the account they signed in to (account.Accounts.Merge): all runs but a
// day the account has played itself, which stays the account's.
func Merge(tx *sql.Tx, from, to int64) error {
	_, err := tx.Exec(`UPDATE runs SET user_id = ? WHERE user_id = ?
		AND NOT (kind = 'day' AND day IN (SELECT day FROM runs WHERE user_id = ? AND kind = 'day'))
		AND NOT (kind = 'challenge' AND challenge IN (SELECT challenge FROM runs WHERE user_id = ? AND challenge IS NOT NULL))`,
		to, from, to, to)
	if err != nil {
		return err
	}
	// The guest's friends become the account's (the two aren't friends with themselves), and duels against the guest
	// count against the account.
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT OR IGNORE INTO friends (user_id, friend_id, since)
			SELECT ?, friend_id, since FROM friends WHERE user_id = ? AND friend_id <> ?`, []any{to, from, to}},
		{`INSERT OR IGNORE INTO friends (user_id, friend_id, since)
			SELECT user_id, ?, since FROM friends WHERE friend_id = ? AND user_id <> ?`, []any{to, from, to}},
		{`DELETE FROM friends WHERE user_id = ? OR friend_id = ?`, []any{from, from}},
		{`UPDATE runs SET opponent_id = ? WHERE opponent_id = ?`, []any{to, from}},
	} {
		if _, err := tx.Exec(q.sql, q.args...); err != nil {
			return err
		}
	}
	return nil
}
