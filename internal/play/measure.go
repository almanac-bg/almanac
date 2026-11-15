package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// Measuring the first week (the admin page): not only whether players come back (retention.go), but what they did
// before they did or didn't. Three sources, none of them kept for this alone but the first:
//
//   - daily_counts: a number a day for each thing counted that no other table keeps (Tally): a visit without a
//     profile by where it landed ("visit:home"), a guest made ("guest:invite"), a share of the day ("share:day"),
//     the reminder's ask on Начало ("pushask:shown|yes|no|home"), notifications sent and opened by kind
//     ("push:sent:day", "push:open:day"), the day's answers and those to a question the player had answered before
//     ("day:answers", "day:seen": none since the days are drawn ahead, ahead.go). Nobody is in it.
//   - users.came_from: where a player first came in (Landings), set as their guest is made.
//   - what the game keeps anyway: the days played (active_days), the games (runs), notifications on (push_subs,
//     phones), friends, the streaks (walkStreak).

// Landings are where a player can first come in (users.came_from): the front page, a shared day's link, an invite, a
// room's link, a player's page, the game's app, and anywhere else.
var Landings = []string{"home", "share", "invite", "room", "player", "app", "other"}

// Tally counts n of something today (daily_counts).
func (g *Game) Tally(ctx context.Context, key string, n int) error {
	_, err := g.DB.Write.ExecContext(ctx, tallySQL, g.Today(), key, n)
	return err
}

// tally counts one of something today, inside a transaction.
func (g *Game) tally(tx *sql.Tx, key string) error {
	_, err := tx.Exec(tallySQL, g.Today(), key, 1)
	return err
}

const tallySQL = `INSERT INTO daily_counts (day, key, n) VALUES (?, ?, ?) ON CONFLICT (day, key) DO UPDATE SET n = n + excluded.n`

// tallyDayAnswer counts an answer to the day's questions, and apart, one to a question the player had answered before
// in another game: the day is one attempt for everyone only while that stays at none (ahead.go).
func (g *Game) tallyDayAnswer(tx *sql.Tx, r *run) error {
	if err := g.tally(tx, "day:answers"); err != nil {
		return err
	}
	var seen bool
	err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM answers a JOIN runs o ON o.id = a.run_id
		WHERE a.question_id = ? AND o.user_id = ? AND a.run_id <> ?)`, r.picks[r.at].ID, r.userID, r.id).Scan(&seen)
	if err != nil || !seen {
		return err
	}
	return g.tally(tx, "day:seen")
}

// Tallies are the counts of the days from `from` to `to` (both in), each key's added up.
func (g *Game) Tallies(ctx context.Context, from, to string) (map[string]int, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT key, sum(n) FROM daily_counts WHERE day BETWEEN ? AND ? GROUP BY key`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var key string
		var n int
		if err := rows.Scan(&key, &n); err != nil {
			return nil, err
		}
		out[key] = n
	}
	return out, rows.Err()
}

// DayShift is the day n days after a day (before, for n < 0), as the days are kept (YYYY-MM-DD).
func DayShift(day string, n int) string {
	t, _ := time.Parse(time.DateOnly, day)
	return t.AddDate(0, 0, n).Format(time.DateOnly)
}

// WeekOf is the Monday of a day's week (YYYY-MM-DD).
func WeekOf(day string) string {
	t, _ := time.Parse(time.DateOnly, day)
	return t.AddDate(0, 0, -((int(t.Weekday()) + 6) % 7)).Format(time.DateOnly)
}

// Newcomer is a player in their first days: when they first played (answered a question), where they came from, and
// what they did then. Day N is N days after the first (day 0).
type Newcomer struct {
	First    string
	CameFrom string // one of Landings; "" when not known
	// By the end of the first day: notifications on (a browser or the app); a friend.
	Push, Friend bool
	// The kind of the first game ("day", "topic", "duel" …).
	FirstKind string
	// Games begun on the first day (with a question answered).
	Games int
	// Played on day N (0 to 30).
	Played [31]bool
	// Finished the day's ten on day N (0 to 6).
	DayTen [7]bool
	// How many days since the first are over: day N can be told once N < Over (today's, still under way, would read
	// low).
	Over int
}

// Due says whether day n is over.
func (n Newcomer) Due(day int) bool { return day < n.Over }

