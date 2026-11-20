package play

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
)

// Progress is ink and the streak (DECISIONS.md, „The direction“): the player's Алманах, a chapter per topic with the
// facts written in it in ink and grey (almanac.go, ink.go) and its rank from its ink (rank.go), and the streak, the
// habit (runs.go). Nothing else adds up across games: no XP, no points (a game's score is its right answers:
// board.go), no achievements, no lifetime totals; a duel's is its record between two people
// (duels.go). How well a player knows each topic (mastery.go) is the game's own, to shape their games, never shown.
//
// What a game brings is told once, at its end (NewsOf): what it wrote in the book, the ranks it raised, or the
// chapter nearest its next. A bad game brings no praise: what it's told is what's true of it.
//
// Every animal is every player's from the first day, in any tone (Shapes, Tones); a chapter's art is theirs too from
// its Страница (rank.go).

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

// Look is how a player shows to others: their avatar ("shape-tone"), and the seal they wear beside their name (rank.go:
// none before a rank).
type Look struct {
	Avatar string `json:"avatar"`
	Seal   *Worn  `json:"seal,omitempty"`
}

// lookColumns read a player's look in a query over users u, as one text for lookOf: the avatar chosen, the chapter
// whose seal they chose, and their ranks as kept (rank.go), each "chapter level ink". A player's ranks are a dozen rows
// read by their key: a board of N names is N such reads, never a count of anyone's ink.
const lookColumns = `coalesce(u.avatar, '') || char(31) || coalesce(u.seal, '') || char(31) ||
	coalesce((SELECT group_concat(k.chapter || ' ' || k.level || ' ' || k.ink, ',') FROM ranks k
		WHERE k.user_id = u.id AND k.level > 0), '')`

// lookOf makes a look from what lookColumns read: the avatar chosen, or the one the game gives; and the seal worn, by
// the one rule (sealOf) over the bank's chapters.
func (g *Game) lookOf(userID int64, read string) Look {
	avatar, rest, _ := strings.Cut(read, "\x1f")
	chosen, kept, _ := strings.Cut(rest, "\x1f")
	look := Look{Avatar: cmp.Or(avatar, DefaultAvatar(userID))}
	if kept == "" {
		return look
	}
	byChapter := map[string]ChapterRank{}
	for e := range strings.SplitSeq(kept, ",") {
		var r ChapterRank
		if _, err := fmt.Sscan(e, &r.Chapter, &r.Level, &r.Ink); err == nil {
			byChapter[r.Chapter] = r
		}
	}
	var ranks []ChapterRank
	for _, c := range g.Bank().Categories {
		if r, ok := byChapter[c.ID]; ok {
			ranks = append(ranks, r)
		}
	}
	if s := sealOf(ranks, chosen); s != nil {
		look.Seal = &Worn{Chapter: s.Chapter, Level: s.Level}
	}
	return look
}

// LookOf is how a player shows to others.
func (g *Game) LookOf(ctx context.Context, userID int64) (Look, error) {
	var read string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT `+lookColumns+` FROM users u WHERE u.id = ?`, userID).Scan(&read)
	return g.lookOf(userID, read), err
}

// SetAvatar changes a player's avatar: a shape of Shapes in a tone of Tones ("fox-gold").
func (g *Game) SetAvatar(ctx context.Context, userID int64, avatar string) error {
	shape, tone, _ := strings.Cut(avatar, "-")
	if !slices.Contains(Tones, tone) {
		return ErrNoAvatar
	}
	if chapter, ok := chapterOfArt(g.Bank(), shape); ok {
		// A chapter's art, the player's from its Страница (rank.go).
		has, err := g.HasArt(ctx, userID, chapter)
		if err != nil {
			return err
		}
		if !has {
			return ErrNoAvatar
		}
	} else if !slices.Contains(Shapes, shape) {
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

// News is what a game brought, told once: the facts it wrote in the Алманах in ink (Ink, a count: ink.go), and, of a
// day's issue, how many of its right answers were to questions met before (MetBefore: in grey already, „1 вече
// срещан“), and of a chapter's game the facts it wrote in grey (Grey: „+4 в сиво“; grey is never counted
// otherwise); the ranks risen since the player was last told (Rose, as one: rank.go),
// or, after a day's issue, the chapter nearest its next rank (Step); and, once a day, what others' duels against the
// player's recordings came to (recordings.go).
type News struct {
	Ink        int             `json:"ink,omitempty"`
	MetBefore  int             `json:"metBefore,omitempty"`
	Grey       int             `json:"grey,omitempty"`
	Rose       *Rose           `json:"rose,omitempty"`
	Step       *Step           `json:"step,omitempty"`
	Recordings *RecordingsNews `json:"recordings,omitempty"`
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
			if n.Ink, met, err = g.InkIn(ctx, userID, runID); err != nil {
				return n, err
			}
			if kind == "topic" {
				if n.Grey, err = g.GreyIn(ctx, userID, runID); err != nil {
					return n, err
				}
			}
			if kind == "day" {
				n.MetBefore = met
				if n.Step, err = g.StepOf(ctx, userID); err != nil {
					return n, err
				}
			}
		}
	}
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if n.Recordings, err = g.recordingsNews(tx, userID); err != nil {
			return err
		}
		if n.Rose, err = roseOf(tx, userID); err != nil {
			return err
		}
		if n.Rose != nil {
			n.Step = nil // the day's big news is the rank: no step beside it
		}
		_, err = tx.Exec(`UPDATE runs SET told = 1 WHERE user_id = ?1 AND NOT told AND finished_at <= ?2`, userID, finished)
		return err
	})
	return n, err
}
