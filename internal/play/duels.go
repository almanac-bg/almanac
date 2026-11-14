package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	mrand "math/rand/v2"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Duels are two players on the same ten questions; more points wins, the same points the quicker.
//
// A duel with whoever comes is played live, both on each question at the same moment (internal/live runs it; here
// it's made, and settled once both runs are done). If nobody comes in time, it's played against a recording of a
// real player's earlier game on the same questions (a topic's or a duel's, never the day's, and none with today's
// questions in it), a real one by a player of about their rating (recordedRun): only the player's rating moves, and
// half as far, as the recorded one didn't ask to play nor plays to win; and only RecordedRatedPerDay such duels a day
// move it.
//
// A friend is challenged in their own time: the challenger plays at once, and the friend hears of it when they've
// finished; from then they have FriendFor to play the same questions or say no.
//
// Only the first duel of a day between the same two players moves their ratings; those after are friendlies, so
// that two accounts can't trade wins for rating.

const (
	// FriendFor is how long a friend has to play a duel they're challenged to, from when they hear of it.
	FriendFor = 48 * time.Hour
	// MaxWaiting is how many challenges a player may have waiting on friends at once.
	MaxWaiting = 5
	// LiveFor is how long a live duel may take before it counts as cut off (the server restarted under it): ten
	// questions at their longest, with the pauses between, take well under it.
	LiveFor = 20 * time.Minute
)

var (
	ErrNoDuel      = errors.New("no such duel")
	ErrManyWaiting = errors.New("too many duels waiting")
	// ErrNobody is that there's nobody to play: no one waiting, and no recording to play against yet.
	ErrNobody = errors.New("nobody to play")
)

// DuelNews is told to whoever should hear of a duel: a friend challenges them, or a result.
type DuelNews struct {
	To   int64
	Kind string // asked, result
	From string // the other player's name
	// Outcome is the one told's: won, lost or draw (with a result).
	Outcome string
	Delta   int
	// Friendly is a result that didn't move ratings (not the first duel of the day between the two, or past the day's
	// rated duels against recordings).
	Friendly bool
	DuelID   int64
}

// DuelView is a duel as one of its two players sees it.
type DuelView struct {
	ID   int64  `json:"id"`
	Kind string `json:"kind"` // live, friend
	// State is the player's: play (their turn), wait (the other's), won, lost, draw, declined, expired (no result:
	// not played in time, or a live one cut off).
	State string `json:"state"`
	// Opponent is the other player, or the recorded one it was played against.
	Opponent *DuelSide `json:"opponent,omitempty"`
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
}

// Live is a live duel just made: the questions, and each side's player and run. Against a recording, the second
// side is the recorded player and the run it plays back, with how they answered each question.
type Live struct {
	DuelID    int64
	Picks     []Pick
	Users     [2]int64
	Runs      [2]int64
	Recording []Recorded
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
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if l.Picks, err = g.drawFor(ctx, tx, a, b); err != nil {
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
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		rec, err := g.recordedRun(tx, userID)
		if err != nil {
			return err
		}
		if rec == nil {
			return ErrNobody
		}
		l.Picks = rec.picks
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

// CancelLive ends a live duel without a result: a player never came to it.
func (g *Game) CancelLive(ctx context.Context, duelID int64) error {
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE duels SET ended_at = ?, outcome = 'expired'
		WHERE id = ? AND kind = 'live' AND ended_at IS NULL`, store.Ms(g.Now()), duelID)
	return err
}

// EndLive ends every live duel still under way without a result: run when the server starts, as live duels are
// played in its memory and a restart cuts them off.
func (g *Game) EndLive(ctx context.Context) error {
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE duels SET ended_at = ?, outcome = 'expired'
		WHERE kind = 'live' AND ended_at IS NULL`, store.Ms(g.Now()))
	return err
}

// ChallengeFriend starts a duel with a friend: the player plays it now, the friend when they can.
func (g *Game) ChallengeFriend(ctx context.Context, userID, friendID int64) (State, int64, error) {
	if _, err := g.Friend(ctx, userID, friendID); err != nil {
		return State{}, 0, err
	}
	var s State
	var duelID int64
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		if err := g.mayStart(tx, userID); err != nil {
			return err
		}
		picks, err := g.drawFor(ctx, tx, userID)
		if err != nil {
			return err
		}
		r, err := g.insertRun(tx, userID, "duel", nil, nil, picks)
		if err != nil {
			return err
		}
		data, _ := json.Marshal(picks)
		now := store.Ms(g.Now())
		// The friend's time starts once the challenger has played (settleRun); until then, this is how long the
		// challenger has.
		res, err := tx.Exec(`INSERT INTO duels (kind, questions, a_id, a_run, b_id, created_at, expires_at)
			VALUES ('friend', ?, ?, ?, ?, ?, ?)`, string(data), userID, r.id, friendID, now, now+FriendFor.Milliseconds())
		if err != nil {
			return err
		}
		duelID, _ = res.LastInsertId()
		s, err = g.state(tx, r)
		return err
	})
	return s, duelID, err
}

