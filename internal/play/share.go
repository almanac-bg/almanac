package play

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Sharing the day's result (DECISIONS.md, „The direction“): the score and its shape, never the answers, with a way
// into the game. A player's finished day gets a link of its own the first time they share it (Share): /d/<issue>-
// <code>, the code eight random letters and digits (shares), so that nobody finds another's by counting, and nothing
// in it says whose it is. Whose it is stays with the run, and goes with it: a player who deletes their profile takes
// their links with them, and a guest's day that a sign-in drops (merge.go) its link. Opened (Shared), a link tells
// the day, its issue and the shape (how each of the ten went), never an answer, nor whose it was. Whoever played the day
// by it may ask its owner to be friends, still without learning who it is unless they say yes (AskSharer); and a new
// player whose first game began by one is marked so, and nothing of whose (markByLink), for /admin's count.
//
// The text shared is Share.Text; the picture a link shows where it's sent, internal/card.

// ErrNotShared is a game that can't be shared: only a finished day is.
var ErrNotShared = errors.New("only a finished day is shared")

// Share is a day's result as it's shared.
type Share struct {
	Code string `json:"-"`
	// Owner is whose day it is: never said (the link is unsigned), only asked by a request to them (AskSharer).
	Owner int64  `json:"-"`
	Day   string `json:"day"`
	Issue int    `json:"issue"`
	// Shape is how each of the day's ten went, in the issue's order, as the tiles show it (and the card: internal/card):
	// '1' right, '2' close („близо“: not right, half a tile), '0' wrong or not answered, '3' a question that counts for
	// nobody (Mark.Void), which has no place in the score.
	Shape string `json:"shape"`
}

// Rights is how many of the questions that count were right.
func (s Share) Rights() int { return strings.Count(s.Shape, "1") }

// Counted is how many questions count: the score is Rights of Counted.
func (s Share) Counted() int { return len(s.Shape) - strings.Count(s.Shape, "3") }

// Path is the link's path: /d/9-k4f2m7qa.
func (s Share) Path() string { return fmt.Sprintf("/d/%d-%s", s.Issue, s.Code) }

// months are the months as a date says them (20 ноември).
var months = [12]string{"януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври",
	"ноември", "декември"}

// DateWords is a day (YYYY-MM-DD) as a date says it: „20 ноември“.
func DateWords(day string) string {
	d, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return day
	}
	return fmt.Sprintf("%d %s", d.Day(), months[d.Month()-1])
}

// shapeOf is a trail's shape, as Share has it.
func shapeOf(trail []Mark) string {
	var b strings.Builder
	for _, m := range trail {
		switch {
		case m.Void:
			b.WriteByte('3')
		case m.Right:
			b.WriteByte('1')
		case m.Close:
			b.WriteByte('2')
		default:
			b.WriteByte('0')
		}
	}
	return b.String()
}

// codeLetters are what a link's code is made of: letters and digits that can't be read as one another (no l, o, 0,
// 1), 32 of them, so that eight are 40 bits.
const codeLetters = "abcdefghijkmnpqrstuvwxyz23456789"

// CodeLength is how long a link's code is.
const CodeLength = 8

func newCode() string {
	b := make([]byte, CodeLength)
	_, _ = rand.Read(b) // never fails (crypto/rand)
	for i := range b {
		b[i] = codeLetters[b[i]%byte(len(codeLetters))]
	}
	return string(b)
}

