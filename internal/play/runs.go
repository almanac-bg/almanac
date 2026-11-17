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
// With them are the questions due for review today (overdue), which no game deals. The map is shared: read it, never
// write to it.
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
		g.finished(ctx, userID, runID)
	}
	return s, err
}

// StartTopic starts a run of a topic ("" for all of them, BulgariaTopic for Bulgaria's from every topic: bulgaria.go),
// shaped by how well the player knows it; or, if the player left a run of the topic unfinished today, goes on with it
// where it stopped, as the day's ten do. One left on an earlier day isn't taken up again: it was drawn before today's
// questions were kept from other games.
func (g *Game) StartTopic(ctx context.Context, userID int64, category string) (State, error) {
	b := g.Bank()
	if category != "" && category != BulgariaTopic &&
		!slices.ContainsFunc(b.Categories, func(c bank.Category) bool { return c.ID == category }) {
		return State{}, ErrNoTopic
	}
	known := category // how well the player knows Bulgaria's questions: all the topics, as for a game of them all
	if category == BulgariaTopic {
		known = ""
	}
	p, err := g.pastOf(ctx, known, userID)
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
		if category == BulgariaTopic && bulgariaLeft(b, barred) < Length {
			return ErrNoTopic // not open: too few of its questions are left beside the days'
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
		g.finished(ctx, userID, ended)
	}
	return s, err
}

// LeftRun is a game of the player's own left unfinished today, to come back to: a topic's (its category, "" for all
// of them) or a second chance's; how far it got (At answered, of Total), and whether a question is showing now, its
// time running (Open).
type LeftRun struct {
	ID       int64  `json:"id"`
	Kind     string `json:"kind"`
	Category string `json:"category"`
	At       int    `json:"at"`
	Total    int    `json:"total"`
	Open     bool   `json:"open,omitempty"`
}

// Left are the games of the player's own left unfinished today that StartTopic and StartMistakes would go on with:
// the latest of each topic, and the latest second chance, the latest first. One whose clock has just run out on its
// last question ends now, as it would at its next look, and isn't among them.
func (g *Game) Left(ctx context.Context, userID int64) ([]LeftRun, error) {
	today, _ := time.ParseInLocation(time.DateOnly, g.Today(), Bulgaria)
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT max(id) FROM runs WHERE user_id = ? AND kind IN ('topic', 'mistakes')
		AND finished_at IS NULL AND started_at >= ? GROUP BY kind, coalesce(category, '') ORDER BY 1 DESC`,
		userID, store.Ms(today))
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	left := []LeftRun{}
	for _, id := range ids {
		s, err := g.State(ctx, userID, id)
		if err != nil {
			return nil, err
		}
		if !s.Done {
			left = append(left, LeftRun{ID: s.ID, Kind: s.Kind, Category: s.Category, At: s.At, Total: s.Total, Open: s.Question != nil})
		}
	}
	return left, nil
}

// ReserveMax is how many reserve days a player can keep. A day missed spends one, so the streak holds through it. They
// come from the day itself, so that a player who plays only the day's ten has them too: one with the first day ever
// played, one on every ReserveEvery-th day in a row; and from a day with all three goals done.
const ReserveMax = 2

// ReserveEvery is how many days in a row earn a reserve day.
const ReserveEvery = 7

// StreakNow is a player's streak: the days in a row they've finished the day's questions (up to today, or yesterday
// while today isn't played yet), the reserve days they have, the days a reserve kept the streak through and those a
// repair kept it through (repair.go), how many more days in a row earn the next reserve day (0 with ReserveMax in
// hand), the last streak that ended, if one did, and the longest the player has had (this one, maybe).
type StreakNow struct {
	Days    int      `json:"days"`
	Best    int      `json:"best"`
	Reserve int      `json:"reserve"`
	Saved   []string `json:"saved"`
	Mended  []string `json:"mended"`
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
// day: ReserveMax), each day missed spends a reserve day, is kept by a repair (repair.go), or ends the streak.
func (g *Game) StreakOf(ctx context.Context, userID int64) (StreakNow, error) {
	h, err := g.streakDays(ctx, userID)
	if err != nil || h.first == "" {
		return StreakNow{Saved: []string{}, Mended: []string{}}, err
	}
	return walkStreak(h, g.Today(), nil), nil
}

// streakHistory is what a streak is made of: the days a player finished the day's questions on (first: the first of
// them, "" for none), the days they did all three goals on, and the days they won a broken streak back on (repair.go).
type streakHistory struct {
	played, full, mended map[string]bool
	first                string
}

// mends says whether a repair keeps the streak through a day missed: one made on a day played soon after it
// (RepairWithin), with nothing played between.
func (h streakHistory) mends(missed string) bool {
	for k := 1; k <= RepairWithin; k++ {
		day := DayShift(missed, k)
		if h.mended[day] {
			return true
		}
		if h.played[day] {
			return false
		}
	}
	return false
}

// streakDays are a player's days as the streak counts them (streakHistory), over the last ten years.
func (g *Game) streakDays(ctx context.Context, userID int64) (streakHistory, error) {
	h := streakHistory{played: map[string]bool{}, full: map[string]bool{}, mended: map[string]bool{}}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT day, 0 FROM runs WHERE user_id = ?1 AND kind = 'day'
			AND finished_at IS NOT NULL AND day >= ?2
		UNION ALL SELECT day, 1 FROM goals_done WHERE user_id = ?1 AND day >= ?2 GROUP BY day HAVING count(*) >= ?3
		UNION ALL SELECT day, 2 FROM streak_repairs WHERE user_id = ?1 AND day >= ?2`,
		userID, g.Now().In(Bulgaria).AddDate(-10, 0, 0).Format(time.DateOnly), GoalsPerDay)
	if err != nil {
		return h, err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		var what int
		if err := rows.Scan(&day, &what); err != nil {
			return h, err
		}
		switch what {
		case 1:
			h.full[day] = true
		case 2:
			h.mended[day] = true
		default:
			h.played[day] = true
			if h.first == "" || day < h.first {
				h.first = day
			}
		}
	}
	return h, rows.Err()
}

// walkStreak goes over a player's days from the first played to today, as StreakOf tells them. saw, if set, hears of
// each day a reserve day kept the streak through (spent), and of each day that ended a streak (ended: the days it had).
func walkStreak(h streakHistory, today string, saw func(day string, spent bool, ended int)) StreakNow {
	s := StreakNow{Saved: []string{}, Mended: []string{}}
	d, _ := time.Parse(time.DateOnly, h.first)
	for day := h.first; day <= today; day = d.Format(time.DateOnly) {
		switch {
		case h.played[day]:
			s.Days++
			s.Best = max(s.Best, s.Days)
			if day == h.first || s.Days%ReserveEvery == 0 || h.full[day] {
				s.Reserve = min(ReserveMax, s.Reserve+1)
			}
		case day == today: // not played yet: the streak runs to yesterday
		case s.Days > 0 && s.Reserve > 0:
			s.Reserve--
			s.Saved = append(s.Saved, day)
			if saw != nil {
				saw(day, true, 0)
			}
		case s.Days > 0 && h.mends(day):
			s.Mended = append(s.Mended, day)
		default:
			if s.Days > 0 {
				s.Ended = &Ended{Days: s.Days, On: day}
				if saw != nil {
					saw(day, false, s.Days)
				}
			}
			s.Days, s.Saved, s.Mended = 0, s.Saved[:0], s.Mended[:0]
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
