package play

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"slices"
	"time"
)

// A player's year in the game („Твоята 2026“): the days they played, their longest streak, their answers, their
// strongest topic, the facts they learned (and the first of them), their duels, their best Роял, the highest league
// they reached, who they played most, and the XP it all earned. Everything comes from the records of that calendar
// year in Bulgaria; nothing is kept for it. The client opens it from mid-December into January (YearOpens), and any
// year can be looked at after.

// YearOpens is when, in December, a year's look back opens on Начало (to mid-January): enough of the year has passed.
const YearOpens = 15

// ErrNoYear is a year that hasn't started.
var ErrNoYear = errors.New("no such year")

// Year is a player's year in the game.
type Year struct {
	Year int `json:"year"`
	// Days is how many days they played on; Streak their longest run of the day's questions in a row.
	Days   int `json:"days"`
	Streak int `json:"streak"`
	Games  int `json:"games"`
	// Answers, and how many of them right.
	Answers int `json:"answers"`
	Right   int `json:"right"`
	// Topic is their strongest topic now (nil until one is sure), and how much of it they know.
	Topic *Mastery `json:"topic,omitempty"`
	// Facts is how many facts they learned in the year, and First the first of them.
	Facts int      `json:"facts"`
	First *Learned `json:"first,omitempty"`
	// Duels played and won.
	Duels int `json:"duels"`
	Won   int `json:"won"`
	// Royal is their best place in a Роял (0: none played), of how many.
	Royal   int `json:"royal,omitempty"`
	RoyalOf int `json:"royalOf,omitempty"`
	// League is the highest league they reached (nil: none).
	League *League `json:"league,omitempty"`
	// Rival is whoever they played most duels against, and how many.
	Rival      string `json:"rival,omitempty"`
	RivalGames int    `json:"rivalGames,omitempty"`
	XP         int    `json:"xp"`
}

// YearOf is a player's year (ErrNoYear for one not started).
func (g *Game) YearOf(ctx context.Context, userID int64, year int) (Year, error) {
	now := g.Now().In(Bulgaria)
	if year < 2026 || year > now.Year() {
		return Year{}, ErrNoYear
	}
	y := Year{Year: year}
	start := time.Date(year, 1, 1, 0, 0, 0, 0, Bulgaria)
	end := start.AddDate(1, 0, 0)
	from, to := start.UnixMilli(), end.UnixMilli()
	first, last := start.Format(time.DateOnly), end.AddDate(0, 0, -1).Format(time.DateOnly)
	db := g.DB.Read
	err := db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM active_days WHERE user_id = ?1 AND day BETWEEN ?4 AND ?5),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND finished_at >= ?2 AND finished_at < ?3),
		(SELECT count(*) FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1 AND a.at >= ?2 AND a.at < ?3),
		(SELECT coalesce(sum(a.is_right), 0) FROM answers a JOIN runs r ON r.id = a.run_id
			WHERE r.user_id = ?1 AND a.at >= ?2 AND a.at < ?3),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'duel' AND outcome IS NOT NULL
			AND finished_at >= ?2 AND finished_at < ?3),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'duel' AND outcome = 'won'
			AND finished_at >= ?2 AND finished_at < ?3),
		coalesce((SELECT sum(xp) FROM runs WHERE user_id = ?1 AND finished_at >= ?2 AND finished_at < ?3), 0)
			+ coalesce((SELECT sum(xp) FROM goals_done WHERE user_id = ?1 AND day BETWEEN ?4 AND ?5), 0)
			+ coalesce((SELECT sum(xp) FROM achievements WHERE user_id = ?1 AND at >= ?2 AND at < ?3), 0)
			+ coalesce((SELECT sum(xp) FROM league_results WHERE user_id = ?1 AND week BETWEEN ?4 AND ?5), 0)`,
		userID, from, to, first, last).Scan(&y.Days, &y.Games, &y.Answers, &y.Right, &y.Duels, &y.Won, &y.XP)
	if err != nil {
		return y, err
	}
	if y.Streak, err = g.longestStreak(ctx, userID, first, last); err != nil {
		return y, err
	}
	mastery, err := g.MasteryOf(ctx, userID)
	if err != nil {
		return y, err
	}
	if best := slices.MaxFunc(append([]Mastery{{}}, mastery...), func(a, b Mastery) int {
		return cmp.Or(cmp.Compare(boolInt(a.Sure), boolInt(b.Sure)), cmp.Compare(a.Known, b.Known))
	}); best.Sure {
		y.Topic = &best
	}
	almanac, err := g.AlmanacOf(ctx, userID)
	if err != nil {
		return y, err
	}
	for i := len(almanac.Facts) - 1; i >= 0; i-- { // newest first: the first learned is last
		if f := almanac.Facts[i]; f.At >= from && f.At < to {
			y.Facts++
			if y.First == nil {
				y.First = &f
			}
		}
	}
	var place, of sql.NullInt64
	if err := db.QueryRowContext(ctx, `SELECT p.place, (SELECT count(*) FROM royal_players o WHERE o.royal_id = p.royal_id)
		FROM royal_players p WHERE p.user_id = ? AND p.place IS NOT NULL AND p.joined_at >= ? AND p.joined_at < ?
		ORDER BY p.place, 2 DESC LIMIT 1`, userID, from, to).Scan(&place, &of); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return y, err
	}
	y.Royal, y.RoyalOf = int(place.Int64), int(of.Int64)
	var top sql.NullInt64
	if err := db.QueryRowContext(ctx, `SELECT max(max(tier, tier + moved)) FROM league_results
		WHERE user_id = ? AND week BETWEEN ? AND ?`, userID, first, last).Scan(&top); err != nil {
		return y, err
	}
	var current sql.NullInt64
	if err := db.QueryRowContext(ctx, `SELECT g.tier FROM league_members m JOIN league_groups g ON g.id = m.group_id
		WHERE m.user_id = ? AND m.week BETWEEN ? AND ? ORDER BY g.tier DESC LIMIT 1`, userID, first, last).
		Scan(&current); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return y, err
	}
	if top.Valid || current.Valid {
		l := leagueOf(max(int(top.Int64), int(current.Int64)))
		y.League = &l
	}
	if err := db.QueryRowContext(ctx, `SELECT u.name, count(*) FROM runs r JOIN users u ON u.id = r.opponent_id
		WHERE r.user_id = ? AND r.kind = 'duel' AND r.finished_at >= ? AND r.finished_at < ?
		GROUP BY r.opponent_id ORDER BY 2 DESC, max(r.finished_at) DESC LIMIT 1`, userID, from, to).
		Scan(&y.Rival, &y.RivalGames); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return y, err
	}
	return y, nil
}

// longestStreak is the longest run of days in a row, between two days, on which a player finished the day's
// questions.
func (g *Game) longestStreak(ctx context.Context, userID int64, first, last string) (int, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT day FROM runs WHERE user_id = ? AND kind = 'day'
		AND finished_at IS NOT NULL AND day BETWEEN ? AND ? ORDER BY day`, userID, first, last)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	best, run := 0, 0
	var prev time.Time
	for rows.Next() {
		var day string
		if err := rows.Scan(&day); err != nil {
			return 0, err
		}
		d, err := time.ParseInLocation(time.DateOnly, day, Bulgaria)
		if err != nil {
			continue
		}
		if !prev.IsZero() && prev.AddDate(0, 0, 1).Equal(d) {
			run++
		} else {
			run = 1
		}
		prev = d
		best = max(best, run)
	}
	return best, rows.Err()
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
