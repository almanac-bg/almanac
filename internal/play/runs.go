package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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

func (g *Game) insertRun(tx *sql.Tx, userID int64, kind string, day, category any, picks []Pick) (*run, error) {
	data, _ := json.Marshal(picks)
	res, err := tx.Exec(`INSERT INTO runs (user_id, kind, day, category, questions, started_at)
		VALUES (?, ?, ?, ?, ?, ?)`, userID, kind, day, category, string(data), store.Ms(g.Now()))
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
			r, err = g.insertRun(tx, userID, "day", today, nil, picks)
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
		ability, err := g.ability(ctx, tx, userID, category)
		if err != nil {
			return err
		}
		picks := Draw(b, category, ability, seen, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
		if len(picks) == 0 {
			return ErrNoQuestion
		}
		r, err := g.insertRun(tx, userID, "topic", nil, category, picks)
		if err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, err
}

// Score is one player's result on a board.
type Score struct {
	Name   string `json:"name"`
	Tag    string `json:"tag,omitempty"`
	Points int    `json:"points"`
	Rights int    `json:"rights"`
	Ms     int64  `json:"ms"`
	Me     bool   `json:"me,omitempty"`
	Look
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
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.id, u.name, u.tag, r.points, r.rights, r.ms, `+lookColumns+`
		FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind = 'day' AND r.day = ? AND r.finished_at IS NOT NULL ORDER BY r.points DESC, r.ms, r.id LIMIT 20`, day)
	if err != nil {
		return b, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var s Score
		var avatar, title string
		var points int
		if err := rows.Scan(&id, &s.Name, &s.Tag, &s.Points, &s.Rights, &s.Ms, &avatar, &title, &points); err != nil {
			return b, err
		}
		s.Me = id == viewer
		s.Look = g.lookOf(id, avatar, title, points)
		b.Top = append(b.Top, s)
	}
	if err := rows.Err(); err != nil || viewer == 0 {
		return b, err
	}
	var mine Score
	var runID int64
	var avatar, title string
	var points int
	err = g.DB.Read.QueryRowContext(ctx, `SELECT r.id, u.name, u.tag, r.points, r.rights, r.ms, `+lookColumns+`
		FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind = 'day' AND r.day = ? AND r.user_id = ? AND r.finished_at IS NOT NULL`, day, viewer).
		Scan(&runID, &mine.Name, &mine.Tag, &mine.Points, &mine.Rights, &mine.Ms, &avatar, &title, &points)
	mine.Look = g.lookOf(viewer, avatar, title, points)
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

// ReserveMax is how many reserve days a player can keep: a day whose three goals were all done earns one, and a day
// missed spends one, so the streak holds through it. The day's goals keep the streak, not only the day's questions.
const ReserveMax = 2

// StreakNow is a player's streak: the days in a row they've finished the day's questions (up to today, or yesterday
// while today isn't played yet), the reserve days they have, and the days a reserve kept the streak through.
type StreakNow struct {
	Days    int      `json:"days"`
	Reserve int      `json:"reserve"`
	Saved   []string `json:"saved"`
}

// StreakOf is a player's streak, from every day they've played: each day played adds to it (and, with all its goals
// done, earns a reserve day), each day missed spends a reserve day, or ends it.
func (g *Game) StreakOf(ctx context.Context, userID int64) (StreakNow, error) {
	s := StreakNow{Saved: []string{}}
	played, full := map[string]bool{}, map[string]bool{}
	first := ""
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT day, 0 FROM runs WHERE user_id = ?1 AND kind = 'day'
			AND finished_at IS NOT NULL AND day >= ?2
		UNION ALL SELECT day, 1 FROM goals_done WHERE user_id = ?1 AND day >= ?2 GROUP BY day HAVING count(*) >= ?3`,
		userID, g.Now().In(Bulgaria).AddDate(-10, 0, 0).Format(time.DateOnly), GoalsPerDay)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		var goals bool
		if err := rows.Scan(&day, &goals); err != nil {
			return s, err
		}
		if goals {
			full[day] = true
			continue
		}
		played[day] = true
		if first == "" || day < first {
			first = day
		}
	}
	if err := rows.Err(); err != nil || first == "" {
		return s, err
	}
	today := g.Today()
	d, _ := time.Parse(time.DateOnly, first)
	for day := first; day <= today; day = d.Format(time.DateOnly) {
		switch {
		case played[day]:
			s.Days++
			if full[day] {
				s.Reserve = min(ReserveMax, s.Reserve+1)
			}
		case day == today: // not played yet: the streak runs to yesterday
		case s.Days > 0 && s.Reserve > 0:
			s.Reserve--
			s.Saved = append(s.Saved, day)
		default:
			s.Days, s.Saved = 0, s.Saved[:0]
		}
		d = d.AddDate(0, 0, 1)
	}
	return s, nil
}

