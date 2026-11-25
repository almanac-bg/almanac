package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	mrand "math/rand/v2"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Duels are two players on the same ten questions, each played on one's own time, as any game is (play.go: the run's
// own clock, a question at a time); more right answers wins, and between the same, what breaks a tie on the day's
// board (tiebreak: how close the hard number came); even in both, it's a draw, as the board would share their place
// (duelScore): time never counts (DECISIONS.md, „The direction“). Nothing moves but the record between two people:
// there's no rating (owner, 2026-11-20, DECISIONS.md „The direction“).
//
// A duel is with a friend (DuelFriend), challenged directly: from their row in Приятели or their profile (owner,
// 2026-11-22: the duel against a recording of another's game is gone, and „Нов дуел“ with it). The player plays ten
// questions drawn for the two of them (drawFor: „Микс“, at their pair's level, questions neither has seen first). Once
// their side is played, the duel is sent: the friend is told (DuelNews: a push through the server's notifyFrom, and a
// dot and a row in Приятели) and has DuelFor to play the same ten, as the first player was shown them (their versions:
// the same ten exactly); past it, the duel lapses, and says so. Whoever plays second sees both at the end; the first
// sees the result when it comes, told too. Each pair keeps its record („общо 5 на 3“: recordAgainst). A rematch is a
// new duel the other way round. A player may have DuelsToOne duels open with one friend at once, and start DuelsADay
// a day.
//
// A duel has no page of its own but the one it's played on (owner, 2026-11-22): everything about it is on its card
// in Приятели (DuelsOf): the two, the score, how each question went for each side, and, on the day the
// player's own game ended, its questions gone over (Review).
//
// A duel the player started and left unfinished is gone on with when they start one with the same friend again; one
// never finished goes at its time, as if never started (SettleDue). One left before its first question showed (a tap,
// then „Отказ“ or away) isn't a duel yet: it isn't listed, and goes with its run DuelUnbegun after it was made
// (SettleDue), so that nothing lingers as „Твой ред“ that nobody played. A duel ends when its time does: nothing more
// of it is played after (PlayDuel, duelOver), but the answer to a question shown before it, in its own time, as a
// day's run has (pastClose); the sweep that ends it comes within the minute, after that answer's time; a friend's
// side left half-way counts as it stood then, and nobody is told it was played.

const (
	// DuelFor is how long a friend has to play a duel sent to them, a week from when it was sent (DECISIONS.md, „The
	// direction“), and how long the first side has to play theirs, from its start.
	DuelFor = 7 * 24 * time.Hour
	// DuelsToOne is how many duels a player may have open with one friend they sent them to (sent or being played,
	// not played back yet): a friend isn't buried under a pile, and the pair's record isn't one player's alone.
	DuelsToOne = 3
	// DuelsADay is how many duels a player may start with friends in a day (in Bulgaria): more than anyone plays, and
	// a bound on what one player can send others.
	DuelsADay = 20
	// DuelUnbegun is how long a duel the player made and left before its first question showed is kept (unlisted, to be
	// gone on with by a tap on the same duel again) before it goes: long past its count, should its screen still be
	// open.
	DuelUnbegun = 10 * time.Minute
)

var (
	// ErrNoDuel is a duel that isn't the player's (another's, or not sent to them yet); ErrDuelGone one there isn't at
	// all: never was, or gone (its player deleted: Forget; its first side never finished: SettleDue). A page tells the
	// two apart: one may be the player's in another profile, the other is nobody's.
	ErrNoDuel   = errors.New("not the player's duel")
	ErrDuelGone = errors.New("no such duel")
	// ErrDuelsToOne is a duel past DuelsToOne open with one friend; ErrDuelsADay one past DuelsADay today.
	ErrDuelsToOne = errors.New("too many duels open with this friend")
	ErrDuelsADay  = errors.New("too many duels today")
	// ErrDuelOver is a duel played on after it ended (a result, or lapsed).
	ErrDuelOver = errors.New("the duel is over")
)

// Duel states, as the player sees them (DuelView.State).
const (
	DuelYours   = "yours"  // the player's to play: sent to them, or their own side not finished
	DuelTheirs  = "theirs" // sent, waiting for the friend
	DuelWon     = "won"
	DuelLost    = "lost"
	DuelDraw    = "draw"
	DuelExpired = "expired" // no result: lapsed (Lapsed says who didn't play), or cut off under way (a live duel's, from before)
)

// DuelView is a duel as one of its two players sees it.
type DuelView struct {
	ID    int64  `json:"id"`
	State string `json:"state"`
	// Opponent is the other player.
	Opponent *DuelSide `json:"opponent,omitempty"`
	You      *DuelSide `json:"you,omitempty"`
	// First says the player played first (sent it).
	First bool `json:"first,omitempty"`
	// RunID is the player's run in it, to play or go over: none until they start it.
	RunID     int64 `json:"runId,omitempty"`
	CreatedAt int64 `json:"createdAt"`
	EndedAt   int64 `json:"endedAt,omitempty"`
	// Until is when an open duel lapses.
	Until int64 `json:"until,omitempty"`
	// Lapsed is, of a duel that expired, who didn't play it in time: "you" or "they" (none: cut off, from before).
	Lapsed string `json:"lapsed,omitempty"`
	// TieBy is, of a duel won on even right answers, what broke the tie (duelScore): TieNumber, the number nearer;
	// "" for a draw, or a duel won on right answers.
	TieBy string `json:"tieBy,omitempty"`
	// Record is how the player's duels against this person went, this one with them.
	Record *Record `json:"record,omitempty"`

	against, theirRun int64
}

