package play

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Friends are two players who joined up: one asked and the other said yes. Asked by tag or by email; never without
// both. Each friend sees how the other did on the day's questions, and they keep a record of their duels.

var (
	// ErrSelf is a player asking themselves to be friends.
	ErrSelf         = errors.New("one's own request")
	ErrNotFriends   = errors.New("not friends")
	ErrManyFriends  = errors.New("too many friends")
	ErrNoPlayer     = errors.New("no player with that tag")
	ErrNoRequest    = errors.New("no such request")
	ErrManyRequests = errors.New("too many requests waiting")
)

// MaxRequests is how many friend requests a player may have waiting for an answer.
const MaxRequests = 50

// MaxFriends is how many friends a player may have: plenty for the people they know, too few for a list of strangers.
const MaxFriends = 200

// DayRights is how many of a day's ten a player got right, once they've finished it (played false before), as a viewer
// sees it (0: nobody signed in): a game played at a script's speed is its player's alone (fairFor).
func (g *Game) DayRights(ctx context.Context, userID int64, day string, viewer int64) (rights int, played bool, err error) {
	err = g.DB.Read.QueryRowContext(ctx, `SELECT r.rights FROM runs r WHERE r.user_id = ? AND r.kind = 'day' AND r.day = ?
		AND r.finished_at IS NOT NULL AND `+fairFor("r", "?"), userID, day, viewer).Scan(&rights)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	return rights, err == nil, err
}

// befriend makes two players friends (if they aren't yet), settles any requests between them, and awards what that
// earns them. a is the one who asked (whose request b accepted): told of the yes (AcceptedOf).
func (g *Game) befriend(ctx context.Context, a, b int64) error {
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM friend_requests WHERE (from_id = ?1 AND (to_id = ?2
			OR to_email = (SELECT email FROM users WHERE id = ?2))) OR (from_id = ?2 AND (to_id = ?1
			OR to_email = (SELECT email FROM users WHERE id = ?1)))`, a, b); err != nil {
			return err
		}
		var already bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?)`, a, b).
			Scan(&already); err != nil || already {
			return err
		}
		for _, who := range []int64{a, b} {
			var n int
			if err := tx.QueryRow(`SELECT count(*) FROM friends WHERE user_id = ?`, who).Scan(&n); err != nil {
				return err
			}
			if n >= MaxFriends {
				return ErrManyFriends
			}
		}
		now := store.Ms(g.Now())
		_, err := tx.Exec(`INSERT OR IGNORE INTO friends (user_id, friend_id, since, asked) VALUES (?, ?, ?, 1), (?, ?, ?, 0)`,
			a, b, now, b, a, now)
		return err
	})
}

// Sent is what came of a friend request: sent, or (when the other had asked first) friends at once.
type Sent struct {
	Friends bool   `json:"friends,omitempty"`
	Name    string `json:"name,omitempty"` // whom it went to, when asked by tag (an email's owner stays unknown)
	// New is a request to a player (To) made now, not one sent before and waiting still: theirs to hear of.
	New bool  `json:"-"`
	To  int64 `json:"-"`
}

