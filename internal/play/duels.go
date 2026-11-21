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

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Duels are two players on the same ten questions, each played on one's own time, as any game is (play.go: the run's
// own clock, a question at a time); more right answers wins, and between the same, what breaks a tie on the day's
// board (tiebreak: how close the hard number came); even in both, it's a draw, as the board would share their place
// (duelScore): time never counts (DECISIONS.md, „The direction“). Nothing moves but the record between two people:
// there's no rating (owner, 2026-11-20, DECISIONS.md „The redesign“).
//
// A duel with a friend (DuelFriend): the player picks a friend and plays ten questions drawn for the two of them
// (drawFor: „Микс“, at their pair's level, questions neither has seen first). Once their side is played, the duel is
// sent: the friend is told (DuelNews: a push through the server's notifyFrom, and a dot and a row in Приятели)
// and has DuelFor to play the same ten, as the first player was shown them (their versions: the same ten exactly);
// past it, the duel lapses, and says so. Whoever plays second sees both at the end; the first sees the result when
// it comes, told too. Each pair keeps its record („общо 5 на 3“: recordAgainst). A rematch is a new duel the other
// way round. A player may have DuelsToOne duels open with one friend at once, and start DuelsADay a day.
//
// A duel against a recording (DuelRecording): the same ten as a real player's finished game (recordedRun: a real
// one, played at a person's speed, none of its questions the player has seen first), chosen as „равен“ (Even: about
// as many right as the player would get on its ten) or „по-силен“ (Stronger: a couple more), by the player's hidden
// mastery (mastery.go: expectedRights), played against it as it went:
// its marks come with the duel, for the screen to show at their times. It's shown by who played it, as anyone is seen
// anywhere in the game (owner, 2026-11-19): their name (a way to their profile) and avatar, during the duel, on its
// result and in the duel history, always labelled a recording, never taken for a person here now. The recorded player
// is never told who played it.
//
// A duel the player started and left unfinished is gone on with when they start one the same way again (with the same
// friend, or against a recording); one never finished goes at its time, as if never started (SettleDue). One left
// before its first question showed (a tap, then „Отказ“ or away) isn't a duel yet: it isn't listed, and goes with its
// run DuelUnbegun after it was made (SettleDue), so that nothing lingers as „Твой ред“ that nobody played. A friend's
// side left half-way counts as it stood when the time runs out.

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
	// gone on with by a tap on the same duel again) before it goes: long past its count, should its screen still be open.
	DuelUnbegun = 10 * time.Minute
)

