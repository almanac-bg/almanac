package play

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	mrand "math/rand/v2"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Duels are two players on the same ten questions; more points wins, the same points the quicker.
//
// A duel with whoever comes is played live, both on each question at the same moment (internal/live runs it; here
// it's made, and settled once both runs are done). If nobody comes in time, it's played against a recording of a
// real player's earlier game on the same questions (a duel's, or else a topic's, which the player is told; never the
// day's, and none with today's questions in it), a real one by a player of about their rating, played at a person's
// speed and not a script's (recordedRun, fair.go): only the player's rating moves, and half as far, as the recorded one
// didn't ask to play nor plays to win; and only RecordedRatedPerDay such duels a day move it. The recorded player hears
// of it quietly, once a day, with a game's news (RecordingsNews).
//
// A friend, or anyone, is challenged in their own time: a challenge (challenges.go), each taker's game of it a duel
// of kind challenge, played against the sender's game as one against a recording is; one taken by a friend is a duel
// between the two (b_id is the sender).
//
// Only the first duel of a day between the same two players moves their ratings; those after are friendlies, so
// that two accounts can't trade wins for rating.

const (
	// LiveFor is how long a live duel may take before it counts as cut off (the server restarted under it): ten
	// questions at their longest, with the pauses between, take well under it.
	LiveFor = 20 * time.Minute
)

var (
	ErrNoDuel = errors.New("no such duel")
	// ErrNobody is that there's nobody to play: no one waiting, and no recording to play against yet.
	ErrNobody = errors.New("nobody to play")
)

// DuelNews is told to whoever should hear of a duel: a friend's challenge waits for them (asked), a result, or
// someone (not a friend) took their challenge (challenge).
type DuelNews struct {
	To   int64
	Kind string // asked, result, challenge
	From string // the other player's name
	// FromID is the other player (of a recording, the player recorded): nothing is told between two one of whom has
	// blocked the other.
	FromID int64
	// Outcome is the one told's: won, lost or draw (with a result).
	Outcome string
	Delta   int
	// Friendly is a result that didn't move ratings (not the first duel of the day between the two, or past the day's
	// rated duels against recordings).
	Friendly bool
	DuelID   int64
	// Seen is a result the one told has on screen already: they just finished the run that settled the duel.
	Seen bool
	// Code is, with Kind "challenge", the challenge a taker played (its link shows the one who sent it who took it).
	Code string
}

// DuelView is a duel as one of its two players sees it.
type DuelView struct {
	ID   int64  `json:"id"`
	Kind string `json:"kind"` // live, challenge
	// State is the player's: play (their turn), wait (the other's), won, lost, draw, declined, expired (no result:
	// not played in time, or a live one cut off).
	State string `json:"state"`
	// Opponent is the other player, or the recorded one it was played against.
	Opponent *DuelSide `json:"opponent,omitempty"`
	// Friend is the other player's id in a challenge between friends: to challenge them back.
	Friend   int64     `json:"friend,omitempty"`
	You      *DuelSide `json:"you,omitempty"`
	Recorded bool      `json:"recorded,omitempty"`
	// Friendly is a duel that didn't move ratings.
	Friendly bool `json:"friendly,omitempty"`
	// Delta is what the duel did to the player's rating.
	Delta     int   `json:"delta,omitempty"`
	RunID     int64 `json:"runId,omitempty"` // the player's run in it, to play or go over
	CreatedAt int64 `json:"createdAt"`
	ExpiresAt int64 `json:"expiresAt"`
	EndedAt   int64 `json:"endedAt,omitempty"`

	// One duel's result (DuelOf) says more:
	//
	// Decided is, in a duel won on points, the question (from 1) after which the winner led to the end (decided); 0
	// when the points were even and the time decided it, or nothing did.
	Decided int `json:"decided,omitempty"`
	// Rating is where the duel moved the player's rating, when it did.
	Rating *DuelRating `json:"rating,omitempty"`
	// Record is how the player's duels against this opponent went, this one with them: a person, not a recording.
	Record *Record `json:"record,omitempty"`
	// YouLeft and TheyLeft are, in a live duel one of the two left under way (it went on without them), how many
	// questions they had played when they left.
	YouLeft  *int `json:"youLeft,omitempty"`
	TheyLeft *int `json:"theyLeft,omitempty"`
	// Befriend says the other, a person met in a live duel, may be asked to be friends: not a friend yet, nor asked.
	Befriend bool `json:"befriend,omitempty"`
	// Challenge is, for a challenge's duel, its code (challenges.go); Sent says the player sent it (else they took it).
	Challenge string `json:"challenge,omitempty"`
	Sent      bool   `json:"sent,omitempty"`

	// against is the other player (the recorded one's, against a recording), theirRun their run.
	against, theirRun int64
}

// DuelSide is one side of a duel: who, and (once played) how they did.
type DuelSide struct {
	Name   string `json:"name"`
	Tag    string `json:"tag,omitempty"`
	Points int    `json:"points"`
	Rights int    `json:"rights"`
	Ms     int64  `json:"ms"`
	Done   bool   `json:"done"`
	Look   *Look  `json:"look,omitempty"`
	// Marks are how each question answered went (DuelOf): the player's own as they play, the other's once the duel
	// has a result.
	Marks []DuelMark `json:"marks,omitempty"`
}

