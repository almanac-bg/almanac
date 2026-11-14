// Package play is the game: runs through a set of questions (the day's, a topic's), one question at a time, against
// the server's clock; duels kept as runs; friends.
//
// A question's time runs only while it's shown: Show starts it, Answer stops it. Between questions a player reads the
// answer and its fact for as long as they like. A question left showing past its time counts as unanswered, whenever
// the run is next looked at. Everything a run does goes through the database, so a refresh, a second tab or a
// restart of the server changes nothing.
package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math/rand/v2"
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
	// Grace is how late an answer may arrive and still count: the trip from the player's screen to the server.
	Grace = 2 * time.Second
)

// Limit is how long a question is shown before its time runs out: a statement to judge true or not is quick;
// putting four things in order, or joining four pairs, takes longer than a tap or a typed number: both get the same time.
func Limit(q bank.Question) time.Duration {
	switch q.Base().Type {
	case "truefalse":
		return 10 * time.Second
	case "order", "match":
		return 30 * time.Second
	}
	return 20 * time.Second
}

// Bulgaria is where the game's days begin and end.
var Bulgaria, _ = time.LoadLocation("Europe/Sofia")

// Errors a player may cause.
var (
	ErrNoRun      = errors.New("no such run")
	ErrNoTopic    = errors.New("no such topic")
	ErrOutOfStep  = errors.New("not the question now")
	ErrBadAnswer  = errors.New("an answer the question can't take")
	ErrNoQuestion = errors.New("no questions to play")
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
	// SeasonNews, if set, is told of each place when a season ends.
	SeasonNews func(context.Context, SeasonNews)

	seasonMu sync.Mutex
	season   string // the season being played, once ensureSeason has seen it

	hard   hardnessCache // how hard each question is (mastery.go)
	crowds crowdCache    // how players have answered each question (crowd.go)
}

func New(db *store.DB, b func() *bank.Bank) *Game {
	return &Game{DB: db, Bank: b, Now: time.Now}
}

// Today is the day it is in Bulgaria, as the days are kept (2026-11-12).
func (g *Game) Today() string { return g.Now().In(Bulgaria).Format(time.DateOnly) }

// Pick is a question as a run holds it: which one, and how it's dealt.
type Pick struct {
	ID   string `json:"id"`
	Seed uint64 `json:"seed"`
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
}

const runColumns = `id, user_id, kind, coalesce(day, ''), coalesce(category, ''), questions,
	at, shown_at, points, rights, xp, ms, finished_at IS NOT NULL`

type scanner interface{ Scan(...any) error }

func scanRun(row scanner) (*run, error) {
	var r run
	var picks string
	err := row.Scan(&r.id, &r.userID, &r.kind, &r.day, &r.category, &picks,
		&r.at, &r.shownAt, &r.points, &r.rights, &r.xp, &r.ms, &r.finished)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoRun
	}
	if err != nil {
		return nil, err
	}
	return &r, json.Unmarshal([]byte(picks), &r.picks)
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
	At       int    `json:"at"`
	Points   int    `json:"points"`
	Rights   int    `json:"rights"`
	// AllRight is what the game earned at its end for every answer right (in Points), once it's done.
	AllRight int `json:"allRight,omitempty"`
	// Trail is how each answered question went, in order.
	Trail []Mark `json:"trail"`
	// Question is the one shown now, if one is.
	Question *Shown `json:"question,omitempty"`
	Done     bool   `json:"done"`
}

// Mark is how one answer went.
type Mark struct {
	Points  int  `json:"points"`
	Right   bool `json:"right"`
	Partial bool `json:"partial,omitempty"`
}

// Shown is the question on screen, with the time it has left.
type Shown struct {
	N        int    `json:"n"`
	Category string `json:"category"`
	View     any    `json:"view"`
	LimitMs  int64  `json:"limitMs"`
	LeftMs   int64  `json:"leftMs"`
}

