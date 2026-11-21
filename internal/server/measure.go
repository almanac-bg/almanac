package server

import (
	"context"
	"fmt"
	"math"

	"github.com/almanac-bg/almanac/internal/play"
)

// What /admin tells of the players: one plain table, a row a day, of how many played (people only: play.People), how
// many of them for the first time, and of those new, how many played again a day, a week and a month after
// (play.DayCounts). It's read from the days played and the games, nothing kept for it: a change is judged by whether
// players come back (DECISIONS.md, „The rule for later“).

// AdminDays is how many days /admin's table shows, today with them.
const AdminDays = 60

// dayRow is a day of /admin's table as it shows it: the day („10.11“), its players and new ones, and those of the new
// back after each of play.Backs („42% (5)“; "—" while that day isn't over, or with none new).
type dayRow struct {
	Day         string
	Played, New int
	Back        [len(play.Backs)]string
}

// dayRows are /admin's table, newest first.
func (s *Server) dayRows(ctx context.Context) ([]dayRow, error) {
	act, err := s.game.Activity(ctx, play.DayShift(s.game.Today(), -(AdminDays-1)))
	if err != nil {
		return nil, err
	}
	var rows []dayRow
	for _, c := range act.DayCounts() {
		r := dayRow{Day: short(c.Day), Played: c.Played, New: c.New}
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

// short is a day as „10.11“.
func short(day string) string { return day[8:10] + "." + day[5:7] }