// DuelMark is how one question of a duel went for one side: the points, whether right (partly, with some points but
// not right), how long it took, and whether nothing was given (Missed: the time ran out).
type DuelMark struct {
	Points  int   `json:"points"`
	Right   bool  `json:"right"`
	Partial bool  `json:"partial,omitempty"`
	Ms      int64 `json:"ms"`
	Missed  bool  `json:"missed,omitempty"`
}

// DuelRating is a player's rating before and after a duel moved it, and the division it left them in (with the next
// one, and where it starts; none at the top).
type DuelRating struct {
	Before   int       `json:"before"`
	After    int       `json:"after"`
	Division Division  `json:"division"`
	Next     *Division `json:"next,omitempty"`
}

// Live is a live duel just made: the questions, and each side's player and run. Against a recording, the second
// side is the recorded player and the run it plays back, with how they answered each question, and the one topic the
// recorded game was in (Topic; "" for all of them).
type Live struct {
	DuelID    int64
	Picks     []Pick
	Users     [2]int64
	Runs      [2]int64
	Recording []Recorded
	Topic     string
}

// Recorded is how the recorded player answered a question: what they gave (as shown; nil for nothing), what it
// earned, and when.
type Recorded struct {
	Shown  json.RawMessage
	Points int
	Right  bool
	Ms     int64
}

// StartLive makes a live duel between two players who are both here now: questions for the two of them, and a run
// each.
func (g *Game) StartLive(ctx context.Context, a, b int64) (Live, error) {
	l := Live{Users: [2]int64{a, b}}
	p, err := g.pastOf(ctx, "", a, b)
	if err != nil {
		return l, err
	}
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if l.Picks, err = g.drawFor(tx, p); err != nil {
			return err
		}
		for i, id := range l.Users {
			r, err := g.insertRun(tx, id, "duel", nil, nil, l.Picks)
			if err != nil {
				return err
			}
			l.Runs[i] = r.id
		}
		data, _ := json.Marshal(l.Picks)
		now := store.Ms(g.Now())
		res, err := tx.Exec(`INSERT INTO duels (kind, questions, a_id, a_run, b_id, b_run, created_at, expires_at)
			VALUES ('live', ?, ?, ?, ?, ?, ?, ?)`, string(data), a, l.Runs[0], b, l.Runs[1], now, now+LiveFor.Milliseconds())
		if err != nil {
			return err
		}
		l.DuelID, _ = res.LastInsertId()
		return nil
	})
	return l, err
}

// StartRecorded makes a live duel against a recording: another player's finished game, the one with the fewest
// questions the player has seen. ErrNobody if there's none yet.
func (g *Game) StartRecorded(ctx context.Context, userID int64) (Live, error) {
	var l Live
	seen := map[string]bool{}
	if err := seenBy(ctx, g.DB.Read, userID, seen); err != nil {
		return l, err
	}
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		rec, err := g.recordedRun(tx, userID, seen)
		if err != nil {
			return err
		}
		if rec == nil {
			return ErrNobody
		}
		l.Picks, l.Topic = rec.picks, rec.topic
		if err := tx.QueryRow(`SELECT user_id FROM runs WHERE id = ?`, rec.id).Scan(&l.Users[1]); err != nil {
			return err
		}
		l.Users[0], l.Runs[1] = userID, rec.id
		if l.Recording, err = recording(tx, rec.id, len(rec.picks)); err != nil {
			return err
		}
		r, err := g.insertRun(tx, userID, "duel", nil, nil, l.Picks)
		if err != nil {
			return err
		}
		l.Runs[0] = r.id
		data, _ := json.Marshal(l.Picks)
		now := store.Ms(g.Now())
		res, err := tx.Exec(`INSERT INTO duels (kind, questions, a_id, a_run, ghost_run, created_at, expires_at)
			VALUES ('live', ?, ?, ?, ?, ?, ?)`, string(data), userID, r.id, rec.id, now, now+LiveFor.Milliseconds())
		if err != nil {
			return err
		}
		l.DuelID, _ = res.LastInsertId()
		return nil
	})
	return l, err
}

// recording is how a finished run answered each of its n questions.
func recording(tx *sql.Tx, runID int64, n int) ([]Recorded, error) {
	out := make([]Recorded, n)
	rows, err := tx.Query(`SELECT n, shown, points, is_right, ms FROM answers WHERE run_id = ? ORDER BY n`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var i int
		var shown sql.NullString
		var r Recorded
		if err := rows.Scan(&i, &shown, &r.Points, &r.Right, &r.Ms); err != nil {
			return nil, err
		}
		if shown.Valid {
			r.Shown = json.RawMessage(shown.String)
		}
		if i >= 0 && i < n {
			out[i] = r
		}
	}
	return out, rows.Err()
}

