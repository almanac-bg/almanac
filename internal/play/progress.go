package play

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"slices"
)

// Progress is ink and the streak (DECISIONS.md, „The direction“): the player's Алманах, a chapter for each of the
// bank's with the facts written in it in ink and grey (almanac.go, ink.go) and its rank from its ink (rank.go), and the
// streak, the habit (runs.go). Nothing else adds up across games: no XP, no points (a game's score is its right
// answers: board.go), no achievements, no lifetime totals; a duel's is its record between two people (duels.go). How
// well a player knows each chapter (mastery.go) is the game's own, to shape their games, never shown.
//
// What a game brings is told once, at its end (NewsOf): what it wrote in the book, the ranks it raised, or the
// chapter nearest its next. A bad game brings no praise: what it's told is what's true of it.
//
// Every animal is every player's from the first day (Shapes), and nothing else is an avatar: a chapter's seal is never
// one, and never on one (the owner, 2026-11-22: a face, nothing over it).

// ErrNoAvatar is an avatar there's no such thing as.
var ErrNoAvatar = errors.New("no such avatar")

// An avatar is a picture, by its shape alone (web/src/art/pictures.ts draws them; a "shape" is a picture's id): every
// part in its own colour, as the thing looks (a fox orange with a white chest; web/src/app.css, .tone-natural).
var (
	// Starters are the animals a new player is given one of (DefaultAvatar), in account.Animals's order (their drawn
	// names say the same animal: a test keeps it).
	Starters = []string{"fox", "bear", "cat", "hare", "hedgehog", "dog", "deer", "stork", "frog"}
	// Shapes are every animal a player may choose, the starters first.
	Shapes = append(slices.Clone(Starters), "mouse", "squirrel", "sheep", "turtle", "badger", "lynx")
)

// DefaultAvatar is the avatar the game gives a player until they choose one: a starter, from their id, turning with
// it (account.AnimalOf: the animal of their drawn name).
func DefaultAvatar(userID int64) string { return Starters[max(userID, 0)%int64(len(Starters))] }

// Look is how a player shows to others: their avatar (a shape), the face beside their name. Nothing else: a player's
// seals are on their profile, never on the face.
type Look struct {
	Avatar string `json:"avatar"`
}

// lookColumns read a player's look in a query over users u, for lookOf: the avatar chosen.
const lookColumns = `coalesce(u.avatar, '')`

// lookOf makes a look from what lookColumns read: the avatar chosen, or the one the game gives.
func (g *Game) lookOf(userID int64, avatar string) Look {
	return Look{Avatar: cmp.Or(avatar, DefaultAvatar(userID))}
}

// LookOf is how a player shows to others.
func (g *Game) LookOf(ctx context.Context, userID int64) (Look, error) {
	var read string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT `+lookColumns+` FROM users u WHERE u.id = ?`, userID).Scan(&read)
	return g.lookOf(userID, read), err
}

// SetAvatar changes a player's avatar: an animal of Shapes ("fox"). An avatar is a face, so an animal only
// (DECISIONS.md).
func (g *Game) SetAvatar(ctx context.Context, userID int64, shape string) error {
	if !slices.Contains(Shapes, shape) {
		return ErrNoAvatar
	}
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE users SET avatar = ? WHERE id = ?`, shape, userID)
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

// News is what a game brought, told once: the facts it wrote in the Алманах in ink (Ink, a count, and Chapters, the
// same by chapter: ink.go), and, of a day's issue, how many of its right answers were to questions met before
// (MetBefore: in grey already, „1 вече срещан“; grey itself is never counted, DECISIONS.md); the ranks risen since the
// player was last told (Rose, as one: rank.go).
type News struct {
	Ink       int          `json:"ink,omitempty"`
	Chapters  []ChapterInk `json:"chapters,omitempty"`
	MetBefore int          `json:"metBefore,omitempty"`
	Rose      *Rose        `json:"rose,omitempty"`
}

// NewsOf tells a player what's new, once: everything in it is marked as told. With the game just played (runID; 0 for
// none), it also tells what that game wrote in the book; that game is told then, and so is every one finished before
// it (Untold). It waits first for what the games just finished brought to be kept (after.go: in the background), so
// that their ranks are in it.
func (g *Game) NewsOf(ctx context.Context, userID, runID int64) (News, error) {
	var n News
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
			var met int
			if n.Chapters, met, err = g.InkIn(ctx, userID, runID); err != nil {
				return n, err
			}
			for _, c := range n.Chapters {
				n.Ink += c.Ink
			}
			if kind == "day" {
				n.MetBefore = met
			}
		}
	}
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if n.Rose, err = roseOf(tx, userID); err != nil {
			return err
		}
		_, err = tx.Exec(`UPDATE runs SET told = 1 WHERE user_id = ?1 AND NOT told AND finished_at <= ?2`, userID, finished)
		return err
	})
	return n, err
}