// PlayDuel is the player's run in a friend's challenge: made the first time (once the friend has played theirs),
// the same after.
func (g *Game) PlayDuel(ctx context.Context, userID, duelID int64) (State, error) {
	var s State
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var questions string
		var bRun sql.NullInt64
		var aDone bool
		err := tx.QueryRow(`SELECT d.questions, d.b_run, r.finished_at IS NOT NULL FROM duels d JOIN runs r ON r.id = d.a_run
			WHERE d.id = ? AND d.kind = 'friend' AND d.b_id = ? AND d.ended_at IS NULL`, duelID, userID).Scan(&questions, &bRun, &aDone)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && !aDone) {
			return ErrNoDuel
		}
		if err != nil {
			return err
		}
		if bRun.Valid {
			r, err := load(tx, userID, bRun.Int64)
			if err != nil {
				return err
			}
			s, err = g.state(tx, r)
			return err
		}
		var picks []Pick
		if err := json.Unmarshal([]byte(questions), &picks); err != nil {
			return err
		}
		r, err := g.insertRun(tx, userID, "duel", nil, nil, picks)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE duels SET b_run = ? WHERE id = ?`, r.id, duelID); err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, err
}

// DeclineDuel ends a friend's challenge that hasn't been played by both: the friend says no (before they start), or
// the challenger calls it off.
func (g *Game) DeclineDuel(ctx context.Context, userID, duelID int64) error {
	res, err := g.DB.Write.ExecContext(ctx, `UPDATE duels SET outcome = 'declined', ended_at = ?
		WHERE id = ? AND kind = 'friend' AND ended_at IS NULL AND b_run IS NULL AND (b_id = ? OR a_id = ?)`,
		store.Ms(g.Now()), duelID, userID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoDuel
	}
	return nil
}

// mayStart refuses a player one more challenge while too many of theirs wait on friends.
func (g *Game) mayStart(tx *sql.Tx, userID int64) error {
	var n int
	if err := tx.QueryRow(`SELECT count(*) FROM duels WHERE a_id = ? AND kind = 'friend' AND ended_at IS NULL`, userID).Scan(&n); err != nil {
		return err
	}
	if n >= MaxWaiting {
		return ErrManyWaiting
	}
	return nil
}

// drawFor draws a duel's ten questions for its players: all topics, shaped by how well they know them (on
// average), questions neither has seen first.
func (g *Game) drawFor(ctx context.Context, tx *sql.Tx, users ...int64) ([]Pick, error) {
	seen := map[string]bool{}
	ability := 0.0
	for _, id := range users {
		s, err := seenBy(tx, id)
		if err != nil {
			return nil, err
		}
		for q := range s {
			seen[q] = true
		}
		a, err := g.ability(ctx, tx, id, "")
		if err != nil {
			return nil, err
		}
		ability += a / float64(len(users))
	}
	barred, err := g.dayQuestions(tx)
	if err != nil {
		return nil, err
	}
	picks := Draw(g.Bank(), "", ability, seen, barred, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
	if len(picks) == 0 {
		return nil, ErrNoQuestion
	}
	return picks, nil
}

func seenBy(tx *sql.Tx, userID int64) (map[string]bool, error) {
	seen := map[string]bool{}
	rows, err := tx.Query(`SELECT a.question_id FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		seen[id] = true
	}
	return seen, rows.Err()
}

type recorded struct {
	id    int64
	picks []Pick
}

