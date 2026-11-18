package play

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Leagues are a race every week on the day's questions. A week runs Monday to Sunday in Bulgaria. A player's first
// finished run of the day's questions in a week puts them in a group of up to GroupSize players of their league,
// filled in the order they come; the group races on the points each scores on the day's questions that week, added up
// day by day. Points add up across games nowhere else (worth.go): here they're the same questions for everyone in the
// group, and a day missed adds nothing. On equal points more right answers go first, then who came first. Whatever
// else a player plays (topics, duels, Роял) is theirs for XP and the rating, never the league's: what wins a week is
// playing the day, every day, and playing it well.
//
// When the week ends the first of each group go up a league and the last go down (moves: how many, by the group's
// size); the first three are paid XP (LeaguePay), and everyone is told how their week ended. Only a week played in a
// player's own league moves them down: a guest who signs in brings a group only of the account's league (merge.go),
// and an account raised to a guest's higher league meanwhile keeps it, or goes higher. A group of fewer than RaceSize
// isn't a race: nobody in it moves or is paid for a place, its first place unlocks nothing, and its players see only
// that it's still gathering. A week not played changes nothing.
//
// A day's run played at a script's speed (fair.go) races for its player alone: its points are in the week as they see
// it, and in the place they're told and paid for at its end, never in anyone else's (standingsFor).
//
// The week under way when the race moved from XP to the day's points (migration 0038) ends as it began, on XP
// (league_week.on_xp, weekXP); every week after it is on points.
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

// GroupSize is how many race in a group: enough for a race, few enough to know the names.
const GroupSize = 20

// RaceSize is how many a group needs to be a race: fewer, and nobody moves or is paid for a place, and the group isn't
// shown.
const RaceSize = 5

// LeaguePay is what the first three places of a week pay, in a group of RaceSize or more.
var LeaguePay = [3]int{300, 200, 100}

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

// weekBounds are a week's start and the next one's, in Bulgaria.
func weekBounds(week string) (time.Time, time.Time) {
	from, _ := time.ParseInLocation(time.DateOnly, week, Bulgaria)
	return from, from.AddDate(0, 0, 7)
}

// weekDays is a SQL condition on a run (r) of a player (a column): a finished run of the day's questions of a week.
// ?3 and ?4 are the week's first day and the next week's (YYYY-MM-DD).
func weekDays(user string) string {
	return `r.user_id = ` + user + ` AND r.kind = 'day' AND r.day >= ?3 AND r.day < ?4 AND r.finished_at IS NOT NULL`
}

// weekXP is a SQL expression for the XP a player (a column) has earned in a week, as a viewer (another SQL
// expression) sees it: their own in full, another's without the games played at a script's speed. ?1 and ?2 are its
// bounds in ms, ?3 and ?4 its first day and the next week's. What a week's place pays isn't in it: that's the next
// week's. Only the week under way when the race moved to the day's points is raced on it (league_week.on_xp).
func weekXP(user, viewer string) string {
	return `(coalesce((SELECT sum(r.xp) FROM runs r WHERE r.user_id = ` + user + ` AND r.finished_at >= ?1 AND r.finished_at < ?2
			AND ` + fairFor("r", viewer) + `), 0)
		+ coalesce((SELECT sum(xp) FROM goals_done WHERE user_id = ` + user + ` AND day >= ?3 AND day < ?4), 0)
		+ coalesce((SELECT sum(xp) FROM achievements WHERE user_id = ` + user + ` AND at >= ?1 AND at < ?2), 0))`
}

// weekArgs are the arguments of weekDays and weekXP for a week.
func weekArgs(week string) []any {
	from, to := weekBounds(week)
	return []any{from.UnixMilli(), to.UnixMilli(), from.Format(time.DateOnly), to.Format(time.DateOnly)}
}

