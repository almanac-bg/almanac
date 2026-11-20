package play

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// A profile is a player as anyone may see them, found by their tag: how they look, their numbers,
// and how well they know each topic. What only they see stays theirs: their games one by one, their Алманах, their
// email, their friends. Nor does it follow them as they play: its numbers are of the games they finished (not a game
// under way, answer by answer), and its time is a date, the month they started, never the moment (review 2026-11-18,
// S12). The privacy page says what
// it shows; the server limits how many anyone looks at (server.profileOf).

// Profile is a player as another sees them, and how the viewer stands with them.
type Profile struct {
	Name string `json:"name"`
	Tag  string `json:"tag"`
	// Me says it's the viewer's own.
	Me bool `json:"me,omitempty"`
	Look
	// Since is when they started playing: the month (its first day, at noon in Bulgaria).
	Since   int64 `json:"since"`
	Streak  int   `json:"streak"`
	Days    int   `json:"days"`
	Games   int   `json:"games"`
	Answers int   `json:"answers"`
	Right   int   `json:"right"`
	Duels   int   `json:"duels"`
	Won     int   `json:"won"`
	// Mastery is how well they know each topic, in the bank's order.
	Mastery []Mastery `json:"mastery"`
	// Friend is how the viewer stands with them: "yes" (friends), "asked" (the viewer asked them), "asks" (they
	// asked the viewer), or "" (none of these, or no viewer). Request is the request's id, while one waits.
	Friend  string `json:"friend,omitempty"`
	Request int64  `json:"request,omitempty"`
	// Record is the duels between the two, from the viewer's side: while they're friends.
	Record *Record `json:"record,omitempty"`
}

// dayOnly is the day of a moment (ms), as noon of it in Bulgaria: the same date wherever a screen shows it, within
// eleven hours of Bulgaria's time.
func dayOnly(ms int64) int64 {
	t := time.UnixMilli(ms).In(Bulgaria)
	return store.Ms(time.Date(t.Year(), t.Month(), t.Day(), 12, 0, 0, 0, Bulgaria))
}

// monthOnly is the month of a moment (ms), as noon of its first day in Bulgaria.
func monthOnly(ms int64) int64 {
	t := time.UnixMilli(ms).In(Bulgaria)
	return store.Ms(time.Date(t.Year(), t.Month(), 1, 12, 0, 0, 0, Bulgaria))
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
	var avatar string
	err := db.QueryRowContext(ctx, `SELECT u.id, u.name, u.tag, u.created_at, `+lookColumns+` FROM users u WHERE u.tag = ?`, tag).
		Scan(&id, &p.Name, &p.Tag, &p.Since, &avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNoPlayer
	}
	if err != nil {
		return p, err
	}
	p.Me, p.Look = id == viewer, lookOf(id, avatar)
	if p.Streak, err = g.Streak(ctx, id); err != nil {
		return p, err
	}
	err = db.QueryRowContext(ctx, `SELECT count(*), count(*) FILTER (WHERE kind = 'day'),
		(SELECT count(*) FROM `+duelResults+`), (SELECT count(*) FROM `+duelResults+` WHERE outcome = 'won')
		FROM runs WHERE user_id = ?1 AND finished_at IS NOT NULL`, id).
		Scan(&p.Games, &p.Days, &p.Duels, &p.Won)
	if err != nil {
		return p, err
	}
	if p.Answers, p.Right, err = g.answered(ctx, id, true); err != nil {
		return p, err
	}
	if p.Mastery, err = g.knownMastery(ctx, id, true); err != nil {
		return p, err
	}
	p.Since = monthOnly(p.Since)
	if viewer == 0 || p.Me {
		return p, nil
	}
	return p, g.relation(ctx, &p, viewer, id)
}

// relation fills in how viewer stands with the player id: friends (and their record), or a request either way.
func (g *Game) relation(ctx context.Context, p *Profile, viewer, id int64) error {
	if _, err := g.Friend(ctx, viewer, id); err == nil {
		r, err := g.recordAgainst(ctx, viewer, id)
		p.Friend, p.Record = "yes", &r
		return err
	} else if !errors.Is(err, ErrNotFriends) {
		return err
	}
	// A request either way: the viewer's to them, or theirs to the viewer (by tag, or to the viewer's email).
	var request, from int64
	err := g.DB.Read.QueryRowContext(ctx, `SELECT r.id, r.from_id FROM friend_requests r
		WHERE (r.from_id = ?1 AND r.to_id = ?2)
		OR (r.from_id = ?2 AND (r.to_id = ?1 OR r.to_email = (SELECT email FROM users WHERE id = ?1)) AND NOT r.declined)
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
