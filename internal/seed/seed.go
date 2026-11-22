// Package seed fills a fresh development database with a game that has been played for a while (`almanac seed`), so
// that a review or a look at a screen sees what a long-time player sees, not a new guest's empty pages.
//
// It plays the history through the game's own functions, on a clock of its own that walks from Options.Days ago to
// now: players arrive (account.Accounts.Guest, named and given an email by some), play the day's ten and topics
// (play.Game: Show, Start, Answer), and duels with their friends (sent, played back, some let lapse: DuelFriend,
// PlayDuel); they ask each other to be friends, accept, say no, choose their
// avatar. Whatever follows from that, the game works out itself: scores, streaks, duels' results and records, the
// facts of Моят Алманах and the notes in it.
// Only what no game function
// writes is written directly: when a player came and was last seen, their email, their mail and notification
// preferences, the players' sessions (each guest's from the day they came, as their browser keeps it; the personas'
// to sign in by).
//
// Players play at once, not one after another: each visit begins at its own time (rewind), the clock put back if the
// visits before it ran past it, so that a day's games stay in its day. One game is one player's, on one clock.
//
// The players are drawn to look like a game's: a few who play every day (streaks of 50 and more), many who come now
// and then (streaks of one to five), some who tried it once and left, some who were regular and stopped; strong and
// weak; with Bulgarian names, Latin ones, long ones, names with digits, and the drawn names of those who never chose
// one. Among them are the personas (Personas): players a reviewer signs in as (by their session's cookie), each one
// of the kinds a screen should be looked at for, checked to be what they say once the history is played.
//
// It's for development only: `almanac seed` refuses without DEV=1, in a release's build, with production's settings,
// and on any database that isn't new and empty (Fresh).
package seed

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	mrand "math/rand/v2"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

// Options say how much history to play.
type Options struct {
	// Players is how many players come over the days (200 if 0), the personas among them.
	Players int
	// Days is how many days back the history begins (60 if 0).
	Days int
	// Seed draws the players and what they do (the game draws its own questions).
	Seed uint64
	// Now is when the history ends (time.Now if zero): the personas' sessions start then.
	Now time.Time
	// Progress, if set, is told how far the history has come, a line a day.
	Progress func(string)
	// small is a test's history: a few weeks of a few players, playing a third as many games (the race detector makes
	// each one dear).
	small bool
}

// Persona is a player a reviewer can be: sign in as them with their session's cookie (account's "sid" over HTTP).
type Persona struct {
	Key   string `json:"key"`
	About string `json:"about"`
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Tag   string `json:"tag"`
	Email string `json:"email,omitempty"`
	Token string `json:"token"`
}

// ErrNotFresh is a database with players or games in it already.
var ErrNotFresh = errors.New("the database isn't a new, empty one")

