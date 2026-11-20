// Package play is the game: runs through a set of questions (the day's, a topic's, „България“'s: bulgaria.go), one
// question at a time, against the server's clock; duels, kept as runs; friends.
//
// A question's time runs only while it's shown: Show starts it, Answer stops it. How long it is is the server's
// (Limit): by how much the question gives to read, at a slow reader's pace, never under its kind's floor; an answer
// the player's screen timed within it is taken if the line brings it late, up to LateGrace (late.go). A question with pictures waits for
// them: Show starts its time PictureWait later, and Start sooner, once the player's screen has them in, so that a slow
// line doesn't eat the time, and the server still says when it runs. Until its time runs, the screen gets the pictures
// only (bank.PicturesView): its words and options come with its time, and an answer before it is refused, so that
// nobody reads a question off the clock. Between questions a player reads the answer and its fact for as long as they
// like; a question of the day's ten dealt on its own date („На този ден“) shows its day's line with them (dealtOn). A
// question left showing past its time counts as unanswered, whenever the run is next looked at. A question is graded
// against the version of it that showed, whatever the bank has become meanwhile (versions.go); the day's ten hold
// still for their day, and one found wrong during it counts for nobody that day (day.go). Everything a run does
// goes through the database, so a refresh, a second tab or a restart of the server changes nothing. A run left
// half-way goes on where it stopped: the day's when the player comes back to it that day (a run of the day's
// questions ends with its day, DayGrace after: dayOver), a topic's when they start the same topic again that day
// (StartTopic). A game played quicker than a person plays counts for its player alone, and so does the day of a
// throwaway guest who played it before a player on the same network; a game keeps that network for a week (fair.go).
//
// No game deals a player again what they've played, in any game, while the bank has questions they haven't: a topic's,
// a duel's are drawn for all their players, those none of them has seen first,
// then those the fewest have (choose, seenAmong); a recording is a game with few of its questions seen. One repeats by
// design: the day (the same ten for everyone). TestNothingPlayedAgain holds it, for every way a game starts.
//
// A guest who signs in to their account brings everything along (Merge), and a player who goes leaves others'
// history whole (Forget): merge.go, checked against the schema so that no table of a player's is left out.
package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"strconv"
	"time"
	_ "time/tzdata" // Bulgaria's days, wherever the server runs

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

const (
	// Length is how many questions a run has.
	Length = 10
	// Grace is how late an answer may arrive and still count: the trip from the player's screen to the server, on a
	// slow phone's line too.
	Grace = 2 * time.Second
	// PictureWait is the longest a question's time waits for its pictures to come in (four of them, on a slow line),
	// and so the most anyone gets to look before it runs.
	PictureWait = 8 * time.Second
)

// Limit is how long a question is shown before its time runs out: the server's clock, the same for everyone. It is a
// base for its kind (thinking, and the taps or the typing it asks) and the time a slow reader takes to read it
// (bank.Reading at SlowReading), never under its kind's floor (limits) nor over LongestLimit, in whole seconds. The
// floors hold for most questions; a long one gets its reading time on top, and the bank's length rule keeps those few.
func Limit(q bank.Question) time.Duration {
	k, ok := limits[q.Base().Type]
	if !ok {
		k = limits["choice"]
	}
	read := time.Duration(float64(bank.Reading(q)) / SlowReading * float64(time.Second))
	return min(max(k.base+read, k.floor), LongestLimit).Round(time.Second)
}

// SlowReading is how many letters and digits a second a slow reader reads (bank.Reading): about the tenth percentile
// of adults reading silently (some 175 words a minute), here on a phone, in a game.
const SlowReading = 12.0

