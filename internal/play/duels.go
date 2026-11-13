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

// Duels are played in each player's own time: the same ten questions for two, each played whenever they can, the
// result once both have.
//
// A player asks for a duel and takes another's open one if there is one (both get the result when they finish), or
// starts one of their own on the questions of a recorded run: it's open for anyone to take, and if nobody does in
// OpenFor, it's settled against that recording (only the player's rating moves: the recorded one didn't ask to
// play). A friend may be asked by name; they have FriendFor to play.

const (
	// OpenFor is how long an open duel waits for someone to take it.
	OpenFor = 12 * time.Hour
	// FriendFor is how long a friend has to play a duel they're asked to.
	FriendFor = 48 * time.Hour
	// MaxWaiting is how many duels a player may have waiting on others at once.
	MaxWaiting = 5
)

var (
	ErrNoDuel      = errors.New("no such duel")
	ErrManyWaiting = errors.New("too many duels waiting")
)

// DuelNews is told to whoever should hear of a duel: a friend asks, someone took an open one, a result.
type DuelNews struct {
	To   int64
	Kind string // asked, result
	From string // the other player's name
	// Outcome is the one told's: won, lost or draw (with a result).
	Outcome string
	Delta   int
	DuelID  int64
}

// Duel is a duel as one of its two players sees it.
type DuelView struct {
	ID   int64  `json:"id"`
	Kind string `json:"kind"`
	// State is the player's: play (their turn), wait (the other's, or nobody's yet), won, lost, draw, declined,
	// expired.
	State string `json:"state"`
	// Opponent is the other player (none while an open duel waits), or the recorded one it was settled against.
	Opponent *DuelSide `json:"opponent,omitempty"`
	You      *DuelSide `json:"you,omitempty"`
	Recorded bool      `json:"recorded,omitempty"`
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

// FindDuel gives a player a duel to play now: another's open one if any is waiting, else one of their own.
func (g *Game) FindDuel(ctx context.Context, userID int64) (State, int64, error) {
	var s State
	var duelID int64
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		now := store.Ms(g.Now())
		// Someone's open duel, played and waiting, that isn't the player's own: the longest waiting first.
		var questions string
		err := tx.QueryRow(`SELECT d.id, d.questions FROM duels d JOIN runs r ON r.id = d.a_run
			WHERE d.kind = 'open' AND d.b_id IS NULL AND d.ended_at IS NULL AND d.expires_at > ?
			AND d.a_id <> ? AND r.finished_at IS NOT NULL
			ORDER BY d.created_at LIMIT 1`, now, userID).Scan(&duelID, &questions)
		if err == nil {
			var picks []Pick
			if err := json.Unmarshal([]byte(questions), &picks); err != nil {
				return err
			}
			r, err := g.insertRun(tx, userID, "duel", nil, nil, picks)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE duels SET b_id = ?, b_run = ? WHERE id = ?`, userID, r.id, duelID); err != nil {
				return err
			}
			s, err = g.state(tx, r)
			return err
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err := g.mayStart(tx, userID); err != nil {
			return err
		}
		// One of the player's own, on a recorded run's questions (to settle against if nobody comes), or on fresh
		// ones while there's nothing recorded yet.
		var picks []Pick
		var ghost any
		if rec, err := g.recordedRun(tx, userID); err != nil {
			return err
		} else if rec != nil {
			picks, ghost = rec.picks, rec.id
		} else {
			picks, err = g.drawFor(tx, userID)
			if err != nil {
				return err
			}
		}
		r, err := g.insertRun(tx, userID, "duel", nil, nil, picks)
		if err != nil {
			return err
		}
		data, _ := json.Marshal(picks)
		res, err := tx.Exec(`INSERT INTO duels (kind, questions, a_id, a_run, ghost_run, created_at, expires_at)
			VALUES ('open', ?, ?, ?, ?, ?, ?)`, string(data), userID, r.id, ghost, now, now+OpenFor.Milliseconds())
		if err != nil {
			return err
		}
		duelID, _ = res.LastInsertId()
		s, err = g.state(tx, r)
		return err
	})
	return s, duelID, err
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
		picks, err := g.drawFor(tx, userID)
		if err != nil {
			return err
		}
		r, err := g.insertRun(tx, userID, "duel", nil, nil, picks)
		if err != nil {
			return err
		}
		data, _ := json.Marshal(picks)
		now := store.Ms(g.Now())
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

// PlayDuel is the player's run in a duel they're the second of: made the first time (the friend asked has played
// theirs), the same after.
func (g *Game) PlayDuel(ctx context.Context, userID, duelID int64) (State, error) {
	var s State
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var questions string
		var bRun sql.NullInt64
		var aDone bool
		err := tx.QueryRow(`SELECT d.questions, d.b_run, r.finished_at IS NOT NULL FROM duels d JOIN runs r ON r.id = d.a_run
			WHERE d.id = ? AND d.b_id = ? AND d.ended_at IS NULL`, duelID, userID).Scan(&questions, &bRun, &aDone)
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

// DeclineDuel ends a duel that hasn't been played by both: the friend asked says no, or its starter calls it off
// before anyone else has played.
func (g *Game) DeclineDuel(ctx context.Context, userID, duelID int64) error {
	res, err := g.DB.Write.ExecContext(ctx, `UPDATE duels SET outcome = 'declined', ended_at = ?
		WHERE id = ? AND ended_at IS NULL AND b_run IS NULL AND (b_id = ? OR (a_id = ? AND b_id IS NULL) OR (a_id = ? AND kind = 'friend'))`,
		store.Ms(g.Now()), duelID, userID, userID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoDuel
	}
	return nil
}

// mayStart refuses a player one more duel while too many of theirs wait on others.
func (g *Game) mayStart(tx *sql.Tx, userID int64) error {
	var n int
	if err := tx.QueryRow(`SELECT count(*) FROM duels WHERE a_id = ? AND ended_at IS NULL`, userID).Scan(&n); err != nil {
		return err
	}
	if n >= MaxWaiting {
		return ErrManyWaiting
	}
	return nil
}

// drawFor draws a duel's ten questions for a player: all topics, at their level, unseen first.
func (g *Game) drawFor(tx *sql.Tx, userID int64) ([]Pick, error) {
	seen, err := seenBy(tx, userID)
	if err != nil {
		return nil, err
	}
	skill, err := g.skill(tx, userID, "")
	if err != nil {
		return nil, err
	}
	picks := Draw(g.Bank(), "", skill, Settings{}, seen, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
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

// recordedRun is another player's finished standard run of ten questions (none with settings of its own: not only
// easy ones, or only true-or-not), all still in the bank, among the latest: the one with the fewest the player has
// seen. Nil if there's none.
func (g *Game) recordedRun(tx *sql.Tx, userID int64) (*recorded, error) {
	seen, err := seenBy(tx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(`SELECT id, questions FROM runs WHERE kind IN ('topic', 'duel', 'day') AND finished_at IS NOT NULL
		AND settings IS NULL AND user_id <> ? AND json_array_length(questions) = ? ORDER BY finished_at DESC LIMIT 200`,
		userID, Length)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	b := g.Bank()
	var best *recorded
	fewest := Length + 1
	for rows.Next() {
		var id int64
		var raw string
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		var picks []Pick
		if json.Unmarshal([]byte(raw), &picks) != nil {
			continue
		}
		n, whole := 0, true
		for _, p := range picks {
			if _, ok := b.Get(p.ID); !ok {
				whole = false
			}
			if seen[p.ID] {
				n++
			}
		}
		if whole && n < fewest {
			best, fewest = &recorded{id: id, picks: picks}, n
		}
	}
	return best, rows.Err()
}

// settleRun settles the duel a just-finished run belongs to, if both sides are now played; and tells a friend
// they're asked once the asker has played.
func (g *Game) settleRun(ctx context.Context, runID int64) error {
	var duelID, aID int64
	var kind, aName string
	var bID sql.NullInt64
	var aDone, bDone bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT d.id, d.kind, d.a_id, ua.name, d.b_id,
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.a_run), 0),
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.b_run), 0)
		FROM duels d JOIN users ua ON ua.id = d.a_id WHERE (d.a_run = ?1 OR d.b_run = ?1) AND d.ended_at IS NULL`, runID).
		Scan(&duelID, &kind, &aID, &aName, &bID, &aDone, &bDone)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if aDone && bDone {
		return g.settleDuel(ctx, duelID, false)
	}
	if aDone && kind == "friend" && bID.Valid && g.DuelNews != nil {
		g.DuelNews(ctx, DuelNews{To: bID.Int64, Kind: "asked", From: aName, DuelID: duelID})
	}
	return nil
}

// settleDuel ends a duel: both played (a result for both), or, for an open one nobody took (ghost), against its
// recording (a result for its starter only).
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
		if err != nil {
			return err
		}
		// More points wins; the same points, the quicker.
		score := 0.5
		switch {
		case a.points > b.points || (a.points == b.points && a.ms < b.ms):
			score = 1
		case a.points < b.points || (a.points == b.points && a.ms > b.ms):
			score = 0
		}
		da := eloDelta(a.rating, b.rating, a.rated, score)
		outcomeOf := func(s float64) string {
			switch s {
			case 1:
				return "won"
			case 0:
				return "lost"
			}
			return "draw"
		}
		now := store.Ms(g.Now())
		if _, err := tx.Exec(`UPDATE users SET rating = max(0, rating + ?1), peak = max(peak, rating + ?1), rated = rated + 1 WHERE id = ?2`, da, a.id); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE runs SET opponent = ?, opponent_id = ?, recorded = ?, outcome = ? WHERE id = ?`,
			b.name, b.id, ghost, outcomeOf(score), a.run); err != nil {
			return err
		}
		news = append(news, DuelNews{To: a.id, Kind: "result", From: b.name, Outcome: outcomeOf(score), Delta: da, DuelID: duelID})
		if ghost {
			_, err = tx.Exec(`UPDATE duels SET ended_at = ?, outcome = ?, a_delta = ? WHERE id = ?`,
				now, "ghost_"+outcomeOf(score), da, duelID)
			return err
		}
		db := eloDelta(b.rating, a.rating, b.rated, 1-score)
		if _, err := tx.Exec(`UPDATE users SET rating = max(0, rating + ?1), peak = max(peak, rating + ?1), rated = rated + 1 WHERE id = ?2`, db, b.id); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE runs SET opponent = ?, opponent_id = ?, recorded = 0, outcome = ? WHERE id = ?`,
			a.name, a.id, outcomeOf(1-score), b.run); err != nil {
			return err
		}
		news = append(news, DuelNews{To: b.id, Kind: "result", From: a.name, Outcome: outcomeOf(1 - score), Delta: db, DuelID: duelID})
		outcome := map[float64]string{1: "a", 0: "b", 0.5: "draw"}[score]
		_, err = tx.Exec(`UPDATE duels SET ended_at = ?, outcome = ?, a_delta = ?, b_delta = ? WHERE id = ?`,
			now, outcome, da, db, duelID)
		return err
	})
	if err != nil {
		return err
	}
	for _, n := range news {
		if ghost && n.To != a.id {
			continue
		}
		if _, err := g.Award(ctx, n.To); err != nil {
			return err
		}
		if g.DuelNews != nil {
			g.DuelNews(ctx, n)
		}
	}
	return nil
}

