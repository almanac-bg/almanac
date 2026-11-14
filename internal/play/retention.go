package play

import (
	"context"
	"database/sql"
	"time"
)

// Retention is whether players come back: the game's measure of itself. A player's days are the days (in Bulgaria)
// they played on — answered a question in any game — kept in active_days as they happen. A
// player is new on their first such day, and comes back N days later if they play on that day too: the usual
// "day N" retention, counted for each day's new players (a cohort).

// RetentionDays are the days after the first that coming back is counted on.
var RetentionDays = []int{1, 3, 7, 30}

// Cohort is the players who first played on a day, and how many of them played again on each of RetentionDays after
// it (-1 for a day that hasn't come yet).
type Cohort struct {
	Day  string
	New  int
	Back []int
}

// Active is how many players played today, in the last 7 days and in the last 30 (today included).
type Active struct {
	Today, Week, Month int
}

// markActive keeps that a player played today.
func (g *Game) markActive(tx *sql.Tx, userID int64) error {
	_, err := tx.Exec(`INSERT OR IGNORE INTO active_days (user_id, day) VALUES (?, ?)`, userID, g.Today())
	return err
}

// Retention reads the cohorts of the last `days` days, newest first, and how many play now.
func (g *Game) Retention(ctx context.Context, days int) ([]Cohort, Active, error) {
	today := g.Now().In(Bulgaria)
	day := func(back int) string { return today.AddDate(0, 0, -back).Format(time.DateOnly) }
	var act Active
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(DISTINCT CASE WHEN day = ?1 THEN user_id END),
		count(DISTINCT CASE WHEN day > ?2 THEN user_id END), count(DISTINCT user_id)
		FROM active_days WHERE day > ?3 AND day <= ?1`, day(0), day(7), day(30)).Scan(&act.Today, &act.Week, &act.Month)
	if err != nil {
		return nil, act, err
	}
	rows, err := g.DB.Read.QueryContext(ctx, `WITH first AS (SELECT user_id, min(day) AS day FROM active_days GROUP BY user_id)
		SELECT f.day, count(*),
			sum(EXISTS (SELECT 1 FROM active_days a WHERE a.user_id = f.user_id AND a.day = date(f.day, '+1 day'))),
			sum(EXISTS (SELECT 1 FROM active_days a WHERE a.user_id = f.user_id AND a.day = date(f.day, '+3 days'))),
			sum(EXISTS (SELECT 1 FROM active_days a WHERE a.user_id = f.user_id AND a.day = date(f.day, '+7 days'))),
			sum(EXISTS (SELECT 1 FROM active_days a WHERE a.user_id = f.user_id AND a.day = date(f.day, '+30 days')))
		FROM first f WHERE f.day > ? GROUP BY f.day ORDER BY f.day DESC`, day(days))
	if err != nil {
		return nil, act, err
	}
	defer rows.Close()
	var out []Cohort
	for rows.Next() {
		c := Cohort{Back: make([]int, len(RetentionDays))}
		if err := rows.Scan(&c.Day, &c.New, &c.Back[0], &c.Back[1], &c.Back[2], &c.Back[3]); err != nil {
			return nil, act, err
		}
		first, _ := time.ParseInLocation(time.DateOnly, c.Day, Bulgaria)
		for i, n := range RetentionDays {
			if first.AddDate(0, 0, n).Format(time.DateOnly) > day(0) {
				c.Back[i] = -1
			}
		}
		out = append(out, c)
	}
	return out, act, rows.Err()
}
