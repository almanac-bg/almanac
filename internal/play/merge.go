package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
)

// A guest who signs in to an account they have already brings their game along (Merge), and a player who goes
// (deletes their account, or a guest nobody uses) leaves others' history as it was (Forget).
//
// Merge is a list of steps, each naming the references to a player it carries: a column that points to a player
// ("table.column") or one of the player's own (users.*). What it leaves with the guest, to go with them, is in
// mergeLeft, with why. A test (merge_test.go) holds the two against the schema: a table that points to players, or a
// player's column, that neither names fails it, so a new one can't be lost to every guest who signs in.

// mergeStep is a step of Merge: its SQL, where ?1 is the account and ?2 the guest.
type mergeStep struct {
	carries []string
	sql     string
}

var mergeSteps = []mergeStep{
	// All the guest's runs but a day the account has played itself, which stays the account's: one game of a day is
	// ever an account's. A day's run the guest played while the account was there already comes as a shadow
	// (ShadowGuest, fair.go): the player's own, for their streak and their numbers, never on the others' boards, so
	// that the day played as several guests, and signed in from the best of them, races nobody.
	{sql: `UPDATE runs SET shadow = ` + strconv.Itoa(ShadowGuest) + ` WHERE user_id = ?2 AND kind = 'day'
		AND shadow = 0 AND started_at >= (SELECT created_at FROM users WHERE id = ?1)`},
	{carries: []string{"runs.user_id"}, sql: `UPDATE runs SET user_id = ?1 WHERE user_id = ?2
		AND NOT (kind = 'day' AND day IN (SELECT day FROM runs WHERE user_id = ?1 AND kind = 'day'))`},
	// The guest's friends become the account's (the two aren't friends with themselves), as many as the account has
	// room for (MaxFriends), the latest first: a guest's game brought along can't give it more friends than befriending
	// could.
	{carries: []string{"friends.user_id", "friends.friend_id"}, sql: `INSERT INTO friends (user_id, friend_id, since, asked)
		SELECT ?1, friend_id, since, asked FROM friends WHERE user_id = ?2 AND friend_id <> ?1
			AND friend_id NOT IN (SELECT friend_id FROM friends WHERE user_id = ?1)
		ORDER BY since DESC LIMIT max(0, ` + strconv.Itoa(MaxFriends) + ` - (SELECT count(*) FROM friends WHERE user_id = ?1))`},
	{sql: `INSERT OR IGNORE INTO friends (user_id, friend_id, since, asked)
		SELECT user_id, ?1, since, asked FROM friends WHERE friend_id = ?2 AND user_id <> ?1
			AND user_id IN (SELECT friend_id FROM friends WHERE user_id = ?1)`},
	{sql: `DELETE FROM friends WHERE user_id = ?2 OR friend_id = ?2`},
	// The guest's duels are the account's. One between the two goes with the guest: what's left of the guest's duels
	// then.
	{carries: []string{"duels.a_id", "duels.b_id"},
		sql: `UPDATE duels SET a_id = ?1 WHERE a_id = ?2 AND coalesce(b_id, 0) <> ?1`},
	{sql: `UPDATE duels SET b_id = ?1 WHERE b_id = ?2 AND coalesce(a_id, 0) <> ?1`},
	{sql: `DELETE FROM duels WHERE a_id = ?2 OR b_id = ?2`},
	// The days the guest played on were the account's player's: the same person, so not a player who left.
	{carries: []string{"active_days.user_id"},
		sql: `INSERT OR IGNORE INTO active_days (user_id, day) SELECT ?1, day FROM active_days WHERE user_id = ?2`},
	{sql: `DELETE FROM active_days WHERE user_id = ?2`},
	// The guest's book is written again with the account's, from all their games now (Merge: rewriteFacts), so that a
	// question met first by either is ink once at most.
	{carries: []string{"facts.user_id"}, sql: `DELETE FROM facts WHERE user_id IN (?1, ?2)`},
	// The guest's ranks are the account's, the higher of the two in each chapter (a rank never falls), told as the
	// higher was; then they're counted again from the book the two share now (Merge: rewriteBook), and a rank that rises
	// by it is told with the next news.
	{carries: []string{"ranks.user_id"}, sql: `INSERT INTO ranks (user_id, chapter, level, quarter, ink, told)
		SELECT ?1, chapter, level, quarter, ink, told FROM ranks WHERE user_id = ?2 AND true
		ON CONFLICT (user_id, chapter) DO UPDATE SET level = max(ranks.level, excluded.level),
			quarter = CASE WHEN excluded.level > ranks.level THEN excluded.quarter ELSE ranks.quarter END,
			ink = max(ranks.ink, excluded.ink),
			told = max(ranks.told, excluded.told)`},
	// The guest's notifications come along, with what they chose of them (unless the account has chosen), the days
	// they were reminded on, and those on their way (but a day's reminder the account has one of). So does what they chose of mails, though a guest gets none.
	{carries: []string{"push_subs.user_id"}, sql: `UPDATE push_subs SET user_id = ?1 WHERE user_id = ?2`},
	{carries: []string{"push_prefs.user_id"}, sql: `INSERT OR IGNORE INTO push_prefs (user_id, kind, wanted)
		SELECT ?1, kind, wanted FROM push_prefs WHERE user_id = ?2`},
	{carries: []string{"push_reminded.user_id"}, sql: `UPDATE OR IGNORE push_reminded SET user_id = ?1 WHERE user_id = ?2`},
	{carries: []string{"push_queue.user_id"}, sql: `UPDATE push_queue SET user_id = ?1 WHERE user_id = ?2
		AND (day IS NULL OR day NOT IN (SELECT day FROM push_queue WHERE user_id = ?1 AND day IS NOT NULL))`},
	{carries: []string{"mail_prefs.user_id"}, sql: `INSERT OR IGNORE INTO mail_prefs (user_id, kind, wanted)
		SELECT ?1, kind, wanted FROM mail_prefs WHERE user_id = ?2`},
	{carries: []string{"streak_mails.user_id"}, sql: `UPDATE OR IGNORE streak_mails SET user_id = ?1 WHERE user_id = ?2`},
	{carries: []string{"day_mails.user_id"}, sql: `UPDATE OR IGNORE day_mails SET user_id = ?1 WHERE user_id = ?2`},
	// The guest's avatar, where the account hasn't chosen one.
	{carries: []string{"users.avatar"}, sql: `UPDATE users SET avatar = coalesce(users.avatar, g.avatar)
		FROM (SELECT avatar FROM users WHERE id = ?2) g WHERE users.id = ?1`},
	// Friend requests: the guest's become the account's (none to itself).
	{carries: []string{"friend_requests.from_id", "friend_requests.to_id"},
		sql: `UPDATE OR IGNORE friend_requests SET from_id = ?1 WHERE from_id = ?2 AND (to_id IS NULL OR to_id <> ?1)`},
	{sql: `UPDATE OR IGNORE friend_requests SET to_id = ?1 WHERE to_id = ?2 AND from_id <> ?1`},
	{sql: `DELETE FROM friend_requests WHERE from_id = ?2 OR to_id = ?2`},
	// The questions the guest reported, still theirs.
	{carries: []string{"reports.user_id"}, sql: `UPDATE reports SET user_id = ?1 WHERE user_id = ?2`},
	// What the guest has been told, so that nothing is told twice: of Днес's lines, of their streak.
	{carries: []string{"today_lines.user_id"},
		sql: `INSERT OR IGNORE INTO today_lines (user_id, what, at) SELECT ?1, what, at FROM today_lines WHERE user_id = ?2`},
	{carries: []string{"users.streak_told"},
		sql: `UPDATE users SET streak_told = CASE WHEN substr(g.streak_told, instr(g.streak_told, ':') + 1)
			> substr(users.streak_told, instr(users.streak_told, ':') + 1) THEN g.streak_told ELSE users.streak_told END
		FROM (SELECT streak_told FROM users WHERE id = ?2) g
		WHERE users.id = ?1`},
	// The player came in when the earlier of the two did, and was last seen when the later was; and last looked at
	// Приятели when the later of the two did (play.FriendsNews).
	{carries: []string{"users.created_at", "users.seen_at", "users.friends_seen_at"},
		sql: `UPDATE users SET created_at = min(users.created_at, g.created_at), seen_at = max(users.seen_at, g.seen_at),
			friends_seen_at = max(users.friends_seen_at, g.friends_seen_at)
		FROM (SELECT created_at, seen_at, friends_seen_at FROM users WHERE id = ?2) g WHERE users.id = ?1`},
}