// DuelSide is one side of a duel: who, and (once played) how they did.
type DuelSide struct {
	ID     int64  `json:"-"`
	Name   string `json:"name"`
	Tag    string `json:"tag,omitempty"`
	Rights int    `json:"rights"`
	Done   bool   `json:"done"`
	// Started is whether the side's game has begun: a question shown (its time running, or run out), or answered (a
	// duel made first may be left before it begins: not listed, and gone DuelUnbegun after).
	Started bool  `json:"-"`
	Look    *Look `json:"look,omitempty"`
	// Gone is a player who has gone since (play.Forget): their game went with them, so their score isn't known.
	Gone bool `json:"gone,omitempty"`
	// Marks are how each question answered went, of a duel the player has played their side of: the player's own; the
	// other's once the duel has a result.
	// While the player plays, the other's come with the run, each as far as the player has come (State.Against).
	Marks []DuelMark `json:"marks,omitempty"`

	score duelScore
}

// TieNumber is what broke a tie on even right answers (DuelView.TieBy): the hard number nearer, the only thing that
// does.
const TieNumber = "number"

// DuelMark is how one question of a duel went for one side: right, or close („близо“: closeAnswer), and whether
// nothing was given (Missed: the time ran out). Never how long it took: a duel isn't a race (time never counts).
type DuelMark struct {
	Right  bool `json:"right"`
	Close  bool `json:"close,omitempty"`
	Missed bool `json:"missed,omitempty"`
}

// DuelNews is a duel news to another player, for the server to tell them (a push through notifyFrom): sent to them
// (From played their side), or played back (From played the second side to its end: the result is in). A side ended
// where it stood, by its time or an unfriending, isn't news: the dot on Приятели tells of its result (FriendsNews).
type DuelNews struct {
	DuelID   int64
	From, To int64
	Played   bool
}

// midnight is when today began, in Bulgaria.
func (g *Game) midnight() time.Time {
	now := g.Now().In(Bulgaria)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, Bulgaria)
}

// DuelFriend starts a duel with a friend: ten questions drawn for the two of them, and the player's run of them. One
// with them the player started and left unfinished is gone on with instead. ErrNotFriends unless they're friends;
// ErrDuelsToOne, ErrDuelsADay past the limits. It says the duel's id.
func (g *Game) DuelFriend(ctx context.Context, userID, friendID int64) (int64, error) {
	p, err := g.pastOf(ctx, "", userID, friendID)
	if err != nil {
		return 0, err
	}
	var id int64
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var friends bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?)`,
			userID, friendID).Scan(&friends); err != nil {
			return err
		}
		if !friends {
			return ErrNotFriends
		}
		err := tx.QueryRow(`SELECT d.id FROM duels d JOIN runs r ON r.id = d.a_run
			WHERE d.a_id = ? AND d.b_id = ? AND d.ended_at IS NULL AND r.finished_at IS NULL
			ORDER BY d.id DESC LIMIT 1`, userID, friendID).Scan(&id)
		if err == nil || !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var open, today int
		if err := tx.QueryRow(`SELECT count(*) FILTER (WHERE b_id = ?2 AND ended_at IS NULL), count(*) FILTER (WHERE created_at >= ?3)
			FROM duels WHERE a_id = ?1`, userID, friendID, store.Ms(g.midnight())).
			Scan(&open, &today); err != nil {
			return err
		}
		switch {
		case open >= DuelsToOne:
			return ErrDuelsToOne
		case today >= DuelsADay:
			return ErrDuelsADay
		}
		picks, err := g.drawFor(tx, p)
		if err != nil {
			return err
		}
		r, err := g.insertRun(ctx, tx, userID, "duel", nil, nil, picks)
		if err != nil {
			return err
		}
		now := g.Now()
		res, err := tx.Exec(`INSERT INTO duels (a_id, a_run, b_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
			userID, r.id, friendID, store.Ms(now), store.Ms(now.Add(DuelFor)))
		if err != nil {
			return err
		}
		id, _ = res.LastInsertId()
		return nil
	})
	return id, err
}

// PlayDuel is the player's run in a duel that's theirs to play (DuelYours): their own side, or, sent to them, the
// same ten as the friend played them, made as they first play it. ErrNoDuel if it isn't theirs to play (not theirs,
// not sent yet), ErrDuelGone if there's no such duel, ErrDuelOver once it's over: a result, lapsed, or its time up
// (the sweep ends it within the minute, SettleDue).
func (g *Game) PlayDuel(ctx context.Context, userID, duelID int64) (int64, error) {
	var run int64
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var a, b, aRun, bRun sql.NullInt64
		var sent, ended bool
		err := tx.QueryRow(`SELECT a_id, b_id, a_run, b_run, sent_at IS NOT NULL, ended_at IS NOT NULL OR expires_at <= ?
			FROM duels WHERE id = ?`, store.Ms(g.Now()), duelID).Scan(&a, &b, &aRun, &bRun, &sent, &ended)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return ErrDuelGone
		case err != nil:
			return err
		case a.Int64 == userID && a.Valid:
			if ended {
				return ErrDuelOver
			}
			run = aRun.Int64
			return nil
		case b.Int64 != userID || !b.Valid || !sent:
			return ErrNoDuel
		case ended:
			return ErrDuelOver
		case bRun.Valid:
			run = bRun.Int64
			return nil
		}
		// The ten as the friend was shown them: each at the version it showed (Pick.V), so that it's the same ten.
		var raw string
		if err := tx.QueryRow(`SELECT questions FROM runs WHERE id = ?`, aRun.Int64).Scan(&raw); err != nil {
			return err
		}
		var picks []Pick
		if err := json.Unmarshal([]byte(raw), &picks); err != nil {
			return err
		}
		r, err := g.insertRun(ctx, tx, userID, "duel", nil, nil, picks)
		if err != nil {
			return err
		}
		run = r.id
		_, err = tx.Exec(`UPDATE duels SET b_run = ? WHERE id = ?`, run, duelID)
		return err
	})
	return run, err
}