// CancelLive ends a live duel without a result: it was cut off under way.
func (g *Game) CancelLive(ctx context.Context, duelID int64) error {
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE duels SET ended_at = ?, outcome = 'expired'
		WHERE id = ? AND kind = 'live' AND ended_at IS NULL`, store.Ms(g.Now()), duelID)
	return err
}

// DropLive takes back a live duel called off before its first question (a player never came to it, or left before it
// began): nothing was played, so it leaves nothing, neither the duel nor the runs made for its players (the recording
// it was to be played against stays as it was). One with an answer kept already is only ended (CancelLive).
func (g *Game) DropLive(ctx context.Context, duelID int64) error {
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var a, b sql.NullInt64
		err := tx.QueryRow(`SELECT a_run, b_run FROM duels WHERE id = ? AND kind = 'live' AND ended_at IS NULL`, duelID).
			Scan(&a, &b)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		var answered bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM answers WHERE run_id IN (?, ?))`, a, b).Scan(&answered); err != nil {
			return err
		}
		if answered {
			_, err := tx.Exec(`UPDATE duels SET ended_at = ?, outcome = 'expired' WHERE id = ?`, store.Ms(g.Now()), duelID)
			return err
		}
		if _, err := tx.Exec(`DELETE FROM duels WHERE id = ?`, duelID); err != nil {
			return err
		}
		_, err = tx.Exec(`DELETE FROM runs WHERE id IN (?, ?)`, a, b)
		return err
	})
}

// EndLive ends every live duel still under way without a result: run when the server starts, as live duels are
// played in its memory and a restart cuts them off. One played to its end, both sides (or the player's, against a
// recording), wasn't cut off, only not settled yet (the server stopped between its last answer and its result): it's
// left to be settled as any finished run's duel is (AfterDue, SettleDue), with its result.
func (g *Game) EndLive(ctx context.Context) error {
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE duels SET ended_at = ?, outcome = 'expired'
		WHERE kind = 'live' AND ended_at IS NULL AND NOT (
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = duels.a_run), 0)
			AND (ghost_run IS NOT NULL OR coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = duels.b_run), 0)))`,
		store.Ms(g.Now()))
	return err
}

// past is what a draw needs from its players' history: the questions they've seen, and how well they know them (on
// average over the players; in a topic, or all of them for ""). It's read before the write the draw goes into: it grows
// with every game they've played, and the game's one writer (store.DB.Write) mustn't wait on it.
type past struct {
	seen    map[string]bool
	ability float64
}

func (g *Game) pastOf(ctx context.Context, category string, users ...int64) (past, error) {
	p := past{seen: map[string]bool{}}
	for _, id := range users {
		if err := seenBy(ctx, g.DB.Read, id, p.seen); err != nil {
			return p, err
		}
		a, err := g.ability(ctx, g.DB.Read, id, category)
		if err != nil {
			return p, err
		}
		p.ability += a / float64(len(users))
	}
	return p, nil
}

// drawFor draws a duel's ten questions for its players (their past): all topics, shaped by how well they know them,
// questions neither has seen first.
func (g *Game) drawFor(tx *sql.Tx, p past) ([]Pick, error) {
	barred, err := g.dayQuestions(tx)
	if err != nil {
		return nil, err
	}
	picks := Draw(g.Bank(), "", p.ability, p.seen, barred, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
	if len(picks) == 0 {
		return nil, ErrNoQuestion
	}
	return picks, nil
}

// seenBy adds the questions a player has answered to seen.
func seenBy(ctx context.Context, db querier, userID int64, seen map[string]bool) error {
	rows, err := db.QueryContext(ctx, `SELECT a.question_id FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		seen[id] = true
	}
	return rows.Err()
}

type recorded struct {
	id    int64
	picks []Pick
	// topic is the one topic the recorded game was in (a topic's game), "" for all of them (a duel's).
	topic string
}

// RecordingBand is how far a recording's player's rating may be from the player's to be their match, while there's
// one that close; RecordingRights how many right answers make a game worth playing against, and RecordingMissed how
// many not answered at most (one left halfway, the tab closed, isn't: a duel would wait out each missing answer).
const (
	RecordingBand   = 150
	RecordingRights = 3
	RecordingMissed = 2
)

