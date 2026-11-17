package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// A challenge is a player's game of ten, sent: to friends, who find it in the game, and as a link (/c/<code>) for
// anyone who opens it (shared into a chat, it's one link with many takers). Each taker plays the same ten questions
// against that game, as a duel against a recording is played (a duel of their own, kind challenge: ghost_run is the
// sender's game), in their own time, a guest as well as anyone; then both are side by side. Each takes it once, and
// one who has sees their result again, never a second game.
//
// It's made two ways. A game already played is sent (Challenge: a topic's, or all of them; the link, and the friends
// it's sent to). Or a friend is challenged at once (ChallengeFriend): ten drawn fresh for the two, questions neither
// has seen first, sent to the friend as soon as the player has played them (sent). A friend it's sent to has their
// game of it made then, not started (a_run none), and is told once the sender has played: they play it or say no
// (Decline); after, it can still go to anyone by its link.
//
// A taker who is the sender's friend plays a duel between the two (b_id is the sender): the first of a day between
// them moves both their ratings (ratedToday), it counts in the record between them, and its result is told to both.
// Anyone else's moves no rating (the two may be of any strength, and accounts made to farm a rating are the risk), and
// the sender hears of those quietly: one line on Начало for all of them since they last heard (ChallengeNewsOf), and a
// push at most once a day.
//
// It can be taken for ChallengeFor from when it was sent; sent again, its time starts again.

// ChallengeFor is how long a challenge can be taken, from when it was sent: a weekend in a group's chat, and not so
// long that a friend's turn hangs for a week.
const ChallengeFor = 3 * 24 * time.Hour

var (
	ErrNoChallenge = errors.New("no such challenge")
	// ErrChallengeOver is a challenge past its time.
	ErrChallengeOver = errors.New("the challenge is over")
	// ErrOwnChallenge is the one who sent it, taking it.
	ErrOwnChallenge = errors.New("one's own challenge")
	// ErrNoChallengeRun is a game that can't be a challenge: not the player's, not finished, not a game of ten.
	ErrNoChallengeRun = errors.New("no game to challenge with")
)

// Challenge sends one of the player's finished games of ten: its link, made the first time and the same after, and to
// the friends in `to` (anyone else in it is left out), who are told. Its time to be taken starts again, for the
// friends it was sent to who haven't started too.
func (g *Game) Challenge(ctx context.Context, userID, runID int64, to []int64) (string, error) {
	var code string
	var asked []int64
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var ok bool
		err := tx.QueryRow(`SELECT finished_at IS NOT NULL AND kind IN ('topic', 'duel')
			AND json_array_length(questions) = ? FROM runs WHERE id = ? AND user_id = ?`, Length, runID, userID).Scan(&ok)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && !ok) {
			return ErrNoChallengeRun
		}
		if err != nil {
			return err
		}
		var id int64
		if id, code, err = g.challengeFor(tx, userID, runID); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE duels SET expires_at = ? WHERE challenge_id = ? AND a_run IS NULL AND ended_at IS NULL`,
			store.Ms(g.Now().Add(ChallengeFor)), id); err != nil {
			return err
		}
		asked, err = g.sendTo(tx, id, userID, runID, to)
		return err
	})
	if err != nil {
		return "", err
	}
	return code, g.tellAsked(ctx, userID, asked)
}

// challengeFor is the challenge of a player's game (its id and code), made the first time, its time to be taken
// started again.
func (g *Game) challengeFor(tx *sql.Tx, userID, runID int64) (int64, string, error) {
	now := g.Now()
	for range 3 {
		var id int64
		var code string
		err := tx.QueryRow(`UPDATE challenges SET expires_at = ? WHERE run_id = ? RETURNING id, code`,
			store.Ms(now.Add(ChallengeFor)), runID).Scan(&id, &code)
		if err == nil {
			return id, code, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return 0, "", err
		}
		// A code taken already leaves it unmade, and the loop draws another.
		if _, err := tx.Exec(`INSERT OR IGNORE INTO challenges (code, user_id, run_id, created_at, expires_at)
			VALUES (?, ?, ?, ?, ?)`, newInviteCode(), userID, runID, store.Ms(now), store.Ms(now.Add(ChallengeFor))); err != nil {
			return 0, "", err
		}
	}
	return 0, "", errors.New("no free challenge code")
}

// sendTo sends a challenge (of the sender's game, run) to those of `to` who are the sender's friends: each one's game
// of it is made, not started, as long as the challenge lasts. The duels made for those not sent it before.
func (g *Game) sendTo(tx *sql.Tx, challengeID, sender, run int64, to []int64) ([]int64, error) {
	var made []int64
	for _, friend := range slices.Compact(slices.Sorted(slices.Values(to))) {
		res, err := tx.Exec(`INSERT OR IGNORE INTO duels (kind, questions, a_id, b_id, ghost_run, challenge_id, created_at,
				expires_at)
			SELECT 'challenge', r.questions, ?1, ?2, r.id, c.id, ?4, c.expires_at FROM runs r JOIN challenges c ON c.run_id = r.id
			WHERE r.id = ?3 AND c.id = ?5 AND EXISTS (SELECT 1 FROM friends WHERE user_id = ?2 AND friend_id = ?1)`,
			friend, sender, run, store.Ms(g.Now()), challengeID)
		if err != nil {
			return nil, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			id, _ := res.LastInsertId()
			made = append(made, id)
		}
	}
	return made, nil
}

// tellAsked tells the friends a player's challenge was sent to (their duels of it) that it waits for them.
func (g *Game) tellAsked(ctx context.Context, sender int64, duels []int64) error {
	if g.DuelNews == nil || len(duels) == 0 {
		return nil
	}
	var name string
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT name FROM users WHERE id = ?`, sender).Scan(&name); err != nil {
		return err
	}
	for _, id := range duels {
		var to int64
		if err := g.DB.Read.QueryRowContext(ctx, `SELECT a_id FROM duels WHERE id = ?`, id).Scan(&to); err != nil {
			return err
		}
		g.DuelNews(ctx, DuelNews{To: to, Kind: "asked", From: name, DuelID: id})
	}
	return nil
}

