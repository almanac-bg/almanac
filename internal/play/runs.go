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
	days, err := storedDays(tx, "")
	if err != nil {
		return nil, err
	}
	used := map[string]bool{}
	for _, picks := range days {
		for _, p := range picks {
			used[p.ID] = true
		}
	}
	picks, _ := drawDay(b, day, used, nil, recentSubjects(b, days, day), mrand.New(mrand.NewPCG(newSeed(), newSeed())))
	if len(picks) == 0 {
		return nil, ErrNoQuestion
	}
	data, _ := json.Marshal(picks)
	if _, err = tx.Exec(`INSERT INTO days (day, questions) VALUES (?, ?)`, day, string(data)); err != nil {
		return nil, err
	}
	return g.pinDay(tx, day, picks, b)
}

// dayQuestions are the questions of today and of the days drawn ahead (ahead.go): no other game deals them (Draw), so
// that nobody meets a day's question before its day, or sees one with its answer before playing it.
// With them are the questions due for review today (overdue), which no game deals, and those waiting for their date
// (waiting: „На този ден“). The map is shared: read it, never write to it.
func (g *Game) dayQuestions(tx *sql.Tx) (map[string]bool, error) {
	d, err := g.days(tx)
	return d.all, err
}

// DayQuestions are the questions no other game deals (dayQuestions), read on their own, outside a run's
// transaction.
func (g *Game) DayQuestions(ctx context.Context) (map[string]bool, error) {
	var barred map[string]bool
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		barred, err = g.dayQuestions(tx)
		return err
	})
	return barred, err
}

// Devices are what a game can be started on, as runs.device keeps them: for /admin to tell phones, tablets and
// desktops apart.
var Devices = []string{"phone", "tablet", "desktop"}

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

// secondKey keeps in a context the players whose day's issue is played a second time in one browser (SecondPlay).
type secondKey struct{}

// SecondPlay is ctx with a player's day's issue, if a run of it is begun in it, played a second time in this
// browser: the browser started the day before as someone else (a sign-out, a handoff), so the day's answers were in
// sight there; the run writes pencil, never ink (ink.go).
func SecondPlay(ctx context.Context, userID int64) context.Context {
	was, _ := ctx.Value(secondKey{}).(map[int64]bool)
	second := make(map[int64]bool, len(was)+1)
	maps.Copy(second, was)
	second[userID] = true
	return context.WithValue(ctx, secondKey{}, second)
}