// Request asks a player to be friends: by their tag, or by an email address. An email request waits for whoever has
// the address, or signs in with it later, and the sender learns nothing about whether anyone does. to is already a
// normal tag or email (account.NormalTag, account.NormalEmail); byEmail says which.
func (g *Game) Request(ctx context.Context, from int64, to string, byEmail bool) (Sent, error) {
	var mine sql.NullString // the sender's email: requests to it are to them
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT email FROM users WHERE id = ?`, from).Scan(&mine); err != nil {
		return Sent{}, err
	}
	var other int64 // whom the request is to, when known
	var name string
	var err error
	if byEmail {
		if mine.Valid && to == mine.String {
			return Sent{}, ErrSelf
		}
		// Told only to someone this address's owner has already asked: they know each other.
		err = g.DB.Read.QueryRowContext(ctx, `SELECT u.id, u.name FROM users u JOIN friend_requests r ON r.from_id = u.id
			WHERE u.email = ? AND (r.to_id = ? OR r.to_email = ?)`, to, from, mine.String).Scan(&other, &name)
		if errors.Is(err, sql.ErrNoRows) {
			other, err = 0, nil
		}
	} else {
		err = g.DB.Read.QueryRowContext(ctx, `SELECT id, name FROM users WHERE tag = ?`, to).Scan(&other, &name)
		if errors.Is(err, sql.ErrNoRows) {
			return Sent{}, ErrNoPlayer
		}
	}
	if err != nil {
		return Sent{}, err
	}
	if other == from {
		return Sent{}, ErrSelf
	}
	if other != 0 {
		if _, err := g.Friend(ctx, from, other); err == nil {
			return Sent{Friends: true, Name: name}, nil
		}
		var asked bool // the other asked first: friends now
		if err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM friend_requests WHERE from_id = ?
			AND (to_id = ? OR to_email = ?))`, other, from, mine.String).Scan(&asked); err != nil {
			return Sent{}, err
		}
		if asked {
			if err := g.befriend(ctx, other, from); err != nil {
				return Sent{}, err
			}
			return Sent{Friends: true, Name: name}, nil
		}
	}
	var waiting bool // sent before, and waiting still
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRow(`SELECT count(*), coalesce(sum(to_id = ?2), 0) > 0 FROM friend_requests WHERE from_id = ?1`,
			from, other).Scan(&n, &waiting); err != nil {
			return err
		}
		if n >= MaxRequests && !waiting {
			return ErrManyRequests
		}
		now := store.Ms(g.Now())
		if byEmail {
			_, err := tx.Exec(`INSERT INTO friend_requests (from_id, to_email, at) VALUES (?, ?, ?)
				ON CONFLICT (from_id, to_email) WHERE to_email IS NOT NULL DO UPDATE SET at = excluded.at`, from, to, now)
			return err
		}
		_, err := tx.Exec(`INSERT INTO friend_requests (from_id, to_id, at) VALUES (?, ?, ?)
			ON CONFLICT (from_id, to_id) WHERE to_id IS NOT NULL DO UPDATE SET at = excluded.at`, from, other, now)
		return err
	})
	if byEmail {
		return Sent{}, err
	}
	return Sent{Name: name, New: !waiting, To: other}, err
}

// FriendRequest is a friend request as one of the two sees it: who asked (to the one asked), or whom it went to (to
// the one who asked: a player, or an email address).
type FriendRequest struct {
	ID   int64  `json:"id"`
	At   int64  `json:"at"`
	Name string `json:"name,omitempty"`
	Tag  string `json:"tag,omitempty"`
	// Email is the address a request went to, shown only to its sender.
	Email string `json:"email,omitempty"`
	Look  *Look  `json:"look,omitempty"`
}