// rowQuerier reads one row: a database or a transaction.
type rowQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// onXP is whether the week being played is raced on XP: only the one under way when the race moved to the day's
// points is.
func onXP(ctx context.Context, q rowQuerier) (bool, error) {
	var xp bool
	err := q.QueryRowContext(ctx, `SELECT on_xp FROM league_week`).Scan(&xp)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return xp, err
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

// standing is a player's place in a group: who, the week's points and right answers as the others see them, theirs
// as they see them (with their runs played at a script's speed), and when they came.
type standing struct {
	user                 int64
	points, rights       int
	ownPoints, ownRights int
	joined               int64
}

// groupStandings are a group's players by the week's points as the others see them, the first first (on equal points,
// more right answers, then who came first); by XP in the week raced on it (xp).
func groupStandings(ctx context.Context, q querier, week string, group int64, xp bool) ([]standing, error) {
	sum := func(column, viewer string) string {
		return `coalesce((SELECT sum(r.` + column + `) FROM runs r WHERE ` + weekDays("m.user_id") + ` AND ` +
			fairFor("r", viewer) + `), 0)`
	}
	query := `SELECT m.user_id, ` + sum("points", "0") + ` AS points, ` + sum("rights", "0") + ` AS rights, ` +
		sum("points", "m.user_id") + `, ` + sum("rights", "m.user_id") + `, m.joined_at FROM league_members m
		WHERE m.group_id = ?5 ORDER BY points DESC, rights DESC, m.joined_at, m.user_id`
	if xp {
		query = `SELECT m.user_id, ` + weekXP("m.user_id", "0") + ` AS points, 0, ` + weekXP("m.user_id", "m.user_id") +
			`, 0, m.joined_at FROM league_members m WHERE m.group_id = ?5 ORDER BY points DESC, m.joined_at, m.user_id`
	}
	rows, err := q.QueryContext(ctx, query, append(weekArgs(week), group)...)
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
	return out, rows.Err()
}

// standingsFor is a group's standings as one of its players sees them: their own points with everything they played,
// everyone else's as the others see them. A player whose runs are all a person's sees the group as everyone does.
func standingsFor(list []standing, viewer int64) []standing {
	out := slices.Clone(list)
	for i := range out {
		if out[i].user == viewer {
			out[i].points, out[i].rights = out[i].ownPoints, out[i].ownRights
		}
	}
	slices.SortStableFunc(out, func(a, b standing) int {
		return cmp.Or(cmp.Compare(b.points, a.points), cmp.Compare(b.rights, a.rights), cmp.Compare(a.joined, b.joined),
			cmp.Compare(a.user, b.user))
	})
	return out
}

// ensureWeek ends the week being played if it's over: every group's places are kept, the leagues move and the
// places pay, and each player's news of it is handed on (LeagueNews) in the same transaction. It runs every minute
// and before anything about a week, so that no game of a new week counts for the old one; it's cheap once the week
// is the current one. Whoever comes first ends the week, to the end: a request whose player leaves meanwhile doesn't
// stop it.
func (g *Game) ensureWeek(ctx context.Context) error {
	now := weekOf(g.Now())
	g.weekMu.Lock()
	defer g.weekMu.Unlock()
	if g.week == now {
		return nil
	}
	ctx = context.WithoutCancel(ctx)
	var news []LeagueNews
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var open string
		var xp bool
		err := tx.QueryRow(`SELECT id, on_xp FROM league_week`).Scan(&open, &xp)
		if errors.Is(err, sql.ErrNoRows) {
			_, err = tx.Exec(`INSERT INTO league_week (id) VALUES (?)`, now)
			return err
		}
		if err != nil || open >= now {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id, tier FROM league_groups WHERE week = ? ORDER BY id`, open)
		if err != nil {
			return err
		}
		type group struct {
			id   int64
			tier int
		}
		var groups []group
		for rows.Next() {
			var gr group
			if err := rows.Scan(&gr.id, &gr.tier); err != nil {
				rows.Close()
				return err
			}
			groups = append(groups, gr)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		result, err := tx.PrepareContext(ctx, `INSERT INTO league_results (week, user_id, tier, place, of, points, moved, xp)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
		if err != nil {
			return err
		}
		defer result.Close()
		// A player moves from the group's league, or stays in their own if it's higher (raised since they joined the
		// group: a guest's of a higher league brought to the account), unless the week takes them higher still.
		move, err := tx.PrepareContext(ctx, `UPDATE users SET league = CASE WHEN league > ?1 THEN max(league, ?2) ELSE ?2 END
			WHERE id = ?3 RETURNING league`)
		if err != nil {
			return err
		}
		defer move.Close()
		for _, gr := range groups {
			list, err := groupStandings(ctx, tx, open, gr.id, xp)
			if err != nil {
				return err
			}
			n := len(list)
			up, down := moves(n)
			// Each one's place is in the group as they see it (standingsFor): for those who played as people, the
			// same for all.
			for _, member := range list {
				seen := standingsFor(list, member.user)
				i := slices.IndexFunc(seen, func(s standing) bool { return s.user == member.user })
				s := seen[i]
				moved, pay := 0, 0
				switch {
				case i < up && s.points > 0 && gr.tier < TopLeague:
					moved = 1
				case i >= n-down && gr.tier > 0:
					moved = -1
				}
				if n >= RaceSize && i < len(LeaguePay) {
					pay = LeaguePay[i]
				}
				if _, err := result.Exec(open, s.user, gr.tier, i+1, n, s.points, moved, pay); err != nil {
					return err
				}
				var league int
				if err := move.QueryRowContext(ctx, gr.tier, gr.tier+moved, s.user).Scan(&league); err != nil {
					return err
				}
				news = append(news, LeagueNews{To: s.user, Week: open, From: leagueOf(gr.tier),
					Now: leagueOf(league), Place: i + 1, Of: n, XP: pay})
			}
		}
		if _, err = tx.Exec(`UPDATE league_week SET id = ?, on_xp = 0`, now); err != nil || g.LeagueNews == nil {
			return err
		}
		return g.LeagueNews(ctx, tx, news)
	})
	if err != nil {
		return err
	}
	g.week = now
	return nil
}

