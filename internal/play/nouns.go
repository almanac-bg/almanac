package play

import (
	"context"
	"database/sql"
	"errors"
)

// The game's nouns, used (DECISIONS.md, „The direction“: the rule for later): /admin shows, week by week, how many of
// those who played used each — the day's issue, ink, the book, its chapters' games, the seal, the streak, friends, a
// duel, a shared day — so that a part nobody uses is seen, and goes. Most are in what the game keeps anyway (Uses);
// the three that are only looked at (the book, Приятели, the seal) a player marks as they open them (Used), once a
// week each, kept as bits of the week on their row (users.used, users.used_week) and counted without a name
// (daily_counts, "use:<noun>").

// Nouns are the parts of the game /admin counts by week, in its order.
var Nouns = []string{"day", "ink", "almanac", "topic", "seal", "streak", "friends", "duel", "share"}

// opened are the nouns a player marks as they open them (Used), each its bit in users.used.
var opened = map[string]int{"almanac": 1, "friends": 2, "seal": 4}

// Opened says whether a noun is one a player marks as they open it (Used).
func Opened(noun string) bool { return opened[noun] != 0 }

// Used marks that a player opened a part of the game that is only looked at (opened): counted once a week each, from
// Monday, without their name.
func (g *Game) Used(ctx context.Context, userID int64, noun string) error {
	bit := opened[noun]
	if bit == 0 {
		return nil
	}
	week := WeekOf(g.Today())
	var was string
	var bits int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT used_week, used FROM users WHERE id = ?`, userID).Scan(&was, &bits)
	if errors.Is(err, sql.ErrNoRows) || err == nil && was == week && bits&bit != 0 {
		return nil
	}
	if err != nil {
		return err
	}
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.Exec(`UPDATE users SET used = CASE WHEN used_week = ?1 THEN used | ?2 ELSE ?2 END, used_week = ?1
			WHERE id = ?3 AND NOT (used_week = ?1 AND used & ?2)`, week, bit, userID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return nil
		}
		return g.tally(tx, "use:"+noun)
	})
}

// NounUse is how many players used each of the game's nouns (Nouns) from a day to a day (both in): of those the game
// keeps, distinct players; of those marked as opened (Used), the marks, which are distinct players when the days are
// a week from its Monday.
func (g *Game) NounUse(ctx context.Context, from, to string) (map[string]int, error) {
	start, _ := dayBounds(from)
	_, end := dayBounds(to)
	out := map[string]int{}
	var day, ink, topic, streak, duel, share int
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT
		(SELECT count(DISTINCT user_id) FROM runs WHERE kind = 'day' AND day BETWEEN ?1 AND ?2
			AND finished_at IS NOT NULL AND NOT shadow),
		(SELECT count(DISTINCT user_id) FROM facts WHERE ink AND at >= ?3 AND at < ?4),
		(SELECT count(DISTINCT user_id) FROM runs WHERE kind = 'topic' AND finished_at >= ?3 AND finished_at < ?4
			AND NOT shadow),
		(SELECT count(DISTINCT a.user_id) FROM active_days a JOIN active_days b ON b.user_id = a.user_id
			AND b.day = date(a.day, '+1 day') WHERE a.day >= ?1 AND b.day <= ?2),
		(SELECT count(DISTINCT user_id) FROM runs WHERE kind = 'duel' AND finished_at >= ?3 AND finished_at < ?4
			AND NOT shadow),
		(SELECT count(DISTINCT r.user_id) FROM shares s JOIN runs r ON r.id = s.run_id
			WHERE s.created_at >= ?3 AND s.created_at < ?4)`, from, to, start, end).
		Scan(&day, &ink, &topic, &streak, &duel, &share); err != nil {
		return nil, err
	}
	out["day"], out["ink"], out["topic"], out["streak"], out["duel"], out["share"] = day, ink, topic, streak, duel, share
	t, err := g.Tallies(ctx, from, to)
	if err != nil {
		return nil, err
	}
	for noun := range opened {
		out[noun] = t["use:"+noun]
	}
	return out, nil
}