// Requests are a player's friend requests: those waiting for their answer, and those they sent.
func (g *Game) Requests(ctx context.Context, userID int64) (in, out []FriendRequest, err error) {
	db := g.DB.Read
	rows, err := db.QueryContext(ctx, `SELECT r.id, r.at, u.id, u.name, u.tag, `+lookColumns+`
		FROM friend_requests r JOIN users u ON u.id = r.from_id
		WHERE (r.to_id = ?1 OR r.to_email = (SELECT email FROM users WHERE id = ?1)) AND NOT r.declined
		ORDER BY r.at DESC`, userID)
	if err != nil {
		return nil, nil, err
	}
	in = []FriendRequest{}
	for rows.Next() {
		var r FriendRequest
		var id int64
		var avatar string
		if err := rows.Scan(&r.ID, &r.At, &id, &r.Name, &r.Tag, &avatar); err != nil {
			rows.Close()
			return nil, nil, err
		}
		look := g.lookOf(id, avatar)
		r.Look = &look
		in = append(in, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	rows, err = db.QueryContext(ctx, `SELECT r.id, r.at, coalesce(u.name, ''), coalesce(u.tag, ''), coalesce(r.to_email, '')
		FROM friend_requests r LEFT JOIN users u ON u.id = r.to_id WHERE r.from_id = ? ORDER BY r.at DESC`, userID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	out = []FriendRequest{}
	for rows.Next() {
		var r FriendRequest
		if err := rows.Scan(&r.ID, &r.At, &r.Name, &r.Tag, &r.Email); err != nil {
			return nil, nil, err
		}
		out = append(out, r)
	}
	return in, out, rows.Err()
}

// Accept says yes to a friend request sent to this player: the two are friends.
func (g *Game) Accept(ctx context.Context, userID, requestID int64) (name string, err error) {
	var from int64
	err = g.DB.Read.QueryRowContext(ctx, `SELECT r.from_id, u.name FROM friend_requests r JOIN users u ON u.id = r.from_id
		WHERE r.id = ?1 AND (r.to_id = ?2 OR r.to_email = (SELECT email FROM users WHERE id = ?2)) AND NOT r.declined`,
		requestID, userID).Scan(&from, &name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNoRequest
	}
	if err != nil {
		return "", err
	}
	if from == userID {
		return "", ErrSelf
	}
	return name, g.befriend(ctx, from, userID)
}

// Withdraw drops a friend request: its sender calls it off, or the one asked says no (the sender isn't told). A no to
// a request by email leaves it waiting in its sender's list until it runs out (account.EmailRequestDays), as one to an
// address without a player does: had it gone at once, the sender would know the address has one (review 2026-11-18,
// S29). The one asked sees it no more.
func (g *Game) Withdraw(ctx context.Context, userID, requestID int64) error {
	var n int64
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.Exec(`UPDATE friend_requests SET declined = 1 WHERE id = ?1 AND from_id <> ?2 AND NOT declined
			AND to_email = (SELECT email FROM users WHERE id = ?2)`, requestID, userID)
		if err != nil {
			return err
		}
		if n, _ = res.RowsAffected(); n > 0 {
			return nil
		}
		res, err = tx.Exec(`DELETE FROM friend_requests WHERE id = ?1 AND (from_id = ?2 OR to_id = ?2)`, requestID, userID)
		if err != nil {
			return err
		}
		n, _ = res.RowsAffected()
		return nil
	})
	if err == nil && n == 0 {
		return ErrNoRequest
	}
	return err
}

// newsReach is how long after it was made a duel can still end: its first side's DuelFor, then the friend's, and a day
// for the sweep that ends it (SettleDue). FriendsNews looks no further back than that before the player's last look.
const newsReach = 2*DuelFor + 24*time.Hour

// FriendsNews says whether something has come to Приятели since the player last looked there (SawFriends), on any
// device: a friend request to them; a duel a friend sent them that they haven't begun (one begun, they know of); a
// result of a duel with a friend, one they sent (played back, or its time run out) or one sent to them whose time ran
// out. What they did themselves (a duel they played back) isn't news to them. It's the dot on Приятели: news, not a
// list of what waits (a duel to play stays first in Приятели until it's played). One query, each part on an index and
// within newsReach of the last look: light enough for a page to ask every half minute.
func (g *Game) FriendsNews(ctx context.Context, userID int64) (bool, error) {
	var news bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT
		EXISTS (SELECT 1 FROM friend_requests r WHERE (r.to_id = u.id OR r.to_email = u.email) AND NOT r.declined
			AND r.at > u.friends_seen_at)
		OR EXISTS (SELECT 1 FROM duels d WHERE d.a_id = u.id AND d.created_at > u.friends_seen_at - ?2
			AND d.ended_at > u.friends_seen_at)
		OR EXISTS (SELECT 1 FROM duels d WHERE d.b_id = u.id AND d.created_at > u.friends_seen_at - ?2
			AND (d.sent_at > u.friends_seen_at AND d.b_run IS NULL
				OR d.ended_at > u.friends_seen_at AND d.ended_at >= d.expires_at))
		FROM users u WHERE u.id = ?1`, userID, newsReach.Milliseconds()).Scan(&news)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return news, err
}

// SawFriends keeps that the player has looked at Приятели now: what came before is seen, on every device
// (FriendsNews).
func (g *Game) SawFriends(ctx context.Context, userID int64) error {
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE users SET friends_seen_at = max(friends_seen_at, ?) WHERE id = ?`,
		store.Ms(g.Now()), userID)
	return err
}

