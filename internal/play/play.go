// Package play is the game: runs through a set of questions (the day's, a topic's, „България“'s: bulgaria.go), one
// question at a time, against the server's clock; duels, and the games played in a room (rooms.go), kept as runs;
// friends.
//
// A question's time runs only while it's shown: Show starts it, Answer stops it. A question with pictures waits for
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
// throwaway guest who played it before a player on the same network; a game keeps that network for a week, and two
// players of one network move no rating between them (fair.go).
//
// A run played live (a live duel's, a Роял's) moves on its game's clock alone (driver): the game shows each question
// and takes each answer (ShowLive and AnswerLive, ShowRoyal and AnswerRoyal: graded through the deal it shows), and
// the player's own Show, Start and Answer refuse it, so that nobody sees a question before the others do, nor answers
// it outside its time. An answer counts if it reaches the server within Grace of its time's end; its time is to when
// it arrived, from when the player's own screen showed the question, as it says, within bounds (seen.go).
//
// No game deals a player again what they've played, in any game, while the bank has questions they haven't: a topic's,
// a duel's (live, a rematch, a friend's challenge), a room's and Роял's are drawn for all their players, those none of
// them has seen first, then those the fewest have (choose, seenAmong); a recording is a game with few of its questions
// seen. Three repeat by design: the day (the same ten for everyone), Втори шанс (what the player missed) and a
// challenge taken (the sender's ten). TestNothingPlayedAgain holds it, for every way a game starts.
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
	"sync"
	"time"
	_ "time/tzdata" // Bulgaria's days, wherever the server runs

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

const (
	// Length is how many questions a run has.
	Length = 10
	// MaxPoints is what a perfect, quick answer to a medium question is worth (an easy one's less, a hard one's more,
	// one in a row of right answers more: worth).
	MaxPoints = 1000
	// Grace is how late an answer may arrive and still count: the trip from the player's screen to the server, on a
	// slow phone's line too.
	Grace = 2 * time.Second
	// PictureWait is the longest a question's time waits for its pictures to come in (four of them, on a slow line),
	// and so the most anyone gets to look before it runs.
	PictureWait = 8 * time.Second
)

// Limit is how long a question is shown before its time runs out: a statement to judge true or not is quick;
// putting four things in order, or joining four pairs, takes longer than a tap or a typed number: both get the same time.
func Limit(q bank.Question) time.Duration {
	switch q.Base().Type {
	case "truefalse":
		return 10 * time.Second
	case "order", "match", "split", "clues":
		return LongestLimit
	}
	return 20 * time.Second
}

// LongestLimit is the longest any question is shown (Limit).
const LongestLimit = 30 * time.Second

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
	// DuelNews, if set, is told of a duel to tell a player about: a friend asks, a result (a push, say).
	DuelNews func(context.Context, DuelNews)
	// RoyalNews, if set, is told of each place when a tournament ends.
	RoyalNews func(context.Context, RoyalNews)
	// RoyalAt, if set, is when the next Роял starts after a moment: a day's goals draw Роял only while it's ahead.
	RoyalAt func(time.Time) time.Time
	// LeagueNews, if set, is told of every place when a week of the leagues ends, inside the write that keeps those
	// places (closeGroups): what it keeps there (a notification queued) is kept with them, or not at all.
	LeagueNews func(context.Context, *sql.Tx, []LeagueNews) error
	// MistakesAfter is how long a missed question waits for its second chance (MistakesAfter when 0; the browser
	// tests make it seconds).
	MistakesAfter time.Duration
	// CrowdMin, if set, is how many answers a question needs before how players answered it shows, the day's
	// players' and everyone's (CrowdFrom, DayCrowdFrom when 0; the browser tests make it 1).
	CrowdMin int
	// Version is the game's version as released (the server's; "" in tests and a developer's build): the version a
	// player met is kept with them on their first day played (users.first_version, retention.go).
	Version string

	weekMu sync.RWMutex // held while a week of the leagues closes (ensureWeek); read while a player joins one
	week   string       // the leagues' week open, once ensureWeek has seen it

	paceMu sync.Mutex
	pace   RoyalPace // how often Роял plays, as of paceDay (RoyalPaceOf)
	paceOn string

	hard      snapshot[*hardnesses] // how hard each question is (mastery.go)
	crowds    snapshot[crowds]      // how players have answered each question (crowd.go)
	dayCrowds dayCrowdCache         // how the day's players have answered its questions (crowd.go)
	boards    boardCache            // the days' boards (board.go)
	daysAhead daysCache             // today's questions and the days ahead's (ahead.go)
	known     snapshot[knowledge]   // everyone's answers, for the boards of knowledge (knowledge.go)
	versions  versions              // the questions' versions kept (versions.go)

	later  laters                  // what follows the runs just finished, under way (after.go)
	skills memo[skillsKey, skills] // each player's abilities, kept while their games stand (memo.go)
	misses memo[[2]int64, [2]int]  // what each player's mistakes make of a second chance (mistakes.go)
}