// limits are each kind's base and floor (Limit). A true-or-not is judged at a glance: 15 s at least. A choice (a
// choice of pictures among them) or a number asks for thought and a tap or a typed number: 25 s. An order, a match or
// a split is four taps or more after reading: 40 s. Clues come bank.ClueEvery apart, the last 20 s in, then a choice:
// 40 s.
var limits = map[string]struct{ base, floor time.Duration }{
	"truefalse": {8 * time.Second, 15 * time.Second},
	"choice":    {12 * time.Second, 25 * time.Second},
	"number":    {15 * time.Second, 25 * time.Second},
	"order":     {28 * time.Second, 40 * time.Second},
	"match":     {28 * time.Second, 40 * time.Second},
	"split":     {28 * time.Second, 40 * time.Second},
	"clues":     {20 * time.Second, 40 * time.Second},
}

// LongestLimit is the longest any question is shown (Limit).
const LongestLimit = 60 * time.Second

// Bulgaria is where the game's days begin and end.
var Bulgaria, _ = time.LoadLocation("Europe/Sofia")

// Errors a player may cause.
var (
	ErrNoRun      = errors.New("no such run")
	ErrNoTopic    = errors.New("no such topic")
	ErrOutOfStep  = errors.New("not the question now")
	ErrBadAnswer  = errors.New("an answer the question can't take")
	ErrNoQuestion = errors.New("no questions to play")
	// ErrDayOver is a run of the day's questions played on after its day (dayOver).
	ErrDayOver = errors.New("the run's day is over")
	// ErrReviewOver is a game gone over after its day (Review).
	ErrReviewOver = errors.New("the game's review is over")
)

// Game plays runs.
type Game struct {
	DB *store.DB
	// Bank is the bank now (it may be reloaded while the game runs).
	Bank func() *bank.Bank
	// Now is the clock (tests set their own).
	Now func() time.Time
	// CrowdMin, if set, is how many answers a question needs before how players answered it shows, the day's
	// players' and everyone's (CrowdFrom, DayCrowdFrom when 0; the browser tests make it 1).
	CrowdMin int
	// Version is the game's version as released (the server's; "" in tests and a developer's build): the version a
	// player met is kept with them on their first day played (users.first_version, retention.go).
	Version string
	// DuelNews, if set, tells a player a duel's news another player caused (duels.go: sent to them, or played back).
	DuelNews func(context.Context, DuelNews)

	hard      snapshot[*hardnesses] // how hard each question is (mastery.go)
	crowds    snapshot[crowds]      // how players have answered each question (crowd.go)
	dayCrowds dayCrowdCache         // how the day's players have answered its questions (crowd.go)
	boards    boardCache            // the days' boards (board.go)
	daysAhead daysCache             // today's questions and the days ahead's (ahead.go)
	versions  versions              // the questions' versions kept (versions.go)

	later  laters                  // what follows the runs just finished, under way (after.go)
	skills memo[skillsKey, skills] // each player's abilities, kept while their games stand (memo.go)
}

func New(db *store.DB, b func() *bank.Bank) *Game {
	return &Game{DB: db, Bank: b, Now: time.Now}
}

// Today is the day it is in Bulgaria, as the days are kept (2026-11-12).
func (g *Game) Today() string { return g.Now().In(Bulgaria).Format(time.DateOnly) }

// Pick is a question as a run holds it: which one, how it's dealt, and, once it's shown, which version of it showed
// (bank.Version: versions.go); the day's ten hold it from the day's start (day.go).
type Pick struct {
	ID   string `json:"id"`
	Seed uint64 `json:"seed"`
	V    string `json:"v,omitempty"`
	// Void is a question of the day's ten that counts for nobody that day (day.go): found untrue, or changed, while
	// the day was played.
	Void bool `json:"void,omitempty"`
}

// run is a run as the database has it.
type run struct {
	id, userID    int64
	kind          string
	day, category string
	picks         []Pick
	at            int
	shownAt       sql.NullInt64
	rights        int
	tie           tiebreak // what decides between the same right answers (board.go)
	ms            int64
	finished      bool
	shadow        int  // why it counts for its player alone (fair.go: ShadowScript…), 0 if it doesn't
	pencil        bool // a day's issue played a second time in one browser: writes pencil only (ink.go)
}

const runColumns = `id, user_id, kind, coalesce(day, ''), coalesce(category, ''), questions,
	at, shown_at, rights, closeness, ms, finished_at IS NOT NULL, shadow, pencil <> 0`