// mergeLeft are the references to a player that Merge leaves with the guest, to go with them, and why.
var mergeLeft = map[string]string{
	"users.id":         "the account's",
	"users.name":       "the account's: the name its player chose",
	"users.tag":        "the account's: friends know it by it",
	"users.email":      "the account's (a guest has none)",
	"users.admin":      "the account's (a guest is never one)",
	"sessions.user_id": "a guest's sessions end: the browser that signed in gets the account's (account.Verify)",
	"handoffs.user_id": "a link that moves the guest to another device: nothing to move once it's the account",
	"suspensions.user_id": "a suspended guest has no session to sign in from, so is never merged; the account's " +
		"own suspension is its own",
}

// Merge moves a guest's progress to the account they signed in to (account.Accounts.Merge), where it doesn't clash
// with the account's own (mergeSteps say what of it, and how), then writes its book again and counts its ranks from it
// (rewriteBook).
func (g *Game) Merge(tx *sql.Tx, from, to int64) error {
	for _, s := range mergeSteps {
		if _, err := tx.Exec(s.sql, to, from); err != nil {
			return err
		}
	}
	return rewriteBook(context.Background(), tx, g.Bank(), to, g.Now())
}

// GoneName is how a player who's gone (deleted, or a guest cleared) shows in others' history.
const GoneName = "Изтрит играч"