// Asked is whether a player's request to another waits for their answer.
func (g *Game) Asked(ctx context.Context, from, to int64) (bool, error) {
	var asked bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?)`,
		from, to).Scan(&asked)
	return asked, err
}

// Unfriend ends a friendship, for both, and the duels open between them with it: their time is up now, and each ends
// as one whose time ran out does (SettleDue: a side left half-way counts as it stood, one never started lapses, one
// never sent goes), so that neither is left a „Твой ред“ that can't be played. The record between them stays.
func (g *Game) Unfriend(ctx context.Context, userID, friendID int64) error {
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM friends WHERE (user_id = ?1 AND friend_id = ?2)
			OR (user_id = ?2 AND friend_id = ?1)`, userID, friendID); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE duels SET expires_at = min(expires_at, ?3) WHERE ended_at IS NULL
			AND ((a_id = ?1 AND b_id = ?2) OR (a_id = ?2 AND b_id = ?1))`, userID, friendID, store.Ms(g.Now()))
		return err
	})
	if err != nil {
		return err
	}
	return g.SettleDue(ctx)
}

// Friend returns a friend's name, or ErrNotFriends.
func (g *Game) Friend(ctx context.Context, userID, friendID int64) (string, error) {
	var name string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT u.name FROM friends f JOIN users u ON u.id = f.friend_id
		WHERE f.user_id = ? AND f.friend_id = ?`, userID, friendID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFriends
	}
	return name, err
}

// Friend is a friend as the player's list shows them: who they are, and the duels between the two (owner, 2026-11-22:
// not their day, which is the day's board's).
type Friend struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Tag   string `json:"tag"`
	Since int64  `json:"since"`
	Look
	// The duels between the two, from the player's side.
	Won   int `json:"won"`
	Lost  int `json:"lost"`
	Drawn int `json:"drawn"`
	// Full is that DuelsToOne duels the player sent wait for this friend to play them: no new one until they play one
	// (DuelFriend: ErrDuelsToOne). Not while one of them is the player's own to finish: „Дуел“ goes on with it.
	Full bool `json:"full,omitempty"`
}