// past is what a draw needs from its players' history: the questions they've seen (how many of them has each:
// seenAmong), and how well they know them (on average over the players; in a chapter, or all of them for ""). It's read
// before the write the draw goes into: it grows with every game they've played, and the game's one writer
// (store.DB.Write) mustn't wait on it.
type past struct {
	seen    map[string]int
	ability float64
}

func (g *Game) pastOf(ctx context.Context, chapter string, users ...int64) (past, error) {
	seen, err := g.seenAmong(ctx, users)
	if err != nil {
		return past{}, err
	}
	p := past{seen: seen}
	for _, id := range users {
		a, err := g.ability(ctx, g.DB.Read, id, chapter)
		if err != nil {
			return p, err
		}
		p.ability += a / float64(len(users))
	}
	return p, nil
}

// drawFor draws a duel's ten questions for its players (their past): all chapters, shaped by how well they know them,
// questions neither has seen first.
func (g *Game) drawFor(tx *sql.Tx, p past) ([]Pick, error) {
	bars, err := g.days(tx)
	if err != nil {
		return nil, err
	}
	picks := Draw(g.Bank(), MixChapter, p.ability, p.seen, bars.all, bars.met, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
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

// seenAmong is how stale each question is to a game for players (choose: the least first, those missing none): of those
// any of them has answered (in any game: the day, a chapter's, a duel), one for each of them who has, so that no game
// deals anyone again what they've played while the bank has questions they haven't.
func (g *Game) seenAmong(ctx context.Context, players []int64) (map[string]int, error) {
	stale := map[string]int{}
	for _, id := range slices.Compact(slices.Sorted(slices.Values(players))) {
		one := map[string]bool{}
		if err := seenBy(ctx, g.DB.Read, id, one); err != nil {
			return nil, err
		}
		for q := range one {
			stale[q]++
		}
	}
	return stale, nil
}

// settleRun does what a just-finished run's duel needs: the first side of a friend's duel played, it's sent (the
// friend's time runs from now, and they're told); the second, the duel's result.
func (g *Game) settleRun(ctx context.Context, runID int64) error {
	var duelID int64
	var first, sent bool
	var a, b sql.NullInt64
	err := g.DB.Read.QueryRowContext(ctx, `SELECT id, a_run = ?1, sent_at IS NOT NULL, a_id, b_id FROM duels
		WHERE (a_run = ?1 OR b_run = ?1) AND ended_at IS NULL`, runID).Scan(&duelID, &first, &sent, &a, &b)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if !first {
		return g.settleDuel(ctx, duelID, runID, false)
	}
	if sent || !b.Valid {
		return nil
	}
	now := g.Now()
	res, err := g.DB.Write.ExecContext(ctx, `UPDATE duels SET sent_at = ?, expires_at = ? WHERE id = ? AND sent_at IS NULL
		AND ended_at IS NULL`, store.Ms(now), store.Ms(now.Add(DuelFor)), duelID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 1 {
		g.duelNews(ctx, DuelNews{DuelID: duelID, From: a.Int64, To: b.Int64})
	}
	return nil
}

// duelNews hands a duel's news to whoever tells it (Game.DuelNews), if anyone does.
func (g *Game) duelNews(ctx context.Context, n DuelNews) {
	if g.DuelNews != nil && n.From != 0 && n.To != 0 {
		g.DuelNews(ctx, n)
	}
}

// settleDuel ends a duel both sides of which are played, with its result (duelScore), and tells the first side the
// friend played theirs (cut: unless the friend's side was ended where it stood, by its time or an unfriending: endDue,
// when the friend didn't play it out). A duel ended already (both sides finished at once, and the other settled it) is
// left as it is. finished is the run that has just ended it, whose own follow-up this is (after.go); the other side's is
// due again, with the result.
func (g *Game) settleDuel(ctx context.Context, duelID, finished int64, cut bool) error {
	type side struct {
		id, run       int64
		score         duelScore
		done, present bool
	}
	var a, b side
	settled := false
	var followed []side
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		followed = nil
		var bID, bRun sql.NullInt64
		var bRights, bClose sql.NullInt64
		var bDone sql.NullBool
		err := tx.QueryRow(`SELECT d.a_id, ra.id, ra.rights, ra.closeness,
				ra.finished_at IS NOT NULL,
				rb.user_id, rb.id, rb.rights, rb.closeness, rb.finished_at IS NOT NULL
			FROM duels d JOIN users ua ON ua.id = d.a_id JOIN runs ra ON ra.id = d.a_run
			LEFT JOIN runs rb ON rb.id = d.b_run
			WHERE d.id = ? AND d.ended_at IS NULL`, duelID).
			Scan(&a.id, &a.run, &a.score.rights, &a.score.tie.closeness,
				&a.done, &bID, &bRun, &bRights, &bClose, &bDone)
		if errors.Is(err, sql.ErrNoRows) {
			settled = true // the other side's last answer settled it a moment ago: it's done
			return nil
		}
		if err != nil {
			return err
		}
		b = side{id: bID.Int64, run: bRun.Int64, done: bDone.Bool, present: bRun.Valid,
			score: duelScore{rights: int(bRights.Int64), tie: tiebreak{closeness: int(bClose.Int64)}}}
		if !a.done || !b.present || !b.done {
			settled = true // not played to its end yet: nothing to settle
			return nil
		}
		score := 0.5
		switch a.score.against(b.score) {
		case -1:
			score = 1
		case 1:
			score = 0
		}
		// The result is the duel's (duels.outcome): a run keeps nothing of whom it was against.
		followed = append(followed, a, b)
		for _, s := range followed {
			if s.run != finished {
				if err := g.afterDue(tx, s.run); err != nil {
					return err
				}
			}
		}
		_, err = tx.Exec(`UPDATE duels SET ended_at = ?, outcome = ? WHERE id = ?`, store.Ms(g.Now()),
			map[float64]string{1: "a", 0: "b", 0.5: "draw"}[score], duelID)
		return err
	})
	if err != nil || settled {
		return err
	}
	// What follows each side's run is done again with the result, but the run that has just settled the duel, whose
	// own follow-up this is. What fails is left to the sweep (AfterDue): the duel's result is kept.
	for _, s := range followed {
		if s.run == finished {
			continue
		}
		if err := g.after(ctx, s.id, s.run); err != nil {
			slog.Error("after a duel", "duel", duelID, "run", s.run, "err", err)
		}
	}
	if !cut {
		g.duelNews(ctx, DuelNews{DuelID: duelID, From: b.id, To: a.id, Played: true})
	}
	return nil
}

// SettleDue ends the duels whose time is up. A friend's side left half-way counts as it stood: it's finished there,
// and the duel has its result. One the friend never started lapses, without a result. One whose first side was never
// finished goes, as if never started (its run stays the player's, a game left half-way). One whose first question never
// showed goes with its run DuelUnbegun after it was made (dropUnbegun). One whose side being played has a question
// shown before the duel's time, still in its own, waits for it (duelOver). Run every few minutes.
func (g *Game) SettleDue(ctx context.Context) error {
	if err := g.dropUnbegun(ctx); err != nil {
		return err
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, d.sent_at IS NOT NULL, coalesce(d.b_run, 0)
		FROM duels d LEFT JOIN runs r ON r.id = CASE WHEN d.sent_at IS NULL THEN d.a_run ELSE d.b_run END
		WHERE d.ended_at IS NULL AND d.expires_at <= ?1 AND NOT coalesce(r.finished_at IS NULL
			AND r.shown_at < d.expires_at AND r.shown_at + ?2 >= ?1, 0)`,
		store.Ms(g.Now()), (LongestLimit + LateGrace).Milliseconds())
	if err != nil {
		return err
	}
	var list []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.sent, &d.bRun); err != nil {
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
		if err := g.endOne(ctx, d); err != nil {
			return err
		}
	}
	return nil
}

// due is a duel whose time is up, as it was read: sent or not, and its second side's run (0: not begun).
type due struct {
	id   int64
	sent bool
	bRun int64
}

// endOne ends a duel whose time is up, as SettleDue says. Each write repeats what chose it, so that a duel read a
// moment before (sent, or begun, since) is left for the next look.
func (g *Game) endOne(ctx context.Context, d due) error {
	var err error
	switch {
	case d.bRun != 0:
		err = g.endDue(ctx, d.id, d.bRun)
	case d.sent:
		_, err = g.DB.Write.ExecContext(ctx, `UPDATE duels SET ended_at = ?, outcome = 'expired' WHERE id = ?
			AND ended_at IS NULL AND b_run IS NULL`, store.Ms(g.Now()), d.id)
	default:
		_, err = g.DB.Write.ExecContext(ctx, `DELETE FROM duels WHERE id = ? AND ended_at IS NULL AND sent_at IS NULL`, d.id)
	}
	return err
}

// duelOver is whether a run of a duel can't be played on any more: the duel's time is up, and no question shown
// before it is still in its time (pastClose: a question shown before the end gets its full time, as a day's does). The
// sweep ends it within the minute, as it stood (SettleDue); until then, nothing more of it is played.
func (g *Game) duelOver(tx *sql.Tx, r *run) (bool, error) {
	if r.kind != "duel" || r.finished {
		return false, nil
	}
	closes, err := duelCloses(tx, r.id)
	return err == nil && !closes.IsZero() && r.pastClose(closes, g.Now()), err
}

// duelCloses is when a duel's run closes: the duel's time, while the duel is on (zero for none: ended, or gone).
func duelCloses(tx *sql.Tx, runID int64) (time.Time, error) {
	var at int64
	err := tx.QueryRow(`SELECT expires_at FROM duels WHERE (a_run = ?1 OR b_run = ?1) AND ended_at IS NULL`, runID).
		Scan(&at)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	return time.UnixMilli(at), nil
}

// dropUnbegun deletes the duels made more than DuelUnbegun ago whose first side never showed a question (a tap that
// made one, then „Отказ“ or away), and their runs: nothing of them was played, nor sent (the friend never knew of it).
// Each is looked at again as it goes, in one write: a question shown meanwhile keeps it.
func (g *Game) dropUnbegun(ctx context.Context) error {
	const unbegun = `r.finished_at IS NULL AND r.at = 0 AND r.shown_at IS NULL
		AND NOT EXISTS (SELECT 1 FROM answers WHERE run_id = r.id)`
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id FROM duels d JOIN runs r ON r.id = d.a_run
		WHERE d.ended_at IS NULL AND d.sent_at IS NULL AND d.created_at <= ? AND `+unbegun,
		store.Ms(g.Now().Add(-DuelUnbegun)))
	if err != nil {
		return err
	}
	var due []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		due = append(due, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(due) == 0 {
		return err
	}
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		for _, id := range due {
			var run int64
			err := tx.QueryRow(`SELECT r.id FROM duels d JOIN runs r ON r.id = d.a_run
				WHERE d.id = ? AND d.ended_at IS NULL AND d.sent_at IS NULL AND `+unbegun, id).Scan(&run)
			if errors.Is(err, sql.ErrNoRows) {
				continue // begun meanwhile
			}
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM duels WHERE id = ?`, id); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM runs WHERE id = ?`, run); err != nil {
				return err
			}
		}
		return nil
	})
}