var (
	// ErrNoDuel is a duel that isn't the player's (another's, or not sent to them yet); ErrDuelGone one there isn't at
	// all: never was, or gone (its player deleted: Forget; its first side never finished: SettleDue). A page tells the
	// two apart: one may be the player's in another profile, the other is nobody's.
	ErrNoDuel   = errors.New("not the player's duel")
	ErrDuelGone = errors.New("no such duel")
	// ErrNobody is that there's no recording to play against yet.
	ErrNobody = errors.New("nobody to play")
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
	// Opponent is the other player, or the recorded one it's played against.
	Opponent *DuelSide `json:"opponent,omitempty"`
	You      *DuelSide `json:"you,omitempty"`
	Recorded bool      `json:"recorded,omitempty"`
	// Level is, against a recording, the level it was chosen at, Even („равен“) or Stronger („по-силен“), where the
	// recording is that level (recordingFit: meets); none where it was only the nearest there was („Запис“), nor
	// against a friend.
	Level string `json:"level,omitempty"`
	// Topic is, against a recording of a topic's game, its topic (none: a game over all of them, „Микс“).
	Topic string `json:"topic,omitempty"`
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
	// Decided is, in a duel won on right answers, the question (from 1) after which the winner led to the end
	// (decided); 0 when the right answers were even and the tie was broken (or nothing did). One duel's view (DuelOf)
	// only.
	Decided int `json:"decided,omitempty"`
	// TieBy is, of a duel won on even right answers, what broke the tie (duelScore): TieNumber, the number nearer;
	// "" for a draw, or a duel won on right answers.
	TieBy string `json:"tieBy,omitempty"`
	// Record is how the player's duels against this person went, this one with them (not a recording's).
	Record *Record `json:"record,omitempty"`
	// Friend says the other is the player's friend now, Them who they are: a rematch is a tap away.
	Friend bool  `json:"friend,omitempty"`
	Them   int64 `json:"them,omitempty"`

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
	// Marks are how each question answered went (DuelOf): the player's own; the other's once the duel has a result.
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
// (From played their side), or played back (From played the second side: the result is in).
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
			WHERE d.kind = 'person' AND d.a_id = ? AND d.b_id = ? AND d.ended_at IS NULL AND r.finished_at IS NULL
			ORDER BY d.id DESC LIMIT 1`, userID, friendID).Scan(&id)
		if err == nil || !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var open, today int
		if err := tx.QueryRow(`SELECT count(*) FILTER (WHERE b_id = ?2 AND ended_at IS NULL), count(*) FILTER (WHERE created_at >= ?3)
			FROM duels WHERE kind = 'person' AND a_id = ?1`, userID, friendID, store.Ms(g.midnight())).
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
		data, _ := json.Marshal(picks)
		now := g.Now()
		res, err := tx.Exec(`INSERT INTO duels (kind, questions, a_id, a_run, b_id, created_at, expires_at)
			VALUES ('person', ?, ?, ?, ?, ?, ?)`, string(data), userID, r.id, friendID, store.Ms(now), store.Ms(now.Add(DuelFor)))
		if err != nil {
			return err
		}
		id, _ = res.LastInsertId()
		return nil
	})
	return id, err
}

// RecordingReady is whether a duel against a recording can be played now (DuelRecording): one the player left
// unfinished, or a recording to draw. Nothing is made: the way to one is offered only while there is one (userID 0: a
// visitor, any recording).
func (g *Game) RecordingReady(ctx context.Context, userID int64) (bool, error) {
	seen := map[string]bool{}
	if err := seenBy(ctx, g.DB.Read, userID, seen); err != nil {
		return false, err
	}
	// The days drawn, as a recording is judged by them (recordedRun): drawn once a day, so that this only reads.
	if err := g.EnsureDays(ctx); err != nil {
		return false, err
	}
	var ready bool
	err := g.read(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM duels d JOIN runs r ON r.id = d.a_run
			WHERE d.kind = 'recording' AND d.a_id = ? AND d.ended_at IS NULL AND r.finished_at IS NULL)`, userID).
			Scan(&ready); err != nil || ready {
			return err
		}
		rec, err := g.recordedRun(tx, userID, seen, nil)
		ready = rec != nil
		return err
	})
	return ready, err
}

// The recordings a player may choose to play against (DuelRecording).
const (
	// Even is a recording about as strong as the player: about as many right as they'd get on its ten.
	Even = "even"
	// Stronger is a recording a little stronger: StrongerBy more right than they'd get.
	Stronger = "stronger"
	// StrongerBy is how many more right answers „по-силен“ aims for.
	StrongerBy = 2
)