// recordedRun is another player's finished run of ten questions (none still played against: a duel's, a challenge's),
// all still in play as it played them (asPlayed: none retired, none changed since), none of today's and none due
// for review (dayBars.now; a day's run never), played at a person's speed (not marked a script's: fair.go), to play
// against: a real game (RecordingRights right or more, RecordingMissed not answered at most), by a player whose rating
// is within RecordingBand of the player's, the one with the fewest questions the player has seen (seen, read before
// the write) or a day ahead holds (ahead.go: a game played before those days were drawn may have them), the latest
// first. Short of such, the nearest it gets: any real game, then any game. At each of these, a game over all the topics (a duel's) comes before one in a
// single topic, which the duel's player didn't choose. Nil if there's none.
func (g *Game) recordedRun(tx *sql.Tx, userID int64, seen map[string]bool) (*recorded, error) {
	days, err := g.days(tx)
	if err != nil {
		return nil, err
	}
	var mine int
	if err := tx.QueryRow(`SELECT rating FROM users WHERE id = ?`, userID).Scan(&mine); err != nil {
		return nil, err
	}
	// A script's game is left out before the limit, so that a script's many games can't push the people's out of it.
	rows, err := tx.Query(`SELECT r.id, r.questions, r.rights, u.rating, r.finished_at,
			CASE WHEN r.kind = 'topic' THEN coalesce(r.category, '') ELSE '' END,
			(SELECT count(*) FROM answers a WHERE a.run_id = r.id AND a.given IS NULL)
		FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind IN ('topic', 'duel') AND r.finished_at IS NOT NULL AND NOT r.shadow AND r.user_id <> ?
			AND json_array_length(r.questions) = ?
			AND NOT EXISTS (SELECT 1 FROM duels d WHERE d.ended_at IS NULL
				AND (d.a_run = r.id OR d.b_run = r.id OR (d.kind = 'challenge' AND d.ghost_run = r.id)))
		ORDER BY r.finished_at DESC LIMIT 200`, userID, Length)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	b := g.Bank()
	// The best of each kind: in the band and real (0, 1), real (2, 3), any (4, 5), each over all the topics first,
	// then in one; each the fewest seen, the latest first.
	var best [6]*recorded
	var fewest [6]int
	for i := range fewest {
		fewest[i] = Length + 1
	}
	for rows.Next() {
		var id, finished int64
		var raw string
		var rights, rating, missed int
		var topic string
		if err := rows.Scan(&id, &raw, &rights, &rating, &finished, &topic, &missed); err != nil {
			return nil, err
		}
		var picks []Pick
		if json.Unmarshal([]byte(raw), &picks) != nil {
			continue
		}
		n, whole := 0, true
		for _, p := range picks {
			if !asPlayed(b, p, finished) || days.now[p.ID] {
				whole = false
			}
			if seen[p.ID] || days.all[p.ID] {
				n++
			}
		}
		if !whole {
			continue
		}
		real := rights >= RecordingRights && missed <= RecordingMissed
		one := 0 // a single topic's game: after the games over all of them
		if topic != "" {
			one = 1
		}
		for level, fits := range [3]bool{real && abs(rating-mine) <= RecordingBand, real, true} {
			if kind := 2*level + one; fits && n < fewest[kind] {
				best[kind], fewest[kind] = &recorded{id: id, picks: picks, topic: topic}, n
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, r := range best {
		if r != nil {
			return r, nil
		}
	}
	return nil, nil
}

// asPlayed says whether a finished run's question is still in play as the run played it (by finished, ms): not
// retired, and the version it showed (one from before versions were kept: not changed since). A recording replays
// its answers against it, and a run's answers to another version say nothing of this one.
func asPlayed(b *bank.Bank, p Pick, finished int64) bool {
	q, ok := b.Get(p.ID)
	switch {
	case !ok || q.Extra().Retired:
		return false
	case p.V != "":
		return bank.Version(q) == p.V
	}
	return changedMs(q) <= finished
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// settleRun settles the duel a just-finished run belongs to once both sides are played (a live one against a
// recording, or a challenge's game, once the player's is); and, when it's a challenge sent to friends before it was
// played, starts its time and tells them (sent).
func (g *Game) settleRun(ctx context.Context, runID int64) error {
	if err := g.sent(ctx, runID); err != nil {
		return err
	}
	var duelID int64
	var ghost, aDone, bDone bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT d.id, d.ghost_run IS NOT NULL,
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.a_run), 0),
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.b_run), 0)
		FROM duels d WHERE (d.a_run = ?1 OR d.b_run = ?1) AND d.ended_at IS NULL`, runID).
		Scan(&duelID, &ghost, &aDone, &bDone)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	switch {
	case aDone && bDone:
		return g.settleDuel(ctx, duelID, false, runID)
	case ghost && aDone:
		return g.settleDuel(ctx, duelID, true, runID)
	}
	return nil
}

// RecordedRatedPerDay is how many duels against recordings move a player's rating in a day: past it, they're
// friendlies, so a rating can't be farmed against the recordings of the weak (or of one's own second account).
const RecordedRatedPerDay = 5

// recordedRatedToday is how many duels against recordings have moved a player's rating today (in Bulgaria).
func (g *Game) recordedRatedToday(tx *sql.Tx, userID int64) (int, error) {
	now := g.Now().In(Bulgaria)
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, Bulgaria)
	var n int
	err := tx.QueryRow(`SELECT count(*) FROM duels WHERE rated = 1 AND kind = 'live' AND ghost_run IS NOT NULL AND a_id = ?
		AND ended_at >= ?`, userID, store.Ms(midnight)).Scan(&n)
	return n, err
}

// ratedToday says whether a duel between the two players (a live one, or a challenge between them) has already moved
// their ratings today (in Bulgaria).
func (g *Game) ratedToday(tx *sql.Tx, a, b int64) (bool, error) {
	now := g.Now().In(Bulgaria)
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, Bulgaria)
	var n int
	err := tx.QueryRow(`SELECT count(*) FROM duels WHERE rated = 1 AND outcome IN ('a', 'b', 'draw')
		AND ended_at >= ?1 AND ((a_id = ?2 AND b_id = ?3) OR (a_id = ?3 AND b_id = ?2))`, store.Ms(midnight), a, b).Scan(&n)
	return n > 0, err
}

// settleDuel ends a duel: both played (a result for both), or one played against a game played back (ghost: a
// recording, or a challenge's sender's game). Two people who both asked to play, a live duel's two or a challenge
// between friends, both have its result. A live duel's two, or a challenge drawn for the pair played by the friend it
// was drawn for (still a friend), move their ratings with the first duel of the day between them; one after is a
// friendly. Any other challenge moves no rating (challenges.go says why). Against a recording only the player has a
// result, and their rating moves half as far, RecordedRatedPerDay times a day; a challenge taken by anyone but a
// friend is told to its sender quietly (challengeNews). A duel already ended (both sides finished at once, and the other settled it) is left as it is.
func (g *Game) settleDuel(ctx context.Context, duelID int64, ghost bool, finished int64) error {
	type side struct {
		id             int64
		name           string
		run            int64
		points, rights int
		ms             int64
		rating, rated  int
	}
	var a, b side
	var news []DuelNews
	settled := false
	var challenge sql.NullInt64 // a challenge's duel: its taker against the one who sent it (challenges.go)
	var outcome string
	both := !ghost // a person on each side, both with a result
	type run struct{ user, run int64 }
	var followed []run
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		followed = nil
		// follow notes, with the result, that what follows a side's run is due again (after.go): a duel won finishes
		// goals too. Not for the run that settles the duel: its own follow-up is under way.
		follow := func(user, r int64) error {
			if r == finished {
				return nil
			}
			followed = append(followed, run{user, r})
			return g.afterDue(tx, r)
		}
		other := "d.b_run"
		if ghost {
			other = "d.ghost_run"
		}
		var friends, pair bool
		err := tx.QueryRow(`SELECT d.a_id, ua.name, ua.rating, ua.rated, ra.id, ra.points, ra.rights, ra.ms,
				rb.user_id, ub.name, ub.rating, ub.rated, rb.id, rb.points, rb.rights, rb.ms, d.challenge_id, d.b_id IS NOT NULL,
				-- drawn for this pair, and friends still
				coalesce((SELECT for_id FROM challenges WHERE id = d.challenge_id), 0) = d.a_id
					AND EXISTS (SELECT 1 FROM friends WHERE user_id = d.a_id AND friend_id = rb.user_id)
			FROM duels d JOIN users ua ON ua.id = d.a_id JOIN runs ra ON ra.id = d.a_run
			JOIN runs rb ON rb.id = `+other+` JOIN users ub ON ub.id = rb.user_id
			WHERE d.id = ? AND d.ended_at IS NULL AND ra.finished_at IS NOT NULL AND rb.finished_at IS NOT NULL`, duelID).
			Scan(&a.id, &a.name, &a.rating, &a.rated, &a.run, &a.points, &a.rights, &a.ms,
				&b.id, &b.name, &b.rating, &b.rated, &b.run, &b.points, &b.rights, &b.ms, &challenge, &friends, &pair)
		if errors.Is(err, sql.ErrNoRows) {
			settled = true // the other side's last answer settled it a moment ago: it's done
			return nil
		}
		if err != nil {
			return err
		}
		recording := ghost && !challenge.Valid
		both = both || (challenge.Valid && friends)
		var rated bool
		switch {
		case challenge.Valid && !pair:
			rated = false // a game that could be chosen to win, or taken knowing it: no rating moves
		case recording:
			n, err := g.recordedRatedToday(tx, a.id)
			if err != nil {
				return err
			}
			rated = n < RecordedRatedPerDay
		default:
			done, err := g.ratedToday(tx, a.id, b.id)
			if err != nil {
				return err
			}
			rated = !done
		}
		// More points wins; the same points, the quicker.
		score := 0.5
		switch {
		case a.points > b.points || (a.points == b.points && a.ms < b.ms):
			score = 1
		case a.points < b.points || (a.points == b.points && a.ms > b.ms):
			score = 0
		}
		outcomeOf := func(s float64) string {
			switch s {
			case 1:
				return "won"
			case 0:
				return "lost"
			}
			return "draw"
		}
		// rate moves a player's rating by a duel (if it counts), and says by how much and to what (null: it didn't).
		rate := func(s side, against int, score float64) (int, sql.NullInt64, error) {
			var after sql.NullInt64
			if !rated {
				return 0, after, nil
			}
			d := eloDelta(s.rating, against, s.rated, score)
			if recording {
				d /= 2 // a recording doesn't play to win: it moves a rating half as far
			}
			err := tx.QueryRow(`UPDATE users SET rating = max(0, rating + ?1), peak = max(peak, rating + ?1), rated = rated + 1
				WHERE id = ?2 RETURNING rating`, d, s.id).Scan(&after)
			return d, after, err
		}
		now := store.Ms(g.Now())
		// opponent_id is a player the duel was against, never a recording's: the year's rival counts only duels
		// played against a person.
		opponentID := sql.NullInt64{Int64: b.id, Valid: !recording}
		da, ra, err := rate(a, b.rating, score)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE runs SET opponent = ?, opponent_id = ?, recorded = ?, outcome = ? WHERE id = ?`,
			b.name, opponentID, recording, outcomeOf(score), a.run); err != nil {
			return err
		}
		news = append(news, DuelNews{To: a.id, Kind: "result", From: b.name, FromID: b.id, Outcome: outcomeOf(score), Delta: da,
			Friendly: !rated, DuelID: duelID, Seen: a.run == finished})
		if err := follow(a.id, a.run); err != nil {
			return err
		}
		if !both {
			outcome = outcomeOf(score)
			_, err = tx.Exec(`UPDATE duels SET ended_at = ?, outcome = ?, a_delta = ?, a_rating = ?, rated = ? WHERE id = ?`,
				now, "ghost_"+outcomeOf(score), da, ra, rated, duelID)
			return err
		}
		db, rb, err := rate(b, a.rating, 1-score)
		if err != nil {
			return err
		}
		// A challenge's sender's game is theirs alone, played against by everyone who takes it: the result is the
		// duel's, not the game's.
		if !ghost {
			if _, err := tx.Exec(`UPDATE runs SET opponent = ?, opponent_id = ?, recorded = 0, outcome = ? WHERE id = ?`,
				a.name, a.id, outcomeOf(1-score), b.run); err != nil {
				return err
			}
		}
		news = append(news, DuelNews{To: b.id, Kind: "result", From: a.name, FromID: a.id, Outcome: outcomeOf(1 - score), Delta: db,
			Friendly: !rated, DuelID: duelID, Seen: b.run == finished})
		if err := follow(b.id, b.run); err != nil {
			return err
		}
		outcome := map[float64]string{1: "a", 0: "b", 0.5: "draw"}[score]
		_, err = tx.Exec(`UPDATE duels SET ended_at = ?, outcome = ?, a_delta = ?, b_delta = ?, a_rating = ?, b_rating = ?,
			rated = ? WHERE id = ?`, now, outcome, da, db, ra, rb, rated, duelID)
		return err
	})
	if err != nil || settled {
		return err
	}
	if challenge.Valid && !both {
		if err := g.challengeNews(ctx, challenge.Int64, a.id, a.name, outcome, duelID); err != nil {
			return err
		}
	}
	// A duel won finishes goals too: what follows each side's run is done again, but the run that has just settled the
	// duel, whose own follow-up this is. What fails is left to the sweep (AfterDue): the duel's result is kept.
	for _, f := range followed {
		if err := g.after(ctx, f.user, f.run); err != nil {
			slog.Error("after a duel", "duel", duelID, "run", f.run, "err", err)
		}
	}
	if g.DuelNews != nil {
		for _, n := range news {
			g.DuelNews(ctx, n)
		}
	}
	return nil
}