// endDue settles a duel whose time is up, its last side finished where it stood (run; 0: played already).
func (g *Game) endDue(ctx context.Context, duelID, runID int64) error {
	ended := false
	if runID != 0 {
		err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
			r, err := scanRun(tx.QueryRow(`SELECT `+runColumns+` FROM runs WHERE id = ?`, runID))
			if err != nil || r.finished {
				return err
			}
			ended = true
			return g.finish(tx, r, g.Now())
		})
		if err != nil {
			return err
		}
	}
	if err := g.settleDuel(ctx, duelID, 0, ended); err != nil {
		return err
	}
	if ended { // what follows the run, as a run ended by its last answer has
		var user int64
		if err := g.DB.Read.QueryRowContext(ctx, `SELECT user_id FROM runs WHERE id = ?`, runID).Scan(&user); err == nil {
			g.afterLater(user, runID, true)
		}
	}
	return nil
}

// Duels are a player's duels, as Приятели lists them: theirs to play (sent to them, or their own side not finished),
// sent and waiting for the friend, and those played (the latest ended first, DuelsShown of them, the last: the list
// says so; all of them, PlayedAll, a page at a time: DuelsPlayed). Each one played, or waiting, as its card shows it
// whole (duelMore): there's no other page of it.
type Duels struct {
	Yours     []DuelView `json:"yours"`
	Theirs    []DuelView `json:"theirs"`
	Played    []DuelView `json:"played"`
	PlayedAll int        `json:"playedAll"`
}

