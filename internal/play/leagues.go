package play

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Leagues are a race every week on the day's questions. A week runs Monday to Sunday in Bulgaria. A player's first
// finished run of the day's questions in a week puts them in a group of up to GroupSize players of their league,
// filled in the order they come; the group races on the right answers each gives to the day's questions that week,
// added up day by day, as the day's own board does (board.go): more right answers never lose to fewer but faster
// (owner, 2026-11-18, review E3). On equal right answers the week's points decide, then who came first. Points add up
// across games nowhere else (worth.go): here they're the same questions for everyone in the group, and a day missed
// adds nothing. Whatever else a player plays (topics, duels, Роял) is theirs for XP and the rating, never the league's:
// what wins a week is playing the day, every day, and playing it well.
//
// Groups fill in the order players come, so a league's last group may be small. A group of fewer than RaceSize races
// with the group before it in its league (races): one race, one standings, its places, moves and pay counted over both,
// so that nobody spends a week alone in a group that's only gathering (review E7). Only a league's one group can be
// too small for a race; then it is no race: nobody in it moves or is paid for a place, its first place unlocks nothing,
// and its players see only that it's still gathering.
//
// When the week ends the first of each race go up a league and the last go down (moves: how many, by the race's
// size); the first three are paid XP (LeaguePay), and everyone is told how their week ended. Only a week played in a
// player's own league moves them down: a guest who signs in brings a group only of the account's league (merge.go),
// and an account raised to a guest's higher league meanwhile keeps it, or goes higher. A week not played changes
// nothing.
//
// A week is its days' runs, whenever they finish: Sunday's questions begun before midnight are Sunday's, though
// finished after it (DayGrace). So a week closes only once no run of its last day can still be answered (weekLate,
// some minutes into Monday), and until then it's the week open (league_week), the one the league shows: nobody joins
// the next one before it closes, since the close moves the leagues they'd join in. A run is put in its own day's week
// (after.go), while that week is open; whoever finished one and isn't in a group by the close (a Monday's run while the
// week before closed, what followed a run cut off) is seated by the close, the closing week's before its places are
// counted, the new week's in their new league once it opens (seatPlayed).
//
// The close is written a few races at a time (closeBatch), each race's places, moves, pay and news in one write
// with them, so that it never holds the single writer for long at the day's busiest minute; cut off half-way, it goes
// on where it stopped, nothing kept or told twice, and the next week opens once all of it is kept.
//
// A day's run played at a script's speed (fair.go) races for its player alone: its points are in the week as they see
// it, and in the place they're told and paid for at its end, never in anyone else's (standingsFor).
//
// The leagues are six mountains, from the lowest highest peak to the highest: Странджа to Рила. They aren't metals,
// so that they don't read as the rating's divisions: the rating is strength (rating.go), the league is the day's
// habit. First place in the top leagues unlocks frames (wardrobe.go), and in Рила a title that counts how many times
// (titles.go).

// League is one of the leagues: its tier (0, the lowest, to 5) and its name.
type League struct {
	Tier int    `json:"tier"`
	Name string `json:"name"`
}

// Leagues from the lowest: by each range's highest peak.
var Leagues = []League{
	{0, "Странджа"},
	{1, "Средна гора"},
	{2, "Родопи"},
	{3, "Стара планина"},
	{4, "Пирин"},
	{5, "Рила"},
}

// TopLeague is the highest league's tier.
var TopLeague = len(Leagues) - 1

// leagueOf is the league of a tier, kept within the leagues there are.
func leagueOf(tier int) League { return Leagues[max(0, min(tier, TopLeague))] }

// GroupSize is how many a group takes: enough for a race, few enough to know the names. A race is a group, or (its
// league's last, gathering) two: up to GroupSize + RaceSize - 1.
const GroupSize = 20

// RaceSize is how many a race needs: fewer (a league's one group, small), and nobody moves or is paid for a place, and
// the group isn't shown.
const RaceSize = 5

// LeaguePay is what the first three places of a week pay, in a race of RaceSize or more.
var LeaguePay = [3]int{300, 200, 100}

// weekLate is how long after its end a week closes: once no run of its last day can still be answered (dayLate), and
// a minute more for the last of them to be kept.
const weekLate = dayLate + time.Minute

