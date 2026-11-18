package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// Retention is whether players come back: the game's measure of itself. A player's days are the days (in Bulgaria)
// they played on — answered a question in any game — kept in active_days as they happen (markActive), with the
// version of the game a player met on their first (users.first_version).
//
// /admin counts people, one population on the whole page (People, fair.go): a day counts when the player isn't an
// admin and played a game as a person that day, not at a script's speed nor a throwaway guest's day. That is judged
// as the days are read (personDays), never as they're kept: a game becomes a shadow only after some of its answers
// (ShadowScript) or minutes later (ShadowThrowaway, JudgeNets), and may be let out of one. A player who goes leaves
// their days as nobody's (Forget), judged as they go: only those that counted are kept.
//
// What the players did in their first days, and the daily loop around them, is measured in measure.go.

// markActive keeps that a player played today, and on their first day, the version they met.
func (g *Game) markActive(tx *sql.Tx, userID int64) error {
	res, err := tx.Exec(`INSERT OR IGNORE INTO active_days (user_id, day) VALUES (?, ?)`, userID, g.Today())
	if err != nil || g.Version == "" {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil // not the day's first answer
	}
	_, err = tx.Exec(`UPDATE users SET first_version = ? WHERE id = ? AND first_version IS NULL`, g.Version, userID)
	return err
}

// personLeeway is how long before a day a game may have started and still count for it: a game begun just before
// midnight and answered after it played the day after.
const personLeeway = time.Hour

// personDay is the SQL condition (on a.user_id, and the day's bounds b.s and b.e in ms) that a day in active_days
// counts as a person's: one gone (a tombstone, judged as they went) or, for a player who isn't an admin, a game played
// as a person (personRun) that day.
const personDay = `(a.user_id < 0 OR (NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id AND u.admin)
	AND EXISTS (SELECT 1 FROM runs r WHERE r.user_id = a.user_id AND r.started_at >= b.s AND r.started_at < b.e
		AND r.at > 0 AND r.` + personRun + `)))`

// dayBoundsJSON are the days from `from` to `to` (both in) with their bounds, as personDay reads them: a JSON array of
// [day, start, end], the start personLeeway early.
func dayBoundsJSON(from, to string) string {
	var out [][3]any
	for d := from; d <= to; d = DayShift(d, 1) {
		s, e := dayBounds(d)
		out = append(out, [3]any{d, s - personLeeway.Milliseconds(), e})
	}
	b, _ := json.Marshal(out)
	return string(b)
}

// boundsCTE names the days of dayBoundsJSON (its first argument) b(day, s, e).
const boundsCTE = `b(day, s, e) AS (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'),
	json_extract(value, '$[2]') FROM json_each(?1))`

// Activity is who played on which days from From to Today (both in), people only (personDay), and who had played
// before From.
type Activity struct {
	From, Today string
	played      map[int64][]bool // by player, a day each from From
	before      map[int64]bool
}

// Activity reads the days people played from `from` to today.
func (g *Game) Activity(ctx context.Context, from string) (*Activity, error) {
	today := g.Today()
	a := &Activity{From: from, Today: today, played: map[int64][]bool{}, before: map[int64]bool{}}
	n := daysBetween(from, today) + 1
	if n <= 0 {
		return a, nil
	}
	rows, err := g.DB.Read.QueryContext(ctx, `WITH `+boundsCTE+`
		SELECT a.user_id, a.day FROM b JOIN active_days a ON a.day = b.day WHERE `+personDay, dayBoundsJSON(from, today))
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		var day string
		if err := rows.Scan(&id, &day); err != nil {
			rows.Close()
			return nil, err
		}
		d := daysBetween(from, day)
		if d < 0 || d >= n {
			continue
		}
		if a.played[id] == nil {
			a.played[id] = make([]bool, n)
		}
		a.played[id][d] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Who played before From, as any day kept says (one that wasn't a person's, that long ago, is too few to matter).
	ids := make([]int64, 0, len(a.played))
	for id := range a.played {
		ids = append(ids, id)
	}
	who, _ := json.Marshal(ids)
	rows, err = g.DB.Read.QueryContext(ctx, `SELECT value FROM json_each(?) j
		WHERE EXISTS (SELECT 1 FROM active_days WHERE user_id = j.value AND day < ?)`, string(who), from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		a.before[id] = true
	}
	return a, rows.Err()
}