// DuelsShown is how many duels played Приятели lists: the last ten.
const DuelsShown = 10

// DuelsOf are a player's duels, as Приятели lists them: those open, and the last DuelsShown ended (listed). A few
// queries, however many duels the player has had: Приятели asks again every 15 seconds while it's open.
func (g *Game) DuelsOf(ctx context.Context, userID int64) (Duels, error) {
	out := Duels{Yours: []DuelView{}, Theirs: []DuelView{}, Played: []DuelView{}}
	list, err := g.duelsOf(ctx, userID, listed, DuelsShown)
	if err != nil {
		return out, err
	}
	if err := g.withRecords(ctx, userID, list); err != nil {
		return out, err
	}
	for _, v := range list {
		switch v.State {
		case DuelYours:
			out.Yours = append(out.Yours, v)
		case DuelTheirs:
			out.Theirs = append(out.Theirs, v)
		default:
			out.Played = append(out.Played, v)
		}
	}
	if err := g.duelMore(ctx, out.Theirs, out.Played); err != nil {
		return out, err
	}
	out.PlayedAll, err = g.playedCount(ctx, userID)
	return out, err
}

// withRecords gives each of a player's duels their record against its other side.
func (g *Game) withRecords(ctx context.Context, userID int64, list []DuelView) error {
	records, err := g.recordsOf(ctx, userID)
	if err != nil {
		return err
	}
	for i := range list {
		if r, ok := records[list[i].against]; ok && list[i].against != 0 {
			list[i].Record = &r
		}
	}
	return nil
}

// playedWhere is, in a query whose ?1 is a player, the duels of theirs that have ended (played back, lapsed): those
// Приятели lists as played.
const playedWhere = `(a_id = ?1 OR (b_id = ?1 AND sent_at IS NOT NULL)) AND ended_at IS NOT NULL`

// Which of a player's duels duelsOf reads: a condition on them (d), whose ?1 is the player, and ?3 and ?4 what's
// passed with it.
const (
	// listed are those Приятели lists (DuelsOf): open, and the last ?3 ended.
	listed = `(d.ended_at IS NULL OR d.id IN (SELECT id FROM duels WHERE ` + playedWhere + `
		ORDER BY ended_at DESC, id DESC LIMIT ?3))`
	// playedPage is a page of those ended (DuelsPlayed): ?3 of them, after the latest ?4.
	playedPage = `d.id IN (SELECT id FROM duels WHERE ` + playedWhere + `
		ORDER BY ended_at DESC, id DESC LIMIT ?3 OFFSET ?4)`
	// oneDuel is the duel ?3 (DuelOf), if it's the player's.
	oneDuel = `d.id = ?3`
)

