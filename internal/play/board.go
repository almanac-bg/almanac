package play

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"slices"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// A day's board is everyone who finished the day, and Начало shows it to each player who opens it: counted for each,
// it would cost as much as the day has players, every time. So it's counted once and kept a little while for all
// (boardCache), and each viewer's own game is set into it exactly, whenever it finished: a player who has just
// played sees their result and place at once; only the others' come in a moment later.
//
// A day's board ranks by right answers, then points, then time: players tell their day as „8 от 10“, so nine right
// are never under eight. Points decide among the same right answers, which is what they're for (worth.go). Other
// games keep their own order: duels by points, Роял by right answers and time (royal.go).

// BoardTop is how many of the best a board shows.
const BoardTop = 20

var (
	// boardPatience and boardStale are how long a day's board is kept before it's counted again: boardPatience times
	// as long as counting it took, so that counting takes a small share of the server's time however big the day
	// grows, and boardStale at most. A small day is counted again almost at once, a big one once in a while.
	boardPatience = 20
	boardStale    = 2 * time.Second
)

// Score is one player's result on a board.
type Score struct {
	Name   string `json:"name"`
	Tag    string `json:"tag,omitempty"`
	Points int    `json:"points"`
	Rights int    `json:"rights"`
	// Of is how many questions the right answers are out of: the day's that count (day.go).
	Of int   `json:"of"`
	Ms int64 `json:"ms"`
	Me bool  `json:"me,omitempty"`
	Look
	// Trail is how each of the ten went, on the friends' board once the viewer has finished the day (FriendsBoard).
	Trail []Mark `json:"trail,omitempty"`
}

// Board is a day's results: the best, and the viewer's place among everyone. A game played at a script's speed is on
// it for its player alone (fairFor): they see it with the others, and their place among them as if it counted.
type Board struct {
	Day     string `json:"day"`
	Players int    `json:"players"`
	// Of is how many of the day's questions count (day.go): what its results and Average are out of.
	Of  int     `json:"of"`
	Top []Score `json:"top"`
	// Place is the viewer's (1 for the best), 0 if they haven't finished the day.
	Place int    `json:"place,omitempty"`
	Mine  *Score `json:"mine,omitempty"`
	// Average is the right answers of the day's ten on average, to a tenth, once DayCrowdFrom have finished it (0
	// before): what tells a player whether their eight is good today.
	Average float64 `json:"average,omitempty"`
}

// BoardOf reads a day's board for a viewer (0: nobody signed in).
func (g *Game) BoardOf(ctx context.Context, day string, viewer int64) (Board, error) {
	d, err := g.dayBoard(ctx, day)
	if err != nil {
		return Board{}, err
	}
	b := Board{Day: day, Players: len(d.runs), Of: d.of, Top: make([]Score, len(d.top), BoardTop)}
	if len(d.runs) >= DayCrowdFrom {
		b.Average = math.Round(10*float64(d.rights)/float64(len(d.runs))) / 10
	}
	for i, s := range d.top {
		s.Me = d.users[i] == viewer
		b.Top[i] = s
	}
	if viewer == 0 {
		return b, nil
	}
	var mine Score
	var r boardRun
	var avatar, title string
	var points int
	err = g.DB.Read.QueryRowContext(ctx, `SELECT r.id, u.name, u.tag, r.points, r.rights, `+countedOf("r.questions")+`, r.ms,
			`+lookColumns+`
		FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind = 'day' AND r.day = ? AND r.user_id = ? AND r.finished_at IS NOT NULL`, day, viewer).
		Scan(&r.id, &mine.Name, &mine.Tag, &mine.Points, &mine.Rights, &mine.Of, &mine.Ms, &avatar, &title, &points)
	if errors.Is(err, sql.ErrNoRows) {
		return b, nil
	}
	if err != nil {
		return b, err
	}
	mine.Me, mine.Look = true, g.lookOf(viewer, avatar, title, points)
	b.Mine = &mine
	r.rights, r.points, r.ms = mine.Rights, mine.Points, mine.Ms
	// Their place: after everyone ahead of them in the count, which has them already, or not yet: finished since, or
	// played at a script's speed (counted for nobody else). Then they're set in as the count would have them.
	at := sort.Search(len(d.runs), func(i int) bool { return !d.runs[i].ahead(r) })
	b.Place = at + 1
	if at < len(d.runs) && d.runs[at].id == r.id {
		return b, nil
	}
	b.Players++
	if at < BoardTop {
		b.Top = slices.Insert(b.Top, at, mine)
		b.Top = b.Top[:min(len(b.Top), BoardTop)]
	}
	return b, nil
}