// insertRun starts a game for a player, with the network they play from if ctx has it (FromNet, fair.go), the device
// (FromDevice), and, of a day's issue, whether it's a second play in this browser (SecondPlay).
func (g *Game) insertRun(ctx context.Context, tx *sql.Tx, userID int64, kind string, day, category any, picks []Pick) (*run, error) {
	data, _ := json.Marshal(picks)
	second, _ := ctx.Value(secondKey{}).(map[int64]bool)
	res, err := tx.Exec(`INSERT INTO runs (user_id, kind, day, category, questions, started_at, device, pencil)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, userID, kind, day, category, string(data), store.Ms(g.Now()),
		deviceOf(ctx, userID), kind == "day" && second[userID])
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

// The streak is the days in a row a player has finished the day's questions. It forgives one missed day a week by
// itself, Monday to Sunday: nothing to earn or hold (owner, 2026-11-20, DECISIONS.md „The redesign“). A second day
// missed in a week ends it, and a streak that ends isn't won back. Two days missed one after the other are both
// forgiven only across a week's turn (a Sunday and the Monday after), so a streak ends at most MostForgiven+1 days
// after the last day played.
//
// The days missed before the rule came in were judged by the reserve days of then (earned, held, spent): each such day
// is kept as it was judged (streak_missed, migration 0084), kept or ended, so that the rule changed no streak that was
// going, and won back none that had ended. A day kept so is its week's one.

// MostForgiven is how many days missed in a row a streak can be forgiven: a Sunday and the Monday after.
const MostForgiven = 2

// StreakNow is a player's streak: the days in a row they've finished the day's questions (up to today, or yesterday
// while today isn't played yet; and a day still being played just after its midnight, within DayGrace, is played
// yet neither), the days missed that it forgave, whether this week still has its day to forgive (Spare), the last
// streak that ended, if one did, and the longest the player has had (this one, maybe).
type StreakNow struct {
	Days     int      `json:"days"`
	Best     int      `json:"best"`
	Forgiven []string `json:"forgiven"`
	Spare    bool     `json:"spare"`
	Ended    *Ended   `json:"ended,omitempty"`
}

// Ended is a streak that ended: how many days it had, and the day that ended it (the second day missed in a week).
type Ended struct {
	Days int    `json:"days"`
	On   string `json:"on"`
}

// StreakOf is a player's streak, from every day they've played: each day played adds to it, a day missed is forgiven
// if it's the first of its week, and ends the streak if it isn't.
func (g *Game) StreakOf(ctx context.Context, userID int64) (StreakNow, error) {
	h, err := g.streakDays(ctx, userID)
	if err != nil || h.first == "" {
		return StreakNow{Forgiven: []string{}, Spare: true}, err
	}
	return walkStreak(h, g.Today(), nil), nil
}

// streakHistory is what a streak is made of: the days a player finished the day's questions on (first: the first of
// them, "" for none), the days missed before today's rule, as they were judged then (kept: true, ended: false), and
// yesterday, if its run is still being played (open: within DayGrace of its midnight, it may count yet).
type streakHistory struct {
	played map[string]bool
	missed map[string]bool
	first  string
	open   string
}

// streakDays are a player's days as the streak counts them (streakHistory), over the last ten years.
func (g *Game) streakDays(ctx context.Context, userID int64) (streakHistory, error) {
	h := streakHistory{played: map[string]bool{}, missed: map[string]bool{}}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT day, NULL FROM runs WHERE user_id = ?1 AND kind = 'day'
			AND finished_at IS NOT NULL AND day >= ?2
		UNION ALL SELECT day, kept FROM streak_missed WHERE user_id = ?1 AND day >= ?2`,
		userID, g.Now().In(Bulgaria).AddDate(-10, 0, 0).Format(time.DateOnly))
	if err != nil {
		return h, err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		var kept sql.NullBool
		if err := rows.Scan(&day, &kept); err != nil {
			return h, err
		}
		if kept.Valid {
			h.missed[day] = kept.Bool
			continue
		}
		h.played[day] = true
		if h.first == "" || day < h.first {
			h.first = day
		}
	}
	if err := rows.Err(); err != nil {
		return h, err
	}
	// Yesterday's run, unfinished but not over (dayOver: its DayGrace, or a question shown before it ended still in
	// its time): the day isn't missed yet, as it counts if it's finished now.
	now := g.Now()
	r := run{kind: "day", day: DayShift(now.In(Bulgaria).Format(time.DateOnly), -1)}
	err = g.DB.Read.QueryRowContext(ctx, `SELECT shown_at FROM runs WHERE user_id = ? AND kind = 'day' AND day = ?
		AND finished_at IS NULL`, userID, r.day).Scan(&r.shownAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return h, nil
	case err != nil:
		return h, err
	}
	if !r.dayOver(now) {
		h.open = r.day
	}
	return h, nil
}

// walkStreak goes over a player's days from the first played to today, as StreakOf tells them. saw, if set, hears of
// each day missed that the streak forgave (forgiven), and of each day that ended a streak (ended: the days it had).
func walkStreak(h streakHistory, today string, saw func(day string, forgiven bool, ended int)) StreakNow {
	s := StreakNow{Forgiven: []string{}}
	d, _ := time.Parse(time.DateOnly, h.first)
	var used time.Time // the Monday of the last week that forgave a day
	for day := h.first; day <= today; day = d.Format(time.DateOnly) {
		switch {
		case h.played[day]:
			s.Days++
			s.Best = max(s.Best, s.Days)
		case day == today || day == h.open || s.Days == 0: // not played yet (it may be still), or no streak to keep
		default:
			kept, judged := h.missed[day]
			if !judged {
				kept = !used.Equal(monday(d))
			}
			if kept {
				used = monday(d)
				s.Forgiven = append(s.Forgiven, day)
				if saw != nil {
					saw(day, true, 0)
				}
				break
			}
			s.Ended = &Ended{Days: s.Days, On: day}
			if saw != nil {
				saw(day, false, s.Days)
			}
			s.Days, s.Forgiven = 0, s.Forgiven[:0]
		}
		d = d.AddDate(0, 0, 1)
	}
	end, _ := time.Parse(time.DateOnly, today)
	s.Spare = !used.Equal(monday(end))
	return s
}

// dayBounds are the day's start and end, in milliseconds.
func dayBounds(day string) (int64, int64) {
	t, _ := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	return t.UnixMilli(), t.AddDate(0, 0, 1).UnixMilli()
}

// monday is the Monday of a day's week.
func monday(d time.Time) time.Time { return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7)) }

// Streak is how many days in a row a player has finished the day's questions, a day a week forgiven (StreakOf).
func (g *Game) Streak(ctx context.Context, userID int64) (int, error) {
	s, err := g.StreakOf(ctx, userID)
	return s.Days, err
}

// InWeek is which of these days (YYYY-MM-DD) are in this week, Monday first: the days forgiven on the streak's strip.
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