// SettleDue ends the duels whose time is up — a challenge not played in time, a live duel cut off — and
// the tournaments whose time is up. Run every few minutes. A week of the leagues that's over ends first.
func (g *Game) SettleDue(ctx context.Context) error {
	if err := g.ensureWeek(ctx); err != nil {
		return err
	}
	if err := g.settleRoyalsDue(ctx); err != nil {
		return err
	}
	now := store.Ms(g.Now())
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, d.ghost_run IS NOT NULL,
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.a_run), 0),
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.b_run), 0)
		FROM duels d WHERE d.ended_at IS NULL AND d.expires_at <= ?`, now)
	if err != nil {
		return err
	}
	type due struct {
		id                  int64
		ghost, aDone, bDone bool
	}
	var list []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.ghost, &d.aDone, &d.bDone); err != nil {
			rows.Close()
			return err
		}
		list = append(list, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, d := range list {
		switch {
		case d.aDone && d.bDone:
			err = g.settleDuel(ctx, d.id, false, 0)
		case d.ghost && d.aDone: // finished, and not settled then (a restart in between)
			err = g.settleDuel(ctx, d.id, true, 0)
		default:
			_, err = g.DB.Write.ExecContext(ctx, `UPDATE duels SET ended_at = ?, outcome = 'expired' WHERE id = ? AND ended_at IS NULL`,
				now, d.id)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// DuelsOf are a player's duels: challenges to play or waiting (theirs to take once their sender has played; those
// they sent, until each is played), then the latest ended (a live duel shows once it's over). The other's score shows
// only once the duel has ended: nobody plays knowing what to beat.
func (g *Game) DuelsOf(ctx context.Context, userID int64) ([]DuelView, error) {
	return g.duelsOf(ctx, userID, 0)
}

// duelsOf are DuelsOf, or (only) that one duel of theirs. The player is a, or b: a live duel's other, or a
// challenge's sender (whose game is its ghost_run).
func (g *Game) duelsOf(ctx context.Context, userID, only int64) ([]DuelView, error) {
	// mine: the player is a. The other side may be none: a player who has gone since (play.Forget), whose game went
	// with them.
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, d.kind, d.created_at, d.expires_at, coalesce(d.ended_at, 0),
			coalesce(d.outcome, ''), d.mine, d.rated,
			coalesce(CASE WHEN d.mine THEN d.a_delta ELSE d.b_delta END, 0),
			coalesce(CASE WHEN d.mine THEN d.a_run WHEN d.kind = 'challenge' THEN d.ghost_run ELSE d.b_run END, 0),
			coalesce(CASE WHEN NOT d.mine THEN d.a_run WHEN d.ghost_run IS NOT NULL THEN d.ghost_run ELSE d.b_run END, 0),
			coalesce(CASE WHEN NOT d.mine THEN d.a_id WHEN d.ghost_run IS NOT NULL
				THEN (SELECT user_id FROM runs WHERE id = d.ghost_run) ELSE d.b_id END, 0),
			CASE WHEN d.mine THEN d.a_left ELSE d.b_left END, CASE WHEN d.mine THEN d.b_left ELSE d.a_left END,
			coalesce(c.code, ''), d.b_id IS NOT NULL, coalesce(c.for_id = d.a_id, 0)
		FROM (SELECT *, coalesce(a_id = ?1, 0) AS mine FROM duels WHERE a_id = ?1 OR b_id = ?1) d
		LEFT JOIN challenges c ON c.id = d.challenge_id
		WHERE (d.kind = 'challenge' OR d.ended_at IS NOT NULL)
			-- a challenge is its taker's once its sender has played it (one played, whose sender has gone since, too)
			AND NOT (d.mine AND d.kind = 'challenge' AND (d.ended_at IS NULL OR d.ghost_run IS NOT NULL)
				AND coalesce((SELECT finished_at FROM runs WHERE id = d.ghost_run), 0) = 0)
			AND (?2 = 0 OR d.id = ?2)
		ORDER BY d.ended_at IS NOT NULL, coalesce(d.ended_at, d.created_at) DESC LIMIT 50`, userID, only)
	if err != nil {
		return nil, err
	}
	type row struct {
		v                       DuelView
		outcome                 string
		mine, rated, friends    bool
		pair                    bool
		myRun, theirRun, theirs int64
	}
	var list []row
	for rows.Next() {
		var r row
		var youLeft, theyLeft sql.NullInt64
		if err := rows.Scan(&r.v.ID, &r.v.Kind, &r.v.CreatedAt, &r.v.ExpiresAt, &r.v.EndedAt, &r.outcome, &r.mine,
			&r.rated, &r.v.Delta, &r.myRun, &r.theirRun, &r.theirs, &youLeft, &theyLeft, &r.v.Challenge, &r.friends,
			&r.pair); err != nil {
			rows.Close()
			return nil, err
		}
		for _, l := range []struct {
			n  sql.NullInt64
			to **int
		}{{youLeft, &r.v.YouLeft}, {theyLeft, &r.v.TheyLeft}} {
			if l.n.Valid {
				n := int(l.n.Int64)
				*l.to = &n
			}
		}
		list = append(list, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]DuelView, 0, len(list))
	for _, r := range list {
		v := r.v
		v.RunID, v.against, v.theirRun = r.myRun, r.theirs, r.theirRun
		challenge := v.Kind == "challenge"
		v.Sent = challenge && !r.mine
		if challenge && r.friends {
			v.Friend = r.theirs
		}
		var err error
		if v.You, err = g.duelSide(ctx, userID, r.myRun, true); err != nil {
			return nil, err
		}
		if r.theirs != 0 {
			if v.Opponent, err = g.duelSide(ctx, r.theirs, r.theirRun, v.EndedAt != 0); err != nil {
				return nil, err
			}
		} else {
			// Every duel has another side (a player, a recording's, a challenge's sender): none is one who's gone.
			v.Opponent = &DuelSide{Name: GoneName, Done: true}
		}
		v.Recorded = strings.HasPrefix(r.outcome, "ghost_") && !challenge
		won := map[bool]string{true: "a", false: "b"}[r.mine]
		switch {
		case r.outcome == won || r.outcome == "ghost_won":
			v.State = "won"
		case r.outcome == "draw" || r.outcome == "ghost_draw":
			v.State = "draw"
		case r.outcome == "a" || r.outcome == "b" || r.outcome == "ghost_lost":
			v.State = "lost"
		case r.outcome == "declined" || r.outcome == "expired":
			v.State = r.outcome
		case v.You == nil || !v.You.Done:
			v.State = "play"
		default:
			v.State = "wait"
		}
		// Friendly: a duel that could have moved ratings, and didn't (only a challenge drawn for the pair could).
		v.Friendly = !r.rated && (!challenge || r.pair) && (v.State == "won" || v.State == "lost" || v.State == "draw")
		out = append(out, v)
	}
	return out, nil
}