// RecordingBand is how far a recording's player's rating may be from the player's to be their match, while there's
// one that close; RecordingRights how many right answers make a game worth playing against.
const (
	RecordingBand   = 150
	RecordingRights = 3
)

// recordedRun is another player's finished run of ten questions, all still in the bank and none of today's (a day's
// run never), to play against: a real game (RecordingRights right or more), by a player whose rating is within
// RecordingBand of the player's, the one with the fewest questions the player has seen, the latest first. Short of
// such, the nearest it gets: any real game, then any game. Nil if there's none.
func (g *Game) recordedRun(tx *sql.Tx, userID int64) (*recorded, error) {
	seen, err := seenBy(tx, userID)
	if err != nil {
		return nil, err
	}
	barred, err := g.dayQuestions(tx)
	if err != nil {
		return nil, err
	}
	var mine int
	if err := tx.QueryRow(`SELECT rating FROM users WHERE id = ?`, userID).Scan(&mine); err != nil {
		return nil, err
	}
	rows, err := tx.Query(`SELECT r.id, r.questions, r.rights, u.rating FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind IN ('topic', 'duel') AND r.finished_at IS NOT NULL AND r.user_id <> ? AND json_array_length(r.questions) = ?
		ORDER BY r.finished_at DESC LIMIT 200`, userID, Length)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	b := g.Bank()
	// The best of each kind: in the band and real (0), real (1), any (2); each the fewest seen, the latest first.
	var best [3]*recorded
	var fewest [3]int
	for i := range fewest {
		fewest[i] = Length + 1
	}
	for rows.Next() {
		var id int64
		var raw string
		var rights, rating int
		if err := rows.Scan(&id, &raw, &rights, &rating); err != nil {
			return nil, err
		}
		var picks []Pick
		if json.Unmarshal([]byte(raw), &picks) != nil {
			continue
		}
		n, whole := 0, true
		for _, p := range picks {
			if _, ok := b.Get(p.ID); !ok || barred[p.ID] {
				whole = false
			}
			if seen[p.ID] {
				n++
			}
		}
		if !whole {
			continue
		}
		real := rights >= RecordingRights
		for kind, fits := range [3]bool{real && abs(rating-mine) <= RecordingBand, real, true} {
			if fits && n < fewest[kind] {
				best[kind], fewest[kind] = &recorded{id: id, picks: picks}, n
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

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// settleRun settles the duel a just-finished run belongs to once both sides are played (a live one against a
// recording, once the player's is); and, when a challenger has played, starts their friend's time and tells them.
func (g *Game) settleRun(ctx context.Context, runID int64) error {
	var duelID, aID, aRun int64
	var kind, aName string
	var bID sql.NullInt64
	var ghost, aDone, bDone bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT d.id, d.kind, d.a_id, ua.name, d.a_run, d.b_id, d.ghost_run IS NOT NULL,
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.a_run), 0),
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.b_run), 0)
		FROM duels d JOIN users ua ON ua.id = d.a_id WHERE (d.a_run = ?1 OR d.b_run = ?1) AND d.ended_at IS NULL`, runID).
		Scan(&duelID, &kind, &aID, &aName, &aRun, &bID, &ghost, &aDone, &bDone)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	switch {
	case aDone && bDone:
		return g.settleDuel(ctx, duelID, false)
	case kind == "live" && ghost && aDone:
		return g.settleDuel(ctx, duelID, true)
	case kind == "friend" && aDone && runID == aRun && bID.Valid:
		if _, err := g.DB.Write.ExecContext(ctx, `UPDATE duels SET expires_at = ? WHERE id = ?`,
			store.Ms(g.Now().Add(FriendFor)), duelID); err != nil {
			return err
		}
		if g.DuelNews != nil {
			g.DuelNews(ctx, DuelNews{To: bID.Int64, Kind: "asked", From: aName, DuelID: duelID})
		}
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
	err := tx.QueryRow(`SELECT count(*) FROM duels WHERE rated = 1 AND ghost_run IS NOT NULL AND a_id = ?
		AND ended_at >= ?`, userID, store.Ms(midnight)).Scan(&n)
	return n, err
}

// ratedToday says whether a duel between the two players has already moved their ratings today (in Bulgaria).
func (g *Game) ratedToday(tx *sql.Tx, a, b int64) (bool, error) {
	now := g.Now().In(Bulgaria)
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, Bulgaria)
	var n int
	err := tx.QueryRow(`SELECT count(*) FROM duels WHERE rated = 1 AND ghost_run IS NULL AND outcome IN ('a', 'b', 'draw')
		AND ended_at >= ?1 AND ((a_id = ?2 AND b_id = ?3) OR (a_id = ?3 AND b_id = ?2))`, store.Ms(midnight), a, b).Scan(&n)
	return n > 0, err
}

// settleDuel ends a duel: both played (a result for both), or a live one against a recording (a result for its
// player only). The first duel of the day between the two moves their ratings; one after is a friendly. A duel
// already ended (both sides finished at once, and the other settled it) is left as it is.
func (g *Game) settleDuel(ctx context.Context, duelID int64, ghost bool) error {
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
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		other := "d.b_run"
		if ghost {
			other = "d.ghost_run"
		}
		err := tx.QueryRow(`SELECT d.a_id, ua.name, ua.rating, ua.rated, ra.id, ra.points, ra.rights, ra.ms,
				rb.user_id, ub.name, ub.rating, ub.rated, rb.id, rb.points, rb.rights, rb.ms
			FROM duels d JOIN users ua ON ua.id = d.a_id JOIN runs ra ON ra.id = d.a_run
			JOIN runs rb ON rb.id = `+other+` JOIN users ub ON ub.id = rb.user_id
			WHERE d.id = ? AND d.ended_at IS NULL AND ra.finished_at IS NOT NULL AND rb.finished_at IS NOT NULL`, duelID).
			Scan(&a.id, &a.name, &a.rating, &a.rated, &a.run, &a.points, &a.rights, &a.ms,
				&b.id, &b.name, &b.rating, &b.rated, &b.run, &b.points, &b.rights, &b.ms)
		if errors.Is(err, sql.ErrNoRows) {
			settled = true // the other side's last answer settled it a moment ago: it's done
			return nil
		}
		if err != nil {
			return err
		}
		rated := true
		if ghost {
			n, err := g.recordedRatedToday(tx, a.id)
			if err != nil {
				return err
			}
			rated = n < RecordedRatedPerDay
		} else {
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
		// rate moves a player's rating by a duel (if it counts), and says by how much.
		rate := func(s side, against int, score float64) (int, error) {
			if !rated {
				return 0, nil
			}
			d := eloDelta(s.rating, against, s.rated, score)
			if ghost {
				d /= 2 // a recording doesn't play to win: it moves a rating half as far
			}
			_, err := tx.Exec(`UPDATE users SET rating = max(0, rating + ?1), peak = max(peak, rating + ?1), rated = rated + 1
				WHERE id = ?2`, d, s.id)
			return d, err
		}
		now := store.Ms(g.Now())
		da, err := rate(a, b.rating, score)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE runs SET opponent = ?, opponent_id = ?, recorded = ?, outcome = ? WHERE id = ?`,
			b.name, b.id, ghost, outcomeOf(score), a.run); err != nil {
			return err
		}
		news = append(news, DuelNews{To: a.id, Kind: "result", From: b.name, Outcome: outcomeOf(score), Delta: da,
			Friendly: !rated, DuelID: duelID})
		if ghost {
			_, err = tx.Exec(`UPDATE duels SET ended_at = ?, outcome = ?, a_delta = ?, rated = ? WHERE id = ?`,
				now, "ghost_"+outcomeOf(score), da, rated, duelID)
			return err
		}
		db, err := rate(b, a.rating, 1-score)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE runs SET opponent = ?, opponent_id = ?, recorded = 0, outcome = ? WHERE id = ?`,
			a.name, a.id, outcomeOf(1-score), b.run); err != nil {
			return err
		}
		news = append(news, DuelNews{To: b.id, Kind: "result", From: a.name, Outcome: outcomeOf(1 - score), Delta: db,
			Friendly: !rated, DuelID: duelID})
		outcome := map[float64]string{1: "a", 0: "b", 0.5: "draw"}[score]
		_, err = tx.Exec(`UPDATE duels SET ended_at = ?, outcome = ?, a_delta = ?, b_delta = ?, rated = ? WHERE id = ?`,
			now, outcome, da, db, rated, duelID)
		return err
	})
	if err != nil || settled {
		return err
	}
	for _, n := range news {
		if err := g.afterRun(ctx, n.To); err != nil { // a duel won finishes goals too
			return err
		}
		if g.DuelNews != nil {
			g.DuelNews(ctx, n)
		}
	}
	return nil
}

// SettleDue ends the duels whose time is up — a friend's challenge not played in time, a live duel cut off — and
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
			err = g.settleDuel(ctx, d.id, false)
		case d.ghost && d.aDone: // finished, and not settled then (a restart in between)
			err = g.settleDuel(ctx, d.id, true)
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

// DuelsOf are a player's duels: friends' challenges to play or waiting, then the latest ended (a live duel shows
// once it's over). The other's score shows only once the duel has ended: nobody plays knowing what to beat.
func (g *Game) DuelsOf(ctx context.Context, userID int64) ([]DuelView, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, d.kind, d.created_at, d.expires_at, coalesce(d.ended_at, 0),
			coalesce(d.outcome, ''), d.a_id = ?1, d.rated,
			coalesce(CASE WHEN d.a_id = ?1 THEN d.a_delta ELSE d.b_delta END, 0),
			coalesce(CASE WHEN d.a_id = ?1 THEN d.a_run ELSE d.b_run END, 0),
			coalesce(CASE WHEN d.a_id <> ?1 THEN d.a_run WHEN d.ghost_run IS NOT NULL THEN d.ghost_run ELSE d.b_run END, 0),
			coalesce(CASE WHEN d.a_id <> ?1 THEN d.a_id WHEN d.ghost_run IS NOT NULL
				THEN (SELECT user_id FROM runs WHERE id = d.ghost_run) ELSE d.b_id END, 0)
		FROM duels d WHERE (d.a_id = ?1 OR d.b_id = ?1) AND (d.kind = 'friend' OR d.ended_at IS NOT NULL)
		ORDER BY d.ended_at IS NOT NULL, coalesce(d.ended_at, d.created_at) DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	type row struct {
		v                       DuelView
		outcome                 string
		mine, rated             bool
		myRun, theirRun, theirs int64
	}
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.v.ID, &r.v.Kind, &r.v.CreatedAt, &r.v.ExpiresAt, &r.v.EndedAt, &r.outcome, &r.mine,
			&r.rated, &r.v.Delta, &r.myRun, &r.theirRun, &r.theirs); err != nil {
			rows.Close()
			return nil, err
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
		v.RunID = r.myRun
		var err error
		if v.You, err = g.duelSide(ctx, userID, r.myRun, true); err != nil {
			return nil, err
		}
		if r.theirs != 0 {
			if v.Opponent, err = g.duelSide(ctx, r.theirs, r.theirRun, v.EndedAt != 0); err != nil {
				return nil, err
			}
		}
		v.Recorded = len(r.outcome) > 6 && r.outcome[:6] == "ghost_"
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
		v.Friendly = !r.rated && (v.State == "won" || v.State == "lost" || v.State == "draw")
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

// Challenge is a friend's challenge waiting for the player: who, and until when.
type Challenge struct {
	ID        int64  `json:"id"`
	From      string `json:"from"`
	ExpiresAt int64  `json:"expiresAt"`
	// Started is a challenge the player has begun (and not finished).
	Started bool `json:"started,omitempty"`
}

// Challenges are the friends' challenges waiting for the player to play, the soonest to run out first.
func (g *Game) Challenges(ctx context.Context, userID int64) ([]Challenge, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, ua.name, d.expires_at, d.b_run IS NOT NULL
		FROM duels d JOIN users ua ON ua.id = d.a_id JOIN runs ra ON ra.id = d.a_run LEFT JOIN runs rb ON rb.id = d.b_run
		WHERE d.kind = 'friend' AND d.b_id = ? AND d.ended_at IS NULL AND ra.finished_at IS NOT NULL AND rb.finished_at IS NULL
		ORDER BY d.expires_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Challenge{}
	for rows.Next() {
		var c Challenge
		if err := rows.Scan(&c.ID, &c.From, &c.ExpiresAt, &c.Started); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