type scanner interface{ Scan(...any) error }

func scanRun(row scanner) (*run, error) {
	var r run
	var picks string
	err := row.Scan(&r.id, &r.userID, &r.kind, &r.day, &r.category, &picks,
		&r.at, &r.shownAt, &r.rights, &r.tie.closeness, &r.ms, &r.finished, &r.shadow, &r.pencil)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoRun
	}
	if err != nil {
		return nil, err
	}
	return &r, json.Unmarshal([]byte(picks), &r.picks)
}

// loadPlayed reads a player's run to play on: a day's whose day is over (dayOver) is over.
func (g *Game) loadPlayed(tx *sql.Tx, userID, runID int64) (*run, error) {
	r, err := load(tx, userID, runID)
	if err != nil {
		return nil, err
	}
	if r.dayOver(g.Now()) {
		return nil, ErrDayOver
	}
	return r, nil
}

// DayGrace is how long after its day a run of the day's questions can still be played on: one begun before midnight
// is finished after it, at a player's pace, between its questions too.
const DayGrace = 15 * time.Minute

// dayLate is the most after its day that a run of the day's questions can still be answered: DayGrace, and the time of
// a question shown just before it ends (dayOver).
const dayLate = DayGrace + LongestLimit + LateGrace

// dayOver is whether a run of the day's questions can't be played on any more: its day ended DayGrace ago, and no
// question shown before then is still in its time. It stays as it was left: unfinished, it counts for nothing (the
// streak, the day's board), and nothing more of it shows. So a day can't be kept open (a run
// started and left) and played days later, its answers known by then, to keep a streak or move a past board.
func (r *run) dayOver(now time.Time) bool {
	if r.kind != "day" || r.finished {
		return false
	}
	_, end := dayBounds(r.day)
	closes := time.UnixMilli(end).Add(DayGrace)
	if shown := time.UnixMilli(r.shownAt.Int64); r.shownAt.Valid && shown.Before(closes) &&
		shown.Add(LongestLimit+LateGrace).After(closes) {
		closes = shown.Add(LongestLimit + LateGrace)
	}
	return now.After(closes)
}

// dealtOn is the day a run's questions are dealt for, as „На този ден“ goes: the day's questions' date, "" for any
// other game (a question that belongs to a date is that day's only in the day's ten).
func (r *run) dealtOn() string {
	if r.kind == "day" {
		return r.day
	}
	return ""
}

// load reads a player's run (another player's is as good as missing).
func load(q interface {
	QueryRow(string, ...any) *sql.Row
}, userID, runID int64) (*run, error) {
	return scanRun(q.QueryRow(`SELECT `+runColumns+` FROM runs WHERE id = ? AND user_id = ?`, runID, userID))
}

// State is a run as a player sees it.
type State struct {
	ID       int64  `json:"id"`
	Kind     string `json:"kind"`
	Day      string `json:"day,omitempty"`
	Category string `json:"category,omitempty"`
	Total    int    `json:"total"`
	// Void is how many of the Total count for nobody (day.go): the run is of Total − Void questions.
	Void   int `json:"void,omitempty"`
	At     int `json:"at"`
	Rights int `json:"rights"`
	// Trail is how each answered question went, in order.
	Trail []Mark `json:"trail"`
	// Question is the one shown now, if one is.
	Question *Shown `json:"question,omitempty"`
	Done     bool   `json:"done"`
	// Against is, in a duel played second (the other side finished: a friend's, a recording), how the other side's
	// answers went as far as the player has come, and no further (duelAgainst): each question the player has answered;
	// and of the one shown, only when they answered it (Ms), if they did, for the
	// screen to say so at that moment. How it went for them waits for the player's own answer.
	Against []DuelMark `json:"against,omitempty"`
}

// Mark is how one answer went: right, or close („близо“: closeAnswer), or that its question counts for nobody (Void:
// day.go), answered or not.
type Mark struct {
	Right bool `json:"right"`
	Close bool `json:"close,omitempty"`
	Void  bool `json:"void,omitempty"`
}