// dayBoard is a day's board as last counted, counted again if it's due: by one at a time, while the others are
// shown the last count (only the first count of a day is waited for).
func (g *Game) dayBoard(ctx context.Context, day string) (*countedBoard, error) {
	e := g.boards.entry(day)
	last := e.board.Load()
	if last != nil && !last.due() {
		return last, nil
	}
	if last != nil {
		if !e.counting.TryLock() {
			return last, nil
		}
	} else {
		e.counting.Lock()
	}
	defer e.counting.Unlock()
	if last = e.board.Load(); last != nil && !last.due() { // counted while this one waited
		return last, nil
	}
	d, err := g.countBoard(ctx, day)
	if err != nil {
		return nil, err
	}
	e.board.Store(d)
	return d, nil
}

// countBoard counts a day's board: every fair game of it finished, in order, and the best with who played them, in
// one read so that the two agree.
func (g *Game) countBoard(ctx context.Context, day string) (*countedBoard, error) {
	start := time.Now()
	tx, err := g.DB.Read.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck // a read: nothing to keep
	d := &countedBoard{}
	d.of = Length
	err = tx.QueryRowContext(ctx, `SELECT `+countedOf("questions")+` FROM days WHERE day = ?`, day).Scan(&d.of)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, rights, points, ms FROM runs WHERE kind = 'day' AND day = ?
		AND finished_at IS NOT NULL AND NOT shadow ORDER BY `+dayOrder, day)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r boardRun
		if err := rows.Scan(&r.id, &r.rights, &r.points, &r.ms); err != nil {
			rows.Close()
			return nil, err
		}
		d.runs, d.rights = append(d.runs, r), d.rights+r.rights
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = tx.QueryContext(ctx, `SELECT u.id, u.name, u.tag, r.points, r.rights, `+countedOf("r.questions")+`, r.ms,
			`+lookColumns+`
		FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind = 'day' AND r.day = ? AND r.finished_at IS NOT NULL AND NOT r.shadow
		ORDER BY `+dayOrderOf("r")+` LIMIT ?`, day, BoardTop)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var s Score
		var avatar, title string
		var points int
		if err := rows.Scan(&id, &s.Name, &s.Tag, &s.Points, &s.Rights, &s.Of, &s.Ms, &avatar, &title, &points); err != nil {
			return nil, err
		}
		s.Look = g.lookOf(id, avatar, title, points)
		d.top, d.users = append(d.top, s), append(d.users, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	d.counted, d.took = time.Now(), time.Since(start)
	return d, nil
}

// countedBoard is a day's board as counted: its fair games finished, best first, and the best of them as shown.
type countedBoard struct {
	counted time.Time     // when, by the machine's clock (not the game's: it's about the server's time)
	took    time.Duration // how long counting it took
	of      int           // the day's questions that count (day.go)
	runs    []boardRun
	rights  int // the right answers of all of them
	top     []Score
	users   []int64 // who played each of top
}

// due says whether a board is old enough to be counted again (boardPatience).
func (d *countedBoard) due() bool {
	return time.Since(d.counted) >= min(boardStale, time.Duration(boardPatience)*d.took)
}

// dayOrder is the order of a day's board, in SQL over runs (ahead says the same in Go): more right answers, then more
// points, then quicker, then the earlier started. dayOrderOf is it for runs under another name.
var dayOrder = dayOrderOf("")

func dayOrderOf(runs string) string {
	if runs != "" {
		runs += "."
	}
	return runs + "rights DESC, " + runs + "points DESC, " + runs + "ms, " + runs + "id"
}

// boardRun is a game on a board, as far as its place goes.
type boardRun struct {
	id     int64
	rights int
	points int
	ms     int64
}

// ahead says whether a game is ahead of another on a day's board (dayOrder): more right answers, then more points,
// then quicker, then the earlier started.
func (r boardRun) ahead(o boardRun) bool {
	if r.rights != o.rights {
		return r.rights > o.rights
	}
	if r.points != o.points {
		return r.points > o.points
	}
	if r.ms != o.ms {
		return r.ms < o.ms
	}
	return r.id < o.id
}

// boardCache keeps each day's board as last counted, for the days asked for lately.
type boardCache struct {
	mu sync.Mutex
	by map[string]*boardEntry
}

type boardEntry struct {
	counting sync.Mutex // held while the day is counted: one count at a time
	board    atomic.Pointer[countedBoard]
	asked    time.Time
}

// boardForget is how long a day's board is kept once nobody asks for it.
const boardForget = 10 * time.Minute

func (c *boardCache) entry(day string) *boardEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	e := c.by[day]
	if e == nil {
		if c.by == nil {
			c.by = map[string]*boardEntry{}
		}
		for d, old := range c.by {
			if now.Sub(old.asked) > boardForget {
				delete(c.by, d)
			}
		}
		e = &boardEntry{}
		c.by[day] = e
	}
	e.asked = now
	return e
}