func New(db *store.DB, b func() *bank.Bank) *Game {
	return &Game{DB: db, Bank: b, Now: time.Now}
}

// Today is the day it is in Bulgaria, as the days are kept (2026-11-12).
func (g *Game) Today() string { return g.Now().In(Bulgaria).Format(time.DateOnly) }

// Pick is a question as a run holds it: which one, how it's dealt, and, once it's shown, which version of it showed
// (bank.Version: versions.go) and how hard it was then; the day's ten hold those from the day's start (day.go).
type Pick struct {
	ID   string `json:"id"`
	Seed uint64 `json:"seed"`
	V    string `json:"v,omitempty"`
	// D is the difficulty the question pays at (worth): its label as it showed, so that one relabelled meanwhile pays
	// the same for the same answer.
	D bank.Difficulty `json:"d,omitempty"`
	// Void is a question of the day's ten that counts for nobody that day (day.go): found untrue, or changed, while
	// the day was played.
	Void bool `json:"void,omitempty"`
}

// run is a run as the database has it.
type run struct {
	id, userID     int64
	kind           string
	day, category  string
	picks          []Pick
	at             int
	shownAt        sql.NullInt64
	points, rights int
	xp             int
	ms             int64
	finished       bool
	shadow         bool // counts for its player alone (fair.go)
}

const runColumns = `id, user_id, kind, coalesce(day, ''), coalesce(category, ''), questions,
	at, shown_at, points, rights, xp, ms, finished_at IS NOT NULL, shadow <> 0`

type scanner interface{ Scan(...any) error }

func scanRun(row scanner) (*run, error) {
	var r run
	var picks string
	err := row.Scan(&r.id, &r.userID, &r.kind, &r.day, &r.category, &picks,
		&r.at, &r.shownAt, &r.points, &r.rights, &r.xp, &r.ms, &r.finished, &r.shadow)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoRun
	}
	if err != nil {
		return nil, err
	}
	return &r, json.Unmarshal([]byte(picks), &r.picks)
}

// driver is who moves a run on: its player (Show, Start, Answer), or the live game it's played in, on that game's
// clock: its live duel (ShowLive, AnswerLive) or its Роял (ShowRoyal, AnswerRoyal).
type driver int

const (
	byPlayer driver = iota
	byDuel
	byRoyal
)