// FriendsOf lists a player's friends by name (how each did today is the day's board's: FriendsBoard).
func (g *Game) FriendsOf(ctx context.Context, userID int64) ([]Friend, error) {
	db := g.DB.Read
	rows, err := db.QueryContext(ctx, `SELECT u.id, u.name, u.tag, f.since, `+lookColumns+`
		FROM friends f JOIN users u ON u.id = f.friend_id
		WHERE f.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	var list []Friend
	at := map[int64]int{}
	for rows.Next() {
		var f Friend
		var avatar string
		if err := rows.Scan(&f.ID, &f.Name, &f.Tag, &f.Since, &avatar); err != nil {
			rows.Close()
			return nil, err
		}
		f.Look = g.lookOf(f.ID, avatar)
		at[f.ID] = len(list)
		list = append(list, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = db.QueryContext(ctx, `SELECT other, outcome, count(*) FROM `+duelResults+`
		WHERE other IS NOT NULL GROUP BY other, outcome`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var outcome string
		var n int
		if err := rows.Scan(&id, &outcome, &n); err != nil {
			return nil, err
		}
		i, ok := at[id]
		if !ok {
			continue // a duel with someone who isn't a friend (any more)
		}
		switch outcome {
		case "won":
			list[i].Won = n
		case "lost":
			list[i].Lost = n
		default:
			list[i].Drawn = n
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	rows, err = db.QueryContext(ctx, `SELECT b_id FROM duels WHERE a_id = ? AND b_id IS NOT NULL AND ended_at IS NULL
		GROUP BY b_id HAVING count(*) >= ? AND count(*) FILTER (WHERE sent_at IS NULL) = 0`, userID, DuelsToOne)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		if i, ok := at[id]; ok {
			list[i].Full = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// By name, as a list of people is read (the day's ranking is the board's): Latin before Cyrillic, each in its
	// alphabet's order, which lower case in Unicode keeps for Bulgarian.
	slices.SortStableFunc(list, func(a, b Friend) int {
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	return list, rows.Err()
}

// FriendsBoard is the day's board among a player and their friends: everyone of them who finished it, best first,
// placed as the day's board is (placed: equal ones share a place, the player first among their equals).
// Empty while none of their friends has. A game played at a script's speed is on it for its player alone (fairFor).
// Once the player has finished the day, the first BoardTop rows and their own carry how each of the ten went (Trail),
// as Начало shows them beside the result; before that, nothing of how the others' went.
func (g *Game) FriendsBoard(ctx context.Context, day string, userID int64) ([]Score, error) {
	return g.friendsBoard(ctx, day, userID, BoardTop)
}

// friendsBoard is FriendsBoard with the trails of its first `trails` rows (and the player's own).
func (g *Game) friendsBoard(ctx context.Context, day string, userID int64, trails int) ([]Score, error) {
	// From the player and their friends to each one's game of the day (runs_one_a_day): CROSS JOIN keeps that order,
	// so it costs as many as they are, not as many as the day has players.
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT r.id, u.id, u.name, u.tag, r.rights, r.closeness,
			`+countedOf("r.questions")+`, `+lookColumns+`
		FROM (SELECT ?2 AS id UNION SELECT friend_id FROM friends WHERE user_id = ?2) f
		CROSS JOIN runs r ON r.user_id = f.id AND r.kind = 'day' AND r.day = ?1
		JOIN users u ON u.id = r.user_id
		WHERE r.finished_at IS NOT NULL AND `+fairFor("r", "?2")+`
		ORDER BY `+resultOrder("r")+`, r.user_id <> ?2, r.id`, day, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var board []Score
	var runs []int64 // each row's game
	others, played := false, false
	for rows.Next() {
		var s Score
		var run, id int64
		var avatar string
		if err := rows.Scan(&run, &id, &s.Name, &s.Tag, &s.Rights, &s.tie.closeness, &s.Of, &avatar); err != nil {
			return nil, err
		}
		s.Me, s.Look = id == userID, g.lookOf(id, avatar)
		others, played = others || !s.Me, played || s.Me
		board, runs = append(board, s), append(runs, run)
	}
	if err := rows.Err(); err != nil || !others {
		return nil, err
	}
	rows.Close()
	placed(board)
	if !played {
		return board, nil
	}
	// The trails, in one read: the first rows', and the player's own wherever it is.
	at := map[int64]int{}
	var ids []int64
	for i, run := range runs {
		if i < trails || board[i].Me {
			at[run] = i
			ids = append(ids, run)
		}
	}
	marks, err := trailsOf(ctx, g.DB.Read, day, ids)
	if err != nil {
		return nil, err
	}
	for run, i := range at {
		board[i].Trail = marks[run]
	}
	return board, nil
}

// FriendDay is a friend's game of the day as the player's questions gone over show it, beside each question: who, and
// how each of the ten went for them.
type FriendDay struct {
	Name string `json:"name"`
	// Avatar is their face alone, without the seal: beside a question it's small, and the seal covered it.
	Avatar string `json:"avatar"`
	// Marks are the ten in the issue's order, as a share says them (Share.Shape): '1' right, '2' close (not right),
	// '0' wrong or not answered, '3' a question that counts for nobody.
	Marks string `json:"marks"`
}

// FriendsOn is how the player's friends did with each question of the player's game of the day (run), for its
// questions gone over: every friend who finished that day's issue (the run's day, not today's: a game finished in the
// grace after midnight is gone over beside its own day's friends), in the order of the day's friends' board (best
// first), each with their ten marks. As the board, never before the player has finished the day (ErrOutOfStep), and a
// game played at a script's speed left out (fairFor); and, as the questions themselves, only on the day they can be
// gone over (ErrReviewOver). Not a day's game: none. A player has at most MaxFriends, so it's at most that many rows of
// ten marks, read as the board reads its first rows' (trailsOf): one read of their answers.
func (g *Game) FriendsOn(ctx context.Context, userID, runID int64) ([]FriendDay, error) {
	var day, kind string
	var finished sql.NullInt64
	err := g.DB.Read.QueryRowContext(ctx, `SELECT coalesce(day, ''), kind, finished_at FROM runs WHERE id = ? AND user_id = ?`,
		runID, userID).Scan(&day, &kind, &finished)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoRun
	}
	switch {
	case err != nil:
		return nil, err
	case !finished.Valid:
		return nil, ErrOutOfStep
	case !g.reviewOpen(finished.Int64):
		return nil, ErrReviewOver
	case kind != "day":
		return []FriendDay{}, nil
	}
	board, err := g.friendsBoard(ctx, day, userID, MaxFriends+1)
	if err != nil {
		return nil, err
	}
	out := []FriendDay{}
	for _, s := range board {
		if !s.Me {
			out = append(out, FriendDay{Name: s.Name, Avatar: s.Avatar, Marks: shapeOf(s.Trail)})
		}
	}
	return out, nil
}
