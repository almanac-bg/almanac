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
	picks, _ := drawDay(g.Bank(), day, used, nil, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
	if len(picks) == 0 {
		return nil, ErrNoQuestion
	}
	data, _ := json.Marshal(picks)
	_, err = tx.Exec(`INSERT INTO days (day, questions) VALUES (?, ?)`, day, string(data))
	return picks, err
}

// dayQuestions are the questions of today and of the days drawn ahead (ahead.go): no other game deals them (Draw,
// Роял, rooms), so that nobody meets a day's question before its day, or sees one with its answer before playing it.
// The map is shared: read it, never write to it.
func (g *Game) dayQuestions(tx *sql.Tx) (map[string]bool, error) {
	d, err := g.days(tx)
	return d.all, err
}

// DayQuestions are the questions no other game deals (dayQuestions): for the draws made outside the game (rooms).
func (g *Game) DayQuestions(ctx context.Context) (map[string]bool, error) {
	var barred map[string]bool
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		barred, err = g.dayQuestions(tx)
		return err
	})
	return barred, err
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
	var runID int64
	ended := false
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
		runID = r.id
		if ended, err = g.settle(tx, r); err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	if err == nil && ended {
		err = g.finished(ctx, userID, runID)
	}
	return s, err
}

// StartTopic starts a run of a topic ("" for all of them), shaped by how well the player knows it; or, if the player
// left a run of the topic unfinished today, goes on with it where it stopped, as the day's ten do. One left on an
// earlier day isn't taken up again: it was drawn before today's questions were kept from other games.
func (g *Game) StartTopic(ctx context.Context, userID int64, category string) (State, error) {
	b := g.Bank()
	if category != "" && !slices.ContainsFunc(b.Categories, func(c bank.Category) bool { return c.ID == category }) {
		return State{}, ErrNoTopic
	}
	p, err := g.pastOf(ctx, category, userID)
	if err != nil {
		return State{}, err
	}
	var s State
	var ended int64 // the run left unfinished, if its clock has just ended it
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		today, _ := time.ParseInLocation(time.DateOnly, g.Today(), Bulgaria)
		left, err := scanRun(tx.QueryRow(`SELECT `+runColumns+` FROM runs WHERE user_id = ? AND kind = 'topic'
			AND category = ? AND finished_at IS NULL AND started_at >= ? ORDER BY id DESC LIMIT 1`,
			userID, category, store.Ms(today)))
		switch {
		case err == nil:
			done, err := g.settle(tx, left)
			if err != nil {
				return err
			}
			if !done {
				s, err = g.state(tx, left)
				return err
			}
			ended = left.id
		case !errors.Is(err, ErrNoRun):
			return err
		}
		barred, err := g.dayQuestions(tx)
		if err != nil {
			return err
		}
		picks := Draw(b, category, p.ability, p.seen, barred, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
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
	if err == nil && ended != 0 {
		err = g.finished(ctx, userID, ended)
	}
	return s, err
}

// ReserveMax is how many reserve days a player can keep. A day missed spends one, so the streak holds through it. They
// come from the day itself, so that a player who plays only the day's ten has them too: one with the first day ever
// played, one on every ReserveEvery-th day in a row; and from a day with all three goals done.
const ReserveMax = 2

// ReserveEvery is how many days in a row earn a reserve day.
const ReserveEvery = 7

// StreakNow is a player's streak: the days in a row they've finished the day's questions (up to today, or yesterday
// while today isn't played yet), the reserve days they have, the days a reserve kept the streak through, how many
// more days in a row earn the next reserve day (0 with ReserveMax in hand), and the last streak that ended, if one did.
type StreakNow struct {
	Days    int      `json:"days"`
	Reserve int      `json:"reserve"`
	Saved   []string `json:"saved"`
	Next    int      `json:"next"`
	Ended   *Ended   `json:"ended,omitempty"`
}

// Ended is a streak that ended: how many days it had, and the day that ended it (the first day missed with no reserve
// day to keep it).
type Ended struct {
	Days int    `json:"days"`
	On   string `json:"on"`
}

// StreakOf is a player's streak, from every day they've played: each day played adds to it (and may earn a reserve
// day: ReserveMax), each day missed spends a reserve day, or ends it.
func (g *Game) StreakOf(ctx context.Context, userID int64) (StreakNow, error) {
	played, full, first, err := g.streakDays(ctx, userID)
	if err != nil || first == "" {
		return StreakNow{Saved: []string{}}, err
	}
	return walkStreak(played, full, first, g.Today(), nil), nil
}

// streakDays are the days a player finished the day's questions on (first: the first of them, "" for none), and the
// days they did all three goals on.
func (g *Game) streakDays(ctx context.Context, userID int64) (played, full map[string]bool, first string, err error) {
	played, full = map[string]bool{}, map[string]bool{}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT day, 0 FROM runs WHERE user_id = ?1 AND kind = 'day'
			AND finished_at IS NOT NULL AND day >= ?2
		UNION ALL SELECT day, 1 FROM goals_done WHERE user_id = ?1 AND day >= ?2 GROUP BY day HAVING count(*) >= ?3`,
		userID, g.Now().In(Bulgaria).AddDate(-10, 0, 0).Format(time.DateOnly), GoalsPerDay)
	if err != nil {
		return nil, nil, "", err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		var goals bool
		if err := rows.Scan(&day, &goals); err != nil {
			return nil, nil, "", err
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
	return played, full, first, rows.Err()
}

// walkStreak goes over a player's days from the first played to today, as StreakOf tells them. saw, if set, hears of
// each day a reserve day kept the streak through (spent), and of each day that ended a streak (ended: the days it had).
func walkStreak(played, full map[string]bool, first, today string, saw func(day string, spent bool, ended int)) StreakNow {
	s := StreakNow{Saved: []string{}}
	d, _ := time.Parse(time.DateOnly, first)
	for day := first; day <= today; day = d.Format(time.DateOnly) {
		switch {
		case played[day]:
			s.Days++
			if day == first || s.Days%ReserveEvery == 0 || full[day] {
				s.Reserve = min(ReserveMax, s.Reserve+1)
			}
		case day == today: // not played yet: the streak runs to yesterday
		case s.Days > 0 && s.Reserve > 0:
			s.Reserve--
			s.Saved = append(s.Saved, day)
			if saw != nil {
				saw(day, true, 0)
			}
		default:
			if s.Days > 0 {
				s.Ended = &Ended{Days: s.Days, On: day}
				if saw != nil {
					saw(day, false, s.Days)
				}
			}
			s.Days, s.Saved = 0, s.Saved[:0]
		}
		d = d.AddDate(0, 0, 1)
	}
	if s.Reserve < ReserveMax {
		s.Next = ReserveEvery - s.Days%ReserveEvery
	}
	return s
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

// Merge moves a guest's progress to the account they signed in to (account.Accounts.Merge), where it doesn't clash
// with the account's own: all runs but a day the account has played itself, which stays the account's; friends,
// duels, achievements, Роял and league weeks; the better rating (with its games) and league; the goals of days the
// account has no goals for.
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
		// The guest's duels are the account's, those waiting too (one between the two goes with the guest).
		{`UPDATE duels SET a_id = ?1 WHERE a_id = ?2 AND coalesce(b_id, 0) <> ?1`, []any{to, from}},
		{`UPDATE duels SET b_id = ?1 WHERE b_id = ?2 AND a_id <> ?1`, []any{to, from}},
		// The rating: the guest's, with its games and peak, if it's the better one of rated games.
		{`UPDATE users SET rating = g.rating, rated = g.rated
			FROM (SELECT rating, rated FROM users WHERE id = ?2) g
			WHERE users.id = ?1 AND g.rated > 0 AND (users.rated = 0 OR g.rating > users.rating)`, []any{to, from}},
		{`UPDATE users SET peak = max(users.peak, g.peak), peak_seen = max(users.peak_seen, g.peak_seen),
			league = max(users.league, g.league)
			FROM (SELECT peak, peak_seen, league FROM users WHERE id = ?2) g WHERE users.id = ?1`, []any{to, from}},
		// The weeks of the leagues, and the evenings of Роял, the guest played (a week or an evening both played in
		// stays the account's); this week's group, if the account isn't in one.
		{`UPDATE OR IGNORE league_results SET user_id = ? WHERE user_id = ?`, []any{to, from}},
		{`UPDATE OR IGNORE league_members SET user_id = ? WHERE user_id = ?`, []any{to, from}},
		{`UPDATE OR IGNORE royal_players SET user_id = ? WHERE user_id = ?`, []any{to, from}},
		// The days the guest played on were the account's player's: the same person, so not a player who left.
		{`INSERT OR IGNORE INTO active_days (user_id, day) SELECT ?, day FROM active_days WHERE user_id = ?`, []any{to, from}},
		{`DELETE FROM active_days WHERE user_id = ?`, []any{from}},
		// What the guest earned is the account's too; so is the guest's look, if the account hasn't chosen one.
		{`INSERT OR IGNORE INTO achievements (user_id, id, at, seen, xp) SELECT ?, id, at, seen, xp FROM achievements
			WHERE user_id = ?`, []any{to, from}},
		{`INSERT OR IGNORE INTO unlocks_told (user_id, id) SELECT ?, id FROM unlocks_told WHERE user_id = ?`, []any{to, from}},
		// The guest's notifications come along, with what they chose of them (unless the account has chosen), and
		// the Роял they said they'd come to.
		{`UPDATE push_subs SET user_id = ? WHERE user_id = ?`, []any{to, from}},
		{`UPDATE phones SET user_id = ? WHERE user_id = ?`, []any{to, from}},
		{`INSERT OR IGNORE INTO push_prefs (user_id, kind, wanted) SELECT ?, kind, wanted FROM push_prefs WHERE user_id = ?`,
			[]any{to, from}},
		{`UPDATE OR IGNORE royal_plans SET user_id = ? WHERE user_id = ?`, []any{to, from}},
		// So are the guest's goals of a day the account has none for: those drawn, and those finished (with their XP).
		// A day both had goals for keeps the account's, so that it's never more than a day's goals.
		{`INSERT OR IGNORE INTO goals_done (user_id, day, goal, at, xp, seen)
			SELECT ?1, day, goal, at, xp, seen FROM goals_done WHERE user_id = ?2
				AND day NOT IN (SELECT day FROM day_goals WHERE user_id = ?1)
				AND day NOT IN (SELECT day FROM goals_done WHERE user_id = ?1)`, []any{to, from}},
		{`INSERT OR IGNORE INTO day_goals (user_id, day, n, goal) SELECT ?1, day, n, goal FROM day_goals WHERE user_id = ?2
			AND day NOT IN (SELECT day FROM day_goals WHERE user_id = ?1)`, []any{to, from}},
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