// Fresh says whether a database is new and empty: no players, no games, no days drawn: only such a one is seeded.
func Fresh(ctx context.Context, db *store.DB) error {
	var n int
	err := db.Read.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM runs)
		+ (SELECT count(*) FROM days)`).Scan(&n)
	if err != nil {
		return err
	}
	if n > 0 {
		return ErrNotFresh
	}
	return nil
}

// Seed plays the history into a fresh database (Fresh), with bank b, and says who the personas are.
func Seed(ctx context.Context, db *store.DB, b *bank.Bank, o Options) ([]Persona, error) {
	if err := Fresh(ctx, db); err != nil {
		return nil, err
	}
	if o.Players == 0 {
		o.Players = 200
	}
	if o.Days == 0 {
		o.Days = 60
	}
	if o.Now.IsZero() {
		o.Now = time.Now()
	}
	if o.Players < len(personaKinds)+10 || o.Days < 14 {
		return nil, fmt.Errorf("seed: at least %d players and 14 days", len(personaKinds)+10)
	}
	end := o.Now.In(play.Bulgaria)
	first := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, play.Bulgaria).AddDate(0, 0, -(o.Days - 1))
	w := &world{
		ctx: ctx, db: db, b: b, opt: o, end: end, first: first,
		r:        mrand.New(mrand.NewPCG(o.Seed, o.Seed^0x5eed)),
		now:      first.Add(6 * time.Hour),
		accounts: &account.Accounts{DB: db},
		byID:     map[int64]*player{},
		friends:  map[[2]int64]bool{},
	}
	w.g = play.New(db, func() *bank.Bank { return b })
	w.g.Now = w.clock
	defer w.g.Settled(context.WithoutCancel(ctx))
	if err := w.g.Keep(ctx, b); err != nil {
		return nil, err
	}
	w.cast(o.Players)
	if o.small {
		for _, p := range w.players {
			p.topics, p.duels = p.topics/3, p.duels/3
		}
	}
	if err := w.history(); err != nil {
		return nil, err
	}
	return w.personas()
}

// world is the history being played: the game on its own clock, the players, and what they've done that the game
// doesn't say (who knows whom).
type world struct {
	ctx      context.Context
	db       *store.DB
	b        *bank.Bank
	g        *play.Game
	accounts *account.Accounts
	opt      Options
	r        *mrand.Rand

	first, end time.Time // the first day's start, and now

	mu  sync.Mutex // the clock is read by what the game does in the background
	now time.Time

	players []*player
	byID    map[int64]*player
	friends map[[2]int64]bool // who has asked whom, either way (the lower id first)
	swept   time.Time         // the last time the server's sweeps ran (sweep)
	day     int               // the day being played, from 0
}

func (w *world) clock() time.Time {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.now
}

// set moves the clock on to t (never back, and never past the end).
func (w *world) set(t time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if t.After(w.end) {
		t = w.end
	}
	if t.After(w.now) {
		w.now = t
	}
}

func (w *world) wait(d time.Duration) { w.set(w.clock().Add(d)) }

// rewind puts the clock at t, back if it's ahead: players play at once, not one after another, so each visit begins at
// its own time however long the visits before it took (on one clock, the day's would run into the night). What the
// game does in the background after the games before is done first, on the clock it began on.
func (w *world) rewind(t time.Time) {
	w.g.AftersDone(w.ctx)
	w.mu.Lock()
	defer w.mu.Unlock()
	w.now = t
	if t.After(w.end) {
		w.now = w.end
	}
	if w.swept.After(w.now) {
		w.swept = w.now
	}
}

// over says whether the clock has reached the end.
func (w *world) over() bool { return !w.clock().Before(w.end) }

// dayAt is the moment of day i (from 0) at the hour and minute given.
func (w *world) dayAt(i int, hour, min int) time.Time {
	d := w.first.AddDate(0, 0, i)
	return time.Date(d.Year(), d.Month(), d.Day(), hour, min, 0, 0, play.Bulgaria)
}

// today is the index of the last day (the end's).
func (w *world) today() int { return w.opt.Days - 1 }

// chance is true with probability p.
func (w *world) chance(p float64) bool { return w.r.Float64() < p }

// between is a duration drawn evenly from lo to hi.
func (w *world) between(lo, hi time.Duration) time.Duration {
	return lo + time.Duration(w.r.Int64N(int64(hi-lo)+1))
}

// count is a whole number drawn around a mean (Poisson).
func (w *world) count(mean float64) int {
	n := 0
	for l := w.r.ExpFloat64(); l < mean; l += w.r.ExpFloat64() {
		n++
	}
	return n
}

// sweep does what the server does every few minutes in the background, as the clock passes: duels whose time is up, what follows runs, the days drawn ahead.
func (w *world) sweep() error {
	if w.clock().Sub(w.swept) < 10*time.Minute {
		return nil
	}
	w.swept = w.clock()
	w.g.AftersDone(w.ctx)
	if err := w.g.EnsureDays(w.ctx); err != nil {
		return fmt.Errorf("days ahead: %w", err)
	}
	if err := w.g.SettleDue(w.ctx); err != nil {
		return fmt.Errorf("settling: %w", err)
	}
	if err := w.g.AfterDue(w.ctx); err != nil {
		return fmt.Errorf("after runs: %w", err)
	}
	return nil
}

// token makes a session for a player, as signing in does: the value of its cookie.
func (w *world) token(id int64) (string, error) {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token := base64.RawURLEncoding.EncodeToString(b)
	now := w.end
	_, err := w.db.Write.ExecContext(w.ctx, `INSERT INTO sessions (token_hash, user_id, created_at, seen_at, expires_at)
		VALUES (?, ?, ?, ?, ?)`, account.SessionKey(token), id, store.Ms(now), store.Ms(now),
		store.Ms(now.AddDate(0, 0, account.SessionDays)))
	return token, err
}

// exec writes what no game function does.
func (w *world) exec(q string, args ...any) error {
	_, err := w.db.Write.ExecContext(w.ctx, q, args...)
	return err
}

// one reads a single value.
func (w *world) one(dst any, q string, args ...any) error {
	err := w.db.Read.QueryRowContext(w.ctx, q, args...).Scan(dst)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}
