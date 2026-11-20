package play

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Measuring the first week (the admin page): not only whether players come back (retention.go), but what they did
// before they did or didn't, and how each part of the game is used. Four sources, none of them kept for this alone but
// the first two:
//
//   - daily_counts: a number a day for each thing counted that no other table keeps (Tally): a visit without a
//     profile by where it landed ("visit:home"), a guest made ("guest:player"), the reminder's ask on Начало
//     ("pushask:shown|yes|no", and by mail "mailask:shown|yes|no"), notifications sent and opened by kind
//     ("push:sent:day", "push:open:day"), the day's reminders mailed ("mail:day:sent"), the day's answers and those
//     to a question the player had answered before ("day:answers", "day:seen": none since the days are drawn ahead,
//     ahead.go). Nobody is in it.
//   - cohort_weeks: a week's newcomers' numbers, frozen once over (server/measure.go). Nobody is in it either.
//   - users.came_from: where a player first came in (Landings), set as their guest is made; users.first_version, the
//     version they met (markActive); runs.device, what each game was played on (FromDevice).
//   - what the game keeps anyway: the days played (active_days), the games (runs), notifications on (push_subs),
//     friends, the streaks (walkStreak), the reminders and mails sent or held (push_reminded, streak_mails:
//     experiment.go).

