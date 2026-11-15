package play

import "context"

// A broken streak can be won back, by playing. When a streak of RepairFrom days or more has just ended (no more than
// RepairWithin days missed, nothing played since), Начало offers the player the repair: the day's questions and one
// more game, both today. With both done (afterRun), a streak_repairs row keeps the day, and the walk of the streak
// (walkStreak) counts the days missed before it as kept, as a reserve day's are: the streak goes on, and the game's
// news says so, once. One repair in RepairEvery days; when none is offered, Начало only says the streak ended.

const (
	// RepairFrom is the shortest streak worth a repair.
	RepairFrom = 3
	// RepairWithin is how many days missed a repair can keep.
	RepairWithin = 2
	// RepairEvery is how many days one repair lasts a player: one in so many.
	RepairEvery = 30
)

// Repair is a repair on offer today: the streak it wins back (its days, and the day missed that ended it), and how
// far the player is with it: the day's questions finished today, another game finished today.
type Repair struct {
	Days  int    `json:"days"`
	On    string `json:"on"`
	Day   bool   `json:"day"`
	Other bool   `json:"other"`
}

// RepairOf is the repair on offer to a player today, nil for none: their last streak had RepairFrom days or more and
// ended within RepairWithin days, they haven't played the day's questions since (but maybe today), and their last
// repair is RepairEvery days old or more.
func (g *Game) RepairOf(ctx context.Context, userID int64) (*Repair, error) {
	h, err := g.streakDays(ctx, userID)
	if err != nil || h.first == "" {
		return nil, err
	}
	today := g.Today()
	s := walkStreak(h, today, nil)
	e := s.Ended
	if e == nil || e.Days < RepairFrom {
		return nil, nil
	}
	if gap := daysBetween(e.On, today); gap < 1 || gap > RepairWithin {
		return nil, nil
	}
	for day := e.On; day < today; day = DayShift(day, 1) {
		if h.played[day] {
			return nil, nil
		}
	}
	for day := range h.mended {
		if day > DayShift(today, -RepairEvery) {
			return nil, nil
		}
	}
	r := &Repair{Days: e.Days, On: e.On, Day: h.played[today]}
	from, to := dayBounds(today)
	err = g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM runs WHERE user_id = ? AND kind <> 'day'
		AND finished_at >= ? AND finished_at < ?)`, userID, from, to).Scan(&r.Other)
	return r, err
}

// mend makes the repair on offer, once its two games are played (the game just finished one of them): the streak goes
// on, and the next news says so.
func (g *Game) mend(ctx context.Context, userID int64) error {
	r, err := g.RepairOf(ctx, userID)
	if err != nil || r == nil || !r.Day || !r.Other {
		return err
	}
	res, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO streak_repairs (user_id, day) VALUES (?, ?)`,
		userID, g.Today())
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil
	}
	return g.Tally(ctx, "repair:done", 1)
}
