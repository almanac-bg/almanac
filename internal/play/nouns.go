package play

import (
	"context"
	"database/sql"
	"errors"
)

// The game's nouns, used (DECISIONS.md, „The direction“: the rule for later): /admin shows, week by week, how many of
// those who played used each noun of the closed list — Брой, близо, серия, Алманах (глави, факти, мастило), печат,
// игра на главата (Микс, България), приятели, класация, дуел (запис), споделяне, профил, напомняне — so that a part
// nobody uses is seen, and goes. Most are in what the game keeps anyway (NounUse); those that are only looked at (the
// book, a chapter's page, Приятели, the seal, the board, a profile) a player marks as they open them (Used), once a
// week each, kept as bits of the week on their row (users.used, users.used_week) and counted without a name
// (daily_counts, "use:<noun>").

// Nouns are the closed list's nouns, as /admin counts them by week, in the list's order.
var Nouns = []string{"day", "close", "streak", "almanac", "chapters", "facts", "ink", "seal", "topic", "mix",
	"bulgaria", "friends", "board", "duel", "recording", "share", "profile", "reminder"}

// opened are the nouns a player marks as they open them (Used), each its bit in users.used.
var opened = map[string]int{"almanac": 1, "friends": 2, "seal": 4, "chapters": 8, "board": 16, "profile": 32}

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

// kept are the nouns the game keeps anyway, each the players who used it from a day to a day (?1, ?2: both in) or
// from a moment to a moment (?3, ?4: ms), a script's games left out.
var kept = map[string]string{
	// Брой: the day's issue finished.
	"day": `SELECT count(DISTINCT user_id) FROM runs WHERE kind = 'day' AND day BETWEEN ?1 AND ?2
		AND finished_at IS NOT NULL AND NOT shadow`,
	// близо: a close answer (not right) in the day's issue.
	"close": `SELECT count(DISTINCT r.user_id) FROM runs r JOIN answers a ON a.run_id = r.id
		WHERE r.kind = 'day' AND r.day BETWEEN ?1 AND ?2 AND NOT r.shadow AND a.score > 0 AND NOT a.is_right`,
	// серия: two days played one after the other.
	"streak": `SELECT count(DISTINCT a.user_id) FROM active_days a JOIN active_days b ON b.user_id = a.user_id
		AND b.day = date(a.day, '+1 day') WHERE a.day >= ?1 AND b.day <= ?2`,
	// факти: any fact written in the book, ink or grey.
	"facts": `SELECT count(DISTINCT user_id) FROM facts WHERE at >= ?3 AND at < ?4`,
	// мастило: a fact written in ink.
	"ink": `SELECT count(DISTINCT user_id) FROM facts WHERE ink AND at >= ?3 AND at < ?4`,
	// игра на главата: a chapter's game finished (Микс and България apart).
	"topic": `SELECT count(DISTINCT user_id) FROM runs WHERE kind = 'topic' AND category NOT IN ('mix', 'bulgaria')
		AND finished_at >= ?3 AND finished_at < ?4 AND NOT shadow`,
	"mix": `SELECT count(DISTINCT user_id) FROM runs WHERE kind = 'topic' AND category = 'mix'
		AND finished_at >= ?3 AND finished_at < ?4 AND NOT shadow`,
	"bulgaria": `SELECT count(DISTINCT user_id) FROM runs WHERE kind = 'topic' AND category = 'bulgaria'
		AND finished_at >= ?3 AND finished_at < ?4 AND NOT shadow`,
	// дуел: a duel with a friend played; запис: one against a recording.
	"duel": `SELECT count(*) FROM (SELECT r.user_id FROM duels d JOIN runs r ON r.id = d.a_run
			WHERE d.kind = 'person' AND r.finished_at >= ?3 AND r.finished_at < ?4 AND NOT r.shadow
		UNION SELECT r.user_id FROM duels d JOIN runs r ON r.id = d.b_run
			WHERE d.kind = 'person' AND r.finished_at >= ?3 AND r.finished_at < ?4 AND NOT r.shadow)`,
	"recording": `SELECT count(DISTINCT r.user_id) FROM duels d JOIN runs r ON r.id = d.a_run
		WHERE d.kind = 'recording' AND r.finished_at >= ?3 AND r.finished_at < ?4 AND NOT r.shadow`,
	// споделяне: a day shared.
	"share": `SELECT count(DISTINCT r.user_id) FROM shares s JOIN runs r ON r.id = s.run_id
		WHERE s.created_at >= ?3 AND s.created_at < ?4`,
	// напомняне: reminded of the day, by a notification that reached a device (not one never delivered) or by mail.
	"reminder": `SELECT count(*) FROM (SELECT user_id FROM push_reminded WHERE day BETWEEN ?1 AND ?2
			AND delivered
		UNION SELECT user_id FROM day_mails WHERE day BETWEEN ?1 AND ?2)`,
}

// NounUse is how many players used each of the game's nouns (Nouns) from a day to a day (both in): of those the game
// keeps, distinct players; of those marked as opened (Used), the marks, which are distinct players when the days are
// a week from its Monday.
func (g *Game) NounUse(ctx context.Context, from, to string) (map[string]int, error) {
	start, _ := dayBounds(from)
	_, end := dayBounds(to)
	out := map[string]int{}
	for noun, q := range kept {
		var n int
		if err := g.DB.Read.QueryRowContext(ctx, q, from, to, start, end).Scan(&n); err != nil {
			return nil, err
		}
		out[noun] = n
	}
	t, err := g.Tallies(ctx, from, to)
	if err != nil {
		return nil, err
	}
	for noun := range opened {
		out[noun] = t["use:"+noun]
	}
	return out, nil
}