// closeAnswer is whether an answer of a score is close („близо“): worth something, but not right (a number short of
// bank.RightFrom, an order or a match nearly so). It counts as not right, in the score and everywhere else.
func closeAnswer(score float64, right bool) bool { return score > 0 && !right }

// Shown is the question on screen, with the time it has left.
type Shown struct {
	N        int    `json:"n"`
	Category string `json:"category"`
	View     any    `json:"view"`
	LimitMs  int64  `json:"limitMs"`
	LeftMs   int64  `json:"leftMs"`
	// MoreMs is how soon more of the question shows (the next clue): look again then. 0 for nothing more.
	MoreMs int64 `json:"moreMs,omitempty"`
	// StartsMs is how soon its time starts by itself, while it waits for its pictures: the screen starts it sooner
	// (Start), once they're in. 0 once it runs.
	StartsMs int64 `json:"startsMs,omitempty"`
	// OnThisDay is a day's question that belongs to its date („На този ден“: bank.Tail.On).
	OnThisDay bool `json:"onThisDay,omitempty"`
}

// Result is how an answer went, the answer itself, and the run after it.
type Result struct {
	// InRow is how many right answers in a row the answer makes, from 2: heard and seen as the run's climb, worth
	// nothing more.
	InRow    int     `json:"inRow,omitempty"`
	Score    float64 `json:"score"`
	Right    bool    `json:"right"`
	Exact    bool    `json:"exact,omitempty"`
	TimedOut bool    `json:"timedOut,omitempty"`
	// Given is the answer as it shows (the player's screen has it already).
	Given  json.RawMessage `json:"-"`
	Reveal any             `json:"reveal"`
	State  State           `json:"state"`
}

// state builds what a player sees of a run.
func (g *Game) state(tx *sql.Tx, r *run) (State, error) {
	s := State{
		ID: r.id, Kind: r.kind, Day: r.day, Category: r.category, Total: len(r.picks), Void: len(r.picks) - r.counted(),
		At: r.at, Rights: r.rights, Done: r.finished,
	}
	rows, err := tx.Query(`SELECT n, score, is_right FROM answers WHERE run_id = ? ORDER BY n`, r.id)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	var marks []markAt
	for rows.Next() {
		var a markAt
		var score float64
		if err := rows.Scan(&a.n, &score, &a.m.Right); err != nil {
			return s, err
		}
		a.m.Close = closeAnswer(score, a.m.Right)
		marks = append(marks, a)
	}
	if err := rows.Err(); err != nil {
		return s, err
	}
	s.Trail = trailOf(r.picks, r.at, marks)
	if r.shownAt.Valid && !r.finished && !r.voidNow() {
		d, ok := g.deal(r.picks[r.at])
		if ok {
			limit := Limit(d.Question())
			since := g.Now().Sub(time.UnixMilli(r.shownAt.Int64))
			s.Question = &Shown{
				N: r.at, Category: d.Question().Base().Category, View: bank.ViewAt(d, max(0, since)),
				LimitMs: limit.Milliseconds(), LeftMs: max(0, min(limit, limit-since).Milliseconds()),
				MoreMs: bank.NextStep(d, max(0, since)).Milliseconds(), StartsMs: max(0, -since.Milliseconds()),
				OnThisDay: r.dealtOn() != "" && d.Question().Extra().OnDay(r.dealtOn()),
			}
			if since < 0 { // waiting for its pictures: those only, until its time runs
				s.Question.View, s.Question.MoreMs = bank.PicturesView(d), 0
			}
		}
	}
	if r.kind == "duel" {
		var err error
		if s.Against, err = duelAgainst(tx, r.id, r.at, s.Question != nil); err != nil {
			return s, err
		}
	}
	return s, nil
}

