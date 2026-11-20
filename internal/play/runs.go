package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"maps"
	mrand "math/rand/v2"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// day reads a day's questions, drawing them the first time the day is asked for; on the day itself, each kept as it
// is as the day begins (pinDay).
func (g *Game) day(tx *sql.Tx, day string, b *bank.Bank) ([]Pick, error) {
	var stored string
	err := tx.QueryRow(`SELECT questions FROM days WHERE day = ?`, day).Scan(&stored)
	if err == nil {
		var picks []Pick
		if err := json.Unmarshal([]byte(stored), &picks); err != nil {
			return nil, err
		}
		return g.pinDay(tx, day, picks, b)
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
	picks, _ := drawDay(b, day, used, nil, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
	if len(picks) == 0 {
		return nil, ErrNoQuestion
	}
	data, _ := json.Marshal(picks)
	if _, err = tx.Exec(`INSERT INTO days (day, questions) VALUES (?, ?)`, day, string(data)); err != nil {
		return nil, err
	}
	return g.pinDay(tx, day, picks, b)
}

// dayQuestions are the questions of today and of the days drawn ahead (ahead.go): no other game deals them (Draw,
// Роял, rooms), so that nobody meets a day's question before its day, or sees one with its answer before playing it.
// With them are the questions due for review today (overdue), which no game deals, and those waiting for their date
// (waiting: „На този ден“). The map is shared: read it, never write to it.
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

// Devices are what a game can be started on, as runs.device keeps them: for /admin to tell phones, desktops and the
// app apart.
var Devices = []string{"phone", "tablet", "desktop", "app-ios", "app-android"}

// devicesKey keeps in a context the device each of its players plays on (FromDevice), by player.
type devicesKey struct{}

// FromDevice is ctx with the device a player plays on (one of Devices): a game started for them in it keeps it
// (runs.device). Nothing for "" (one that can't be told).
func FromDevice(ctx context.Context, userID int64, device string) context.Context {
	if device == "" {
		return ctx
	}
	was, _ := ctx.Value(devicesKey{}).(map[int64]string)
	devices := make(map[int64]string, len(was)+1)
	maps.Copy(devices, was)
	devices[userID] = device
	return context.WithValue(ctx, devicesKey{}, devices)
}

// deviceOf is the device a player plays on in ctx (FromDevice), or none (nil).
func deviceOf(ctx context.Context, userID int64) any {
	if d, _ := ctx.Value(devicesKey{}).(map[int64]string); d[userID] != "" {
		return d[userID]
	}
	return nil
}

// insertRun starts a game for a player, with the network they play from if ctx has it (FromNet, fair.go), and the
// device (FromDevice).
func (g *Game) insertRun(ctx context.Context, tx *sql.Tx, userID int64, kind string, day, category any, picks []Pick) (*run, error) {
	data, _ := json.Marshal(picks)
	res, err := tx.Exec(`INSERT INTO runs (user_id, kind, day, category, questions, started_at, device)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, userID, kind, day, category, string(data), store.Ms(g.Now()), deviceOf(ctx, userID))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if err := g.keepNet(ctx, tx, userID, id); err != nil {
		return nil, err
	}
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
			picks, derr := g.day(tx, today, g.Bank())
			if derr != nil {
				return derr
			}
			r, err = g.insertRun(ctx, tx, userID, "day", today, nil, picks)
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

// MixTopic is the topic „Микс“: the questions of every topic at once, played and kept as a topic is (runs.category).
// Its games are shaped by how well the player knows all the topics, and count toward each question's own topic.
const MixTopic = "mix"

// StartTopic starts a run of a topic (MixTopic for all of them, BulgariaTopic for Bulgaria's from every topic:
// bulgaria.go), shaped by how well the player knows it; or, if the player left a run of the topic unfinished today, goes on with it
// where it stopped, as the day's ten do. One left on an earlier day isn't taken up again: it was drawn before today's
// questions were kept from other games.
func (g *Game) StartTopic(ctx context.Context, userID int64, category string) (State, error) {
	b := g.Bank()
	if category != MixTopic && category != BulgariaTopic &&
		!slices.ContainsFunc(b.Categories, func(c bank.Category) bool { return c.ID == category }) {
		return State{}, ErrNoTopic
	}
	known := category // how well the player knows „Микс“'s and Bulgaria's questions: all the topics
	if category == MixTopic || category == BulgariaTopic {
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
		r, err := g.insertRun(ctx, tx, userID, "topic", nil, category, picks)
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

// LeftRun is a game of the player's own left unfinished, to come back to: a topic's today (its category); how far it
// got (At answered, of Total), and whether a question is showing now, its time running (Open).
type LeftRun struct {
	ID       int64  `json:"id"`
	Category string `json:"category"`
	At       int    `json:"at"`
	Total    int    `json:"total"`
	Open     bool   `json:"open,omitempty"`
}

// Left are the games of the player's own left unfinished that StartTopic would go on with: the latest of each topic,
// today's; the latest first. One whose clock has just run out on its last question ends now, as it would at its next
// look, and isn't among them.
func (g *Game) Left(ctx context.Context, userID int64) ([]LeftRun, error) {
	today, _ := time.ParseInLocation(time.DateOnly, g.Today(), Bulgaria)
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT max(id) FROM runs WHERE user_id = ? AND finished_at IS NULL
		AND kind = 'topic' AND started_at >= ? GROUP BY category ORDER BY 1 DESC`,
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
			left = append(left, LeftRun{ID: s.ID, Category: s.Category, At: s.At, Total: s.Total, Open: s.Question != nil})
		}
	}
	return left, nil
}

// ReserveMax is how many reserve days a player can keep. A day missed spends one, so the streak holds through it. They
// come from the day itself, so that a player who plays only the day's ten has them too: the first on the streak's
// ReserveFrom-th day, then one on every ReserveEvery-th day in a row; and from a day with all three goals done. At most
// one a week, Monday to Sunday, from whichever comes first (ReserveWeek), and none before a streak's ReserveFrom-th
// day: a streak „поред“ hides at most a day a week, and day two still has its stake (owner, 2026-11-18, review E4 and
// E11).
const ReserveMax = 2

// ReserveEvery is how many days in a row earn a reserve day, after the first.
const ReserveEvery = 7

// ReserveFrom is the streak's day that earns its first reserve day, and before which nothing earns one.
const ReserveFrom = 3

// ReserveRulesFrom is the first day whose reserve days are earned as above. The days before it earned them as the rules
// were then (one with the first day ever played, every ReserveEvery-th day in a row and every day with all three goals,
// with no weekly cap), so that nobody lost a reserve day they held when the rules changed. A variable: development,
// with no players from before to keep, and the tests take today's rules from the start ("").
var ReserveRulesFrom = "2026-11-19"

// StreakNow is a player's streak: the days in a row they've finished the day's questions (up to today, or yesterday
// while today isn't played yet), the reserve days they have, the days a reserve kept the streak through, how many more
// days in a row earn the next reserve day by themselves (0 with ReserveMax in hand), whether this week's reserve day
// is earned, the last streak that ended, if one did, and the longest the player has had (this one, maybe).
type StreakNow struct {
	Days    int      `json:"days"`
	Best    int      `json:"best"`
	Reserve int      `json:"reserve"`
	Saved   []string `json:"saved"`
	Next    int      `json:"next"`
	Week    bool     `json:"week"`
	Ended   *Ended   `json:"ended,omitempty"`
	// Unbroken is how many days in a row, one after another, the player has finished the day's questions with no
	// reserve day between them: „Година без пропуск“ (progress.go).
	Unbroken int `json:"-"`
	// today is whether today's are finished.
	today bool
}

// What the day's goals, done all three, would bring the streak (StreakNow.GoalsReserve).
const (
	ReserveByGoals = ""     // a reserve day
	ReserveFull    = "full" // nothing: the reserve days are all in hand
	ReserveWeek    = "week" // nothing more: this week's is earned
	ReserveSoon    = "soon" // nothing yet: the streak is under ReserveFrom days, today's counted
)

// GoalsReserve is what the day's goals, done all three today, would bring the streak (ReserveByGoals…).
func (s StreakNow) GoalsReserve() string {
	days := s.Days
	if !s.today {
		days++ // the day's questions are a goal: done, they're a day of the streak
	}
	switch {
	case s.Reserve >= ReserveMax:
		return ReserveFull
	case s.Week:
		return ReserveWeek
	case days < ReserveFrom:
		return ReserveSoon
	}
	return ReserveByGoals
}

// Ended is a streak that ended: how many days it had, and the day that ended it (the first day missed with no reserve
// day to keep it).
type Ended struct {
	Days int    `json:"days"`
	On   string `json:"on"`
}

// StreakOf is a player's streak, from every day they've played: each day played adds to it (and may earn a reserve
// day: ReserveMax), each day missed spends a reserve day or ends the streak.
func (g *Game) StreakOf(ctx context.Context, userID int64) (StreakNow, error) {
	h, err := g.streakDays(ctx, userID)
	if err != nil || h.first == "" {
		return StreakNow{Saved: []string{}}, err
	}
	return walkStreak(h, g.Today(), nil), nil
}

// streakHistory is what a streak is made of: the days a player finished the day's questions on (first: the first of
// them, "" for none), and the days they did all three goals on.
type streakHistory struct {
	played, full map[string]bool
	first        string
}

// streakDays are a player's days as the streak counts them (streakHistory), over the last ten years.
func (g *Game) streakDays(ctx context.Context, userID int64) (streakHistory, error) {
	h := streakHistory{played: map[string]bool{}, full: map[string]bool{}}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT day, 0 FROM runs WHERE user_id = ?1 AND kind = 'day'
			AND finished_at IS NOT NULL AND day >= ?2
		UNION ALL SELECT day, 1 FROM goals_done WHERE user_id = ?1 AND day >= ?2 GROUP BY day HAVING count(*) >= ?3`,
		userID, g.Now().In(Bulgaria).AddDate(-10, 0, 0).Format(time.DateOnly), GoalsPerDay)
	if err != nil {
		return h, err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		var full bool
		if err := rows.Scan(&day, &full); err != nil {
			return h, err
		}
		if full {
			h.full[day] = true
			continue
		}
		h.played[day] = true
		if h.first == "" || day < h.first {
			h.first = day
		}
	}
	return h, rows.Err()
}

// walkStreak goes over a player's days from the first played to today, as StreakOf tells them. saw, if set, hears of
// each day a reserve day kept the streak through (spent), and of each day that ended a streak (ended: the days it had).
func walkStreak(h streakHistory, today string, saw func(day string, spent bool, ended int)) StreakNow {
	s := StreakNow{Saved: []string{}}
	d, _ := time.Parse(time.DateOnly, h.first)
	var earned time.Time // the Monday of the week the last reserve day was earned in
	for day := h.first; day <= today; day = d.Format(time.DateOnly) {
		switch {
		case h.played[day]:
			s.Days++
			s.Unbroken++
			s.Best = max(s.Best, s.Days)
			s.today = day == today
			if s.Reserve < ReserveMax && earns(day, d, s.Days, day == h.first, h.full[day], earned) {
				s.Reserve++
				earned = monday(d)
			}
		case day == today: // not played yet: the streak runs to yesterday
		case s.Days > 0 && s.Reserve > 0:
			s.Reserve--
			s.Unbroken = 0
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
			s.Days, s.Unbroken, s.Saved = 0, 0, s.Saved[:0]
		}
		d = d.AddDate(0, 0, 1)
	}
	end, _ := time.Parse(time.DateOnly, today)
	s.Week = !earned.IsZero() && earned.Equal(monday(end))
	if s.Reserve < ReserveMax {
		// The next day the day's questions alone would earn one on, played every day from the next to be played.
		next := end
		if s.today {
			next = next.AddDate(0, 0, 1)
		}
		for k := 1; k <= 3*ReserveEvery; k++ {
			at := next.AddDate(0, 0, k-1)
			if earns(at.Format(time.DateOnly), at, s.Days+k, false, false, earned) {
				s.Next = k
				break
			}
		}
	}
	return s
}

// earns is whether a day played earns a reserve day (ReserveMax): as the day (d) of the streak it's on (days), the
// first day ever played or not, with all three goals done or not, the last reserve day earned in the week of a Monday.
func earns(day string, d time.Time, days int, first, full bool, earned time.Time) bool {
	if day < ReserveRulesFrom {
		return first || days%ReserveEvery == 0 || full
	}
	return days >= ReserveFrom && (days == ReserveFrom || days%ReserveEvery == 0 || full) && !earned.Equal(monday(d))
}

// monday is the Monday of a day's week.
func monday(d time.Time) time.Time { return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7)) }

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