// joinLeague puts a player who has finished the day's questions this week in a group of their league, if they aren't
// in one yet: the first group of it with room, or a new one. (In the week raced on XP, any game that earned XP puts
// them in.)
func (g *Game) joinLeague(ctx context.Context, userID int64) error {
	if err := g.ensureWeek(ctx); err != nil {
		return err
	}
	week := weekOf(g.Now())
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		xp, err := onXP(ctx, tx)
		if err != nil {
			return err
		}
		played := `EXISTS (SELECT 1 FROM runs r WHERE ` + weekDays("?6") + `)`
		if xp {
			played = weekXP("?6", "?6") + ` > 0`
		}
		var in, ok bool
		var tier int
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM league_members WHERE week = ?5 AND user_id = ?6),
			`+played+`, (SELECT league FROM users WHERE id = ?6)`, append(weekArgs(week), week, userID)...).
			Scan(&in, &ok, &tier); err != nil {
			return err
		}
		if in || !ok {
			return nil
		}
		return placeInLeague(tx, week, tier, userID, store.Ms(g.Now()))
	})
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

// LeagueView is a player's week as they see it: their league, the days left, and their group, each with the week's
// points, the first going up and the last going down; or, not in it yet, what puts them in.
type LeagueView struct {
	Week     string `json:"week"`
	DaysLeft int    `json:"daysLeft"`
	League   League `json:"league"`
	// In is whether the player is in a group this week (the day's questions finished put them in).
	In bool `json:"in"`
	// Size is how many are in the group; Group is who, once it's a race (RaceSize): until then it's gathering.
	Size  int         `json:"size"`
	Group []LeagueRow `json:"group"`
	Place int         `json:"place,omitempty"`
	// Up and Down are how many of the group go up and down as it stands (none up from the top, none down from the
	// bottom).
	Up   int    `json:"up"`
	Down int    `json:"down"`
	Pay  [3]int `json:"pay"`
	// Race is how many a group needs to be a race (RaceSize).
	Race int `json:"race"`
	// OnXP is whether this week is still raced on XP: the one under way when the race moved to the day's points.
	OnXP bool `json:"onXP,omitempty"`
	// Last is how the player's last week ended, if they played one.
	Last *LeagueEnd `json:"last,omitempty"`
}

// LeagueRow is a player in a group: who, and the week's points (XP in the week raced on it).
type LeagueRow struct {
	Name   string `json:"name"`
	Tag    string `json:"tag"`
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

// LeagueOf is the week as a player sees it (0: nobody signed in, the week alone).
func (g *Game) LeagueOf(ctx context.Context, userID int64) (LeagueView, error) {
	if err := g.ensureWeek(ctx); err != nil {
		return LeagueView{}, err
	}
	now := g.Now().In(Bulgaria)
	week := weekOf(now)
	_, end := weekBounds(week)
	v := LeagueView{Week: week, DaysLeft: int(end.Sub(now).Hours()/24) + 1, League: Leagues[0], Group: []LeagueRow{},
		Pay: LeaguePay, Race: RaceSize}
	db := g.DB.Read
	var err error
	if v.OnXP, err = onXP(ctx, db); err != nil || userID == 0 {
		return v, err
	}
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
	list, err := groupStandings(ctx, db, week, group.Int64, v.OnXP)
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
		row := LeagueRow{Points: s.points, Me: s.user == userID}
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
