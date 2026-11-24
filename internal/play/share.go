package play

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Sharing the day's result (DECISIONS.md, „The direction“): the score and its shape, never the answers, with a way
// into the game. A player's finished day gets a link of its own the first time they share it (Share): /d/<issue>-
// <code>, the code eight random letters and digits (shares), so that nobody finds another's by counting, and nothing
// in it says whose it is. Whose it is stays with the run, and goes with it: a player who deletes their profile takes
// their links with them, and a guest's day that a sign-in drops (merge.go) its link. Opened (Shared), a link tells
// the day, its issue and the shape (how each of the ten went), never an answer, nor whose it was. Whoever played the day
// by it may ask its owner to be friends, still without learning who it is unless they say yes (AskSharer); and a new
// player whose first game was played by one is counted, a number a day and nothing of who (countByLink).
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

// SharerAsks is how many friend requests one shared link may bring its owner (AskSharer): enough for the people a
// day is shared with in a chat, few for a link posted where thousands see it.
const SharerAsks = 20

// ErrSharerAsked is a shared link that has brought its owner SharerAsks requests already.
var ErrSharerAsked = errors.New("the link has asked its owner enough")

// AskSharer asks the owner of a shared day (its link: issue and code) to be friends, for a player who played that day
// by it (DECISIONS.md, Friends): an ordinary request (Request), which the one asked sees with the link's issue, and
// which names nobody to its sender (Requests, relation) unless they say yes. Only for whoever has finished that day's
// issue, while it's today's or yesterday's (one finished in the grace after midnight): a link opened after its day
// opens today's issue, another ten. A link brings its owner SharerAsks requests at most, counted as they're made
// (shares.asked), not as they wait: a no doesn't make room for another. What it says to its sender says nothing of
// the owner: asked of oneself, or of a friend already, or asked again, it's as if sent (Sent{}; nothing is sent to
// oneself); a link that isn't, or isn't of a day the sender finished, ErrNoRun.
func (g *Game) AskSharer(ctx context.Context, from int64, issue int, code string) (Sent, error) {
	sh, err := g.Shared(ctx, issue, code)
	if err != nil {
		return Sent{}, err
	}
	today := g.Today()
	if sh.Day != today && sh.Day != DayShift(today, -1) {
		return Sent{}, ErrNoRun
	}
	var played bool
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM runs WHERE user_id = ? AND kind = 'day'
		AND day = ? AND finished_at IS NOT NULL)`, from, sh.Day).Scan(&played); err != nil {
		return Sent{}, err
	}
	if !played {
		return Sent{}, ErrNoRun
	}
	if sh.Owner == from {
		return Sent{}, nil
	}
	var tag string
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT tag FROM users WHERE id = ?`, sh.Owner).Scan(&tag); err != nil {
		return Sent{}, err
	}
	// The link's count first, one of its SharerAsks taken, and given back should no request be made by it.
	res, err := g.DB.Write.ExecContext(ctx, `UPDATE shares SET asked = asked + 1 WHERE code = ? AND asked < ?`,
		code, SharerAsks)
	if err != nil {
		return Sent{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Sent{}, ErrSharerAsked
	}
	sent, err := g.request(ctx, from, tag, false, issue)
	if err != nil || !sent.New {
		if _, err := g.DB.Write.ExecContext(ctx, `UPDATE shares SET asked = asked - 1 WHERE code = ? AND asked > 0`,
			code); err != nil {
			return Sent{}, err
		}
	}
	if err != nil {
		return Sent{}, err
	}
	// Friends already, or now (the owner had asked first): they know each other; still, nothing said of whom.
	return Sent{New: sent.New, To: sent.To}, nil
}

// linkKey keeps in a context the shared link a page was opened at (ByLink).
type linkKey struct{}

type link struct {
	issue int
	code  string
}

// ByLink is ctx with the shared day's link (its issue and code) the page that plays a game was opened at: a new
// player's first game, finished, counts its day once in new_by_link (countByLink).
func ByLink(ctx context.Context, issue int, code string) context.Context {
	return context.WithValue(ctx, linkKey{}, link{issue, code})
}

// countByLink counts a new player who came by a shared link (/admin's „Нови по връзка“), as their first game ends: a
// day's issue, played at a person's pace (as /admin counts people: People), by someone who isn't an admin and had no
// game before it, on a page opened at a link (ByLink) to anyone's shared day but their own (of any day: one gone by
// opens today's). A count a day (the game's day), nothing of who: what it keeps is the number alone. The run ends
// once, so it's counted once.
func (g *Game) countByLink(ctx context.Context, tx *sql.Tx, r *run) error {
	l, ok := ctx.Value(linkKey{}).(link)
	if !ok || !r.finished || r.kind != "day" || r.shadow == ShadowScript || len(l.code) != CodeLength {
		return nil
	}
	_, err := tx.Exec(`INSERT INTO new_by_link (day, players) SELECT ?1, 1
		WHERE NOT EXISTS (SELECT 1 FROM runs WHERE user_id = ?2 AND id <> ?3)
		AND NOT EXISTS (SELECT 1 FROM users WHERE id = ?2 AND admin)
		AND EXISTS (SELECT 1 FROM shares s JOIN runs o ON o.id = s.run_id WHERE s.code = ?4 AND o.day = ?5
			AND o.user_id <> ?2)
		ON CONFLICT (day) DO UPDATE SET players = players + 1`, r.day, r.userID, r.id, l.code, IssueDay(l.issue))
	return err
}

// ByLinkDays are how many new players came by a shared link (countByLink) on each day from `from` on, by day.
func (g *Game) ByLinkDays(ctx context.Context, from string) (map[string]int, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT day, players FROM new_by_link WHERE day >= ?`, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var day string
		var n int
		if err := rows.Scan(&day, &n); err != nil {
			return nil, err
		}
		out[day] = n
	}
	return out, rows.Err()
}
