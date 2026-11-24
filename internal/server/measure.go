package server

import (
	"context"
	"fmt"
	"math"

	"github.com/almanac-bg/almanac/internal/play"
)

// What /admin tells of the players: one plain table, a row a day, of how many played (people only: play.People), how
// many of them for the first time, how many of that day's issues were shared (a link made for them: share.go), and of
// the new, how many played again a day, a week and a month after (play.DayCounts). It's read from the days played,
// the games and the links shared, nothing kept for it: a change is judged by whether players come back (DECISIONS.md,
// „The rule for later“), and the bet that the share brings players is read as the new beside the days shared.

// AdminDays is how many days /admin's table shows, today with them.
const AdminDays = 60

// dayRow is a day of /admin's table as it shows it: the day („10.11“), its players and new ones, that day's issues
// shared, and those of the new back after each of play.Backs („42% (5)“; "—" while that day isn't over, or with none
// new).
type dayRow struct {
	Day                 string
	Played, New, Shared int
	Back                [len(play.Backs)]string
}

// dayRows are /admin's table, newest first.
func (s *Server) dayRows(ctx context.Context) ([]dayRow, error) {
	from := play.DayShift(s.game.Today(), -(AdminDays - 1))
	act, err := s.game.Activity(ctx, from)
	if err != nil {
		return nil, err
	}
	shared, err := s.sharedByDay(ctx, from)
	if err != nil {
		return nil, err
	}
	var rows []dayRow
	for _, c := range act.DayCounts() {
		r := dayRow{Day: short(c.Day), Played: c.Played, New: c.New, Shared: shared[c.Day]}
		for k := range play.Backs {
			r.Back[k] = "—"
			if c.Due[k] && c.New > 0 {
				r.Back[k] = fmt.Sprintf("%d\u00a0%% (%s)", int(math.Round(100*float64(c.Back[k])/float64(c.New))), sayInt(c.Back[k]))
			}
		}
		rows = append(rows, r)
	}
	return rows, nil
}

// sharedByDay is how many of each day's issues, from `from` on, were shared: by the day of the game shared, not of the
// sharing (a day shared after midnight is its own day's).
func (s *Server) sharedByDay(ctx context.Context, from string) (map[string]int, error) {
	rows, err := s.db.Read.QueryContext(ctx, `SELECT r.day, count(*) FROM shares sh JOIN runs r ON r.id = sh.run_id
		WHERE r.kind = 'day' AND r.day >= ? GROUP BY r.day`, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	n := map[string]int{}
	for rows.Next() {
		var day string
		var count int
		if err := rows.Scan(&day, &count); err != nil {
			return nil, err
		}
		n[day] = count
	}
	return n, rows.Err()
}

// short is a day as „10.11“.
func short(day string) string { return day[8:10] + "." + day[5:7] }
