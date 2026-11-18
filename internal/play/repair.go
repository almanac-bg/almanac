package play

import "context"

// A broken streak can be won back, by playing the days it missed. When a streak of RepairFrom days or more has just
// ended (no more than RepairWithin days missed, nothing played since), Начало offers the player the repair: each issue
// missed, played now as a past issue (past.go), and the day's questions, today. With all of them done (afterRun), a
// streak_repairs row keeps the day, and the walk of the streak (walkStreak) counts the days missed before it as kept,
// as a reserve day's are: the streak goes on, and the game's news says so, once. The missed issue is the day itself,
// made up for, played on any day since it was missed: not one more game of any kind, which made the repair about
// playing more rather than about the day that was missed (owner, 2026-11-18, review R4 and O9). One repair in
// RepairEvery days; when none is offered, Начало only says the streak ended.
//
// The day is the games' day, not the clock's: the day's questions begun before midnight and finished after it
// (DayGrace) are that day's, and a past issue counts on the day it ended. What follows each game makes the repair of
// the day it counts on (afterRun), whenever that's done.

const (
	// RepairFrom is the shortest streak worth a repair.
	RepairFrom = 3
	// RepairWithin is how many days missed a repair can keep.
	RepairWithin = 2
	// RepairEvery is how many days one repair lasts a player: one in so many.
	RepairEvery = 30
)

// Repair is a repair on offer today: the streak it wins back (its days, and the day missed that ended it), and how
// far the player is with it: the day's questions finished today (Day), and each issue missed, played since or not.
type Repair struct {
	Days   int           `json:"days"`
	On     string        `json:"on"`
	Day    bool          `json:"day"`
	Missed []MissedIssue `json:"missed"`
	// Words are the issues missed still to play, as a sentence says them (MissedWords): the card on Начало says them so.
	Words string `json:"words"`
}

// MissedIssue is an issue a broken streak missed, as its repair asks for it: its day and number, whether it's played
// (Done), and whether it can be played yet (Open: once its day has settled, a quarter of an hour after its midnight).
type MissedIssue struct {
	Day   string `json:"day"`
	Issue int    `json:"issue"`
	Done  bool   `json:"done"`
	Open  bool   `json:"open"`
}

// done is whether every issue missed is played.
func (r *Repair) done() bool {
	for _, m := range r.Missed {
		if !m.Done {
			return false
		}
	}
	return true
}

// RepairOf is the repair on offer to a player today, nil for none (repairOn).
func (g *Game) RepairOf(ctx context.Context, userID int64) (*Repair, error) {
	return g.repairOn(ctx, userID, g.Today())
}

// repairOn is the repair on offer to a player on a day, nil for none: their last streak by then had RepairFrom days or
// more and ended within RepairWithin days of it, they hadn't played the day's questions since (but maybe that day),
// and their last repair is RepairEvery days older than it or more. A day missed that has no issue to play (before the
// first, or never drawn) asks for nothing.
func (g *Game) repairOn(ctx context.Context, userID int64, day string) (*Repair, error) {
	h, err := g.streakDays(ctx, userID)
	if err != nil || h.first == "" {
		return nil, err
	}
	s := walkStreak(h, day, nil)
	e := s.Ended
	if e == nil || e.Days < RepairFrom {
		return nil, nil
	}
	if gap := daysBetween(e.On, day); gap < 1 || gap > RepairWithin {
		return nil, nil
	}
	for d := e.On; d < day; d = DayShift(d, 1) {
		if h.played[d] {
			return nil, nil
		}
	}
	for d := range h.mended {
		if d > DayShift(day, -RepairEvery) {
			return nil, nil
		}
	}
	r := &Repair{Days: e.Days, On: e.On, Day: h.played[day], Missed: []MissedIssue{}}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.day, EXISTS (SELECT 1 FROM runs r WHERE r.user_id = ?1
			AND r.kind = 'past' AND r.day = d.day AND r.finished_at IS NOT NULL)
		FROM days d WHERE d.day >= ?2 AND d.day >= ?3 AND d.day < ?4 ORDER BY d.day`, userID, FirstIssue, e.On, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m MissedIssue
		if err := rows.Scan(&m.Day, &m.Done); err != nil {
			return nil, err
		}
		m.Issue, m.Open = Issue(m.Day), g.pastOpen(m.Day)
		r.Missed = append(r.Missed, m)
	}
	r.Words = r.MissedWords()
	return r, rows.Err()
}

// mend makes the repair on offer on a day, once its games are played (the game just finished, counting on that day,
// one of them): the streak goes on, and the next news says so.
func (g *Game) mend(ctx context.Context, userID int64, day string) error {
	r, err := g.repairOn(ctx, userID, day)
	if err != nil || r == nil || !r.Day || !r.done() {
		return err
	}
	res, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO streak_repairs (user_id, day) VALUES (?, ?)`,
		userID, day)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil
	}
	return g.Tally(ctx, "repair:done", 1)
}