// Forget keeps others' history of a player who goes (account.Accounts.Forget: in the transaction that deletes them,
// before), as it was without them: a duel's result stays the other's, without the player's name or game (the schema
// sets the player to none there, ON DELETE SET NULL); what was theirs alone, or nobody's once they're gone, goes.
//
//   - A duel not over yet goes: nothing of it is played by both.
//   - A duel only they had (the other gone before) goes.
//   - Friend requests to their address go.
//   - The days they played on (active_days, which has no reference to users: the retention counts keep a player who
//     went, or those who never came back would drop out and make them look better) are kept as a tombstone, the id
//     made negative: counted still, nobody's. An id is never a player's again (users' AUTOINCREMENT), so a newcomer
//     never starts with someone else's days. Only the days that count for /admin (personDay, retention.go) are kept:
//     once the player's games are gone, nothing could tell the others apart.
func Forget(tx *sql.Tx, id int64) error {
	if err := forgetDaysUncounted(tx, id); err != nil {
		return err
	}
	for _, q := range []string{
		`DELETE FROM duels WHERE ended_at IS NULL AND (a_id = ?1 OR b_id = ?1)`,
		`DELETE FROM duels WHERE a_id = ?1 AND b_id IS NULL`,
		`DELETE FROM duels WHERE b_id = ?1 AND a_id IS NULL`,
		`DELETE FROM friend_requests WHERE to_email = (SELECT email FROM users WHERE id = ?1)`,
		`UPDATE OR REPLACE active_days SET user_id = -user_id WHERE user_id = ?1`,
	} {
		if _, err := tx.Exec(q, id); err != nil {
			return err
		}
	}
	return nil
}

// forgetDaysUncounted lets go of a player's days that /admin doesn't count (personDay): while their games are there to
// tell.
func forgetDaysUncounted(tx *sql.Tx, id int64) error {
	var first, last sql.NullString
	if err := tx.QueryRow(`SELECT min(day), max(day) FROM active_days WHERE user_id = ?`, id).Scan(&first, &last); err != nil ||
		!first.Valid {
		return err
	}
	_, err := tx.Exec(`WITH `+boundsCTE+` DELETE FROM active_days WHERE user_id = ?2 AND day NOT IN (
		SELECT a.day FROM b JOIN active_days a ON a.day = b.day WHERE a.user_id = ?2 AND `+personDay+`)`,
		dayBoundsJSON(first.String, last.String), id)
	return err
}

// DayRuns are the ids of a player's games of the day, any day: what a sign-in's merge may leave behind (DaysLeft).
func (g *Game) DayRuns(ctx context.Context, userID int64) ([]int64, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT id FROM runs WHERE user_id = ? AND kind = 'day'`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// DaysLeft is how many of a guest's games of the day (`runs`: DayRuns, before the sign-in) didn't come to the account
// `to` with the rest (Merge): the account had played those days itself, so they went with the guest.
func (g *Game) DaysLeft(ctx context.Context, to int64, runs []int64) (int, error) {
	if len(runs) == 0 {
		return 0, nil
	}
	ids, err := json.Marshal(runs)
	if err != nil {
		return 0, err
	}
	var carried int
	err = g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FROM runs WHERE user_id = ?
		AND id IN (SELECT value FROM json_each(?))`, to, string(ids)).Scan(&carried)
	return len(runs) - carried, err
}