// duelSide is a player in a duel: who they are, and (when shown) how their run went.
func (g *Game) duelSide(ctx context.Context, userID, runID int64, show bool) (*DuelSide, error) {
	var s DuelSide
	var avatar, title string
	var points int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT u.name, u.tag, `+lookColumns+` FROM users u WHERE u.id = ?`, userID).
		Scan(&s.Name, &s.Tag, &avatar, &title, &points)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	look := g.lookOf(userID, avatar, title, points)
	s.Look = &look
	if runID != 0 {
		err = g.DB.Read.QueryRowContext(ctx, `SELECT finished_at IS NOT NULL, points, rights, ms FROM runs WHERE id = ?`, runID).
			Scan(&s.Done, &s.Points, &s.Rights, &s.Ms)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	if !show {
		s.Points, s.Rights, s.Ms = 0, 0, 0
	}
	return &s, nil
}

// DuelOf is one of a player's duels, as DuelsOf has it, with what its result says: how each question went for each
// side (the other's once it has a result), the question that decided it, where the player's rating went, and their
// record against this opponent. ErrNoDuel if it isn't theirs (or, live, isn't over).
func (g *Game) DuelOf(ctx context.Context, userID, duelID int64) (DuelView, error) {
	list, err := g.duelsOf(ctx, userID, duelID)
	if err != nil || len(list) == 0 {
		return DuelView{}, cmp.Or(err, ErrNoDuel)
	}
	v := list[0]
	result := v.State == "won" || v.State == "lost" || v.State == "draw"
	if v.You != nil && v.RunID != 0 {
		if v.You.Marks, err = g.duelMarks(ctx, v.RunID); err != nil {
			return v, err
		}
	}
	if !result {
		return v, nil
	}
	if v.Opponent != nil && v.theirRun != 0 {
		if v.Opponent.Marks, err = g.duelMarks(ctx, v.theirRun); err != nil {
			return v, err
		}
		if v.You != nil {
			v.Decided = decided(v.You.Marks, v.Opponent.Marks, v.You.Points, v.Opponent.Points)
		}
	}
	var after sql.NullInt64
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT CASE WHEN a_id = ? THEN a_rating ELSE b_rating END FROM duels
		WHERE id = ?`, userID, duelID).Scan(&after); err != nil {
		return v, err
	}
	if after.Valid && v.Delta != 0 {
		r := DuelRating{Before: int(after.Int64) - v.Delta, After: int(after.Int64)}
		var next int
		if r.Division, next = DivisionOf(r.After); next != 0 {
			n, _ := DivisionOf(next)
			r.Next = &n
		}
		v.Rating = &r
	}
	if !v.Recorded && v.against != 0 {
		r, err := g.recordAgainst(ctx, userID, v.against)
		if err != nil {
			return v, err
		}
		v.Record = &r
		if v.Kind == "live" || v.Kind == "challenge" {
			// Met by chance, or by a link: a tap from asking them to be friends, unless they are, or either has asked.
			err := g.DB.Read.QueryRowContext(ctx, `SELECT NOT (EXISTS (SELECT 1 FROM friends WHERE user_id = ?1 AND friend_id = ?2)
				OR EXISTS (SELECT 1 FROM friend_requests WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)))`,
				userID, v.against).Scan(&v.Befriend)
			if err != nil {
				return v, err
			}
		}
	}
	return v, nil
}

