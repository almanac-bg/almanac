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
// the day, its issue and the shape (how each of the ten went), never an answer, nor whose it was.
//
// The text shared is Share.Text; the picture a link shows where it's sent, internal/card.

// ErrNotShared is a game that can't be shared: only a finished day is.
var ErrNotShared = errors.New("only a finished day is shared")

// Share is a day's result as it's shared.
type Share struct {
	Code  string `json:"-"`
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
	return Share{Code: code, Day: st.Day, Issue: issue, Shape: shapeOf(st.Trail)}, nil
}
