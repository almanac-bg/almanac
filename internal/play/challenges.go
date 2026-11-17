package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// A challenge is a link to a player's finished game of ten (a topic's, or a duel's own ten), for anyone who opens it:
// shared into a chat, it's one link with many takers. Each taker plays the same ten questions as a duel against that
// game, as a duel against a recording is played (ghost_run, a duel of their own: duels.challenge_id), in their own time,
// a guest as well as anyone; then both are side by side. It moves no rating (the two may be of any strength), and earns
// XP as any duel. A taker who has played it sees their result again, never a second game; the one who sent it sees
// who took it. A friend's duel is shared the same way, by the challenger's game in it: its link brings the friend to
// their duel, and anyone else to the challenge.
//
// The one who sent it hears of its takers quietly: one line on Начало for all of them since they last heard
// (ChallengeNewsOf), and a push for a taker at most once a day.

// ChallengeFor is how long a challenge can be taken, from when it was last sent.
const ChallengeFor = 7 * 24 * time.Hour

var (
	ErrNoChallenge = errors.New("no such challenge")
	// ErrChallengeOver is a challenge past its time.
	ErrChallengeOver = errors.New("the challenge is over")
	// ErrOwnChallenge is the one who sent it, taking it.
	ErrOwnChallenge = errors.New("one's own challenge")
	// ErrNoChallengeRun is a game that can't be a challenge: not the player's, not finished, not a game of ten.
	ErrNoChallengeRun = errors.New("no game to challenge with")
)

// Challenge is the link for a player's finished game of ten: made the first time it's asked for, the same after (and
// its time to be taken starts again).
func (g *Game) Challenge(ctx context.Context, userID, runID int64) (string, error) {
	var ok bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT finished_at IS NOT NULL AND kind IN ('topic', 'duel')
			AND json_array_length(questions) = ? FROM runs WHERE id = ? AND user_id = ?`, Length, runID, userID).Scan(&ok)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !ok) {
		return "", ErrNoChallengeRun
	}
	if err != nil {
		return "", err
	}
	now := g.Now()
	for range 3 {
		var code string
		err := g.DB.Write.QueryRowContext(ctx, `UPDATE challenges SET expires_at = ? WHERE run_id = ? RETURNING code`,
			store.Ms(now.Add(ChallengeFor)), runID).Scan(&code)
		if err == nil {
			return code, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		// Another tab may make one at the same moment: the first kept wins, and the loop reads it.
		if _, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO challenges (code, user_id, run_id, created_at, expires_at)
			VALUES (?, ?, ?, ?, ?)`, newInviteCode(), userID, runID, store.Ms(now), store.Ms(now.Add(ChallengeFor))); err != nil {
			return "", err
		}
	}
	return "", errors.New("no free challenge code")
}

// ChallengeView is a challenge as whoever opens its link sees it.
type ChallengeView struct {
	Code string `json:"code"`
	// By is who sent it, and how their game went: right answers of Total, in a topic ("" for all of them).
	By      NamedUser `json:"by"`
	Look    *Look     `json:"look,omitempty"`
	Rights  int       `json:"rights"`
	Total   int       `json:"total"`
	Topic   string    `json:"topic,omitempty"`
	Expires int64     `json:"expiresAt"`
	Over    bool      `json:"over,omitempty"`
	Own     bool      `json:"own,omitempty"`
	Duel    int64     `json:"duel,omitempty"`
	Takers  []Taker   `json:"takers,omitempty"`
	// Run is, to the one who sent it, their game it was sent with: to send it again (Challenge).
	Run      int64 `json:"run,omitempty"`
	friendOf int64 // the friend its duel was for, when it's a friend's duel's game
	userID   int64
	runID    int64
	id       int64
}

// Taker is one who took a player's challenge, as the player sees them: how it went for the player.
type Taker struct {
	NamedUser
	Look *Look `json:"look,omitempty"`
	// State is the sender's: won, lost, draw; or play while the taker is still at it.
	State  string `json:"state"`
	Rights int    `json:"rights"`
}