// Streak is how many days in a row a player has finished the day's questions, reserve days kept (StreakOf).
func (g *Game) Streak(ctx context.Context, userID int64) (int, error) {
	s, err := g.StreakOf(ctx, userID)
	return s.Days, err
}

// InWeek is which of these days (YYYY-MM-DD) are in this week, Monday first: a reserve's days on the streak's strip.
func (g *Game) InWeek(days []string) [7]bool {
	var week [7]bool
	today, _ := time.Parse(time.DateOnly, g.Today())
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	for _, day := range days {
		d, _ := time.Parse(time.DateOnly, day)
		if i := int(d.Sub(monday) / (24 * time.Hour)); i >= 0 && i < len(week) {
			week[i] = true
		}
	}
	return week
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

// Merge moves a guest's runs, friends and goals to the account they signed in to (account.Accounts.Merge): all runs but a
// day the account has played itself, which stays the account's.
func Merge(tx *sql.Tx, from, to int64) error {
	_, err := tx.Exec(`UPDATE runs SET user_id = ? WHERE user_id = ?
		AND NOT (kind = 'day' AND day IN (SELECT day FROM runs WHERE user_id = ? AND kind = 'day'))`,
		to, from, to)
	if err != nil {
		return err
	}
	// The guest's friends become the account's (the two aren't friends with themselves), duels against the guest
	// count against the account, and the guest's achievements and look come along.
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
		// The guest's arenas are the account's (unless both played the same one, which can't be: one person).
		{`UPDATE OR IGNORE arena_players SET user_id = ? WHERE user_id = ?`, []any{to, from}},
		// What the guest earned is the account's too; so is the guest's look, if the account hasn't chosen one.
		{`INSERT OR IGNORE INTO achievements (user_id, id, at, seen, xp) SELECT ?, id, at, seen, xp FROM achievements
			WHERE user_id = ?`, []any{to, from}},
		{`INSERT OR IGNORE INTO unlocks_told (user_id, id) SELECT ?, id FROM unlocks_told WHERE user_id = ?`, []any{to, from}},
		// So are the goals the guest finished (with their XP), and the day's goals drawn, unless the account has its own.
		{`INSERT OR IGNORE INTO goals_done (user_id, day, goal, at, xp, seen)
			SELECT ?, day, goal, at, xp, seen FROM goals_done WHERE user_id = ?`, []any{to, from}},
		{`INSERT OR IGNORE INTO day_goals (user_id, day, n, goal) SELECT ?, day, n, goal FROM day_goals WHERE user_id = ?`,
			[]any{to, from}},
		{`UPDATE users SET avatar = coalesce(avatar, (SELECT avatar FROM users WHERE id = ?)),
			title = coalesce(title, (SELECT title FROM users WHERE id = ?)) WHERE id = ?`, []any{from, from, to}},
		// Friend requests: the guest's become the account's (none to itself).
		{`UPDATE OR IGNORE friend_requests SET from_id = ? WHERE from_id = ? AND (to_id IS NULL OR to_id <> ?)`,
			[]any{to, from, to}},
		{`UPDATE OR IGNORE friend_requests SET to_id = ? WHERE to_id = ? AND from_id <> ?`, []any{to, from, to}},
		{`DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?`, []any{from, from}},
	} {
		if _, err := tx.Exec(q.sql, q.args...); err != nil {
			return err
		}
	}
	return nil
}
