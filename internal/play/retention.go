package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// Retention is whether players come back: the game's measure of itself, and the one /admin tells (DayCounts). A
// player's days are the days (in Bulgaria) they played on — reached a question in any game: answered it, gave it up or
// let its time run out — kept in active_days as they happen (markActive).
//
// /admin counts people, one population on the whole page but its shares, which are anyone's, the owner's too, since
// any link may bring players (People, fair.go): a day counts when the player isn't an admin and played a game as a
// person that day, not at a script's speed. That is judged as the days are read (personDays), never as they're kept: a
// game becomes a script's only after some of its answers, and may be let out of it. A player who goes leaves their days as nobody's (Forget), judged as they go: only those that counted are kept.

// markActive keeps that a player played on the day of `at`: when an answer came, or when a question's time ran out,
// however much later that's settled (settle).
func (g *Game) markActive(tx *sql.Tx, userID int64, at time.Time) error {
	_, err := tx.Exec(`INSERT OR IGNORE INTO active_days (user_id, day) VALUES (?, ?)`, userID, dayOf(at))
	return err
}

// personLeeway is how long before a day a game may have started and still count for it: a game begun just before
// midnight and answered after it played the day after.
const personLeeway = time.Hour

// personDay is the SQL condition (on a.user_id, and the day's bounds b.s and b.e in ms) that a day in active_days
// counts as a person's: one gone (a tombstone, judged as they went) or, for a player who isn't an admin, a game played
// as a person (personRun) that day.
var personDay = `(a.user_id < 0 OR (NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id AND u.admin)
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

// Activity is who played on which days from From to Today (both in), people only (personDay), who had played
// before From, and whose first game was played by a shared link (markByLink).
type Activity struct {
	From, Today string
	played      map[int64][]bool // by player, a day each from From
	before      map[int64]bool
	byLink      map[int64]bool
}

// Activity reads the days people played from `from` to today.
func (g *Game) Activity(ctx context.Context, from string) (*Activity, error) {
	today := g.Today()
	a := &Activity{From: from, Today: today, played: map[int64][]bool{}, before: map[int64]bool{}, byLink: map[int64]bool{}}
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
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		a.before[id] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Of the new (who hadn't played before From), whose first game, as it stands (a guest's games brought to an older
	// account come after the account's), was played by a shared link, at a person's pace.
	ids = ids[:0]
	for id := range a.played {
		if !a.before[id] {
			ids = append(ids, id)
		}
	}
	who, _ = json.Marshal(ids)
	rows, err = g.DB.Read.QueryContext(ctx, `SELECT value FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM runs_by_link l
		JOIN runs r ON r.id = l.run_id WHERE r.`+personRun+`
			AND l.run_id = (SELECT id FROM runs WHERE user_id = j.value ORDER BY started_at, id LIMIT 1))`, string(who))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		a.byLink[id] = true
	}
	return a, rows.Err()
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

// Backs are the days after a player's first that /admin tells whether they played on again: D1, D7, D30.
var Backs = [3]int{1, 7, 30}

// DayCount is a day of /admin's table: how many played on it, how many of them for the first time, of those new how
// many came by a shared link (their first game played by one: markByLink), and how many played again on each of the
// days Backs after it (Due: whether that day is over yet).
type DayCount struct {
	Day                 string
	Played, New, ByLink int
	Back                [3]int
	Due                 [3]bool
}

// DayCounts are the counts of the days the Activity read, newest first: today, under way, with them. A player is new on
// their first day played, if it's within the days read (one who played before them isn't new in them).
func (a *Activity) DayCounts() []DayCount {
	n := daysBetween(a.From, a.Today) + 1
	out := make([]DayCount, n)
	for d := range out {
		out[n-1-d].Day = DayShift(a.From, d)
	}
	for id, days := range a.played {
		first := -1
		if f := a.first(id); f != "" {
			first = daysBetween(a.From, f)
		}
		for d, on := range days {
			if !on {
				continue
			}
			c := &out[n-1-d]
			c.Played++
			if d != first {
				continue
			}
			c.New++
			if a.byLink[id] {
				c.ByLink++
			}
			for k, after := range Backs {
				if d+after < len(days) && days[d+after] {
					c.Back[k]++
				}
			}
		}
	}
	for i := range out {
		for k, after := range Backs {
			out[i].Due[k] = DayShift(out[i].Day, after) < a.Today
		}
	}
	return out
}

// DayShift is the day n days after a day (before, for n < 0), as the days are kept (YYYY-MM-DD).
func DayShift(day string, n int) string {
	t, _ := time.Parse(time.DateOnly, day)
	return t.AddDate(0, 0, n).Format(time.DateOnly)
}

// daysBetween is how many days `to` is after `from` (both YYYY-MM-DD; negative when before).
func daysBetween(from, to string) int {
	a, err1 := time.Parse(time.DateOnly, from)
	b, err2 := time.Parse(time.DateOnly, to)
	if err1 != nil || err2 != nil {
		return -1
	}
	return int(b.Sub(a).Hours() / 24)
}