// Result is what an answer earned, the answer itself, and the run after it.
type Result struct {
	Points int `json:"points"`
	// Speed is how many of the points were for being quick, and Row how many for the right answers in a row InRow.
	Speed    int     `json:"speed,omitempty"`
	Row      int     `json:"row,omitempty"`
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

// deal finds a pick's question in the bank and deals it.
func (g *Game) deal(p Pick) (bank.Dealt, bool) {
	q, ok := g.Bank().Get(p.ID)
	if !ok {
		return nil, false
	}
	return q.Deal(p.Seed), true
}

// state builds what a player sees of a run.
func (g *Game) state(tx *sql.Tx, r *run) (State, error) {
	s := State{
		ID: r.id, Kind: r.kind, Day: r.day, Category: r.category,
		Total: len(r.picks), At: r.at, Points: r.points, Rights: r.rights, Done: r.finished, Trail: []Mark{},
	}
	if r.finished && r.allRight() {
		s.AllRight = AllRight
	}
	rows, err := tx.Query(`SELECT points, is_right FROM answers WHERE run_id = ? ORDER BY n`, r.id)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var m Mark
		if err := rows.Scan(&m.Points, &m.Right); err != nil {
			return s, err
		}
		m.Partial = m.Points > 0 && !m.Right
		s.Trail = append(s.Trail, m)
	}
	if err := rows.Err(); err != nil {
		return s, err
	}
	if r.shownAt.Valid && !r.finished {
		d, ok := g.deal(r.picks[r.at])
		if ok {
			limit := Limit(d.Question())
			left := limit - g.Now().Sub(time.UnixMilli(r.shownAt.Int64))
			s.Question = &Shown{
				N: r.at, Category: d.Question().Base().Category, View: d.View(),
				LimitMs: limit.Milliseconds(), LeftMs: max(0, left.Milliseconds()),
			}
		}
	}
	return s, nil
}

// settle counts a question whose time ran out as unanswered (or one gone from the bank as skipped), so the run can
// go on. It reports whether it moved the run.
func (g *Game) settle(tx *sql.Tx, r *run) (bool, error) {
	if r.finished || !r.shownAt.Valid {
		return false, nil
	}
	d, ok := g.deal(r.picks[r.at])
	if ok && g.Now().Sub(time.UnixMilli(r.shownAt.Int64)) <= Limit(d.Question())+Grace {
		return false, nil
	}
	ms := int64(0)
	if ok {
		ms = Limit(d.Question()).Milliseconds()
	}
	return true, g.record(tx, r, bank.Graded{}, Worth{}, ms)
}