// sent follows a game just finished (run) that is a challenge already, sent to friends before it was played (a
// friend challenged at once): its time to be taken starts now, and the friends it was sent to are told.
func (g *Game) sent(ctx context.Context, runID int64) error {
	var sender int64
	var duels []int64
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		until := store.Ms(g.Now().Add(ChallengeFor))
		err := tx.QueryRow(`UPDATE challenges SET expires_at = ? WHERE run_id = ? RETURNING user_id`, until, runID).Scan(&sender)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		rows, err := tx.Query(`UPDATE duels SET expires_at = ? WHERE ghost_run = ? AND kind = 'challenge' AND a_run IS NULL
			AND ended_at IS NULL RETURNING id`, until, runID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return err
			}
			duels = append(duels, id)
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	return g.tellAsked(ctx, sender, duels)
}

// ChallengeFriend challenges a friend at once: ten questions drawn for the two (questions neither has seen first, as
// hard as they know on average), the player's game of them started, and the challenge sent to the friend, who hears
// of it once the player has played. The friend's duel of it, for the player to follow.
func (g *Game) ChallengeFriend(ctx context.Context, userID, friendID int64) (State, int64, error) {
	if _, err := g.Friend(ctx, userID, friendID); err != nil {
		return State{}, 0, err
	}
	p, err := g.pastOf(ctx, "", userID, friendID)
	if err != nil {
		return State{}, 0, err
	}
	var s State
	var duelID int64
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		picks, err := g.drawFor(tx, p)
		if err != nil {
			return err
		}
		r, err := g.insertRun(tx, userID, "duel", nil, nil, picks)
		if err != nil {
			return err
		}
		id, _, err := g.challengeFor(tx, userID, r.id)
		if err != nil {
			return err
		}
		made, err := g.sendTo(tx, id, userID, r.id, []int64{friendID})
		if err != nil {
			return err
		}
		if len(made) != 1 {
			return ErrNotFriends
		}
		duelID = made[0]
		s, err = g.state(tx, r)
		return err
	})
	return s, duelID, err
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
	// Duel is the viewer's game of it: one they took, or one sent to them.
	Duel   int64   `json:"duel,omitempty"`
	Takers []Taker `json:"takers,omitempty"`
	// Run is, to the one who sent it, their game it was sent with: to send it again (Challenge).
	Run    int64 `json:"run,omitempty"`
	userID int64
	runID  int64
	id     int64
}

// Taker is one who took a player's challenge, as the player sees them: how it went for the player.
type Taker struct {
	NamedUser
	Look *Look `json:"look,omitempty"`
	// State is the sender's: won, lost, draw; or play while the taker is still at it, wait once they've finished.
	State  string `json:"state"`
	Rights int    `json:"rights"`
}