// DuelRecording starts a duel against a recording: another player's finished game, the one with the fewest questions
// the player has seen that fits the level chosen best (recordedRun: Even or Stronger, by the player's hidden mastery;
// anything else is Even), and the player's run of its ten; the duel keeps the level only if the recording is it. One the
// player started and left unfinished is gone on with instead. ErrNobody if there's none yet. It says the duel's id.
func (g *Game) DuelRecording(ctx context.Context, userID int64, level string) (int64, error) {
	seen := map[string]bool{}
	if err := seenBy(ctx, g.DB.Read, userID, seen); err != nil {
		return 0, err
	}
	if level != Stronger {
		level = Even
	}
	fit, err := g.recordingFit(ctx, userID, level)
	if err != nil {
		return 0, err
	}
	var id int64
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRow(`SELECT d.id FROM duels d JOIN runs r ON r.id = d.a_run
			WHERE d.kind = 'recording' AND d.a_id = ? AND d.ended_at IS NULL AND r.finished_at IS NULL
			ORDER BY d.id DESC LIMIT 1`, userID).Scan(&id)
		if err == nil || !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		rec, err := g.recordedRun(tx, userID, seen, fit)
		if err != nil {
			return err
		}
		if rec == nil {
			return ErrNobody
		}
		r, err := g.insertRun(ctx, tx, userID, "duel", nil, nil, rec.picks)
		if err != nil {
			return err
		}
		data, _ := json.Marshal(rec.picks)
		now := g.Now()
		// The level it's called by only if it is that level: else (the nearest there was) only „Запис“.
		var kept *string
		if rec.meets {
			kept = &level
		}
		res, err := tx.Exec(`INSERT INTO duels (kind, questions, a_id, a_run, recording_run, level, created_at, expires_at)
			VALUES ('recording', ?, ?, ?, ?, ?, ?, ?)`, string(data), userID, r.id, rec.id, kept,
			store.Ms(now), store.Ms(now.Add(DuelFor)))
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
// not sent yet), ErrDuelGone if there's no such duel, ErrDuelOver once it's over.
func (g *Game) PlayDuel(ctx context.Context, userID, duelID int64) (int64, error) {
	var run int64
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var a, b, aRun, bRun sql.NullInt64
		var sent, ended bool
		err := tx.QueryRow(`SELECT a_id, b_id, a_run, b_run, sent_at IS NOT NULL, ended_at IS NOT NULL FROM duels WHERE id = ?`,
			duelID).Scan(&a, &b, &aRun, &bRun, &sent, &ended)
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
// seenAmong), and how well they know them (on average over the players; in a topic, or all of them for ""). It's read
// before the write the draw goes into: it grows with every game they've played, and the game's one writer
// (store.DB.Write) mustn't wait on it.
type past struct {
	seen    map[string]int
	ability float64
}

func (g *Game) pastOf(ctx context.Context, category string, users ...int64) (past, error) {
	seen, err := g.seenAmong(ctx, users)
	if err != nil {
		return past{}, err
	}
	p := past{seen: seen}
	for _, id := range users {
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
	picks := Draw(g.Bank(), MixTopic, p.ability, p.seen, barred, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
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

// seenAmong is how stale each question is to a game for players (choose: the least first, those missing none): of
// those any of them has answered (in any game: the day, a topic's, a duel), one for each of them who has, so that no game
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

type recorded struct {
	id    int64
	picks []Pick
	// topic is the one topic the recorded game was in (a topic's game), "" for all of them (a duel's, „Микс“).
	topic string
	// meets is whether it's the level chosen (recordingFit), not only the nearest there was.
	meets bool
}

// RecordingRights is how many right answers make a game worth playing against, RecordingMissed how many not answered
// at most (one left halfway, the tab closed, isn't a game), and RecordingSeen how many of its questions the player may
// have seen before it counts as mostly seen.
const (
	RecordingRights = 3
	RecordingMissed = 2
	RecordingSeen   = 3
)

// recordedRun is another player's finished run of ten questions, every one answered or let run out (none still played
// in a duel), all still in play as it played them (asPlayed: none retired, none changed since), none of today's and
// none due for review (dayBars.now; a day's run never), played at a person's speed (not marked a script's: fair.go),
// to play against: a real game (RecordingRights right or more, RecordingMissed not answered at most), the one with the
// fewest questions the player has seen (seen, read before the write) or a day ahead holds (ahead.go: a game played
// before those days were drawn may have them), the latest first. Short of a real game, any game. At each of these, a
// game over all the topics (a duel's, „Микс“) comes before one in a single topic, which the duel's player didn't
// choose. Above all of it, a game with more than RecordingSeen of its questions seen by the player comes after every
// game with more than RecordingSeen of its questions seen by the player comes after every game with fewer: the same ten
// again (a duel the player has just played, then the other's game in it as a recording) is no duel. Of those as few
// seen, the one that fits the level the player chose best (fit, if given: the lower the better). Nil if there's none.
func (g *Game) recordedRun(tx *sql.Tx, userID int64, seen map[string]bool, fit recordingFit) (*recorded, error) {
	days, err := g.days(tx)
	if err != nil {
		return nil, err
	}
	// A script's game is left out before the limit, so that a script's many games can't push the people's out of it.
	rows, err := tx.Query(`SELECT r.id, r.questions, r.rights, r.finished_at,
			CASE WHEN r.kind = 'topic' AND r.category <> ?3 THEN r.category ELSE '' END,
			(SELECT count(*) FROM answers a WHERE a.run_id = r.id AND a.given IS NULL)
		FROM runs r
		WHERE r.kind IN ('topic', 'duel') AND r.finished_at IS NOT NULL AND NOT r.shadow AND r.user_id <> ?1
			AND json_array_length(r.questions) = ?2 AND r.at = ?2
			AND NOT EXISTS (SELECT 1 FROM duels d WHERE d.ended_at IS NULL
				AND (d.a_run = r.id OR d.b_run = r.id))
		ORDER BY r.finished_at DESC LIMIT 200`, userID, Length, MixTopic)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	b := g.Bank()
	// The best of each kind: real (0, 1), any (2, 3), each over all the topics first, then in one; each the fewest
	// seen, the latest first. Those with more than RecordingSeen seen: the same four after all of them (4–7).
	var best [8]*recorded
	var fewest [8]int
	var fits [8]float64
	for i := range fewest {
		fewest[i] = Length + 1
	}
	for rows.Next() {
		var id, finished int64
		var raw string
		var rights, missed int
		var topic string
		if err := rows.Scan(&id, &raw, &rights, &finished, &topic, &missed); err != nil {
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
		kind := 0
		if topic != "" {
			kind = 1 // a single topic's game: after the games over all of them
		}
		if n > RecordingSeen {
			kind += 4 // mostly seen: after every game the player hasn't
		}
		real := rights >= RecordingRights && missed <= RecordingMissed
		off, meets := 0.0, false
		if fit != nil {
			off, meets = fit(b, picks, rights)
		}
		for level, ok := range [2]bool{real, true} {
			if k := 2*level + kind; ok && (n < fewest[k] || n == fewest[k] && off < fits[k]) {
				best[k], fewest[k], fits[k] = &recorded{id: id, picks: picks, topic: topic, meets: meets}, n, off
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

// settleRun does what a just-finished run's duel needs: the first side of a friend's duel played, it's sent (the
// friend's time runs from now, and they're told); the second (or the player's, against a recording), the duel's
// result.
func (g *Game) settleRun(ctx context.Context, runID int64) error {
	var duelID int64
	var kind string
	var first, sent bool
	var a, b sql.NullInt64
	err := g.DB.Read.QueryRowContext(ctx, `SELECT id, kind, a_run = ?1, sent_at IS NOT NULL, a_id, b_id FROM duels
		WHERE (a_run = ?1 OR b_run = ?1) AND ended_at IS NULL`, runID).Scan(&duelID, &kind, &first, &sent, &a, &b)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if kind == "recording" || !first {
		return g.settleDuel(ctx, duelID, runID)
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

// settleDuel ends a duel both sides of which are played (against a recording, the player's), with its result
// (duelScore). A duel ended already (both sides
// finished at once, and the other settled it) is left as it is. finished is the run that has just ended it, whose own
// follow-up this is (after.go); the other side's is due again, with the result.
func (g *Game) settleDuel(ctx context.Context, duelID, finished int64) error {
	type side struct {
		id, run       int64
		score         duelScore
		done, present bool
	}
	var a, b side
	var kind string
	settled := false
	var followed []side
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		followed = nil
		var bID, bRun sql.NullInt64
		var bRights, bClose sql.NullInt64
		var bDone sql.NullBool
		err := tx.QueryRow(`SELECT d.kind, d.a_id, ra.id, ra.rights, ra.closeness,
				ra.finished_at IS NOT NULL,
				rb.user_id, rb.id, rb.rights, rb.closeness, rb.finished_at IS NOT NULL
			FROM duels d JOIN users ua ON ua.id = d.a_id JOIN runs ra ON ra.id = d.a_run
			LEFT JOIN runs rb ON rb.id = CASE d.kind WHEN 'recording' THEN d.recording_run ELSE d.b_run END
			WHERE d.id = ? AND d.ended_at IS NULL`, duelID).
			Scan(&kind, &a.id, &a.run, &a.score.rights, &a.score.tie.closeness,
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
		recording := kind == "recording"
		score := 0.5
		switch a.score.against(b.score) {
		case -1:
			score = 1
		case 1:
			score = 0
		}
		// The result is the duel's (duels.outcome): a run keeps nothing of whom it was against.
		followed = append(followed, a)
		if !recording {
			followed = append(followed, b)
		}
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
	if kind == "person" {
		g.duelNews(ctx, DuelNews{DuelID: duelID, From: b.id, To: a.id, Played: true})
	}
	return nil
}

// SettleDue ends the duels whose time is up. A friend's side left half-way counts as it stood: it's finished there,
// and the duel has its result. One the friend never started lapses, without a result. One whose first side was never
// finished goes, as if never started (its run stays the player's, a game left half-way). One whose first question never
// showed goes with its run DuelUnbegun after it was made (dropUnbegun). Run every few minutes.
func (g *Game) SettleDue(ctx context.Context) error {
	if err := g.dropUnbegun(ctx); err != nil {
		return err
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, d.kind, d.sent_at IS NOT NULL, coalesce(d.b_run, 0),
			coalesce((SELECT finished_at IS NOT NULL FROM runs WHERE id = d.a_run), 0)
		FROM duels d WHERE d.ended_at IS NULL AND d.expires_at <= ?`, store.Ms(g.Now()))
	if err != nil {
		return err
	}
	type due struct {
		id         int64
		kind       string
		sent       bool
		bRun       int64
		firstPlays bool
	}
	var list []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.kind, &d.sent, &d.bRun, &d.firstPlays); err != nil {
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
		case d.kind == "recording" && d.firstPlays, d.kind == "person" && d.bRun != 0:
			err = g.endDue(ctx, d.id, d.bRun)
		case d.kind == "person" && d.sent:
			_, err = g.DB.Write.ExecContext(ctx, `UPDATE duels SET ended_at = ?, outcome = 'expired' WHERE id = ?
				AND ended_at IS NULL`, store.Ms(g.Now()), d.id)
		default:
			_, err = g.DB.Write.ExecContext(ctx, `DELETE FROM duels WHERE id = ? AND ended_at IS NULL`, d.id)
		}
		if err != nil {
			return err
		}
	}
	return nil
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
			return g.finish(tx, r)
		})
		if err != nil {
			return err
		}
	}
	if err := g.settleDuel(ctx, duelID, 0); err != nil {
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
// sent and waiting for the friend, and those played (the latest ended first, DuelsShown of them).
type Duels struct {
	Yours  []DuelView `json:"yours"`
	Theirs []DuelView `json:"theirs"`
	Played []DuelView `json:"played"`
}

// DuelsShown is how many duels played Приятели lists.
const DuelsShown = 30

// DuelsOf are a player's duels, as Приятели lists them.
func (g *Game) DuelsOf(ctx context.Context, userID int64) (Duels, error) {
	out := Duels{Yours: []DuelView{}, Theirs: []DuelView{}, Played: []DuelView{}}
	list, err := g.duelsOf(ctx, userID, 0)
	if err != nil {
		return out, err
	}
	records, err := g.recordsOf(ctx, userID)
	if err != nil {
		return out, err
	}
	for _, v := range list {
		if r, ok := records[v.against]; ok && !v.Recorded && v.against != 0 {
			v.Record = &r
		}
		switch v.State {
		case DuelYours:
			out.Yours = append(out.Yours, v)
		case DuelTheirs:
			out.Theirs = append(out.Theirs, v)
		default:
			if len(out.Played) < DuelsShown {
				out.Played = append(out.Played, v)
			}
		}
	}
	return out, nil
}

// duelsOf are the player's duels (or only that one), as they see them: the open ones first (the oldest first: the
// first to lapse), then those ended, the latest first. A friend's duel shows to the one it's sent to once it's sent.
func (g *Game) duelsOf(ctx context.Context, userID, only int64) ([]DuelView, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, d.kind, d.mine, d.created_at, coalesce(d.ended_at, 0),
			d.expires_at, d.sent_at IS NOT NULL, coalesce(d.outcome, ''),
			coalesce(CASE WHEN d.mine THEN d.a_run ELSE d.b_run END, 0),
			coalesce(CASE WHEN NOT d.mine THEN d.a_run WHEN d.kind = 'recording' THEN d.recording_run ELSE d.b_run END, 0),
			coalesce(CASE WHEN NOT d.mine THEN d.a_id WHEN d.kind = 'recording'
				THEN (SELECT user_id FROM runs WHERE id = d.recording_run) ELSE d.b_id END, 0),
			coalesce((SELECT category FROM runs WHERE id = d.recording_run AND kind = 'topic' AND category <> ?3), ''),
			coalesce(d.level, '')
		FROM (SELECT *, coalesce(a_id = ?1, 0) AS mine FROM duels
			WHERE (a_id = ?1 OR (b_id = ?1 AND sent_at IS NOT NULL)) AND (?2 = 0 OR id = ?2)) d
		ORDER BY d.ended_at IS NOT NULL, CASE WHEN d.ended_at IS NULL THEN d.expires_at ELSE -d.ended_at END
		LIMIT 200`, userID, only, MixTopic)
	if err != nil {
		return nil, err
	}
	type row struct {
		v                       DuelView
		kind, outcome           string
		sent                    bool
		myRun, theirRun, theirs int64
		expires                 int64
	}
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.v.ID, &r.kind, &r.v.First, &r.v.CreatedAt, &r.v.EndedAt, &r.expires, &r.sent,
			&r.outcome, &r.myRun, &r.theirRun, &r.theirs, &r.v.Topic, &r.v.Level); err != nil {
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
		v.Recorded = r.kind == "recording"
		v.RunID, v.against, v.theirRun = r.myRun, r.theirs, r.theirRun
		var err error
		if v.You, err = g.duelSide(ctx, userID, r.myRun); err != nil {
			return nil, err
		}
		if r.theirs != 0 {
			if v.Opponent, err = g.duelSide(ctx, r.theirs, r.theirRun); err != nil {
				return nil, err
			}
		}
		if v.Opponent == nil {
			// Every duel has another side (a player, or a recording's): none is one who's gone.
			v.Opponent = &DuelSide{Name: GoneName, Done: true, Gone: true}
		}
		mine := v.First
		// The player's own, left before its first question showed: not a duel yet, in the lists (SettleDue drops it).
		if only == 0 && v.EndedAt == 0 && mine && v.You != nil && !v.You.Started {
			continue
		}
		switch {
		case v.EndedAt == 0:
			v.Until = r.expires
			v.State = DuelYours
			if mine && v.You != nil && v.You.Done {
				v.State = DuelTheirs
			}
		case r.outcome == "draw":
			v.State = DuelDraw
		case r.outcome == "a" && mine, r.outcome == "b" && !mine:
			v.State = DuelWon
		case r.outcome == "a", r.outcome == "b":
			v.State = DuelLost
		default:
			v.State = DuelExpired
			if r.kind == "person" && r.sent {
				// Lapsed: the friend never played it (or it's from before, cut off live: both had played some).
				switch {
				case mine && r.theirRun == 0:
					v.Lapsed = "they"
				case !mine && r.myRun == 0:
					v.Lapsed = "you"
				}
			}
		}
		// The other's score shows once there's a result.
		if result := v.State == DuelWon || v.State == DuelLost || v.State == DuelDraw; !result && v.Opponent != nil {
			v.Opponent.Rights = 0
		}
		// A result on even right answers says what broke the tie, in a list too (Приятели's rows).
		if (v.State == DuelWon || v.State == DuelLost) && v.You != nil && !v.Opponent.Gone {
			v.TieBy = v.You.score.tieBy(v.Opponent.score)
		}
		out = append(out, v)
	}
	return out, nil
}

// duelSide is a player in a duel: who they are, and how their run went (none: not started).
func (g *Game) duelSide(ctx context.Context, userID, runID int64) (*DuelSide, error) {
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
	if runID != 0 {
		err = g.DB.Read.QueryRowContext(ctx, `SELECT finished_at IS NOT NULL, rights, closeness,
			at > 0 OR shown_at IS NOT NULL OR EXISTS (SELECT 1 FROM answers WHERE run_id = runs.id) FROM runs WHERE id = ?`, runID).
			Scan(&s.Done, &s.Rights, &s.score.tie.closeness, &s.Started)
		s.score.rights = s.Rights
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	return &s, nil
}

// DuelExists is whether there is a duel by this id, whoever's it is: what a page of it can say to anyone.
func (g *Game) DuelExists(ctx context.Context, id int64) (bool, error) {
	var yes bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM duels WHERE id = ?)`, id).Scan(&yes)
	return yes, err
}

// DuelOf is one of a player's duels, as DuelsOf has it, with more: how each question went for each side (the other's
// once it has a result, or while it's the player's turn, for its screen: DuelSide.Marks), the question that decided
// it, their record against this person, and whether they're friends. ErrNoDuel if it isn't theirs, ErrDuelGone if
// there's no such duel.
func (g *Game) DuelOf(ctx context.Context, userID, duelID int64) (DuelView, error) {
	list, err := g.duelsOf(ctx, userID, duelID)
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
	v := list[0]
	if v.You != nil && v.RunID != 0 {
		if v.You.Marks, err = g.duelMarks(ctx, v.RunID); err != nil {
			return v, err
		}
	}
	result := v.State == DuelWon || v.State == DuelLost || v.State == DuelDraw
	if v.Opponent != nil && v.theirRun != 0 && result {
		if v.Opponent.Marks, err = g.duelMarks(ctx, v.theirRun); err != nil {
			return v, err
		}
		if v.You != nil {
			v.Decided = decided(v.You.Marks, v.Opponent.Marks, v.You.Rights, v.Opponent.Rights)
			if v.State != DuelDraw {
				v.TieBy = v.You.score.tieBy(v.Opponent.score)
			}
		}
	}
	if !v.Recorded && v.against != 0 {
		r, err := g.recordAgainst(ctx, userID, v.against)
		if err != nil {
			return v, err
		}
		v.Record = &r
		if err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?)`,
			userID, v.against).Scan(&v.Friend); err != nil {
			return v, err
		}
		if v.Friend {
			v.Them = v.against
		}
	}
	return v, nil
}

// duelMarks is how each question of a run went, in order.
func (g *Game) duelMarks(ctx context.Context, runID int64) ([]DuelMark, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT score, is_right, given IS NULL FROM answers WHERE run_id = ?
		ORDER BY n`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DuelMark
	for rows.Next() {
		var m DuelMark
		var score float64
		if err := rows.Scan(&score, &m.Right, &m.Missed); err != nil {
			return nil, err
		}
		m.Close = closeAnswer(score, m.Right)
		out = append(out, m)
	}
	return out, rows.Err()
}

// duelAgainst is the other side's answers in a duel run played second (State.Against), as far as the player has come:
// each of the at questions the player has answered, and nothing of the one shown, not even whether or when they
// answered it (a duel isn't a race). Nothing while the other side hasn't finished (a friend's duel played first).
func duelAgainst(tx *sql.Tx, runID int64, at int) ([]DuelMark, error) {
	var other int64
	err := tx.QueryRow(`SELECT o.id FROM duels d
		JOIN runs o ON o.id = CASE WHEN d.a_run = ?1 THEN CASE WHEN d.kind = 'recording' THEN d.recording_run ELSE d.b_run END
			ELSE d.a_run END
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

// decided is the question (from 1) after which a duel's winner on right answers led to the end, by how each question
// went for each side (a and b) and their games' right answers (those that count: the last question's lead is theirs);
// 0 when their right answers end even, and what broke the tie decided it.
func decided(a, b []DuelMark, rightsA, rightsB int) int {
	n := max(len(a), len(b))
	if n == 0 {
		return 0
	}
	lead := make([]int, n) // a's lead over b after each question
	sum := 0
	for i := range n {
		if i < len(a) && a[i].Right {
			sum++
		}
		if i < len(b) && b[i].Right {
			sum--
		}
		lead[i] = sum
	}
	lead[n-1] = rightsA - rightsB
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
// (a person; null against a recording, or one gone since), how it went for the player (won, lost, draw) and when it
// ended.
const duelResults = `(SELECT d.id, CASE d.kind WHEN 'person' THEN d.b_id END AS other,
		CASE d.outcome WHEN 'a' THEN 'won' WHEN 'b' THEN 'lost' ELSE 'draw' END AS outcome, d.ended_at
	FROM duels d WHERE d.a_id = ?1 AND d.outcome IN ('a', 'b', 'draw')
	UNION ALL
	SELECT d.id, d.a_id, CASE d.outcome WHEN 'b' THEN 'won' WHEN 'a' THEN 'lost' ELSE 'draw' END, d.ended_at
	FROM duels d WHERE d.b_id = ?1 AND d.kind = 'person' AND d.outcome IN ('a', 'b', 'draw'))`

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