// duelMarks is how each question of a run went, in order.
func (g *Game) duelMarks(ctx context.Context, runID int64) ([]DuelMark, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT points, is_right, ms, given IS NULL FROM answers WHERE run_id = ?
		ORDER BY n`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DuelMark
	for rows.Next() {
		var m DuelMark
		if err := rows.Scan(&m.Points, &m.Right, &m.Ms, &m.Missed); err != nil {
			return nil, err
		}
		m.Partial = m.Points > 0 && !m.Right
		out = append(out, m)
	}
	return out, rows.Err()
}

// decided is the question (from 1) after which a duel's winner on points led to the end, by how each question went
// for each side (a and b) and their games' points (what isn't in the answers, the bonus for all right, comes with the
// last question); 0 when their points end even.
func decided(a, b []DuelMark, pointsA, pointsB int) int {
	n := max(len(a), len(b))
	if n == 0 {
		return 0
	}
	lead := make([]int, n) // a's lead over b after each question
	sum := 0
	for i := range n {
		if i < len(a) {
			sum += a[i].Points
		}
		if i < len(b) {
			sum -= b[i].Points
		}
		lead[i] = sum
	}
	lead[n-1] = pointsA - pointsB
	sum = lead[n-1]
	if sum == 0 {
		return 0
	}
	at := 1
	for i, l := range lead {
		if (sum > 0 && l <= 0) || (sum < 0 && l >= 0) {
			at = i + 2 // not ahead after this one: if anywhere, it was decided on the next
		}
	}
	return at
}

// duelResults is, in a query whose ?1 is a player, every duel they've played to a result, one row each: the other
// (a person; null against a recording), how it went for the player (won, lost, draw) and when it ended. A
// challenge's sender has a result only of one a friend took, a duel between the two (b_id); the game they sent is
// theirs alone, and the duels anyone else plays against it are the takers' (each taker's other is the sender).
const duelResults = `(SELECT d.id, coalesce(d.b_id, c.user_id) AS other,
		CASE WHEN d.outcome IN ('a', 'ghost_won') THEN 'won' WHEN d.outcome IN ('b', 'ghost_lost') THEN 'lost' ELSE 'draw' END
			AS outcome, d.ended_at
	FROM duels d LEFT JOIN challenges c ON c.id = d.challenge_id
	WHERE d.a_id = ?1 AND d.outcome IN ('a', 'b', 'draw', 'ghost_won', 'ghost_lost', 'ghost_draw')
	UNION ALL
	SELECT d.id, d.a_id, CASE d.outcome WHEN 'b' THEN 'won' WHEN 'a' THEN 'lost' ELSE 'draw' END, d.ended_at
	FROM duels d WHERE d.b_id = ?1 AND d.outcome IN ('a', 'b', 'draw'))`

// recordAgainst is how a player's duels against another went: won, lost, drawn.
func (g *Game) recordAgainst(ctx context.Context, userID, other int64) (Record, error) {
	var r Record
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FILTER (WHERE outcome = 'won'),
			count(*) FILTER (WHERE outcome = 'lost'), count(*) FILTER (WHERE outcome = 'draw')
		FROM `+duelResults+` WHERE other = ?2`, userID, other).Scan(&r.Won, &r.Lost, &r.Drawn)
	return r, err
}