// Share is a player's finished day as it's shared, with its link: made the first time it's asked for (and counted
// then, share:day: the days shared), the same one after. A game that isn't the player's is ErrNoRun; one that isn't
// a finished day, ErrNotShared.
func (g *Game) Share(ctx context.Context, userID, runID int64) (Share, error) {
	st, err := g.State(ctx, userID, runID)
	if err != nil {
		return Share{}, err
	}
	if st.Kind != "day" || !st.Done {
		return Share{}, ErrNotShared
	}
	sh := Share{Day: st.Day, Issue: Issue(st.Day), Shape: shapeOf(st.Trail)}
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRow(`SELECT code FROM shares WHERE run_id = ?`, runID).Scan(&sh.Code)
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		// A code taken already (one in a trillion): another.
		for range 3 {
			sh.Code = newCode()
			res, err := tx.Exec(`INSERT INTO shares (code, run_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
				sh.Code, runID, g.Now().UnixMilli())
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 1 {
				return nil
			}
		}
		return errors.New("share: no free code")
	})
	return sh, err
}

// Shared is the day a link shares (its issue and code: the link's path, /d/<issue>-<code>), as it stands: ErrNoRun
// for a link that isn't, or is no more.
func (g *Game) Shared(ctx context.Context, issue int, code string) (Share, error) {
	if len(code) != CodeLength {
		return Share{}, ErrNoRun
	}
	var runID, userID int64
	err := g.DB.Read.QueryRowContext(ctx, `SELECT r.id, r.user_id FROM shares s JOIN runs r ON r.id = s.run_id
		WHERE s.code = ?`, code).Scan(&runID, &userID)
	if errors.Is(err, sql.ErrNoRows) {
		return Share{}, ErrNoRun
	}
	if err != nil {
		return Share{}, err
	}
	st, err := g.State(ctx, userID, runID)
	if err != nil {
		return Share{}, err
	}
	if Issue(st.Day) != issue {
		return Share{}, ErrNoRun
	}
	return Share{Code: code, Owner: userID, Day: st.Day, Issue: issue, Shape: shapeOf(st.Trail)}, nil
}

// SharerAsks is how many people one shared link may bring its owner friend requests from (AskSharer): enough for the
// people a day is shared with in a chat, few for a link posted where thousands see it.
const SharerAsks = 20

// ErrSharerAsked is a shared link that SharerAsks people have asked its owner by already.
var ErrSharerAsked = errors.New("the link has asked its owner enough")

// ErrPlayShared is a player asking by a shared link before they've finished the day it shares.
var ErrPlayShared = errors.New("the day shared isn't played yet")

// AskSharer asks the owner of a shared day (its link: issue and code) to be friends, for a player who played that day
// by it (DECISIONS.md, Friends): a friend request, which the one asked sees with the link's issue, and which names
// nobody to its sender (Requests, relation) unless they say yes. Only while the link's day is today's, or yesterday's
// within DayGrace (one finished in the grace after midnight): a link opened after its day opens today's issue,
// another ten. A link that isn't, or of another day, is ErrNoRun; one whose day the sender hasn't finished,
// ErrPlayShared. A link brings its owner requests from SharerAsks people at most, each counted once (share_asks), so a
// no doesn't make room for another, nor does a request called off and made again take more.
//
// Nothing it says or does tells its sender whose the link is, whoever they guess: it's a request apart from one by
// tag to the same player (both stand, and both show in the sender's list), held to MaxRequests as any other, made the
// same to a friend already (who never sees it: it's made as declined), to a player who has asked the sender first (no
// friends at once: the sender has their request to say yes to), and to anyone; asked of oneself, nothing is made, and
// it answers as if it were.
func (g *Game) AskSharer(ctx context.Context, from int64, issue int, code string) (Sent, error) {
	sh, err := g.Shared(ctx, issue, code)
	if err != nil {
		return Sent{}, err
	}
	today := g.Today()
	if _, end := dayBounds(sh.Day); sh.Day != today &&
		(sh.Day != DayShift(today, -1) || g.Now().After(time.UnixMilli(end).Add(DayGrace))) {
		return Sent{}, ErrNoRun
	}
	var played bool
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM runs WHERE user_id = ? AND kind = 'day'
		AND day = ? AND finished_at IS NOT NULL)`, from, sh.Day).Scan(&played); err != nil {
		return Sent{}, err
	}
	if !played {
		return Sent{}, ErrPlayShared
	}
	if sh.Owner == from {
		return Sent{}, nil
	}
	var sent Sent
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		// One of the link's SharerAsks, the first time this sender asks by it.
		if _, err := tx.Exec(`INSERT INTO share_asks (code, from_id) SELECT ?1, ?2
			WHERE (SELECT count(*) FROM share_asks WHERE code = ?1) < ?3 ON CONFLICT DO NOTHING`,
			code, from, SharerAsks); err != nil {
			return err
		}
		var counted bool
		if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM share_asks WHERE code = ? AND from_id = ?)`, code, from).
			Scan(&counted); err != nil {
			return err
		}
		if !counted {
			return ErrSharerAsked
		}
		var n int
		var waiting, friends bool
		if err := tx.QueryRow(`SELECT count(*), coalesce(sum(to_id = ?2 AND via_issue = ?3), 0) > 0,
				EXISTS (SELECT 1 FROM friends WHERE user_id = ?1 AND friend_id = ?2)
			FROM friend_requests WHERE from_id = ?1`, from, sh.Owner, issue).Scan(&n, &waiting, &friends); err != nil {
			return err
		}
		if n >= MaxRequests && !waiting {
			return ErrManyRequests
		}
		declined := 0 // to a friend already: theirs never to see
		if friends {
			declined = 1
		}
		if _, err := tx.Exec(`INSERT INTO friend_requests (from_id, to_id, at, via_issue, declined) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (from_id, to_id, via_issue) WHERE via_issue IS NOT NULL DO UPDATE SET at = excluded.at`,
			from, sh.Owner, store.Ms(g.Now()), issue, declined); err != nil {
			return err
		}
		sent = Sent{New: !waiting && !friends, To: sh.Owner}
		return nil
	})
	return sent, err
}

// linkKey keeps in a context the shared link a page was opened at (ByLink).
type linkKey struct{}

type link struct {
	issue int
	code  string
}

// ByLink is ctx with the shared day's link (its issue and code) the page that plays a game was opened at: a new
// player's first game, begun there, is marked as one played by a link (markByLink).
func ByLink(ctx context.Context, issue int, code string) context.Context {
	return context.WithValue(ctx, linkKey{}, link{issue, code})
}

// markByLink marks a player's first game as played by a shared link (runs_by_link), at its first answer, since that
// comes from the page the link opened (a reload, or a later visit, goes on at the day's address, without it): a day's
// issue, by someone who had no game before it, on a page opened at a link (ByLink) to anyone's shared day but their
// own (of any day: one gone by opens today's). That it came by a link is all that's kept, not whose. /admin's „Нови
// по връзка“ counts the new whose first game it still is, played at a person's pace (Activity, as /admin counts
// people: People; a game is found a script's only after some of its answers): a guest who signs in to an account that
// played before isn't new, and isn't counted.
func (g *Game) markByLink(ctx context.Context, tx *sql.Tx, r *run) error {
	l, ok := ctx.Value(linkKey{}).(link)
	if !ok || r.kind != "day" || r.shadow == ShadowScript || len(l.code) != CodeLength {
		return nil
	}
	_, err := tx.Exec(`INSERT OR IGNORE INTO runs_by_link (run_id) SELECT ?1
		WHERE NOT EXISTS (SELECT 1 FROM runs WHERE user_id = ?2 AND id <> ?1)
		AND EXISTS (SELECT 1 FROM shares s JOIN runs o ON o.id = s.run_id WHERE s.code = ?3 AND o.day = ?4
			AND o.user_id <> ?2)`, r.id, r.userID, l.code, IssueDay(l.issue))
	return err
}