// driver says who moves a run on. A live duel's run is its duel's for good: one cut off (the server restarted under
// it) stays where it stopped, never played on alone, as its duel ended without a result.
func (r *run) driver(tx *sql.Tx) (driver, error) {
	switch r.kind {
	case "royal":
		return byRoyal, nil
	case "duel":
		var live bool
		err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM duels WHERE kind = 'live' AND (a_run = ?1 OR b_run = ?1))`,
			r.id).Scan(&live)
		if live {
			return byDuel, err
		}
		return byPlayer, err
	}
	return byPlayer, nil
}

// loadBy reads a player's run that by moves on: another's (a live game's, when by is its player) is out of step, and
// a day's whose day is over (dayOver) is over.
func (g *Game) loadBy(tx *sql.Tx, userID, runID int64, by driver) (*run, error) {
	r, err := load(tx, userID, runID)
	if err != nil {
		return nil, err
	}
	d, err := r.driver(tx)
	if err != nil {
		return nil, err
	}
	if d != by {
		return nil, ErrOutOfStep
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
// a question shown just before it ends (dayOver). Whatever is counted by the day waits for it: the week of the
// leagues closes after it (ensureWeek), so that a day run finished after midnight counts in its own week.
const dayLate = DayGrace + LongestLimit + Grace

// dayOver is whether a run of the day's questions can't be played on any more: its day ended DayGrace ago, and no
// question shown before then is still in its time. It stays as it was left: unfinished, it counts for nothing (the
// streak, the day's board, the week's league), and nothing more of it shows. So a day can't be kept open (a run
// started and left) and played days later, its answers known by then, to keep a streak or move a past board.
func (r *run) dayOver(now time.Time) bool {
	if r.kind != "day" || r.finished {
		return false
	}
	_, end := dayBounds(r.day)
	closes := time.UnixMilli(end).Add(DayGrace)
	if shown := time.UnixMilli(r.shownAt.Int64); r.shownAt.Valid && shown.Before(closes) &&
		shown.Add(LongestLimit+Grace).After(closes) {
		closes = shown.Add(LongestLimit + Grace)
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
	Points int `json:"points"`
	Rights int `json:"rights"`
	// AllRight is what the game earned at its end for every answer right (in Points), once it's done.
	AllRight int `json:"allRight,omitempty"`
	// Trail is how each answered question went, in order.
	Trail []Mark `json:"trail"`
	// Question is the one shown now, if one is.
	Question *Shown `json:"question,omitempty"`
	Done     bool   `json:"done"`
}

// Mark is how one answer went, or that its question counts for nobody (Void: day.go), answered or not.
type Mark struct {
	Points  int  `json:"points"`
	Right   bool `json:"right"`
	Partial bool `json:"partial,omitempty"`
	Void    bool `json:"void,omitempty"`
}

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

// Result is what an answer earned, the answer itself, and the run after it.
type Result struct {
	Points int `json:"points"`
	// Speed is how many of the points were for being quick. InRow is how many right answers in a row the answer
	// makes, from 2: heard and seen as the run's climb, worth no points (worth.go).
	Speed    int     `json:"speed,omitempty"`
	InRow    int     `json:"inRow,omitempty"`
	Score    float64 `json:"score"`
	Right    bool    `json:"right"`
	Exact    bool    `json:"exact,omitempty"`
	TimedOut bool    `json:"timedOut,omitempty"`
	// Learned is a second chance taken (mistakes.go): the first right answer to the question, so its fact is in the
	// Almanac now.
	Learned bool `json:"learned,omitempty"`
	// Given is the answer as it shows (the player's screen has it already).
	Given  json.RawMessage `json:"-"`
	Reveal any             `json:"reveal"`
	State  State           `json:"state"`
}

// state builds what a player sees of a run.
func (g *Game) state(tx *sql.Tx, r *run) (State, error) {
	s := State{
		ID: r.id, Kind: r.kind, Day: r.day, Category: r.category, Total: len(r.picks), Void: len(r.picks) - r.counted(),
		At: r.at, Points: r.points, Rights: r.rights, Done: r.finished,
	}
	if r.finished && r.allRight() {
		s.AllRight = AllRight
	}
	rows, err := tx.Query(`SELECT n, points, is_right FROM answers WHERE run_id = ? ORDER BY n`, r.id)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	var marks []markAt
	for rows.Next() {
		var a markAt
		if err := rows.Scan(&a.n, &a.m.Points, &a.m.Right); err != nil {
			return s, err
		}
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
	err := g.record(tx, r, bank.Graded{}, Worth{}, ms)
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
	late := Limit(d.Question()) + Grace
	if r.kind == "duel" || r.kind == "royal" { // a live game's may be timed from its player's screen (LiveDue)
		late += LagOf(d.Question())
	}
	return g.Now().Sub(time.UnixMilli(r.shownAt.Int64)) > late
}

// record keeps an answer, and the points and XP it earned, and moves the run to the next question (or its end).
func (g *Game) record(tx *sql.Tx, r *run, gr bank.Graded, w Worth, ms int64) error {
	var given, shown any
	if gr.Given != nil {
		given, shown = string(gr.Given), string(gr.Shown)
	}
	now := store.Ms(g.Now())
	p := r.picks[r.at]
	if _, err := tx.Exec(`INSERT INTO answers (run_id, n, question_id, given, shown, score, points, is_right, ms, at, version)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, r.at, p.ID, given, shown, gr.Score, w.Points, gr.Right, ms, now,
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
	r.at++
	r.points += w.Points
	r.xp += xp(gr)
	if gr.Right {
		r.rights++
	}
	r.ms += ms
	r.shownAt = sql.NullInt64{}
	r.skipVoid()
	// A Роял run goes on after a wrong answer: who goes on is the tournament's to say, at its cuts (RevealRoyal).
	if r.at >= len(r.picks) {
		return g.finish(tx, r)
	}
	_, err := tx.Exec(`UPDATE runs SET at = ?, shown_at = NULL, points = ?, rights = ?, xp = ?, ms = ? WHERE id = ?`,
		r.at, r.points, r.rights, r.xp, r.ms, r.id)
	return err
}

