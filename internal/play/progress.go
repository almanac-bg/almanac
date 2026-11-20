package play

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
)

// Progress is one measure: the player's Алманах, a chapter per topic with the facts they've collected in it
// (almanac.go) and how much of it they know (mastery.go), and the streak, the habit (runs.go). Nothing else adds up
// across games (owner, 2026-11-20, DECISIONS.md „The redesign“): no XP, no levels, no day's goals, no achievements, no
// titles, nothing to unlock, no rating, no points: a game's score is its right answers (board.go); a duel's is its
// record between two people (duels.go).
//
// What a game brings is told once, at its end (NewsOf): the facts it put in the Алманах, how it moved a topic's
// mastery when that's news (a first estimate, a tier reached), and the milestones it reached. Those are noted in the
// book (notes: a streak of 7, 30, 100 or 365 days, the first day's ten with every answer right, a chapter whose every
// fact is collected), each once, on the day it came; the Алманах lists them (NotesOf). A bad game brings no praise:
// what it's told is what's true of it.
//
// Every avatar is free from the first day: an animal (Shapes) in a tone (Tones), chosen by the player.

// ErrNoAvatar is an avatar there's no such thing as.
var ErrNoAvatar = errors.New("no such avatar")

// Avatars are a picture in a tone (web/src/art/pictures.ts draws them; a "shape" is a picture's id). Every one is
// every player's. The tones are the theme's five, each painting the whole picture in its shades, and "natural": every
// part in its own colour, as the thing looks (a fox orange with a white chest; web/src/app.css, .tone-natural).
var (
	Tones  = []string{"gold", "lilac", "sky", "rose", "mint", "natural"}
	tinted = Tones[:5] // the theme's tones, which the game gives

	// Starters are the animals a new player is given one of (DefaultAvatar), in account.Animals's order (their drawn
	// names say the same animal: a test keeps it).
	Starters = []string{"fox", "bear", "cat", "hare", "hedgehog", "dog", "deer", "stork", "frog"}
	// Shapes are every animal a player may choose, the starters first.
	Shapes = append(slices.Clone(Starters), "mouse", "squirrel", "sheep", "turtle", "badger", "lynx")
)

// DefaultAvatar is the avatar the game gives a player until they choose one: a starter and one of the theme's tones,
// from their id. Both turn with the id (9 shapes and 5 tones have no common factor, so every pair comes, once in 45):
// players who sign up one after another never share a tone, and no tone stands for the first ones. "natural" is only
// ever chosen.
func DefaultAvatar(userID int64) string {
	n := max(userID, 0)
	return Starters[n%int64(len(Starters))] + "-" + tinted[n%int64(len(tinted))]
}

// Look is how a player shows to others: their avatar ("shape-tone").
type Look struct {
	Avatar string `json:"avatar"`
}

// lookOf makes a look from what lookColumns read: the avatar chosen, or the one the game gives.
func lookOf(userID int64, avatar string) Look {
	return Look{Avatar: cmp.Or(avatar, DefaultAvatar(userID))}
}

// lookColumns read a player's look in a query over users u.
const lookColumns = `coalesce(u.avatar, '')`

// LookOf is how a player shows to others.
func (g *Game) LookOf(ctx context.Context, userID int64) (Look, error) {
	var avatar string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT `+lookColumns+` FROM users u WHERE u.id = ?`, userID).Scan(&avatar)
	return lookOf(userID, avatar), err
}

// SetAvatar changes a player's avatar: a shape of Shapes in a tone of Tones ("fox-gold").
func (g *Game) SetAvatar(ctx context.Context, userID int64, avatar string) error {
	shape, tone, _ := strings.Cut(avatar, "-")
	if !slices.Contains(Shapes, shape) || !slices.Contains(Tones, tone) {
		return ErrNoAvatar
	}
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE users SET avatar = ? WHERE id = ?`, avatar, userID)
	return err
}

// FirstDay is whether day is a player's first: no game of theirs finished before it. It stays so all day, whatever they
// play, so that what is said of their first day (web/src/game/standing.ts) reads the same on a reload after the game.
func (g *Game) FirstDay(ctx context.Context, userID int64, day string) (bool, error) {
	start, _ := dayBounds(day)
	var before bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM runs WHERE user_id = ? AND finished_at < ?)`,
		userID, start).Scan(&before)
	return !before, err
}

// Played is whether a player has finished a game of any kind.
func (g *Game) Played(ctx context.Context, userID int64) (bool, error) {
	var played bool
	err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM runs WHERE user_id = ? AND finished_at IS NOT NULL)`,
		userID).Scan(&played)
	return played, err
}

// News is what a game brought, told once: the facts it wrote in the Алманах in ink (Ink, a count), and whether it
// wrote any in pencil (Pencil: listed, never counted: ink.go), how it moved a topic's mastery when that's news (a
// topic's game only), the milestones noted in the book since the player was last told (Notes), and, once a day, what
// others' duels against the player's recordings came to (recordings.go).
type News struct {
	Ink        int             `json:"ink,omitempty"`
	Pencil     bool            `json:"pencil,omitempty"`
	Mastery    *MasteryMove    `json:"mastery,omitempty"`
	Notes      []Note          `json:"notes"`
	Recordings *RecordingsNews `json:"recordings,omitempty"`
}