// settle counts a question whose time ran out as unanswered (or one gone from the bank as skipped), and passes over
// one that counts for nobody (day.go), so the run can go on. It reports whether that ended the run: then, once the
// transaction is done, the caller follows it with finished, as an answer that ends a run does.
func (g *Game) settle(tx *sql.Tx, r *run) (bool, error) {
	if !g.settles(r) {
		return false, nil
	}
	if r.voidNow() {
		err := g.passVoid(tx, r)
		return err == nil && r.finished, err
	}
	d, ok := g.deal(r.picks[r.at])
	ms := int64(0)
	if ok {
		ms = Limit(d.Question()).Milliseconds()
	}
	err := g.record(tx, r, bank.Graded{}, false, ms)
	return err == nil && r.finished, err
}

// settles says whether settle has anything to do: a question showing past its time, or gone from the bank; or one that
// counts for nobody, where the run stands.
func (g *Game) settles(r *run) bool {
	if r.finished {
		return false
	}
	if r.voidNow() {
		return true
	}
	if !r.shownAt.Valid {
		return false
	}
	d, ok := g.deal(r.picks[r.at])
	if !ok {
		return true
	}
	// A question's answer may still come, timed within its limit by the screen, until LateGrace after it (late.go).
	late := Limit(d.Question()) + LateGrace
	return g.Now().Sub(time.UnixMilli(r.shownAt.Int64)) > late
}