// finish ends a run where it is: what playing it to its end earns, and a game right throughout its bonus; and notes
// that what follows it is due (after.go), but for a Роял's, whose evening keeps what it earned (AfterRoyal).
func (g *Game) finish(tx *sql.Tx, r *run) error {
	if err := g.finishOf(tx, r, r.counted()); err != nil {
		return err
	}
	if r.kind == "royal" {
		return nil
	}
	return g.afterDue(tx, r.id)
}

// finishOf ends a run as a game of total questions: what playing it to its end earns is in the share of those answered
// right (a Роял won before its last question was a game of the questions it asked).
func (g *Game) finishOf(tx *sql.Tx, r *run, total int) error {
	r.finished = true
	r.xp += finishXP(r.kind, r.rights, total)
	if r.allRight() {
		r.points += AllRight
	}
	_, err := tx.Exec(`UPDATE runs SET at = ?, shown_at = NULL, points = ?, rights = ?, xp = ?, ms = ?, finished_at = ?
		WHERE id = ?`, r.at, r.points, r.rights, r.xp, r.ms, store.Ms(g.Now()), r.id)
	return err
}

// allRight is whether a run went through all of its questions, each that counts answered right.
func (r *run) allRight() bool {
	return r.at == len(r.picks) && r.counted() > 0 && r.rights == r.counted()
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
// with pictures, PictureWait later at most (Start). A run a live game moves on is out of step (driver).
func (g *Game) Show(ctx context.Context, userID, runID int64) (State, error) {
	var s State
	ended := false
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		r, err := g.loadBy(tx, userID, runID, byPlayer)
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

// ShowLive puts question n of a live duel's run on screen, as the duel deals it (d: the version it shows, whatever the
// bank has become since the duel began), its time starting at at: the duel's own moment for it, the same for both
// players, pictures or not (the duel keeps the time). It's out of step if the run isn't at n, or d isn't its question.
func (g *Game) ShowLive(ctx context.Context, userID, runID int64, n int, at time.Time, d bank.Dealt) error {
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		r, err := g.loadBy(tx, userID, runID, byDuel)
		if err != nil {
			return err
		}
		if r.finished || r.at != n || d == nil || d.Question().Base().ID != r.picks[n].ID {
			return ErrOutOfStep
		}
		return r.showAt(tx, at, d)
	})
}