// index is a day's place from From, or -1 outside.
func (a *Activity) index(day string) int {
	d := daysBetween(a.From, day)
	if d < 0 || d > daysBetween(a.From, a.Today) {
		return -1
	}
	return d
}

// On is how many played on a day.
func (a *Activity) On(day string) int {
	d, n := a.index(day), 0
	if d < 0 {
		return 0
	}
	for _, p := range a.played {
		if p[d] {
			n++
		}
	}
	return n
}

// Within is how many played on any day from `from` to `to` (both in, within the days read).
func (a *Activity) Within(from, to string) int {
	n := 0
	for id := range a.played {
		if a.playedWithin(id, from, to) {
			n++
		}
	}
	return n
}

func (a *Activity) playedWithin(id int64, from, to string) bool {
	p := a.played[id]
	for d := max(a.index(from), 0); d >= 0 && d < len(p) && DayShift(a.From, d) <= to; d++ {
		if p[d] {
			return true
		}
	}
	return false
}

// first is a player's first day played, if it's within the days read ("" if they played before them).
func (a *Activity) first(id int64) string {
	if a.before[id] {
		return ""
	}
	for d, on := range a.played[id] {
		if on {
			return DayShift(a.From, d)
		}
	}
	return ""
}

// Stickiness is how many play on a day, on average over the 28 days to `to` (both in), of those who played in them:
// one window for both.
func (a *Activity) Stickiness(to string) (daily float64, month int) {
	from := DayShift(to, -27)
	sum := 0
	for d := from; d <= to; d = DayShift(d, 1) {
		sum += a.On(d)
	}
	return float64(sum) / 28, a.Within(from, to)
}

// Growth is a week's players, by how they stand to the week before: new (their first day in it), kept (played the week
// before too), back (after a week or more away), and lost (played the week before, not in it).
type Growth struct {
	Week                  string // its Monday
	New, Kept, Back, Lost int
}

// Growth tells the weeks (from Monday) whose Monday is `weeks` weeks before the week of `to` or later, and over by `to`,
// newest first. The days read must begin a week before the first.
func (a *Activity) Growth(to string, weeks int) []Growth {
	var out []Growth
	this := WeekOf(DayShift(to, 1)) // the week `to` ends, if it's a Sunday; else the one it's in, not over
	for w := 1; w <= weeks; w++ {
		monday := DayShift(this, -7*w)
		if DayShift(monday, -7) < a.From {
			break
		}
		g := Growth{Week: monday}
		sunday, before := DayShift(monday, 6), DayShift(monday, -7)
		for id := range a.played {
			now := a.playedWithin(id, monday, sunday)
			was := a.playedWithin(id, before, DayShift(monday, -1))
			switch first := a.first(id); {
			case now && first >= monday && first <= sunday:
				g.New++
			case now && was:
				g.Kept++
			case now:
				g.Back++
			case was:
				g.Lost++
			}
		}
		out = append(out, g)
	}
	return out
}

// Habit is how many players finished the day's ten on at least 3 of the 7 days to `to` (both in): the habit the game
// is built for.
func (g *Game) Habit(ctx context.Context, to string) (int, error) {
	var n int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FROM (SELECT user_id FROM runs WHERE kind = 'day'
		AND finished_at IS NOT NULL AND day BETWEEN ? AND ? AND `+People+` GROUP BY user_id HAVING count(*) >= 3)`,
		DayShift(to, -6), to).Scan(&n)
	return n, err
}