// BackWithin says whether the player played on any day from a to b (both in).
func (n Newcomer) BackWithin(a, b int) bool {
	for d := a; d <= b; d++ {
		if n.Played[d] {
			return true
		}
	}
	return false
}

// DayTens is on how many of the first seven days the player finished the day's ten.
func (n Newcomer) DayTens() int {
	k := 0
	for _, d := range n.DayTen {
		if d {
			k++
		}
	}
	return k
}

// Newcomers are the players whose first day played is on or after `since`, oldest first.
func (g *Game) Newcomers(ctx context.Context, since string) ([]Newcomer, error) {
	db := g.DB.Read
	today := g.Today()
	rows, err := db.QueryContext(ctx, `SELECT user_id, min(day) d FROM active_days GROUP BY user_id HAVING d >= ?
		ORDER BY d, user_id`, since)
	if err != nil {
		return nil, err
	}
	byID := map[int64]*Newcomer{}
	var ids []int64
	for rows.Next() {
		var id int64
		var first string
		if err := rows.Scan(&id, &first); err != nil {
			rows.Close()
			return nil, err
		}
		byID[id] = &Newcomer{First: first, Over: daysBetween(first, today)}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(ids) == 0 {
		return nil, err
	}
	who, _ := json.Marshal(ids)
	// each reads a query's rows about these players (its first argument is them, as JSON); scan reads one row and
	// says whose it is, and what it tells of them.
	each := func(query string, scan func(*sql.Rows) (int64, func(*Newcomer), error), args ...any) error {
		rows, err := db.QueryContext(ctx, query, append([]any{string(who)}, args...)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			id, tell, err := scan(rows)
			if err != nil {
				return err
			}
			if n := byID[id]; n != nil {
				tell(n)
			}
		}
		return rows.Err()
	}
	err = each(`SELECT user_id, day FROM active_days WHERE user_id IN (SELECT value FROM json_each(?1))`,
		func(rows *sql.Rows) (int64, func(*Newcomer), error) {
			var id int64
			var day string
			err := rows.Scan(&id, &day)
			return id, func(n *Newcomer) {
				if d := daysBetween(n.First, day); d >= 0 && d < len(n.Played) {
					n.Played[d] = true
				}
			}, err
		})
	if err != nil {
		return nil, err
	}
	err = each(`SELECT id, coalesce(came_from, '') FROM users WHERE id IN (SELECT value FROM json_each(?1))`,
		func(rows *sql.Rows) (int64, func(*Newcomer), error) {
			var id int64
			var from string
			err := rows.Scan(&id, &from)
			return id, func(n *Newcomer) { n.CameFrom = from }, err
		})
	if err != nil {
		return nil, err
	}
	sinceMs, _ := dayBounds(since)
	err = each(`SELECT user_id, kind, coalesce(day, ''), started_at, finished_at IS NOT NULL FROM runs
		WHERE user_id IN (SELECT value FROM json_each(?1)) AND started_at >= ?2 AND at > 0 ORDER BY started_at`,
		func(rows *sql.Rows) (int64, func(*Newcomer), error) {
			var id, at int64
			var kind, day string
			var finished bool
			err := rows.Scan(&id, &kind, &day, &at, &finished)
			return id, func(n *Newcomer) {
				started := time.UnixMilli(at).In(Bulgaria).Format(time.DateOnly)
				if started < n.First {
					return
				}
				if n.FirstKind == "" {
					n.FirstKind = kind
				}
				if started == n.First {
					n.Games++
				}
				if d := daysBetween(n.First, day); kind == "day" && finished && d >= 0 && d < len(n.DayTen) {
					n.DayTen[d] = true
				}
			}, err
		}, sinceMs)
	if err != nil {
		return nil, err
	}
	// Notifications on, and a friend, by the end of the first day.
	byFirstDay := func(set func(*Newcomer)) func(*sql.Rows) (int64, func(*Newcomer), error) {
		return func(rows *sql.Rows) (int64, func(*Newcomer), error) {
			var id, at int64
			err := rows.Scan(&id, &at)
			return id, func(n *Newcomer) {
				if _, end := dayBounds(n.First); at < end {
					set(n)
				}
			}, err
		}
	}
	err = each(`SELECT user_id, min(created_at) FROM (SELECT user_id, created_at FROM push_subs UNION ALL
		SELECT user_id, created_at FROM phones) WHERE user_id IN (SELECT value FROM json_each(?1)) GROUP BY user_id`,
		byFirstDay(func(n *Newcomer) { n.Push = true }))
	if err != nil {
		return nil, err
	}
	err = each(`SELECT user_id, min(since) FROM friends WHERE user_id IN (SELECT value FROM json_each(?1)) GROUP BY user_id`,
		byFirstDay(func(n *Newcomer) { n.Friend = true }))
	if err != nil {
		return nil, err
	}
	out := make([]Newcomer, 0, len(ids))
	for _, id := range ids {
		out = append(out, *byID[id])
	}
	return out, nil
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

// StreakBands are where the bands of streaks' lengths begin: 1–2 days, 3–6, 7–29, 30 and more.
var StreakBands = []int{1, 3, 7, 30}

// StreakBand is the band of StreakBands a streak of so many days is in.
func StreakBand(days int) int {
	b := 0
	for i, from := range StreakBands {
		if days >= from {
			b = i
		}
	}
	return b
}

// StreakHealth is how the streaks go: those going on now, and over the days measured, the reserve days spent and the
// streaks that ended, by the bands of StreakBands.
type StreakHealth struct {
	Going []int
	Spent int
	Ended []int
}

// StreakHealth tells the streaks going on now, and those ended and the reserve days spent over the last `days` days
// (today, not over yet, not among them).
func (g *Game) StreakHealth(ctx context.Context, days int) (StreakHealth, error) {
	h := StreakHealth{Going: make([]int, len(StreakBands)), Ended: make([]int, len(StreakBands))}
	today := g.Today()
	from := DayShift(today, -days)
	// Whoever's streak was alive in the days measured finished a day's ten no more than ReserveMax days before them.
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT DISTINCT user_id FROM runs WHERE kind = 'day' AND finished_at IS NOT NULL
		AND day >= ?`, DayShift(from, -ReserveMax-1))
	if err != nil {
		return h, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return h, err
	}
	for _, id := range ids {
		played, full, first, err := g.streakDays(ctx, id)
		if err != nil {
			return h, err
		}
		if first == "" {
			continue
		}
		s := walkStreak(played, full, first, today, func(day string, spent bool, ended int) {
			if day < from {
				return
			}
			if spent {
				h.Spent++
			} else {
				h.Ended[StreakBand(ended)]++
			}
		})
		if s.Days > 0 {
			h.Going[StreakBand(s.Days)]++
		}
	}
	return h, nil
}

// DayGames are a day's games by people (not those played at a script's speed: fair.go), by kind, and of the players
// who finished the day's ten, how many played nothing else.
type DayGames struct {
	Day           string
	Kinds         map[string]int
	DayPlayers    int
	OnlyDayPlayer int
}

// Games are the games of the last `days` days (today with them, newest first).
func (g *Game) Games(ctx context.Context, days int) ([]DayGames, error) {
	today := g.Today()
	from := DayShift(today, -days+1)
	fromMs, _ := dayBounds(from)
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT user_id, kind, started_at, kind = 'day' AND finished_at IS NOT NULL
		FROM runs WHERE started_at >= ? AND at > 0 AND NOT scripted`, fromMs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type mix struct{ day, other bool }
	byDay := map[string]*DayGames{}
	players := map[string]map[int64]*mix{}
	out := make([]DayGames, days)
	for i := range out {
		day := DayShift(today, -i)
		out[i] = DayGames{Day: day, Kinds: map[string]int{}}
		byDay[day] = &out[i]
		players[day] = map[int64]*mix{}
	}
	for rows.Next() {
		var id, at int64
		var kind string
		var dayTen bool
		if err := rows.Scan(&id, &kind, &at, &dayTen); err != nil {
			return nil, err
		}
		day := time.UnixMilli(at).In(Bulgaria).Format(time.DateOnly)
		d := byDay[day]
		if d == nil {
			continue
		}
		d.Kinds[kind]++
		m := players[day][id]
		if m == nil {
			m = &mix{}
			players[day][id] = m
		}
		if dayTen {
			m.day = true
		} else if kind != "day" {
			m.other = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for day, ps := range players {
		for _, m := range ps {
			if m.day {
				byDay[day].DayPlayers++
				if !m.other {
					byDay[day].OnlyDayPlayer++
				}
			}
		}
	}
	return out, nil
}