// closeBatch is about how many players' places one write of a week's close keeps: whole groups, up to it.
var closeBatch = 500

// moves are how many of a group of n go up and down when the week ends: five each way in a full group; in a smaller
// one the first quarter up (none under RaceSize) and, from eight, the last quarter down.
func moves(n int) (up, down int) {
	switch {
	case n >= 10:
		up = 5
	case n >= RaceSize:
		up = (n + 3) / 4
	}
	switch {
	case n >= 15:
		down = 5
	case n >= 8:
		down = n / 4
	}
	return up, down
}

// weekOf is the week a moment is in: its Monday, in Bulgaria (YYYY-MM-DD).
func weekOf(t time.Time) string {
	t = t.In(Bulgaria)
	return t.AddDate(0, 0, -((int(t.Weekday()) + 6) % 7)).Format(time.DateOnly)
}

// weekOfDay is the week a day (YYYY-MM-DD) is in.
func weekOfDay(day string) string {
	t, _ := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	return weekOf(t)
}

// weekBounds are a week's start and the next one's, in Bulgaria.
func weekBounds(week string) (time.Time, time.Time) {
	from, _ := time.ParseInLocation(time.DateOnly, week, Bulgaria)
	return from, from.AddDate(0, 0, 7)
}

// nextWeek is the week after a week.
func nextWeek(week string) string {
	_, next := weekBounds(week)
	return next.Format(time.DateOnly)
}

// weekDue is whether a week is due to close at a moment: over, and its last day's runs all in (weekLate).
func weekDue(week string, now time.Time) bool {
	_, end := weekBounds(week)
	return !now.Before(end.Add(weekLate))
}

// weekDays is a SQL condition on a run (r) of a player (a column): a finished run of the day's questions of a week.
// ?1 and ?2 are the week's first day and the next week's (YYYY-MM-DD: weekArgs).
func weekDays(user string) string {
	return `r.user_id = ` + user + ` AND r.kind = 'day' AND r.day >= ?1 AND r.day < ?2 AND r.finished_at IS NOT NULL`
}

// weekArgs are the arguments of weekDays for a week.
func weekArgs(week string) []any {
	from, to := weekBounds(week)
	return []any{from.Format(time.DateOnly), to.Format(time.DateOnly)}
}

// rowQuerier reads one row: a database or a transaction.
type rowQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// LeagueNews is told to each player in a week when it ends.
type LeagueNews struct {
	To    int64
	Week  string
	From  League // the league the week was played in
	Now   League // the one they're in now
	Place int
	Of    int
	XP    int
}

// standing is a player's place in a race: who, the week's points and right answers as the others see them, theirs
// as they see them (with their runs played at a script's speed), and when they came.
type standing struct {
	user                 int64
	points, rights       int
	ownPoints, ownRights int
	joined               int64
}

// byPlace orders standings the first first: more right answers, then more points, then who came first.
func byPlace(a, b standing) int {
	return cmp.Or(cmp.Compare(b.rights, a.rights), cmp.Compare(b.points, a.points), cmp.Compare(a.joined, b.joined),
		cmp.Compare(a.user, b.user))
}