// ChallengeOf is a challenge as viewer (0: nobody signed in) sees it: who sent it and how they did; the viewer's own
// duel of it, if they have one (a taker's, or the friend's duel it was sent for); and, to the one who sent it, who has
// taken it.
func (g *Game) ChallengeOf(ctx context.Context, code string, viewer int64) (ChallengeView, error) {
	var v ChallengeView
	var avatar, title, category string
	var points int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT c.id, c.user_id, c.run_id, c.expires_at, u.name, u.tag, `+lookColumns+`,
			r.rights, json_array_length(r.questions), coalesce(r.category, ''),
			coalesce((SELECT b_id FROM duels WHERE kind = 'friend' AND a_run = c.run_id AND challenge_id IS NULL), 0)
		FROM challenges c JOIN users u ON u.id = c.user_id JOIN runs r ON r.id = c.run_id WHERE c.code = ?`, code).
		Scan(&v.id, &v.userID, &v.runID, &v.Expires, &v.By.Name, &v.By.Tag, &avatar, &title, &points, &v.Rights, &v.Total,
			&category, &v.friendOf)
	if errors.Is(err, sql.ErrNoRows) {
		return v, ErrNoChallenge
	}
	if err != nil {
		return v, err
	}
	v.Code, v.Topic, v.Own = code, category, viewer != 0 && viewer == v.userID
	v.Over = !g.Now().Before(time.UnixMilli(v.Expires))
	look := g.lookOf(v.userID, avatar, title, points)
	v.Look = &look
	if viewer != 0 && !v.Own {
		err := g.DB.Read.QueryRowContext(ctx, `SELECT id FROM duels WHERE (challenge_id = ?1 AND a_id = ?2)
			OR (kind = 'friend' AND a_run = ?3 AND b_id = ?2 AND challenge_id IS NULL) ORDER BY id LIMIT 1`, v.id, viewer, v.runID).
			Scan(&v.Duel)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return v, err
		}
	}
	if v.Own {
		v.Run = v.runID
		if v.Takers, err = g.takers(ctx, v.id); err != nil {
			return v, err
		}
	}
	return v, nil
}

// takers are those who took a challenge, the latest first.
func (g *Game) takers(ctx context.Context, challengeID int64) ([]Taker, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.id, u.name, u.tag, `+lookColumns+`, coalesce(d.outcome, ''), r.rights,
			r.finished_at IS NOT NULL
		FROM duels d JOIN users u ON u.id = d.a_id JOIN runs r ON r.id = d.a_run
		WHERE d.challenge_id = ? ORDER BY coalesce(d.ended_at, d.created_at) DESC LIMIT 100`, challengeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Taker
	for rows.Next() {
		var t Taker
		var id int64
		var avatar, title, outcome string
		var points int
		var done bool
		if err := rows.Scan(&id, &t.Name, &t.Tag, &avatar, &title, &points, &outcome, &t.Rights, &done); err != nil {
			return nil, err
		}
		look := g.lookOf(id, avatar, title, points)
		t.Look = &look
		// The outcome is the taker's (ghost_won: they won): the sender's is the other way round.
		t.State = map[string]string{"ghost_won": "lost", "ghost_lost": "won", "ghost_draw": "draw"}[outcome]
		if t.State == "" {
			t.State = "play"
			if done {
				t.State = "wait"
			}
			t.Rights = 0 // not shown until it's settled
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TakeChallenge is the viewer's game of a challenge: made the first time (a duel of theirs against the challenge's
// game), the same after. The friend a friend's duel was sent to gets their duel (its id, no state), not a new one.
func (g *Game) TakeChallenge(ctx context.Context, viewer int64, code string) (State, int64, error) {
	v, err := g.ChallengeOf(ctx, code, viewer)
	if err != nil {
		return State{}, 0, err
	}
	switch {
	case v.Own:
		return State{}, 0, ErrOwnChallenge
	case v.friendOf == viewer && v.Duel != 0:
		return State{}, v.Duel, nil
	case v.Duel == 0 && v.Over:
		return State{}, 0, ErrChallengeOver
	}
	var s State
	duelID := v.Duel
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		if duelID != 0 {
			var runID int64
			if err := tx.QueryRow(`SELECT a_run FROM duels WHERE id = ?`, duelID).Scan(&runID); err != nil {
				return err
			}
			r, err := load(tx, viewer, runID)
			if err != nil {
				return err
			}
			s, err = g.state(tx, r)
			return err
		}
		// Another tab of the same player may have taken it a moment ago: theirs is the one game of it.
		var taken, takenRun int64
		err := tx.QueryRow(`SELECT id, a_run FROM duels WHERE challenge_id = ? AND a_id = ?`, v.id, viewer).
			Scan(&taken, &takenRun)
		if err == nil {
			r, err := load(tx, viewer, takenRun)
			if err != nil {
				return err
			}
			duelID = taken
			s, err = g.state(tx, r)
			return err
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var raw string
		if err := tx.QueryRow(`SELECT questions FROM runs WHERE id = ?`, v.runID).Scan(&raw); err != nil {
			return err
		}
		var picks []Pick
		if err := json.Unmarshal([]byte(raw), &picks); err != nil {
			return err
		}
		r, err := g.insertRun(tx, viewer, "duel", nil, nil, picks)
		if err != nil {
			return err
		}
		now := g.Now()
		res, err := tx.Exec(`INSERT INTO duels (kind, questions, a_id, a_run, ghost_run, challenge_id, created_at, expires_at, rated)
			VALUES ('friend', ?, ?, ?, ?, ?, ?, ?, 0)`, raw, viewer, r.id, v.runID, v.id, store.Ms(now), store.Ms(now.Add(FriendFor)))
		if err != nil {
			return err
		}
		duelID, _ = res.LastInsertId()
		s, err = g.state(tx, r)
		return err
	})
	return s, duelID, err
}

// ChallengeNews is who has taken the player's challenges since they last heard: how many played, how many of them
// won, and the latest challenge taken (its code), for a line on Начало.
type ChallengeNews struct {
	Played int    `json:"played"`
	Beat   int    `json:"beat"`
	Name   string `json:"name,omitempty"` // the one who took it, when one did
	Code   string `json:"code"`
}

// ChallengeNewsOf is what came of the player's challenges since they last heard (ChallengesTold), in the last
// LinesRecent; nil if nothing did.
func (g *Game) ChallengeNewsOf(ctx context.Context, userID int64) (*ChallengeNews, error) {
	var n ChallengeNews
	var name sql.NullString
	var code sql.NullString
	err := g.DB.Read.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(d.outcome = 'ghost_won'), 0),
			CASE WHEN count(*) = 1 THEN max(u.name) END,
			(SELECT c2.code FROM duels d2 JOIN challenges c2 ON c2.id = d2.challenge_id WHERE c2.user_id = ?1
				AND d2.outcome LIKE 'ghost_%' ORDER BY d2.ended_at DESC LIMIT 1)
		FROM duels d JOIN challenges c ON c.id = d.challenge_id JOIN users u ON u.id = d.a_id
		WHERE c.user_id = ?1 AND d.outcome LIKE 'ghost_%' AND d.ended_at > max(?2, (SELECT challenges_told FROM users WHERE id = ?1))`,
		userID, store.Ms(g.Now().Add(-LinesRecent))).Scan(&n.Played, &n.Beat, &name, &code)
	if err != nil || n.Played == 0 {
		return nil, err
	}
	n.Name, n.Code = name.String, code.String
	return &n, nil
}

// challengeTold keeps that the player has heard of their challenges' takers so far.
func (g *Game) challengeTold(ctx context.Context, userID int64) error {
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE users SET challenges_told = ? WHERE id = ?`, store.Ms(g.Now()), userID)
	return err
}

// challengeNews tells the one who sent a challenge that someone took it: a push, at most once a day (the rest wait
// for Начало's line).
func (g *Game) challengeNews(ctx context.Context, challengeID int64, taker, outcome string, duelID int64) error {
	if g.DuelNews == nil {
		return nil
	}
	var to int64
	var code string
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT user_id, code FROM challenges WHERE id = ?`, challengeID).
		Scan(&to, &code); err != nil {
		return err
	}
	res, err := g.DB.Write.ExecContext(ctx, `UPDATE users SET challenge_pushed = ?1 WHERE id = ?2 AND challenge_pushed < ?3`,
		store.Ms(g.Now()), to, store.Ms(g.Now().Add(-24*time.Hour)))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil
	}
	mine := map[string]string{"won": "lost", "lost": "won", "draw": "draw"}[outcome]
	g.DuelNews(ctx, DuelNews{To: to, Kind: "challenge", From: taker, Outcome: mine, DuelID: duelID, Code: code})
	return nil
}
