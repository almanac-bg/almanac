package play

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Leagues are a race every week, for everyone who plays. A week runs Monday to Sunday in Bulgaria. A player's first
// game of a week that earns XP puts them in a group of up to GroupSize players of their league, filled in the order
// they come; the group races on the XP each earns that week (games finished, goals, achievements). When the week
// ends the first of each group go up a league and the last go down (moves: how many, by the group's size); the first
// three are paid XP (LeaguePay), and everyone is told how their week ended. A week not played changes nothing.
//
// The leagues are six mountains, from the lowest highest peak to the highest: Странджа to Рила. They aren't metals,
// so that they don't read as the rating's divisions: the rating is strength (rating.go), the league is playing.
// First place in the top leagues unlocks frames (wardrobe.go), and in Рила a title that counts how many times
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

// LeaguePay is what the first three places of a week pay, in a group of two or more.
var LeaguePay = [3]int{300, 200, 100}

// moves are how many of a group of n go up and down when the week ends: five each way in a full group; in a smaller
// one the first quarter up (at least one, once there's someone to beat) and, from eight, the last quarter down.
func moves(n int) (up, down int) {
	switch {
	case n >= 10:
		up = 5
	case n >= 2:
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

// weekXP is a SQL expression for the XP a player (a column) has earned in a week: ?1 and ?2 its bounds in ms, ?3 and
// ?4 its first day and the next week's (YYYY-MM-DD). What a week's place pays isn't in it: that's the next week's.
func weekXP(user string) string {
	return `(coalesce((SELECT sum(xp) FROM runs WHERE user_id = ` + user + ` AND finished_at >= ?1 AND finished_at < ?2), 0)
		+ coalesce((SELECT sum(xp) FROM goals_done WHERE user_id = ` + user + ` AND day >= ?3 AND day < ?4), 0)
		+ coalesce((SELECT sum(xp) FROM achievements WHERE user_id = ` + user + ` AND at >= ?1 AND at < ?2), 0))`
}

// weekArgs are weekXP's arguments for a week.
func weekArgs(week string) []any {
	from, to := weekBounds(week)
	return []any{from.UnixMilli(), to.UnixMilli(), from.Format(time.DateOnly), to.Format(time.DateOnly)}
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

// standing is a player's place in a group: who, the week's XP, and when they came.
type standing struct {
	user   int64
	xp     int
	joined int64
}

// groupStandings are a group's players by the week's XP, the first first (who came first, on equal XP).
func groupStandings(ctx context.Context, q querier, week string, group int64) ([]standing, error) {
	rows, err := q.QueryContext(ctx, `SELECT m.user_id, `+weekXP("m.user_id")+`, m.joined_at FROM league_members m
		WHERE m.group_id = ?5 ORDER BY 2 DESC, m.joined_at, m.user_id`, append(weekArgs(week), group)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []standing
	for rows.Next() {
		var s standing
		if err := rows.Scan(&s.user, &s.xp, &s.joined); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ensureWeek ends the week being played if it's over: every group's places are kept, the leagues move and the
// places pay. It runs every minute and before anything about a week, so that no game of a new week counts for the
// old one; it's cheap once the week is the current one.
func (g *Game) ensureWeek(ctx context.Context) error {
	now := weekOf(g.Now())
	g.weekMu.Lock()
	defer g.weekMu.Unlock()
	if g.week == now {
		return nil
	}
	var news []LeagueNews
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var open string
		err := tx.QueryRow(`SELECT id FROM league_week`).Scan(&open)
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
		for _, gr := range groups {
			list, err := groupStandings(ctx, tx, open, gr.id)
			if err != nil {
				return err
			}
			n := len(list)
			up, down := moves(n)
			for i, s := range list {
				moved, pay := 0, 0
				switch {
				case i < up && s.xp > 0 && gr.tier < TopLeague:
					moved = 1
				case i >= n-down && gr.tier > 0:
					moved = -1
				}
				if n >= 2 && i < len(LeaguePay) {
					pay = LeaguePay[i]
				}
				if _, err := tx.Exec(`INSERT INTO league_results (week, user_id, tier, place, of, points, moved, xp)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, open, s.user, gr.tier, i+1, n, s.xp, moved, pay); err != nil {
					return err
				}
				if _, err := tx.Exec(`UPDATE users SET league = ? WHERE id = ?`, gr.tier+moved, s.user); err != nil {
					return err
				}
				news = append(news, LeagueNews{To: s.user, Week: open, From: leagueOf(gr.tier),
					Now: leagueOf(gr.tier + moved), Place: i + 1, Of: n, XP: pay})
			}
		}
		_, err = tx.Exec(`UPDATE league_week SET id = ?`, now)
		return err
	})
	if err != nil {
		return err
	}
	g.week = now
	if g.LeagueNews != nil {
		for _, n := range news {
			g.LeagueNews(ctx, n)
		}
	}
	return nil
}

// joinLeague puts a player who has earned XP this week in a group of their league, if they aren't in one yet: the
// first group of it with room, or a new one.
func (g *Game) joinLeague(ctx context.Context, userID int64) error {
	if err := g.ensureWeek(ctx); err != nil {
		return err
	}
	week := weekOf(g.Now())
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var in, xp, tier int
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM league_members WHERE week = ?5 AND user_id = ?6),
			`+weekXP("?6")+`, (SELECT league FROM users WHERE id = ?6)`, append(weekArgs(week), week, userID)...).
			Scan(&in, &xp, &tier); err != nil {
			return err
		}
		if in == 1 || xp == 0 {
			return nil
		}
		var group int64
		err := tx.QueryRow(`SELECT g.id FROM league_groups g WHERE g.week = ? AND g.tier = ?
			AND (SELECT count(*) FROM league_members m WHERE m.group_id = g.id) < ? ORDER BY g.id LIMIT 1`,
			week, tier, GroupSize).Scan(&group)
		if errors.Is(err, sql.ErrNoRows) {
			res, err := tx.Exec(`INSERT INTO league_groups (week, tier) VALUES (?, ?)`, week, tier)
			if err != nil {
				return err
			}
			group, err = res.LastInsertId()
			if err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO league_members (week, user_id, group_id, joined_at) VALUES (?, ?, ?, ?)`,
			week, userID, group, store.Ms(g.Now()))
		return err
	})
}

// LeagueView is a player's week as they see it: their league, the days left, and their group, each with the week's
// XP, the first going up and the last going down; or, not in it yet, what puts them in.
type LeagueView struct {
	Week     string `json:"week"`
	DaysLeft int    `json:"daysLeft"`
	League   League `json:"league"`
	// In is whether the player is in a group this week (a game that earns XP puts them in).
	In    bool        `json:"in"`
	Group []LeagueRow `json:"group"`
	Place int         `json:"place,omitempty"`
	// Up and Down are how many of the group go up and down as it stands (none up from the top, none down from the
	// bottom).
	Up   int    `json:"up"`
	Down int    `json:"down"`
	Pay  [3]int `json:"pay"`
	// Last is how the player's last week ended, if they played one.
	Last *LeagueEnd `json:"last,omitempty"`
}

// LeagueRow is a player in a group: who, and the week's XP.
type LeagueRow struct {
	Name string `json:"name"`
	Tag  string `json:"tag"`
	XP   int    `json:"xp"`
	Me   bool   `json:"me,omitempty"`
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
		Pay: LeaguePay}
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
	list, err := groupStandings(ctx, db, week, group.Int64)
	if err != nil {
		return v, err
	}
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
		row := LeagueRow{XP: s.xp, Me: s.user == userID}
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
func (g *Game) lastWeek(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, userID int64, where string) (*LeagueEnd, error) {
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

// leagueFirsts is how many weeks a player has ended first in a group of two or more, by the league's tier.
func (g *Game) leagueFirsts(ctx context.Context, userID int64) ([]int, error) {
	out := make([]int, len(Leagues))
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT tier, count(*) FROM league_results
		WHERE user_id = ? AND place = 1 AND of >= 2 GROUP BY tier`, userID)
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