// record keeps an answer (to a number, if it's one: what decides a tie, tiebreak), and moves the run to the next
// question (or its end).
func (g *Game) record(tx *sql.Tx, r *run, gr bank.Graded, number bool, ms int64) error {
	var given, shown any
	if gr.Given != nil {
		given, shown = string(gr.Given), string(gr.Shown)
	}
	now := store.Ms(g.Now())
	p := r.picks[r.at]
	if _, err := tx.Exec(`INSERT INTO answers (run_id, n, question_id, given, shown, score, is_right, ms, at, version)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, r.at, p.ID, given, shown, gr.Score, gr.Right, ms, now,
		g.versionOf(p)); err != nil {
		return err
	}
	if err := g.markActive(tx, r.userID); err != nil {
		return err
	}
	if r.kind == "day" {
		if err := g.tallyDayAnswer(tx, r); err != nil {
			return err
		}
	}
	if err := g.judgeAnswer(tx, r, gr, ms); err != nil {
		return err
	}
	if gr.Right {
		if err := g.writeFact(tx, r, now); err != nil {
			return err
		}
	}
	r.tie.add(gr.Score, number)
	r.at++
	if gr.Right {
		r.rights++
	}
	r.ms += ms
	r.shownAt = sql.NullInt64{}
	r.skipVoid()
	if r.at >= len(r.picks) {
		return g.finish(tx, r)
	}
	_, err := tx.Exec(`UPDATE runs SET at = ?, shown_at = NULL, rights = ?, closeness = ?, ms = ?
		WHERE id = ?`, r.at, r.rights, r.tie.closeness, r.ms, r.id)
	return err
}

// finish ends a run where it is, and notes that what follows it is due (after.go).
func (g *Game) finish(tx *sql.Tx, r *run) error {
	r.finished = true
	_, err := tx.Exec(`UPDATE runs SET at = ?, shown_at = NULL, rights = ?, closeness = ?, ms = ?,
		finished_at = ? WHERE id = ?`, r.at, r.rights, r.tie.closeness, r.ms, store.Ms(g.Now()), r.id)
	if err != nil {
		return err
	}
	return g.afterDue(tx, r.id)
}

// rightsInRow is how many right answers a run's last ones are in a row: one that counts for nobody (day.go) neither
// adds to a row nor breaks it.
func rightsInRow(tx *sql.Tx, r *run) (int, error) {
	rows, err := tx.Query(`SELECT n, is_right FROM answers WHERE run_id = ? ORDER BY n DESC`, r.id)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	inRow := 0
	for rows.Next() {
		var n int
		var right bool
		if err := rows.Scan(&n, &right); err != nil {
			return 0, err
		}
		switch {
		case n < len(r.picks) && r.picks[n].Void:
		case !right:
			return inRow, nil
		default:
			inRow++
		}
	}
	return inRow, rows.Err()
}

// read runs fn in a transaction of the read pool: what it reads is one moment's, and it waits on no write.
func (g *Game) read(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := g.DB.Read.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // a read: nothing to keep
	return fn(tx)
}

// State is a player's run as it stands. It's read alongside everything else, and takes the one writer only when
// there's something to write: a question whose time has run out (settle).
func (g *Game) State(ctx context.Context, userID, runID int64) (State, error) {
	var s State
	write := false
	err := g.read(ctx, func(tx *sql.Tx) error {
		r, err := load(tx, userID, runID)
		if err != nil {
			return err
		}
		if write = g.settles(r); write {
			return nil
		}
		s, err = g.state(tx, r)
		return err
	})
	if err != nil || !write {
		return s, err
	}
	ended := false
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		r, err := load(tx, userID, runID)
		if err != nil {
			return err
		}
		if ended, err = g.settle(tx, r); err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	if err == nil && ended {
		g.finished(ctx, userID, runID)
	}
	return s, err
}

// Show puts the next question on screen and starts its time (the one already showing keeps its time); a question
// with pictures, PictureWait later at most (Start).
func (g *Game) Show(ctx context.Context, userID, runID int64) (State, error) {
	var s State
	ended := false
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		r, err := g.loadPlayed(tx, userID, runID)
		if err != nil {
			return err
		}
		if ended, err = g.settle(tx, r); err != nil {
			return err
		}
		if !r.finished && !r.shownAt.Valid {
			start := g.Now()
			d, ok := g.deal(r.picks[r.at])
			if ok && bank.HasPictures(d.Question()) {
				start = start.Add(PictureWait)
			}
			if err := r.showAt(tx, start, d); err != nil {
				return err
			}
		}
		s, err = g.state(tx, r)
		return err
	})
	if err == nil && ended {
		g.finished(ctx, userID, runID)
	}
	return s, err
}

// Start starts the time of question n, shown and waiting for its pictures, now that the player's screen has them in.
func (g *Game) Start(ctx context.Context, userID, runID int64, n int) (State, error) {
	var s State
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		r, err := g.loadPlayed(tx, userID, runID)
		if err != nil {
			return err
		}
		now := g.Now()
		if !r.finished && r.at == n && r.shownAt.Valid && r.shownAt.Int64 > now.UnixMilli() {
			if err := r.startAt(tx, now); err != nil {
				return err
			}
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, err
}

// showAt shows the question now, d (nil: none to show, gone from the bank), its time starting at t: the run keeps
// which version of it shows (Pick.V), so that it's graded against that one, whatever the bank becomes meanwhile. A
// pick that holds it already (the day's, from the day's start) keeps it.
func (r *run) showAt(tx *sql.Tx, t time.Time, d bank.Dealt) error {
	if d == nil {
		return r.startAt(tx, t)
	}
	p := &r.picks[r.at]
	v := bank.Version(d.Question())
	if v == p.V {
		return r.startAt(tx, t)
	}
	at := store.Ms(t)
	if _, err := tx.Exec(`UPDATE runs SET shown_at = ?, questions = json_set(questions, ?, ?) WHERE id = ?`,
		at, "$["+strconv.Itoa(r.at)+"].v", v, r.id); err != nil {
		return err
	}
	p.V = v
	r.shownAt = sql.NullInt64{Int64: at, Valid: true}
	return nil
}

// startAt keeps when the question showing starts its time.
func (r *run) startAt(tx *sql.Tx, t time.Time) error {
	at := store.Ms(t)
	if _, err := tx.Exec(`UPDATE runs SET shown_at = ? WHERE id = ?`, at, r.id); err != nil {
		return err
	}
	r.shownAt = sql.NullInt64{Int64: at, Valid: true}
	return nil
}

// Answer grades an answer to question n, the one showing. A null answer gives up on it. An answer to the question just
// answered (the one before, past any that count for nobody the run went on over: day.go) is one sent again, its reply lost on the way (a line that dropped, a server restarting): it gets the answer
// taken the first time, as it was, and changes nothing (again). One before the question's time runs (still waiting for
// its pictures) is out of step. It counts if it arrives within Grace of the question's time; AnswerTimed takes one
// the screen timed within it later.
func (g *Game) Answer(ctx context.Context, userID, runID int64, n int, answer json.RawMessage) (Result, error) {
	return g.answer(ctx, userID, runID, n, answer, false, g.Now())
}

// AnswerTimed is Answer for an answer the player's screen timed within the question's limit, or not (inTime): one
// that did is taken while it arrives within LateGrace of the limit's end (late.go).
func (g *Game) AnswerTimed(ctx context.Context, userID, runID int64, n int, answer json.RawMessage, inTime bool) (Result, error) {
	return g.answer(ctx, userID, runID, n, answer, inTime, g.Now())
}

// answer grades an answer that arrived at at, against the version of its question the run showed (Pick.V).
func (g *Game) answer(ctx context.Context, userID, runID int64, n int, answer json.RawMessage, inTime bool, at time.Time) (Result, error) {
	var res Result
	var r *run
	var d bank.Dealt
	finished := false
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if r, err = g.loadPlayed(tx, userID, runID); err != nil {
			return err
		}
		if r.justBefore(n) {
			res, d, err = g.again(tx, r, n)
			return err
		}
		if r.finished || n != r.at || r.voidNow() {
			return ErrOutOfStep
		}
		defer func() { finished = r.finished }()
		var ok bool
		if d, ok = g.deal(r.picks[r.at]); !ok || !r.shownAt.Valid {
			return ErrOutOfStep
		}
		shownAt := time.UnixMilli(r.shownAt.Int64)
		since := at.Sub(shownAt)
		if since < 0 { // still waiting for its pictures: its words aren't on screen yet
			return ErrOutOfStep
		}
		limit := Limit(d.Question())
		took, due := since, shownAt.Add(limit)
		var gr bank.Graded
		late := at.Sub(due)
		switch {
		case late > Grace && (!inTime || late > LateGrace):
			res.TimedOut = true
		case len(answer) == 0 || string(answer) == "null":
		default:
			if gr, err = bank.GradeAt(d, answer, since); err != nil {
				return ErrBadAnswer
			}
		}
		if late > Grace && gr.Given == nil {
			res.TimedOut = true // only an answer is taken late: no answer late is the time run out (late.go)
		}
		inRow := 0
		if gr.Right {
			if inRow, err = rightsInRow(tx, r); err != nil {
				return err
			}
			inRow++
		}
		if inRow > 1 {
			res.InRow = inRow
		}
		number := d.Question().Base().Type == "number"
		if err := g.record(tx, r, gr, number, min(took, limit).Milliseconds()); err != nil {
			return err
		}
		if late > Grace && !res.TimedOut {
			if err := keepLate(tx, r.id, n, late, at); err != nil {
				return err
			}
		}
		res.Score, res.Right, res.Exact, res.Given = gr.Score, gr.Right, gr.Exact, gr.Shown
		res.State, err = g.state(tx, r)
		return err
	})
	if err != nil {
		return res, err
	}
	// How other players answered it: counted once the answer is kept, outside the write, which it never waits on. The
	// answer is kept whatever happens here: a count that fails shows none.
	crowd, err := g.crowdOf(ctx, g.DB.Read, r, d.Question())
	if err != nil {
		slog.Warn("counting a question's crowd", "question", d.Question().Base().ID, "err", err)
	}
	res.Reveal = bank.RevealOn(d, crowd, r.dealtOn())
	if finished {
		g.finished(ctx, userID, runID)
	}
	return res, nil
}

// again is an answer to question n, the run's last answered, sent again: its reply was lost on the way, so the screen
// never showed it. What it gets is what the answer taken the first time got (its verdict, the answer and its fact),
// and the run as it stands; nothing changes. A question that ran out of time, or was given up on, gives
// that: no answer, and timed out if its time ran out.
func (g *Game) again(tx *sql.Tx, r *run, n int) (Result, bank.Dealt, error) {
	var res Result
	d, ok := g.deal(r.picks[n])
	if !ok {
		return res, nil, ErrOutOfStep
	}
	var given, shown sql.NullString
	var ms int64
	err := tx.QueryRow(`SELECT given, shown, score, is_right, ms FROM answers WHERE run_id = ? AND n = ?`, r.id, n).
		Scan(&given, &shown, &res.Score, &res.Right, &ms)
	if errors.Is(err, sql.ErrNoRows) {
		return res, nil, ErrOutOfStep
	}
	if err != nil {
		return res, nil, err
	}
	took := time.Duration(ms) * time.Millisecond
	if given.Valid {
		res.Given = json.RawMessage(shown.String)
		if gr, err := bank.GradeAt(d, json.RawMessage(given.String), took); err == nil {
			res.Exact = gr.Exact
		}
	} else {
		res.TimedOut = took >= Limit(d.Question())
	}
	if res.Right {
		inRow, err := rightsInRow(tx, r) // the run's last answer: the row it made
		if err != nil {
			return res, nil, err
		}
		if inRow > 1 {
			res.InRow = inRow
		}
	}
	res.State, err = g.state(tx, r)
	return res, d, err
}

// newSeed is a deal's seed.
func newSeed() uint64 { return rand.Uint64() }

// Reviewed is a question of a finished run, gone over: as it was shown, its answer, and what the player gave.
type Reviewed struct {
	N        int             `json:"n"`
	Category string          `json:"category"`
	View     any             `json:"view"`
	Reveal   any             `json:"reveal"`
	Given    json.RawMessage `json:"given"` // as shown; null: no answer
	Right    bool            `json:"right"`
	Close    bool            `json:"close,omitempty"`
	// Void is an answer to a question that counts for nobody (day.go): in no score.
	Void bool `json:"void,omitempty"`
}

// Review goes over a finished run, question by question (an unfinished one would give answers away), on its own day
// only (ErrReviewOver after): a game is gone over right after it, not looked up again days later (the owner's call,
// 19 Nov 2026: past days' questions aren't kept to go back to).
func (g *Game) Review(ctx context.Context, userID, runID int64) ([]Reviewed, error) {
	r, err := scanRun(g.DB.Read.QueryRowContext(ctx, `SELECT `+runColumns+` FROM runs WHERE id = ? AND user_id = ?`, runID, userID))
	if err != nil {
		return nil, err
	}
	if !r.finished {
		return nil, ErrOutOfStep
	}
	var ended int64
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT finished_at FROM runs WHERE id = ?`, r.id).Scan(&ended); err != nil {
		return nil, err
	}
	// Until the end of the day it ended on, in Bulgaria, and DayGrace at least: one ended at 23:59 is gone over after.
	_, dayEnd := dayBounds(dayOf(time.UnixMilli(ended)))
	if now := store.Ms(g.Now()); now >= max(dayEnd, ended+DayGrace.Milliseconds()) {
		return nil, ErrReviewOver
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT n, shown, score, is_right FROM answers WHERE run_id = ? ORDER BY n`, r.id)
	if err != nil {
		return nil, err
	}
	var all []Reviewed
	for rows.Next() {
		var it Reviewed
		var shown sql.NullString
		var score float64
		if err := rows.Scan(&it.N, &shown, &score, &it.Right); err != nil {
			rows.Close()
			return nil, err
		}
		it.Close = closeAnswer(score, it.Right)
		it.Given = json.RawMessage("null")
		if shown.Valid {
			it.Given = json.RawMessage(shown.String)
		}
		all = append(all, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []Reviewed{}
	for _, it := range all {
		d, ok := g.deal(r.picks[it.N])
		if !ok {
			continue // gone from the bank since
		}
		crowd, err := g.crowdOf(ctx, g.DB.Read, r, d.Question())
		if err != nil {
			return nil, err
		}
		it.Category, it.View, it.Reveal = d.Question().Base().Category, d.View(), bank.RevealOn(d, crowd, r.dealtOn())
		it.Void = r.picks[it.N].Void
		out = append(out, it)
	}
	return out, nil
}