// Landings are where a player can first come in (users.came_from): the front page, a player's page, and anywhere
// else.
var Landings = []string{"home", "player", "other"}

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
	// It's in the one write, so it never walks a history: not the question's answers of the day (they grow with its
	// players), nor all the player's (they grow with the player). It reads the question's answers from before its day
	// (a question of the day is drawn from those nobody has answered: none, unless something went wrong), and the
	// player's games begun since the day before (CROSS JOIN keeps that order): a few.
	dayStart, _ := time.ParseInLocation(time.DateOnly, r.day, Bulgaria)
	err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM answers a INDEXED BY answers_question JOIN runs o ON o.id = a.run_id
			WHERE a.question_id = ?3 AND a.at < ?4 AND o.user_id = ?1)
		OR EXISTS (SELECT 1 FROM runs o CROSS JOIN answers a ON a.run_id = o.id
			WHERE o.user_id = ?1 AND o.started_at >= ?5 AND o.id <> ?2 AND a.question_id = ?3)`,
		r.userID, r.id, r.picks[r.at].ID, store.Ms(dayStart), store.Ms(dayStart.AddDate(0, 0, -1))).Scan(&seen)
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

// Newcomer is a player in their first weeks: when they first played (answered a question), where they came from, the
// version they met, and what they did then. Day N is N days after the first (day 0).
type Newcomer struct {
	First    string
	CameFrom string // one of Landings; "" when not known
	Version  string // the game's version on their first day ("" when not known)
	Device   string // what their first game was played on (one of Devices; "" when not known)
	// By the end of the first day: notifications on (a browser or the app); a friend.
	Push, Friend bool
	// The kind of the first game ("day", "topic", "duel" …), and whether it was finished.
	FirstKind     string
	FirstFinished bool
	// Games begun on the first day (with a question answered).
	Games int
	// The kinds of games played in the first week (days 0 to 6).
	Kinds map[string]bool
	// Played on day N (0 to 90).
	Played [91]bool
	// Finished the day's ten on day N (0 to 7).
	DayTen [8]bool
	// How many days since the first are over: day N can be told once N < Over (today's, still under way, would read
	// low).
	Over int
}

// Due says whether day n is over.
func (n Newcomer) Due(day int) bool { return day < n.Over }

// BackWithin says whether the player played on any day from a to b (both in).
func (n Newcomer) BackWithin(a, b int) bool {
	for d := a; d <= b && d < len(n.Played); d++ {
		if n.Played[d] {
			return true
		}
	}
	return false
}

// DayTens is on how many of the first seven days the player finished the day's ten.
func (n Newcomer) DayTens() int {
	k := 0
	for _, d := range n.DayTen[:7] {
		if d {
			k++
		}
	}
	return k
}

// DayTenAgain says whether the player finished the day's ten again on any of days 1 to 7.
func (n Newcomer) DayTenAgain() bool {
	for _, d := range n.DayTen[1:] {
		if d {
			return true
		}
	}
	return false
}

// Newcomers are the players whose first day played (as Activity reads them: people only) is on or after `since`,
// oldest first.
func (g *Game) Newcomers(ctx context.Context, act *Activity, since string) ([]Newcomer, error) {
	db := g.DB.Read
	byID := map[int64]*Newcomer{}
	var ids []int64
	for id := range act.played {
		first := act.first(id)
		if first == "" || first < since {
			continue
		}
		n := &Newcomer{First: first, Over: daysBetween(first, act.Today), Kinds: map[string]bool{}}
		for d := range n.Played {
			if i := act.index(DayShift(first, d)); i >= 0 {
				n.Played[d] = act.played[id][i]
			}
		}
		byID[id] = n
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, nil
	}
	slices.SortFunc(ids, func(a, b int64) int {
		return cmp.Or(strings.Compare(byID[a].First, byID[b].First), cmp.Compare(a, b))
	})
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
	err := each(`SELECT id, coalesce(came_from, ''), coalesce(first_version, '') FROM users
		WHERE id IN (SELECT value FROM json_each(?1))`,
		func(rows *sql.Rows) (int64, func(*Newcomer), error) {
			var id int64
			var from, version string
			err := rows.Scan(&id, &from, &version)
			return id, func(n *Newcomer) { n.CameFrom, n.Version = from, version }, err
		})
	if err != nil {
		return nil, err
	}
	sinceMs, _ := dayBounds(since)
	err = each(`SELECT user_id, kind, coalesce(day, ''), started_at, finished_at IS NOT NULL, coalesce(device, '') FROM runs
		WHERE user_id IN (SELECT value FROM json_each(?1)) AND started_at >= ?2 AND at > 0 AND `+personRun+`
		ORDER BY started_at`,
		func(rows *sql.Rows) (int64, func(*Newcomer), error) {
			var id, at int64
			var kind, day, device string
			var finished bool
			err := rows.Scan(&id, &kind, &day, &at, &finished, &device)
			return id, func(n *Newcomer) {
				started := daysBetween(n.First, time.UnixMilli(at).In(Bulgaria).Format(time.DateOnly))
				if started < 0 {
					return
				}
				if n.FirstKind == "" {
					n.FirstKind, n.FirstFinished = kind, finished
				}
				if started == 0 {
					n.Games++
					if n.Device == "" {
						n.Device = device
					}
				}
				if started < 7 {
					n.Kinds[kind] = true
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
	err = each(`SELECT user_id, min(created_at) FROM push_subs WHERE user_id IN (SELECT value FROM json_each(?1))
		GROUP BY user_id`,
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

// StreakHealth is how the streaks go: those going on now, and over the days measured, the days missed that the streaks
// forgave and the streaks that ended, by the bands of StreakBands.
type StreakHealth struct {
	Going    []int
	Forgiven int
	Ended    []int
}

// StreakHealth tells the streaks going on now, and those ended and the days forgiven over the last `days` days
// (today, not over yet, not among them).
func (g *Game) StreakHealth(ctx context.Context, days int) (StreakHealth, error) {
	h := StreakHealth{Going: make([]int, len(StreakBands)), Ended: make([]int, len(StreakBands))}
	today := g.Today()
	from := DayShift(today, -days)
	// Whoever's streak was alive in the days measured finished a day's ten no more than MostForgiven days before them.
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT DISTINCT user_id FROM runs WHERE kind = 'day' AND finished_at IS NOT NULL
		AND day >= ?`, DayShift(from, -MostForgiven-1))
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
		days, err := g.streakDays(ctx, id)
		if err != nil {
			return h, err
		}
		if days.first == "" {
			continue
		}
		s := walkStreak(days, today, func(day string, forgiven bool, ended int) {
			if day < from {
				return
			}
			if forgiven {
				h.Forgiven++
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

// DayGames are a day's games by people (People: fair.go), by kind, and of the players
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
		FROM runs WHERE started_at >= ? AND at > 0 AND `+People, fromMs)
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

// Use is how a part of the game is used over some days: by how many players, in how many games (begun, with a
// question answered), and of those, how many finished.
type Use struct {
	Players, Games, Finished int
}

// Uses are the games of people (People) begun over some days, by kind (ByKind), by the device they were played on
// (ByDevice; "" where it isn't known), and the day's ten alone by device (DayByDevice).
type Uses struct {
	ByKind, ByDevice, DayByDevice map[string]Use
}

// UsesSince tells the Uses of the games begun from `from` (a day) to now.
func (g *Game) UsesSince(ctx context.Context, from string) (Uses, error) {
	u := Uses{ByKind: map[string]Use{}, ByDevice: map[string]Use{}, DayByDevice: map[string]Use{}}
	fromMs, _ := dayBounds(from)
	for _, q := range []struct {
		into         map[string]Use
		group, where string
	}{
		{u.ByKind, "kind", ""},
		{u.ByDevice, "coalesce(device, '')", ""},
		{u.DayByDevice, "coalesce(device, '')", " AND kind = 'day'"},
	} {
		rows, err := g.DB.Read.QueryContext(ctx, `SELECT `+q.group+`, count(DISTINCT user_id), count(*), count(finished_at)
			FROM runs WHERE started_at >= ? AND at > 0 AND `+People+q.where+` GROUP BY 1`, fromMs)
		if err != nil {
			return u, err
		}
		for rows.Next() {
			var k string
			var x Use
			if err := rows.Scan(&k, &x.Players, &x.Games, &x.Finished); err != nil {
				rows.Close()
				return u, err
			}
			q.into[k] = x
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return u, err
		}
	}
	return u, nil
}