// SettleDue settles duels whose time is up — an open one nobody took, against its recording (or, with none, no
// game); a friend's that wasn't played, as expired — and ends the tournaments whose time is up. Run every few
// minutes.
func (g *Game) SettleDue(ctx context.Context) error {
	if err := g.settleRoyalsDue(ctx); err != nil {
		return err
	}
	now := store.Ms(g.Now())
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, d.kind, d.b_id IS NULL, d.ghost_run IS NOT NULL,
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.a_run), 0),
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.b_run), 0)
		FROM duels d WHERE d.ended_at IS NULL AND d.expires_at <= ?`, now)
	if err != nil {
		return err
	}
	type due struct {
		id                           int64
		kind                         string
		untaken, ghost, aDone, bDone bool
	}
	var list []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.kind, &d.untaken, &d.ghost, &d.aDone, &d.bDone); err != nil {
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
		case d.kind == "open" && d.untaken && d.ghost && d.aDone:
			err = g.settleDuel(ctx, d.id, true)
		case d.kind == "open" && !d.untaken && d.aDone:
			continue // taken and being played: its own run's end settles it (or, abandoned, the day after)
		default:
			_, err = g.DB.Write.ExecContext(ctx, `UPDATE duels SET ended_at = ?, outcome = 'expired' WHERE id = ? AND ended_at IS NULL`,
				now, d.id)
		}
		if err != nil {
			return err
		}
	}
	// A taken duel the second player left unfinished for a day after it was due: it ends without a result.
	_, err = g.DB.Write.ExecContext(ctx, `UPDATE duels SET ended_at = ?, outcome = 'expired'
		WHERE ended_at IS NULL AND expires_at <= ?`, now, now-int64(24*time.Hour/time.Millisecond))
	return err
}

// DuelsOf are a player's duels: those to play or waiting, then the latest ended. The other's score shows only once
// the duel has ended: nobody plays knowing what to beat.
func (g *Game) DuelsOf(ctx context.Context, userID int64) ([]DuelView, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, d.kind, d.created_at, d.expires_at, coalesce(d.ended_at, 0),
			coalesce(d.outcome, ''), d.a_id = ?1,
			coalesce(CASE WHEN d.a_id = ?1 THEN d.a_delta ELSE d.b_delta END, 0),
			coalesce(CASE WHEN d.a_id = ?1 THEN d.a_run ELSE d.b_run END, 0),
			coalesce(CASE WHEN d.a_id <> ?1 THEN d.a_run WHEN d.outcome LIKE 'ghost_%' THEN d.ghost_run ELSE d.b_run END, 0),
			coalesce(CASE WHEN d.a_id <> ?1 THEN d.a_id WHEN d.outcome LIKE 'ghost_%'
				THEN (SELECT user_id FROM runs WHERE id = d.ghost_run) ELSE d.b_id END, 0)
		FROM duels d WHERE d.a_id = ?1 OR d.b_id = ?1
		ORDER BY d.ended_at IS NOT NULL, coalesce(d.ended_at, d.created_at) DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	type row struct {
		v                       DuelView
		outcome                 string
		mine                    bool
		myRun, theirRun, theirs int64
	}
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.v.ID, &r.v.Kind, &r.v.CreatedAt, &r.v.ExpiresAt, &r.v.EndedAt, &r.outcome, &r.mine,
			&r.v.Delta, &r.myRun, &r.theirRun, &r.theirs); err != nil {
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
	look := lookOf(userID, avatar, title, points)
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

// DuelTurns is how many duels wait for the player to play (for the dot on Играй).
func (g *Game) DuelTurns(ctx context.Context, userID int64) (int, error) {
	var n int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FROM duels d JOIN runs ra ON ra.id = d.a_run
		LEFT JOIN runs rb ON rb.id = d.b_run
		WHERE d.b_id = ? AND d.ended_at IS NULL AND ra.finished_at IS NOT NULL AND rb.finished_at IS NULL`, userID).Scan(&n)
	return n, err
}