// record keeps an answer, and the points and XP it earned, and moves the run to the next question (or its end).
func (g *Game) record(tx *sql.Tx, r *run, gr bank.Graded, w Worth, ms int64) error {
	var given, shown any
	if gr.Given != nil {
		given, shown = string(gr.Given), string(gr.Shown)
	}
	now := store.Ms(g.Now())
	if _, err := tx.Exec(`INSERT INTO answers (run_id, n, question_id, given, shown, score, points, is_right, ms, at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, r.at, r.picks[r.at].ID, given, shown, gr.Score, w.Points, gr.Right, ms, now); err != nil {
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
	// Роял: the first wrong answer (or the time running out) is the way out.
	r.finished = r.at >= len(r.picks) || (r.kind == "royal" && !gr.Right)
	var finishedAt any
	if r.finished {
		finishedAt = now
		r.xp += finishXP(r.kind)
		if r.allRight() {
			r.points += AllRight
		}
	}
	_, err := tx.Exec(`UPDATE runs SET at = ?, shown_at = NULL, points = ?, rights = ?, xp = ?, ms = ?, finished_at = ? WHERE id = ?`,
		r.at, r.points, r.rights, r.xp, r.ms, finishedAt, r.id)
	return err
}

// allRight is whether a run went through all of its questions, each answered right.
func (r *run) allRight() bool { return r.at == len(r.picks) && r.rights == len(r.picks) }

// rightsInRow is how many right answers a run's last ones are in a row.
func rightsInRow(tx *sql.Tx, runID int64) (int, error) {
	var n int
	err := tx.QueryRow(`SELECT count(*) FROM answers WHERE run_id = ?
		AND n > coalesce((SELECT max(n) FROM answers WHERE run_id = ? AND NOT is_right), -1)`, runID, runID).Scan(&n)
	return n, err
}

// State is a player's run as it stands.
func (g *Game) State(ctx context.Context, userID, runID int64) (State, error) {
	var s State
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		r, err := load(tx, userID, runID)
		if err != nil {
			return err
		}
		if _, err := g.settle(tx, r); err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, err
}

// Show puts the next question on screen and starts its time (the one already showing keeps its time).
func (g *Game) Show(ctx context.Context, userID, runID int64) (State, error) {
	var s State
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		r, err := load(tx, userID, runID)
		if err != nil {
			return err
		}
		if _, err := g.settle(tx, r); err != nil {
			return err
		}
		if r.kind == "royal" { // its questions show when the tournament shows them
			s, err = g.state(tx, r)
			return err
		}
		if !r.finished && !r.shownAt.Valid {
			now := store.Ms(g.Now())
			if _, err := tx.Exec(`UPDATE runs SET shown_at = ? WHERE id = ?`, now, r.id); err != nil {
				return err
			}
			r.shownAt = sql.NullInt64{Int64: now, Valid: true}
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, err
}

// Answer grades an answer to question n, the one showing. A null answer gives up on it.
func (g *Game) Answer(ctx context.Context, userID, runID int64, n int, answer json.RawMessage) (Result, error) {
	return g.answer(ctx, userID, runID, n, answer, false)
}

// answer grades an answer; a Роял run's only as its tournament's (royal), so that it keeps the tournament's pace.
func (g *Game) answer(ctx context.Context, userID, runID int64, n int, answer json.RawMessage, royal bool) (Result, error) {
	var res Result
	finished := false
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		r, err := load(tx, userID, runID)
		if err != nil {
			return err
		}
		if r.finished || n != r.at || (r.kind == "royal") != royal {
			return ErrOutOfStep
		}
		defer func() { finished = r.finished }()
		d, ok := g.deal(r.picks[r.at])
		if !ok || !r.shownAt.Valid {
			return ErrOutOfStep
		}
		took := g.Now().Sub(time.UnixMilli(r.shownAt.Int64))
		limit := Limit(d.Question())
		var gr bank.Graded
		switch {
		case took > limit+Grace:
			res.TimedOut = true
		case len(answer) == 0 || string(answer) == "null":
		default:
			if gr, err = d.Grade(answer); err != nil {
				return ErrBadAnswer
			}
		}
		inRow := 0
		if gr.Right {
			if inRow, err = rightsInRow(tx, r.id); err != nil {
				return err
			}
			inRow++
		}
		w := WorthOf(d.Question(), gr.Score, took, inRow)
		res.Points, res.Speed, res.Row = w.Points, w.Speed, w.Row
		if inRow > 1 {
			res.InRow = inRow
		}
		if err := g.record(tx, r, gr, w, min(took, limit).Milliseconds()); err != nil {
			return err
		}
		res.Score, res.Right, res.Exact, res.Given = gr.Score, gr.Right, gr.Exact, gr.Shown
		res.Reveal = d.Reveal(g.Crowd(d.Question().Base().ID))
		res.State, err = g.state(tx, r)
		return err
	})
	if err == nil && finished {
		// A duel's run settles the duel once both have played (and awards both); then what the run earned, before
		// the answer goes back, so that the screen with the result can tell of it.
		if err = g.settleRun(ctx, runID); err == nil {
			err = g.afterRun(ctx, userID)
		}
	}
	return res, err
}

// afterRun keeps what a player's game, just finished, earned them: achievements, and the day's goals.
func (g *Game) afterRun(ctx context.Context, userID int64) error {
	if _, err := g.Award(ctx, userID); err != nil {
		return err
	}
	_, err := g.GoalsOf(ctx, userID) // a goal done is kept, with its XP, whether or not the player looks
	return err
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
}

// Review goes over a finished run, question by question (an unfinished one would give answers away).
func (g *Game) Review(ctx context.Context, userID, runID int64) ([]Reviewed, error) {
	r, err := scanRun(g.DB.Read.QueryRowContext(ctx, `SELECT `+runColumns+` FROM runs WHERE id = ? AND user_id = ?`, runID, userID))
	if err != nil {
		return nil, err
	}
	if !r.finished {
		return nil, ErrOutOfStep
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT n, shown, points, is_right FROM answers WHERE run_id = ? ORDER BY n`, r.id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Reviewed{}
	for rows.Next() {
		var it Reviewed
		var shown sql.NullString
		if err := rows.Scan(&it.N, &shown, &it.Points, &it.Right); err != nil {
			return nil, err
		}
		d, ok := g.deal(r.picks[it.N])
		if !ok {
			continue // gone from the bank since
		}
		it.Category, it.View, it.Reveal = d.Question().Base().Category, d.View(), d.Reveal(g.Crowd(d.Question().Base().ID))
		it.Given = json.RawMessage("null")
		if shown.Valid {
			it.Given = json.RawMessage(shown.String)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}