// raceStandings are a race's players (its groups': leagueRace) by the week as the others see it, the first first
// (byPlace).
func raceStandings(ctx context.Context, q querier, week string, groups []int64) ([]standing, error) {
	sum := func(column, viewer string) string {
		return `coalesce((SELECT sum(r.` + column + `) FROM runs r WHERE ` + weekDays("m.user_id") + ` AND ` +
			fairFor("r", viewer) + `), 0)`
	}
	in := strings.Repeat(", ?", len(groups))[2:]
	args := weekArgs(week)
	for _, id := range groups {
		args = append(args, id)
	}
	rows, err := q.QueryContext(ctx, `SELECT m.user_id, `+sum("points", "0")+`, `+sum("rights", "0")+`, `+
		sum("points", "m.user_id")+`, `+sum("rights", "m.user_id")+`, m.joined_at FROM league_members m
		WHERE m.group_id IN (`+in+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []standing
	for rows.Next() {
		var s standing
		if err := rows.Scan(&s.user, &s.points, &s.rights, &s.ownPoints, &s.ownRights, &s.joined); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	slices.SortFunc(out, byPlace)
	return out, rows.Err()
}

// standingsFor is a race's standings as one of its players sees them: their own week with everything they played,
// everyone else's as the others see it. A player whose runs are all a person's sees the race as everyone does.
func standingsFor(list []standing, viewer int64) []standing {
	out := slices.Clone(list)
	for i := range out {
		if out[i].user == viewer {
			out[i].points, out[i].rights = out[i].ownPoints, out[i].ownRights
		}
	}
	slices.SortStableFunc(out, byPlace)
	return out
}

// leagueRace is who race together in a week: a group, or a league's last group (of fewer than RaceSize) with the one
// before it; their league's tier, and how many they are.
type leagueRace struct {
	groups     []int64
	tier, size int
}

// races are a week's groups (by league, then as they opened) as they race: a group of fewer than RaceSize joins the
// race before it in its league, if there is one.
func races(groups []leagueGroup) []leagueRace {
	var out []leagueRace
	for _, gr := range groups {
		if last := len(out) - 1; last >= 0 && out[last].tier == gr.tier && gr.size < RaceSize {
			out[last].groups = append(out[last].groups, gr.id)
			out[last].size += gr.size
			continue
		}
		out = append(out, leagueRace{groups: []int64{gr.id}, tier: gr.tier, size: gr.size})
	}
	return out
}

// weekGroups are a week's groups, of one league (tier 0 and up) or all (-1), by league and then as they opened, with
// how many are in each.
func weekGroups(ctx context.Context, q querier, week string, tier int) ([]leagueGroup, error) {
	rows, err := q.QueryContext(ctx, `SELECT g.id, g.tier, (SELECT count(*) FROM league_members m
		WHERE m.group_id = g.id) FROM league_groups g WHERE g.week = ?1 AND (?2 < 0 OR g.tier = ?2)
		ORDER BY g.tier, g.id`, week, tier)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []leagueGroup
	for rows.Next() {
		var gr leagueGroup
		if err := rows.Scan(&gr.id, &gr.tier, &gr.size); err != nil {
			return nil, err
		}
		groups = append(groups, gr)
	}
	return groups, rows.Err()
}

// ensureWeek closes the week open if it's due (weekDue), and any after it that are due too (the server was off), and
// knows the week open after: it runs every minute and before anything about a week, and is cheap until a week is due.
// Whoever comes first closes it, to the end: a request whose player leaves meanwhile doesn't stop it. Nobody joins a
// week while one closes (weekMu).
func (g *Game) ensureWeek(ctx context.Context) error {
	now := g.Now()
	g.weekMu.RLock()
	known := g.week
	g.weekMu.RUnlock()
	if known != "" && !weekDue(known, now) {
		return nil
	}
	g.weekMu.Lock()
	defer g.weekMu.Unlock()
	if g.week != "" && !weekDue(g.week, now) {
		return nil
	}
	ctx = context.WithoutCancel(ctx)
	var open string
	err := g.DB.Write.QueryRowContext(ctx, `SELECT id FROM league_week`).Scan(&open)
	if errors.Is(err, sql.ErrNoRows) {
		open = weekOf(now.Add(-weekLate))
		_, err = g.DB.Write.ExecContext(ctx, `INSERT INTO league_week (id) VALUES (?)`, open)
	}
	if err != nil {
		return err
	}
	for weekDue(open, now) {
		if err := g.closeWeek(ctx, open); err != nil {
			return err
		}
		open = nextWeek(open)
	}
	// A week new to this server (just opened, or the server just started): whoever finished a run of it and isn't
	// seated yet (a Monday's, while the week before closed) is seated now.
	if g.week != open {
		if err := g.seatPlayed(ctx, open); err != nil {
			return err
		}
	}
	g.week = open
	return nil
}

// leagueGroup is a group of a week: its id, its league's tier, and how many are in it.
type leagueGroup struct {
	id         int64
	tier, size int
}

// closeWeek ends a week of the leagues: whoever played it is seated (seatPlayed), every race's places are kept, the
// leagues move and the places pay, and each player's news is handed on (LeagueNews), a few races at a time
// (closeRaces), a race's groups always together; then the next week opens. Done again after a failure, it goes on
// where it stopped.
func (g *Game) closeWeek(ctx context.Context, week string) error {
	if err := g.seatPlayed(ctx, week); err != nil {
		return err
	}
	groups, err := weekGroups(ctx, g.DB.Read, week, -1)
	if err != nil {
		return err
	}
	list := races(groups)
	for len(list) > 0 {
		n, size := 0, 0
		for n < len(list) && (n == 0 || size+list[n].size <= closeBatch) {
			size += list[n].size
			n++
		}
		if err := g.closeRaces(ctx, week, list[:n]); err != nil {
			return err
		}
		list = list[n:]
	}
	_, err = g.DB.Write.ExecContext(ctx, `UPDATE league_week SET id = ? WHERE id = ?`, nextWeek(week), week)
	return err
}

// closeRaces keeps how a week ended for some of its races, in one write: each player's place, the league they move
// to, what the place pays, and their news (LeagueNews), kept with them or not at all. A place kept already (a close
// cut off after it) is left as it is, and not told again.
func (g *Game) closeRaces(ctx context.Context, week string, list []leagueRace) error {
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		result, err := tx.PrepareContext(ctx, `INSERT OR IGNORE INTO league_results
			(week, user_id, tier, place, of, points, moved, xp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
		if err != nil {
			return err
		}
		defer result.Close()
		// A player moves from the race's league, or stays in their own if it's higher (raised since they joined the
		// group: a guest's of a higher league brought to the account), unless the week takes them higher still.
		move, err := tx.PrepareContext(ctx, `UPDATE users SET league = CASE WHEN league > ?1 THEN max(league, ?2) ELSE ?2 END
			WHERE id = ?3 RETURNING league`)
		if err != nil {
			return err
		}
		defer move.Close()
		var news []LeagueNews
		for _, race := range list {
			standings, err := raceStandings(ctx, tx, week, race.groups)
			if err != nil {
				return err
			}
			n := len(standings)
			up, down := moves(n)
			// Each one's place is in the race as they see it (standingsFor): for those who played as people, the
			// same for all.
			for _, member := range standings {
				seen := standingsFor(standings, member.user)
				i := slices.IndexFunc(seen, func(s standing) bool { return s.user == member.user })
				s := seen[i]
				moved, pay := 0, 0
				switch {
				case i < up && s.points > 0 && race.tier < TopLeague:
					moved = 1
				case i >= n-down && race.tier > 0:
					moved = -1
				}
				if n >= RaceSize && i < len(LeaguePay) {
					pay = LeaguePay[i]
				}
				res, err := result.ExecContext(ctx, week, s.user, race.tier, i+1, n, s.points, moved, pay)
				if err != nil {
					return err
				}
				kept, err := res.RowsAffected()
				if err != nil {
					return err
				}
				if kept == 0 { // kept by a close cut off after it
					continue
				}
				var league int
				if err := move.QueryRowContext(ctx, race.tier, race.tier+moved, s.user).Scan(&league); err != nil {
					return err
				}
				news = append(news, LeagueNews{To: s.user, Week: week, From: leagueOf(race.tier),
					Now: leagueOf(league), Place: i + 1, Of: n, XP: pay})
			}
		}
		if len(news) == 0 || g.LeagueNews == nil {
			return nil
		}
		return g.LeagueNews(ctx, tx, news)
	})
}

// seatPlayed seats in a week whoever has finished a run of its questions and isn't in a group of it, in the order they
// first finished one, a few at a time: those what followed their run didn't seat (a Monday's run while the week
// before closed; one whose follow-up failed until its week was closing).
func (g *Game) seatPlayed(ctx context.Context, week string) error {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT r.user_id, min(r.finished_at) FROM runs r
		WHERE r.kind = 'day' AND r.day >= ?1 AND r.day < ?2 AND r.finished_at IS NOT NULL
			AND NOT EXISTS (SELECT 1 FROM league_members m WHERE m.week = ?3 AND m.user_id = r.user_id)
		GROUP BY r.user_id ORDER BY 2, 1`, append(weekArgs(week), week)...)
	if err != nil {
		return err
	}
	type seated struct{ user, joined int64 }
	var list []seated
	for rows.Next() {
		var s seated
		if err := rows.Scan(&s.user, &s.joined); err != nil {
			rows.Close()
			return err
		}
		list = append(list, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for len(list) > 0 {
		n := min(len(list), closeBatch)
		err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
			for _, s := range list[:n] {
				if err := seat(tx, week, s.user, s.joined); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		list = list[n:]
	}
	return nil
}

// joinLeague puts a player who has finished a run of the day's questions of a week in a group of their league, if
// they aren't in one yet and the week is the one open; a week closing or not open yet is the close's to seat them in
// (seatPlayed).
func (g *Game) joinLeague(ctx context.Context, userID int64, week string) error {
	if err := g.ensureWeek(ctx); err != nil {
		return err
	}
	g.weekMu.RLock()
	defer g.weekMu.RUnlock()
	if week != g.week {
		return nil
	}
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var played bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM runs r WHERE `+weekDays("?3")+`)`,
			append(weekArgs(week), userID)...).Scan(&played); err != nil || !played {
			return err
		}
		return seat(tx, week, userID, store.Ms(g.Now()))
	})
}

// seat puts a player in a group of a week, of their league, as of joined (ms), unless they're in one already or gone.
func seat(tx *sql.Tx, week string, userID, joined int64) error {
	var tier int
	var in bool
	err := tx.QueryRow(`SELECT league, EXISTS (SELECT 1 FROM league_members WHERE week = ? AND user_id = users.id)
		FROM users WHERE id = ?`, week, userID).Scan(&tier, &in)
	if errors.Is(err, sql.ErrNoRows) || in {
		return nil
	}
	if err != nil {
		return err
	}
	return placeInLeague(tx, week, tier, userID, joined)
}

// placeInLeague puts a player in a group of a week's league (tier), as of joined (ms): the first group of it with
// room, or a new one.
func placeInLeague(tx *sql.Tx, week string, tier int, userID, joined int64) error {
	var group int64
	err := tx.QueryRow(`SELECT g.id FROM league_groups g WHERE g.week = ? AND g.tier = ?
		AND (SELECT count(*) FROM league_members m WHERE m.group_id = g.id) < ? ORDER BY g.id LIMIT 1`,
		week, tier, GroupSize).Scan(&group)
	if errors.Is(err, sql.ErrNoRows) {
		res, err := tx.Exec(`INSERT INTO league_groups (week, tier) VALUES (?, ?)`, week, tier)
		if err != nil {
			return err
		}
		if group, err = res.LastInsertId(); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO league_members (week, user_id, group_id, joined_at) VALUES (?, ?, ?, ?)`,
		week, userID, group, joined)
	return err
}

// LeagueView is a player's week as they see it: their league, the days left, and their race (their group, or two:
// races), each with the week's right answers and points, the first going up and the last going down; or, not in it
// yet, what puts them in.
type LeagueView struct {
	Week string `json:"week"`
	// DaysLeft is how many days of the week are left, today too: 0 once it's over, its last runs still coming in
	// before it closes (weekLate).
	DaysLeft int    `json:"daysLeft"`
	League   League `json:"league"`
	// In is whether the player is in a group this week (the day's questions finished put them in).
	In bool `json:"in"`
	// Size is how many race with the player (their group's race); Group is who, once it's a race (RaceSize): until
	// then it's gathering.
	Size  int         `json:"size"`
	Group []LeagueRow `json:"group"`
	Place int         `json:"place,omitempty"`
	// Up and Down are how many of the group go up and down as it stands (none up from the top, none down from the
	// bottom).
	Up   int    `json:"up"`
	Down int    `json:"down"`
	Pay  [3]int `json:"pay"`
	// Race is how many a race needs (RaceSize).
	Race int `json:"race"`
	// Last is how the player's last week ended, if they played one.
	Last *LeagueEnd `json:"last,omitempty"`
}

// LeagueRow is a player in a race: who, and the week's right answers and points.
type LeagueRow struct {
	Name   string `json:"name"`
	Tag    string `json:"tag"`
	Rights int    `json:"rights"`
	Points int    `json:"points"`
	Me     bool   `json:"me,omitempty"`
	Look
}

// LeagueEnd is how a week ended for a player: the league it was played in, the place, the move and what it paid.
type LeagueEnd struct {
	Week  string `json:"week"`
	From  League `json:"from"`
	Now   League `json:"now"`
	Place int    `json:"place"`
	Of    int    `json:"of"`
	Moved int    `json:"moved"`
	XP    int    `json:"xp"`
}

// LeagueOf is the week open as a player sees it (0: nobody signed in, the week alone): until it closes, minutes into
// the next one, the week that has just ended, its last runs coming in.
func (g *Game) LeagueOf(ctx context.Context, userID int64) (LeagueView, error) {
	if err := g.ensureWeek(ctx); err != nil {
		return LeagueView{}, err
	}
	g.weekMu.RLock()
	week := g.week
	g.weekMu.RUnlock()
	now := g.Now().In(Bulgaria)
	v := LeagueView{Week: week, League: Leagues[0], Group: []LeagueRow{}, Pay: LeaguePay, Race: RaceSize}
	if _, end := weekBounds(week); now.Before(end) {
		v.DaysLeft = int(end.Sub(now).Hours()/24) + 1
	}
	if userID == 0 {
		return v, nil
	}
	db := g.DB.Read
	var tier int
	var group sql.NullInt64
	if err := db.QueryRowContext(ctx, `SELECT u.league, m.group_id FROM users u
		LEFT JOIN league_members m ON m.user_id = u.id AND m.week = ? WHERE u.id = ?`, week, userID).
		Scan(&tier, &group); err != nil {
		return v, err
	}
	v.League = leagueOf(tier)
	last, err := g.lastWeek(ctx, db, userID, `1`)
	if err != nil {
		return v, err
	}
	v.Last = last
	if !group.Valid {
		return v, nil
	}
	v.In = true
	if err := db.QueryRowContext(ctx, `SELECT tier FROM league_groups WHERE id = ?`, group.Int64).Scan(&tier); err != nil {
		return v, err
	}
	v.League = leagueOf(tier)
	groups, err := weekGroups(ctx, db, week, tier)
	if err != nil {
		return v, err
	}
	race := leagueRace{groups: []int64{group.Int64}}
	for _, r := range races(groups) {
		if slices.Contains(r.groups, group.Int64) {
			race = r
		}
	}
	list, err := raceStandings(ctx, db, week, race.groups)
	if err != nil {
		return v, err
	}
	v.Size = len(list)
	if v.Size < RaceSize {
		return v, nil
	}
	list = standingsFor(list, userID)
	v.Up, v.Down = moves(len(list))
	if tier == TopLeague {
		v.Up = 0
	}
	if tier == 0 {
		v.Down = 0
	}
	for i, s := range list {
		var avatar, title string
		var xp int
		row := LeagueRow{Rights: s.rights, Points: s.points, Me: s.user == userID}
		if err := db.QueryRowContext(ctx, `SELECT u.name, u.tag, `+lookColumns+` FROM users u WHERE u.id = ?`, s.user).
			Scan(&row.Name, &row.Tag, &avatar, &title, &xp); err != nil {
			return v, err
		}
		row.Look = g.lookOf(s.user, avatar, title, xp)
		if row.Me {
			v.Place = i + 1
		}
		v.Group = append(v.Group, row)
	}
	return v, nil
}

// lastWeek is how a player's latest week ended (nil for none), among the results a condition allows (`NOT r.seen`:
// the ones not told yet).
func (g *Game) lastWeek(ctx context.Context, q rowQuerier, userID int64, where string) (*LeagueEnd, error) {
	var e LeagueEnd
	var tier int
	err := q.QueryRowContext(ctx, `SELECT r.week, r.tier, r.place, r.of, r.moved, r.xp FROM league_results r
		WHERE r.user_id = ? AND `+where+` ORDER BY r.week DESC LIMIT 1`, userID).
		Scan(&e.Week, &tier, &e.Place, &e.Of, &e.Moved, &e.XP)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	e.From, e.Now = leagueOf(tier), leagueOf(tier+e.Moved)
	return &e, nil
}

// leagueFirsts is how many weeks a player has ended first in a group that was a race (RaceSize), by the league's tier.
func (g *Game) leagueFirsts(ctx context.Context, userID int64) ([]int, error) {
	out := make([]int, len(Leagues))
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT tier, count(*) FROM league_results
		WHERE user_id = ? AND place = 1 AND of >= ? GROUP BY tier`, userID, RaceSize)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var tier, n int
		if err := rows.Scan(&tier, &n); err != nil {
			return out, err
		}
		if tier >= 0 && tier < len(out) {
			out[tier] = n
		}
	}
	return out, rows.Err()
}