// ChallengeOf is a challenge as viewer (0: nobody signed in) sees it: who sent it and how they did; the viewer's own
// game of it, if they have one; and, to the one who sent it, who has taken it. ErrNoChallenge for one whose sender
// hasn't played it yet, but to them.
func (g *Game) ChallengeOf(ctx context.Context, code string, viewer int64) (ChallengeView, error) {
	var v ChallengeView
	var avatar, title, category string
	var points int
	var played bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT c.id, c.user_id, c.run_id, c.expires_at, u.name, u.tag, `+lookColumns+`,
			r.rights, json_array_length(r.questions), coalesce(r.category, ''), r.finished_at IS NOT NULL
		FROM challenges c JOIN users u ON u.id = c.user_id JOIN runs r ON r.id = c.run_id WHERE c.code = ?`, code).
		Scan(&v.id, &v.userID, &v.runID, &v.Expires, &v.By.Name, &v.By.Tag, &avatar, &title, &points, &v.Rights, &v.Total,
			&category, &played)
	if errors.Is(err, sql.ErrNoRows) {
		return v, ErrNoChallenge
	}
	if err != nil {
		return v, err
	}
	v.Code, v.Topic, v.Own = code, category, viewer != 0 && viewer == v.userID
	if !played && !v.Own {
		return ChallengeView{}, ErrNoChallenge
	}
	v.Over = !g.Now().Before(time.UnixMilli(v.Expires))
	look := g.lookOf(v.userID, avatar, title, points)
	v.Look = &look
	if viewer != 0 && !v.Own {
		err := g.DB.Read.QueryRowContext(ctx, `SELECT id FROM duels WHERE challenge_id = ? AND a_id = ?`, v.id, viewer).
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

// takers are those who took a challenge, the latest first: not those it was sent to who haven't started, nor said no.
func (g *Game) takers(ctx context.Context, challengeID int64) ([]Taker, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.id, u.name, u.tag, `+lookColumns+`, coalesce(d.outcome, ''), r.rights,
			r.finished_at IS NOT NULL
		FROM duels d JOIN users u ON u.id = d.a_id JOIN runs r ON r.id = d.a_run
		WHERE d.challenge_id = ? AND coalesce(d.outcome, '') NOT IN ('declined', 'expired')
		ORDER BY coalesce(d.ended_at, d.created_at) DESC LIMIT 100`, challengeID)
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
		// The outcome is the taker's (a, ghost_won: they won): the sender's is the other way round.
		t.State = map[string]string{"a": "lost", "ghost_won": "lost", "b": "won", "ghost_lost": "won", "draw": "draw",
			"ghost_draw": "draw"}[outcome]
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
// game, between the two if they're friends; or, sent to them, theirs started), the same after. One over already (said
// no to, not played in time, played) has its duel's id and no state.
func (g *Game) TakeChallenge(ctx context.Context, viewer int64, code string) (State, int64, error) {
	v, err := g.ChallengeOf(ctx, code, viewer)
	if err != nil {
		return State{}, 0, err
	}
	switch {
	case v.Own:
		return State{}, 0, ErrOwnChallenge
	case v.Duel == 0 && v.Over:
		return State{}, 0, ErrChallengeOver
	}
	var s State
	var duelID int64
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		now := g.Now()
		// Another tab of the same player may have taken it a moment ago: theirs is the one game of it.
		var run sql.NullInt64
		var ended bool
		err := tx.QueryRow(`SELECT id, a_run, ended_at IS NOT NULL FROM duels WHERE challenge_id = ? AND a_id = ?`, v.id, viewer).
			Scan(&duelID, &run, &ended)
		switch {
		case err == nil && ended:
			return nil
		case err == nil && run.Valid:
			r, err := load(tx, viewer, run.Int64)
			if err != nil {
				return err
			}
			s, err = g.state(tx, r)
			return err
		case err != nil && !errors.Is(err, sql.ErrNoRows):
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
		// Taken, the game is the taker's to finish in a challenge's time from now.
		until := store.Ms(now.Add(ChallengeFor))
		if duelID != 0 { // sent to them: theirs, started now
			if _, err := tx.Exec(`UPDATE duels SET a_run = ?, expires_at = max(expires_at, ?) WHERE id = ?`, r.id, until, duelID); err != nil {
				return err
			}
		} else {
			res, err := tx.Exec(`INSERT INTO duels (kind, questions, a_id, a_run, b_id, ghost_run, challenge_id, created_at,
					expires_at)
				VALUES ('challenge', ?1, ?2, ?3, (SELECT friend_id FROM friends WHERE user_id = ?2 AND friend_id = ?4), ?5, ?6, ?7, ?8)`,
				raw, viewer, r.id, v.userID, v.runID, v.id, store.Ms(now), until)
			if err != nil {
				return err
			}
			duelID, _ = res.LastInsertId()
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, duelID, err
}

// Decline is a friend saying no to a challenge sent to them, before they've started it: it's over for them, without a
// result.
func (g *Game) Decline(ctx context.Context, userID, duelID int64) error {
	res, err := g.DB.Write.ExecContext(ctx, `UPDATE duels SET outcome = 'declined', ended_at = ?
		WHERE id = ? AND kind = 'challenge' AND a_id = ? AND a_run IS NULL AND ended_at IS NULL`,
		store.Ms(g.Now()), duelID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoDuel
	}
	return nil
}

// Asked is a friend's challenge waiting for the player: who, and until when.
type Asked struct {
	ID        int64  `json:"id"` // the player's duel of it
	From      string `json:"from"`
	ExpiresAt int64  `json:"expiresAt"`
	// Started is a challenge the player has begun (and not finished).
	Started bool `json:"started,omitempty"`
}

// AskedOf are the friends' challenges waiting for the player to play (sent to them, or taken and not finished), once
// their senders have played them, the soonest to run out first.
func (g *Game) AskedOf(ctx context.Context, userID int64) ([]Asked, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT d.id, ub.name, d.expires_at, d.a_run IS NOT NULL
		FROM duels d JOIN users ub ON ub.id = d.b_id JOIN runs rs ON rs.id = d.ghost_run LEFT JOIN runs ra ON ra.id = d.a_run
		WHERE d.kind = 'challenge' AND d.a_id = ? AND d.ended_at IS NULL AND rs.finished_at IS NOT NULL
			AND ra.finished_at IS NULL
		ORDER BY d.expires_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Asked{}
	for rows.Next() {
		var a Asked
		if err := rows.Scan(&a.ID, &a.From, &a.ExpiresAt, &a.Started); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// FriendPlayed is a friend's game of the player's challenge, played: who, how it ended for the player, and the two
// scores. Начало tells it once (the client keeps which it has told).
type FriendPlayed struct {
	DuelID int64  `json:"id"`
	From   string `json:"from"`
	State  string `json:"state"` // won, lost, draw
	You    int    `json:"you"`
	Them   int    `json:"them"`
}

// PlayedRecent is how long a friend's playing of the player's challenge is told on Начало.
const PlayedRecent = 72 * time.Hour

// FriendPlayedOf is the latest of the player's challenges that a friend has played in the last PlayedRecent, or nil.
func (g *Game) FriendPlayedOf(ctx context.Context, userID int64) (*FriendPlayed, error) {
	var p FriendPlayed
	var outcome string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT d.id, ua.name, d.outcome, rs.points, ra.points
		FROM duels d JOIN users ua ON ua.id = d.a_id JOIN runs ra ON ra.id = d.a_run JOIN runs rs ON rs.id = d.ghost_run
		WHERE d.b_id = ? AND d.kind = 'challenge' AND d.outcome IN ('a', 'b', 'draw') AND d.ended_at >= ?
		ORDER BY d.ended_at DESC LIMIT 1`, userID, store.Ms(g.Now().Add(-PlayedRecent))).
		Scan(&p.DuelID, &p.From, &outcome, &p.You, &p.Them)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.State = map[string]string{"b": "won", "a": "lost", "draw": "draw"}[outcome]
	return &p, nil
}

// ChallengeNews is who has taken the player's challenges since they last heard (anyone but friends, whose results are
// told as they come): how many played, how many of them won, and the latest challenge taken (its code), for a line on
// Начало.
type ChallengeNews struct {
	Played int    `json:"played"`
	Beat   int    `json:"beat"`
	Name   string `json:"name,omitempty"` // the one who took it, when one did
	Code   string `json:"code"`
}

// ChallengeNewsOf is what came of the player's challenges since they last heard (ChallengesTold), in the last
// LinesRecent; nil if nothing did. A friend's game, a duel between the two, has a result of its own (a or b, not
// ghost_*): it's told on its own.
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

// challengeNews tells the one who sent a challenge that someone (not a friend) took it: a push, at most once a day
// (the rest wait for Начало's line).
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
