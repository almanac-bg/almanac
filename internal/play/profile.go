package play

import (
	"context"
	"database/sql"
	"errors"
	"slices"
)

// A profile is a player as anyone may see them, found by their tag: how they look, their division, their numbers,
// how well they know each topic, and the achievements they've earned. What only they see stays theirs: their games
// one by one, achievements not yet earned, their email, their friends.

// Profile is a player as another sees them, and how the viewer stands with them.
type Profile struct {
	Name string `json:"name"`
	Tag  string `json:"tag"`
	// Me says it's the viewer's own.
	Me bool `json:"me,omitempty"`
	// Avatar comes as a look's does ("shape-tone/frame/backdrop"), with their title and level.
	Look
	// Since is when they started playing.
	Since    int64    `json:"since"`
	Standing Standing `json:"standing"`
	Streak   int      `json:"streak"`
	Days     int      `json:"days"`
	Games    int      `json:"games"`
	Answers  int      `json:"answers"`
	Right    int      `json:"right"`
	Duels    int      `json:"duels"`
	Won      int      `json:"won"`
	// Mastery is how well they know each topic, in the bank's order.
	Mastery []Mastery `json:"mastery"`
	// Achievements are those they've earned, the latest first; Of is how many there are in all.
	Achievements []Earned `json:"achievements"`
	Of           int      `json:"of"`
	// Friend is how the viewer stands with them: "yes" (friends), "asked" (the viewer asked them), "asks" (they
	// asked the viewer), or "" (none of these, or no viewer). Request is the request's id, while one waits.
	Friend  string `json:"friend,omitempty"`
	Request int64  `json:"request,omitempty"`
	// Record is the duels between the two, from the viewer's side: while they're friends.
	Record *Record `json:"record,omitempty"`
	// ID is theirs, for calling them to a duel: told only to a friend.
	ID int64 `json:"id,omitempty"`
}

// Record is the duels between two players, from one's side.
type Record struct {
	Won   int `json:"won"`
	Lost  int `json:"lost"`
	Drawn int `json:"drawn"`
}

// ProfileOf reads the profile of the player with a tag (a normal one: account.NormalTag), as viewer sees it (0: no
// one signed in). ErrNoPlayer when there's no such player.
func (g *Game) ProfileOf(ctx context.Context, tag string, viewer int64) (Profile, error) {
	db := g.DB.Read
	var p Profile
	var id int64
	var avatar, title string
	var total int
	err := db.QueryRowContext(ctx, `SELECT u.id, u.name, u.tag, u.created_at, `+lookColumns+` FROM users u WHERE u.tag = ?`, tag).
		Scan(&id, &p.Name, &p.Tag, &p.Since, &avatar, &title, &total)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNoPlayer
	}
	if err != nil {
		return p, err
	}
	p.Me, p.Look = id == viewer, g.lookOf(id, avatar, title, total)
	if p.Standing, err = g.StandingOf(ctx, id); err != nil {
		return p, err
	}
	if p.Streak, err = g.Streak(ctx, id); err != nil {
		return p, err
	}
	err = db.QueryRowContext(ctx, `SELECT count(*), count(*) FILTER (WHERE kind = 'day'), count(*) FILTER (WHERE kind = 'duel'),
		count(*) FILTER (WHERE outcome = 'won') FROM runs WHERE user_id = ? AND finished_at IS NOT NULL`, id).
		Scan(&p.Games, &p.Days, &p.Duels, &p.Won)
	if err != nil {
		return p, err
	}
	if p.Answers, p.Right, err = g.answered(ctx, id); err != nil {
		return p, err
	}
	if p.Mastery, err = g.MasteryOf(ctx, id); err != nil {
		return p, err
	}
	earned, err := g.earned(ctx, id)
	if err != nil {
		return p, err
	}
	p.Achievements, p.Of = []Earned{}, len(Achievements)
	for _, a := range Achievements {
		if at, ok := earned[a.ID]; ok {
			p.Achievements = append(p.Achievements, Earned{Achievement: a, At: at, Progress: a.Goal})
		}
	}
	slices.SortStableFunc(p.Achievements, func(a, b Earned) int { return int(b.At - a.At) })
	if viewer == 0 || p.Me {
		return p, nil
	}
	return p, g.relation(ctx, &p, viewer, id)
}

// relation fills in how viewer stands with the player id: friends (and their record), or a request either way.
func (g *Game) relation(ctx context.Context, p *Profile, viewer, id int64) error {
	db := g.DB.Read
	if _, err := g.Friend(ctx, viewer, id); err == nil {
		p.Friend, p.ID, p.Record = "yes", id, &Record{}
		rows, err := db.QueryContext(ctx, `SELECT outcome, count(*) FROM runs
			WHERE user_id = ? AND kind = 'duel' AND opponent_id = ? GROUP BY outcome`, viewer, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var outcome string
			var n int
			if err := rows.Scan(&outcome, &n); err != nil {
				return err
			}
			switch outcome {
			case "won":
				p.Record.Won = n
			case "lost":
				p.Record.Lost = n
			default:
				p.Record.Drawn = n
			}
		}
		return rows.Err()
	} else if !errors.Is(err, ErrNotFriends) {
		return err
	}
	// A request either way: the viewer's to them, or theirs to the viewer (by tag, or to the viewer's email).
	var request, from int64
	err := db.QueryRowContext(ctx, `SELECT r.id, r.from_id FROM friend_requests r
		WHERE (r.from_id = ?1 AND r.to_id = ?2)
		OR (r.from_id = ?2 AND (r.to_id = ?1 OR r.to_email = (SELECT email FROM users WHERE id = ?1)))
		ORDER BY r.from_id = ?2 DESC LIMIT 1`, viewer, id).Scan(&request, &from)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	p.Request, p.Friend = request, "asked"
	if from == id {
		p.Friend = "asks"
	}
	return nil
}