// NewsOf tells a player what's new, once: everything in it is marked as told. With the game just played (runID; 0 for
// none), it also tells that game's facts and, for a topic's game, how it moved their mastery; that game is told then,
// and so is every one finished before it (Untold). It waits first for what the games just finished brought to be
// kept (after.go: in the background), so that its notes are in it.
func (g *Game) NewsOf(ctx context.Context, userID, runID int64) (News, error) {
	n := News{Notes: []Note{}}
	g.AfterWait(ctx, userID)
	var finished int64 // the game's end: it, and every game finished before it, are told with this news
	if runID != 0 {
		// A game that isn't the player's, or isn't over, has nothing to tell: the rest of the news still is.
		var kind string
		err := g.DB.Read.QueryRowContext(ctx, `SELECT kind, finished_at FROM runs r
			WHERE id = ? AND user_id = ? AND finished_at IS NOT NULL`, runID, userID).Scan(&kind, &finished)
		switch {
		case errors.Is(err, sql.ErrNoRows):
		case err != nil:
			return n, err
		default:
			if n.Ink, n.Pencil, err = g.InkIn(ctx, userID, runID); err != nil {
				return n, err
			}
			if kind == "topic" {
				moves, err := g.MasteryMoves(ctx, userID, runID)
				if err != nil {
					return n, err
				}
				n.Mastery = masteryTold(moves)
			}
		}
	}
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if n.Notes, err = untoldNotes(tx, userID); err != nil {
			return err
		}
		if n.Recordings, err = g.recordingsNews(tx, userID); err != nil {
			return err
		}
		for _, q := range []string{
			`UPDATE notes SET told = 1 WHERE user_id = ?1 AND NOT told`,
			`UPDATE runs SET told = 1 WHERE user_id = ?1 AND NOT told AND finished_at <= ?2`,
		} {
			if _, err := tx.Exec(q, userID, finished); err != nil {
				return err
			}
		}
		return nil
	})
	return n, err
}

// Note is a milestone noted in a player's book, once, on the day it came: a streak of N days (StreakNotes), the first
// day's ten with every answer right ("perfect"), every fact of a topic collected ("chapter", its Topic).
type Note struct {
	Day   string `json:"day"`
	Kind  string `json:"kind"`
	N     int    `json:"n,omitempty"`
	Topic string `json:"topic,omitempty"`
}

// The kinds of notes.
const (
	NoteStreak  = "streak"
	NotePerfect = "perfect"
	NoteChapter = "chapter"
)

// StreakNotes are the streaks noted in the book, in days in a row: the first time a player's streak reaches each.
var StreakNotes = []int{7, 30, 100, 365}

const noteColumns = `day, kind, n, topic`

func scanNotes(rows *sql.Rows, err error) ([]Note, error) {
	out := []Note{}
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var n Note
		if err := rows.Scan(&n.Day, &n.Kind, &n.N, &n.Topic); err != nil {
			return out, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// untoldNotes are the notes a player hasn't been told of, the oldest first.
func untoldNotes(tx *sql.Tx, userID int64) ([]Note, error) {
	return scanNotes(tx.Query(`SELECT `+noteColumns+` FROM notes WHERE user_id = ? AND NOT told ORDER BY day, kind, n`,
		userID))
}

// NotesOf are all of a player's notes, the latest first: what the Алманах lists.
func (g *Game) NotesOf(ctx context.Context, userID int64) ([]Note, error) {
	return scanNotes(g.DB.Read.QueryContext(ctx, `SELECT `+noteColumns+` FROM notes WHERE user_id = ?
		ORDER BY day DESC, kind, n DESC`, userID))
}

// noteMilestones notes in a player's book what their games have reached and it doesn't have yet, on the day of the
// game just finished (day): a streak of StreakNotes days, the day's ten all right (on its own day), a chapter
// completed. It looks at everything, so it may be done again safely, and a milestone reached before the notes were
// kept is noted with the next game.
func (g *Game) noteMilestones(ctx context.Context, userID int64, day string) error {
	var notes []Note
	streak, err := g.StreakOf(ctx, userID)
	if err != nil {
		return err
	}
	for _, n := range StreakNotes {
		if streak.Days >= n {
			notes = append(notes, Note{Day: day, Kind: NoteStreak, N: n})
		}
	}
	var perfect sql.NullString
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT min(day) FROM runs WHERE user_id = ? AND kind = 'day'
		AND finished_at IS NOT NULL AND rights > 0 AND rights = `+countedOf("questions"), userID).Scan(&perfect); err != nil {
		return err
	}
	if perfect.Valid {
		notes = append(notes, Note{Day: perfect.String, Kind: NotePerfect})
	}
	f, err := g.factsOf(ctx, userID)
	if err != nil {
		return err
	}
	for _, topic := range f.whole {
		notes = append(notes, Note{Day: day, Kind: NoteChapter, Topic: topic})
	}
	for _, n := range notes {
		if _, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO notes (user_id, day, kind, n, topic)
			VALUES (?, ?, ?, ?, ?)`, userID, n.Day, n.Kind, n.N, n.Topic); err != nil {
			return err
		}
	}
	return nil
}