// playedCount is how many duels of a player's have ended.
func (g *Game) playedCount(ctx context.Context, userID int64) (int, error) {
	var n int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FROM duels WHERE `+playedWhere, userID).Scan(&n)
	return n, err
}

// PlayedPage is a page of a player's duels played (DuelsPlayed): DuelsShown of them, the latest ended first, and how
// many pages there are in all (at least one).
type PlayedPage struct {
	Duels []DuelView `json:"duels"`
	Page  int        `json:"page"`
	Pages int        `json:"pages"`
}

// DuelsPlayed is a page of a player's duels played, from 1 (the latest, as Приятели lists them), each as its card shows
// it whole (duelMore); a page past the last is the last.
func (g *Game) DuelsPlayed(ctx context.Context, userID int64, page int) (PlayedPage, error) {
	out := PlayedPage{Duels: []DuelView{}, Page: page, Pages: 1}
	n, err := g.playedCount(ctx, userID)
	if err != nil {
		return out, err
	}
	out.Pages = max(1, (n+DuelsShown-1)/DuelsShown)
	out.Page = min(max(page, 1), out.Pages)
	list, err := g.duelsOf(ctx, userID, playedPage, DuelsShown, (out.Page-1)*DuelsShown)
	if err != nil {
		return out, err
	}
	if err := g.withRecords(ctx, userID, list); err != nil {
		return out, err
	}
	if err := g.duelMore(ctx, list); err != nil {
		return out, err
	}
	out.Duels = append(out.Duels, list...)
	return out, nil
}

// duelsOf are the player's duels of which (listed, playedPage, oneDuel; args are its ?3 and ?4), as they see them:
// the open ones first (the oldest first: the first to lapse), then those ended, the latest first. A friend's duel
// shows to the one it's sent to once it's sent. One query, the sides and their runs joined, and one for the player.
func (g *Game) duelsOf(ctx context.Context, userID int64, which string, args ...any) ([]DuelView, error) {
	you, err := g.duelSide(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, d.mine, d.created_at, coalesce(d.ended_at, 0),
			d.expires_at, d.sent_at IS NOT NULL, coalesce(d.expires_at >= d.sent_at + ?2, 0), coalesce(d.outcome, ''),
			coalesce(CASE WHEN d.mine THEN d.a_run ELSE d.b_run END, 0),
			coalesce(CASE WHEN d.mine THEN d.b_run ELSE d.a_run END, 0),
			coalesce(CASE WHEN d.mine THEN d.b_id ELSE d.a_id END, 0),
			`+runSide("m")+`, u.id IS NOT NULL, coalesce(u.name, ''), coalesce(u.tag, ''), `+lookColumns+`, `+runSide("t")+`
		FROM (SELECT d.*, coalesce(d.a_id = ?1, 0) AS mine FROM duels d
			WHERE (d.a_id = ?1 OR (d.b_id = ?1 AND d.sent_at IS NOT NULL)) AND `+which+`) d
		LEFT JOIN runs m ON m.id = CASE WHEN d.mine THEN d.a_run ELSE d.b_run END
		LEFT JOIN users u ON u.id = CASE WHEN d.mine THEN d.b_id ELSE d.a_id END
		LEFT JOIN runs t ON t.id = CASE WHEN d.mine THEN d.b_run ELSE d.a_run END
		ORDER BY d.ended_at IS NOT NULL, CASE WHEN d.ended_at IS NULL THEN d.expires_at ELSE -d.ended_at END,
			CASE WHEN d.ended_at IS NULL THEN d.id ELSE -d.id END
		LIMIT 200`, append([]any{userID, DuelFor.Milliseconds()}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DuelView
	for rows.Next() {
		var v DuelView
		var outcome, avatar string
		var sent, fullWeek, there bool
		var mine, theirs DuelSide
		if err := rows.Scan(&v.ID, &v.First, &v.CreatedAt, &v.EndedAt, &v.Until, &sent, &fullWeek, &outcome,
			&v.RunID, &v.theirRun, &v.against,
			&mine.Done, &mine.Rights, &mine.score.tie.closeness, &mine.Started,
			&there, &theirs.Name, &theirs.Tag, &avatar,
			&theirs.Done, &theirs.Rights, &theirs.score.tie.closeness, &theirs.Started); err != nil {
			return nil, err
		}
		if you != nil {
			mine.ID, mine.Name, mine.Tag, mine.Look = you.ID, you.Name, you.Tag, you.Look
			mine.score.rights = mine.Rights
			v.You = &mine
		}
		if there {
			look := g.lookOf(v.against, avatar)
			theirs.ID, theirs.Look = v.against, &look
			theirs.score.rights = theirs.Rights
			v.Opponent = &theirs
		} else {
			// Every duel has another side: none is one who's gone.
			v.Opponent = &DuelSide{Name: GoneName, Done: true, Gone: true}
		}
		first := v.First
		// The player's own, left before its first question showed: not a duel yet, in the lists (SettleDue drops it).
		if which != oneDuel && v.EndedAt == 0 && first && v.You != nil && !v.You.Started {
			continue
		}
		switch {
		case v.EndedAt == 0:
			v.State = DuelYours
			if first && v.You != nil && v.You.Done {
				v.State = DuelTheirs
			}
		case outcome == "draw":
			v.State = DuelDraw
		case outcome == "a" && first, outcome == "b" && !first:
			v.State = DuelWon
		case outcome == "a", outcome == "b":
			v.State = DuelLost
		default:
			v.State = DuelExpired
			if sent && fullWeek {
				// Lapsed: the friend never played it (or it's from before, cut off live: both had played some). One
				// ended before its week was out ended with the friendship (Unfriend): no one let it lapse.
				switch {
				case first && v.theirRun == 0:
					v.Lapsed = "they"
				case !first && v.RunID == 0:
					v.Lapsed = "you"
				}
			}
		}
		if v.EndedAt != 0 {
			v.Until = 0 // only an open duel lapses
		}
		// The other's score shows once there's a result.
		if !v.hasResult() {
			v.Opponent.Rights = 0
		}
		// A result on even right answers says what broke the tie, in a list too (Приятели's rows).
		if (v.State == DuelWon || v.State == DuelLost) && v.You != nil && !v.Opponent.Gone {
			v.TieBy = v.You.score.tieBy(v.Opponent.score)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// runSide are, of a duel's run r (joined: none if the side hasn't started), what its side shows: whether it's done, its
// right answers and its closeness (what breaks a tie), and whether it has begun (DuelSide.Started).
func runSide(r string) string {
	return `coalesce(` + r + `.finished_at IS NOT NULL, 0), coalesce(` + r + `.rights, 0), coalesce(` + r + `.closeness, 0),
		coalesce(` + r + `.at > 0 OR ` + r + `.shown_at IS NOT NULL OR EXISTS (SELECT 1 FROM answers WHERE run_id = ` + r + `.id), 0)`
}

// hasResult is whether a duel ended won, lost or drawn: not open, nor lapsed.
func (v *DuelView) hasResult() bool {
	return v.State == DuelWon || v.State == DuelLost || v.State == DuelDraw
}

// duelSide is a player in a duel, who they are (nil: gone); how their run went duelsOf reads with the duels.
func (g *Game) duelSide(ctx context.Context, userID int64) (*DuelSide, error) {
	s := DuelSide{ID: userID}
	var avatar string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT u.name, u.tag, `+lookColumns+` FROM users u WHERE u.id = ?`, userID).
		Scan(&s.Name, &s.Tag, &avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	look := g.lookOf(userID, avatar)
	s.Look = &look
	return &s, nil
}

// DuelExists is whether there is a duel by this id, whoever's it is: what a page of it can say to anyone.
func (g *Game) DuelExists(ctx context.Context, id int64) (bool, error) {
	var yes bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM duels WHERE id = ?)`, id).Scan(&yes)
	return yes, err
}

// DuelOf is one of a player's duels, as DuelsOf has it (duelMore), with their record against this person. ErrNoDuel
// if it isn't theirs, ErrDuelGone if there's no such duel.
func (g *Game) DuelOf(ctx context.Context, userID, duelID int64) (DuelView, error) {
	list, err := g.duelsOf(ctx, userID, oneDuel, duelID)
	if err != nil {
		return DuelView{}, err
	}
	if len(list) == 0 {
		if there, err := g.DuelExists(ctx, duelID); err != nil {
			return DuelView{}, err
		} else if !there {
			return DuelView{}, ErrDuelGone
		}
		return DuelView{}, ErrNoDuel
	}
	if err := g.duelMore(ctx, list); err != nil {
		return list[0], err
	}
	v := list[0]
	if v.against != 0 {
		r, err := g.recordAgainst(ctx, userID, v.against)
		if err != nil {
			return v, err
		}
		v.Record = &r
	}
	return v, nil
}

// duelMore adds to duels (duelsOf) what their cards show of them, in one query: how each question went for each side
// (the player's own; the other's once it has a result: DuelSide.Marks). The player's own game, once played, can be
// gone over from the card on any day (Review).
func (g *Game) duelMore(ctx context.Context, lists ...[]DuelView) error {
	var runs []int64
	for _, list := range lists {
		for i := range list {
			v := &list[i]
			if v.You != nil && v.RunID != 0 {
				runs = append(runs, v.RunID)
			}
			if v.Opponent != nil && v.theirRun != 0 && v.hasResult() {
				runs = append(runs, v.theirRun)
			}
		}
	}
	if len(runs) == 0 {
		return nil
	}
	marks, err := g.duelMarks(ctx, runs)
	if err != nil {
		return err
	}
	for _, list := range lists {
		for i := range list {
			v := &list[i]
			if v.You != nil && v.RunID != 0 {
				v.You.Marks = marks[v.RunID]
			}
			if v.Opponent != nil && v.theirRun != 0 && v.hasResult() {
				v.Opponent.Marks = marks[v.theirRun]
			}
		}
	}
	return nil
}

// duelMarks is how each question of these runs went, in order, by run.
func (g *Game) duelMarks(ctx context.Context, runs []int64) (map[int64][]DuelMark, error) {
	ids, err := json.Marshal(runs)
	if err != nil {
		return nil, err
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT run_id, score, is_right, given IS NULL FROM answers
		WHERE run_id IN (SELECT value FROM json_each(?)) ORDER BY run_id, n`, string(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]DuelMark{}
	for rows.Next() {
		var run int64
		var m DuelMark
		var score float64
		if err := rows.Scan(&run, &score, &m.Right, &m.Missed); err != nil {
			return nil, err
		}
		m.Close = closeAnswer(score, m.Right)
		out[run] = append(out[run], m)
	}
	return out, rows.Err()
}

// duelAgainst is the other side's answers in a duel run played second (State.Against), as far as the player has come:
// each of the at questions the player has answered, and nothing of the one shown, not even whether or when they
// answered it (a duel isn't a race). Nothing while the other side hasn't finished (a friend's duel played first).
func duelAgainst(tx *sql.Tx, runID int64, at int) ([]DuelMark, error) {
	var other int64
	err := tx.QueryRow(`SELECT o.id FROM duels d
		JOIN runs o ON o.id = CASE WHEN d.a_run = ?1 THEN d.b_run ELSE d.a_run END
		WHERE (d.a_run = ?1 OR d.b_run = ?1) AND o.finished_at IS NOT NULL`, runID).Scan(&other)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	rows, err := tx.Query(`SELECT n, is_right, score, given IS NULL FROM answers WHERE run_id = ? AND n < ?
		ORDER BY n`, other, at)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DuelMark, 0, at)
	for rows.Next() {
		var n int
		var m DuelMark
		var score float64
		if err := rows.Scan(&n, &m.Right, &score, &m.Missed); err != nil {
			return nil, err
		}
		for len(out) < n { // a question with no answer of theirs (one that counts for nobody): nothing to say of it
			out = append(out, DuelMark{Missed: true})
		}
		m.Close = closeAnswer(score, m.Right)
		out = append(out, m)
	}
	return out, rows.Err()
}

// duelScore is one side's game in a duel as its result goes: its right answers and what breaks a tie between the
// same (tiebreak, as on the day's board). Not its time: that never counts.
type duelScore struct {
	rights int
	tie    tiebreak
}

// against is -1 if s wins against o, 1 if it loses, 0 for a draw: more right answers wins; the same, what breaks a tie
// on the board (tiebreak); even in that too, a draw.
func (s duelScore) against(o duelScore) int {
	if s.rights != o.rights {
		return cmpInt(o.rights, s.rights)
	}
	return s.tie.cmp(o.tie)
}

// tieBy is what broke a tie between two games of even right answers (TieBy), "" if their right answers differ or
// nothing did (a draw).
func (s duelScore) tieBy(o duelScore) string {
	if s.rights == o.rights && s.tie != o.tie {
		return TieNumber
	}
	return ""
}

// duelResults is, in a query whose ?1 is a player, every duel they've played to a result, one row each: the other
// (null: one gone since), how it went for the player (won, lost, draw) and when it
// ended.
const duelResults = `(SELECT d.id, d.b_id AS other,
		CASE d.outcome WHEN 'a' THEN 'won' WHEN 'b' THEN 'lost' ELSE 'draw' END AS outcome, d.ended_at
	FROM duels d WHERE d.a_id = ?1 AND d.outcome IN ('a', 'b', 'draw')
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

// recordsOf are a player's records against everyone they've had a duel with, by the other.
func (g *Game) recordsOf(ctx context.Context, userID int64) (map[int64]Record, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT other, count(*) FILTER (WHERE outcome = 'won'),
			count(*) FILTER (WHERE outcome = 'lost'), count(*) FILTER (WHERE outcome = 'draw')
		FROM `+duelResults+` WHERE other IS NOT NULL GROUP BY other`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]Record{}
	for rows.Next() {
		var id int64
		var r Record
		if err := rows.Scan(&id, &r.Won, &r.Lost, &r.Drawn); err != nil {
			return nil, err
		}
		out[id] = r
	}
	return out, rows.Err()
}

// Waiting is the duels friends have sent a player and they haven't played yet, as Днес shows them (owner,
// 2026-11-23): the first challenged, from whom, and how many more wait. On the cover, under the streak; once the day
// is played, the result's action.
type Waiting struct {
	// ID is the first of them to play: the earliest sent (the first to lapse), as Приятели stacks them.
	ID   int64     `json:"id"`
	From *DuelSide `json:"from"`
	// More is how many others wait besides it.
	More int `json:"more"`
}

// DuelsWaiting is a player's Waiting: nil when no friend's duel waits for them. A light read (one row and its sender),
// for it's asked with every look at Днес; Приятели's whole list is DuelsOf.
func (g *Game) DuelsWaiting(ctx context.Context, userID int64) (*Waiting, error) {
	var w Waiting
	var from sql.NullInt64
	var all int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT d.id, d.a_id, count(*) OVER () FROM duels d
		LEFT JOIN runs r ON r.id = d.b_run
		WHERE d.b_id = ? AND d.sent_at IS NOT NULL AND d.ended_at IS NULL AND r.finished_at IS NULL
		ORDER BY d.expires_at, d.id LIMIT 1`, userID).Scan(&w.ID, &from, &all)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	w.More = all - 1
	if from.Valid {
		if w.From, err = g.duelSide(ctx, from.Int64); err != nil {
			return nil, err
		}
	}
	if w.From == nil {
		w.From = &DuelSide{Name: GoneName, Gone: true}
	}
	return &w, nil
}