// Start starts the time of question n, shown and waiting for its pictures, now that the player's screen has them in.
func (g *Game) Start(ctx context.Context, userID, runID int64, n int) (State, error) {
	var s State
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		r, err := g.loadBy(tx, userID, runID, byPlayer)
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
// which version of it shows (Pick.V), so that it's graded against that one, whatever the bank becomes meanwhile, and
// how hard it is (Pick.D), so that it pays as it showed. A pick that holds them already (the day's, from the day's
// start) keeps them.
func (r *run) showAt(tx *sql.Tx, t time.Time, d bank.Dealt) error {
	if d == nil {
		return r.startAt(tx, t)
	}
	p := &r.picks[r.at]
	v, level := bank.Version(d.Question()), d.Question().Base().Difficulty
	if v == p.V && p.D != "" {
		return r.startAt(tx, t)
	}
	at := store.Ms(t)
	path := "$[" + strconv.Itoa(r.at) + "]"
	if _, err := tx.Exec(`UPDATE runs SET shown_at = ?, questions = json_set(questions, ?, ?, ?, ?) WHERE id = ?`,
		at, path+".v", v, path+".d", string(level), r.id); err != nil {
		return err
	}
	p.V, p.D = v, level
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
// answered is one sent again, its reply lost on the way (a line that dropped, a server restarting): it gets the answer
// taken the first time, as it was, and changes nothing (again). One before the question's time runs (still waiting for
// its pictures), or to a run a live game moves on (driver), is out of step.
func (g *Game) Answer(ctx context.Context, userID, runID int64, n int, answer json.RawMessage) (Result, error) {
	return g.answer(ctx, userID, runID, n, answer, g.Now(), time.Time{}, byPlayer, nil)
}

// AnswerLive grades a player's answer to question n of their live duel, which arrived at at, against the question as
// the duel shows it (d): its time is from when the player's screen showed it (saw: Saw; zero, not said: from the
// duel's moment) to when it came, whatever it waited for after (the duel busy with the other's answer).
func (g *Game) AnswerLive(ctx context.Context, userID, runID int64, n int, answer json.RawMessage, at, saw time.Time, d bank.Dealt) (Result, error) {
	return g.answer(ctx, userID, runID, n, answer, at, saw, byDuel, d)
}

// answer grades an answer that arrived at at, to a run that by moves on: its player's, or the live game's it's played
// in, which keeps its pace (and takes an answer sent again itself), and grades against the deal it shows (shown); its
// time runs from when the player's screen showed it (saw: seen.go). Otherwise it's graded against the version the
// run showed (Pick.V).
func (g *Game) answer(ctx context.Context, userID, runID int64, n int, answer json.RawMessage, at, saw time.Time, by driver, shown bank.Dealt) (Result, error) {
	var res Result
	var r *run
	var d bank.Dealt
	finished := false
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if r, err = g.loadBy(tx, userID, runID, by); err != nil {
			return err
		}
		if n == r.at-1 && by == byPlayer {
			res, d, err = g.again(tx, r, n)
			return err
		}
		if r.finished || n != r.at || r.voidNow() {
			return ErrOutOfStep
		}
		defer func() { finished = r.finished }()
		ok := false
		if shown != nil {
			d, ok = shown, shown.Question().Base().ID == r.picks[r.at].ID
		} else {
			d, ok = g.deal(r.picks[r.at])
		}
		if !ok || !r.shownAt.Valid {
			return ErrOutOfStep
		}
		// The time on the game's clock (a clue's worth goes by it), and the player's own: in a live game, from when
		// their screen showed the question (seen.go).
		shownAt := time.UnixMilli(r.shownAt.Int64)
		since := at.Sub(shownAt)
		if since < 0 && by == byPlayer { // still waiting for its pictures: its words aren't on screen yet
			return ErrOutOfStep
		}
		since = max(0, since)
		limit := Limit(d.Question())
		took, due := since, shownAt.Add(limit)
		if by != byPlayer {
			took, due = LiveTook(shownAt, saw, at), LiveDue(shownAt, saw, d.Question())
		}
		var gr bank.Graded
		switch {
		case at.Sub(due) > Grace:
			res.TimedOut = true
		case len(answer) == 0 || string(answer) == "null":
		default:
			if gr, err = bank.GradeAt(d, answer, since); err != nil {
				return ErrBadAnswer
			}
		}
		inRow := 0
		if gr.Right {
			if inRow, err = rightsInRow(tx, r); err != nil {
				return err
			}
			inRow++
		}
		w := r.picks[r.at].worth(d.Question(), gr.Score, took)
		res.Points, res.Speed = w.Points, w.Speed
		if inRow > 1 {
			res.InRow = inRow
		}
		if err := g.record(tx, r, gr, w, min(took, limit).Milliseconds()); err != nil {
			return err
		}
		res.Score, res.Right, res.Exact, res.Given = gr.Score, gr.Right, gr.Exact, gr.Shown
		res.Learned = r.kind == "mistakes" && gr.Right && d.Question().Extra().Fact != ""
		res.State, err = g.state(tx, r)
		return err
	})
	if err != nil {
		return res, err
	}
	if by == byRoyal {
		// Роял shows the answer and its crowd to everyone at once, and keeps what a game earned off its clock
		// (AfterRoyal).
		return res, nil
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
// never showed it. What it gets is what the answer taken the first time got (its points, its verdict, the answer and
// its fact), and the run as it stands; nothing changes. A question that ran out of time, or was given up on, gives
// that: no answer, and timed out if its time ran out.
func (g *Game) again(tx *sql.Tx, r *run, n int) (Result, bank.Dealt, error) {
	var res Result
	d, ok := g.deal(r.picks[n])
	if !ok {
		return res, nil, ErrOutOfStep
	}
	var given, shown sql.NullString
	var ms int64
	err := tx.QueryRow(`SELECT given, shown, score, points, is_right, ms FROM answers WHERE run_id = ? AND n = ?`, r.id, n).
		Scan(&given, &shown, &res.Score, &res.Points, &res.Right, &ms)
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
	// How the points were made up, as far as they can be worked out again (the time kept is to the end of the
	// question's time at most).
	if w := r.picks[n].worth(d.Question(), res.Score, took); w.Points == res.Points {
		res.Speed = w.Speed
	}
	res.Learned = r.kind == "mistakes" && res.Right && d.Question().Extra().Fact != ""
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
	Points   int             `json:"points"`
	Right    bool            `json:"right"`
	// Void is an answer to a question that counts for nobody (day.go): its points taken out.
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
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT n, shown, points, is_right FROM answers WHERE run_id = ? ORDER BY n`, r.id)
	if err != nil {
		return nil, err
	}
	var all []Reviewed
	for rows.Next() {
		var it Reviewed
		var shown sql.NullString
		if err := rows.Scan(&it.N, &shown, &it.Points, &it.Right); err != nil {
			rows.Close()
			return nil, err
		}
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
