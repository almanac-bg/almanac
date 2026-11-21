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
// A day's board ranks by right answers, then by what breaks a tie between them (tiebreak): how close the hard number
// came. Players tell their day as „8 от 10“, so nine right are never under eight; there are no points, and time never
// counts (DECISIONS.md, „The direction“). Games still equal share a place (1, 2, 2, 4: placed), shown in an order
// that isn't speed: the viewer first among their equals, so that their own row is never behind one it ties with,
// then by the game (resultOrder). A duel is decided the same way, and is a draw where the board shares a place
// (duels.go).

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
	Rights int    `json:"rights"`
	// Of is how many questions the right answers are out of: the day's that count (day.go).
	Of int `json:"of"`
	// Place is the row's on its board (1 for the best), shared by games equal in right answers and what breaks a
	// tie (placed): BoardOf's top rows and FriendsBoard's.
	Place int  `json:"place,omitempty"`
	Me    bool `json:"me,omitempty"`
	Look
	// Trail is how each of the ten went, on either board once the viewer has finished the day (FriendsBoard,
	// BoardOf): the first BoardTop rows' and the viewer's own.
	Trail []Mark `json:"trail,omitempty"`

	tie tiebreak
}

// Board is a day's results: the best, and the viewer's place among everyone. A game played at a script's speed is on
// it for its player alone (fairFor): they see it with the others, and their place among them as if it counted.
type Board struct {
	Day     string `json:"day"`
	Players int    `json:"players"`
	// Of is how many of the day's questions count (day.go): what its results and Average are out of.
	Of  int     `json:"of"`
	Top []Score `json:"top"`
	// Place is the viewer's (1 for the best; shared with those equal to them: placed), 0 if they haven't finished the
	// day.
	Place int    `json:"place,omitempty"`
	Mine  *Score `json:"mine,omitempty"`
	// Average is the right answers of the day's ten on average, to a tenth, once DayCrowdFrom have finished it (0
	// before): what tells a player whether their eight is good today.
	Average float64 `json:"average,omitempty"`
	// Spread is how many played the day to each count of right answers, 0 to Of, once DayCrowdFrom have finished it:
	// the day's board draws it on the result's България tab. People only: a game played at a script's speed is in no
	// count.
	Spread []int `json:"spread,omitempty"`
}

// BoardOf reads a day's board for a viewer (0: nobody signed in), its rows placed.
func (g *Game) BoardOf(ctx context.Context, day string, viewer int64) (Board, error) {
	b, err := g.boardOf(ctx, day, viewer)
	placed(b.Top)
	return b, err
}

func (g *Game) boardOf(ctx context.Context, day string, viewer int64) (Board, error) {
	d, err := g.dayBoard(ctx, day)
	if err != nil {
		return Board{}, err
	}
	b := Board{Day: day, Players: len(d.runs), Of: d.of, Top: make([]Score, len(d.top), BoardTop)}
	if len(d.runs) >= DayCrowdFrom {
		b.Average = math.Round(10*float64(d.rights)/float64(len(d.runs))) / 10
		b.Spread = make([]int, d.of+1)
		for _, r := range d.runs {
			b.Spread[min(max(r.rights, 0), d.of)]++
		}
	}
	for i, s := range d.top {
		s.Me = d.users[i] == viewer
		s.Trail = nil // until the viewer has finished the day: then, as counted
		b.Top[i] = s
	}
	if viewer == 0 {
		return b, nil
	}
	var mine Score
	var r boardRun
	var avatar string
	err = g.DB.Read.QueryRowContext(ctx, `SELECT r.id, u.name, u.tag, r.rights, r.closeness,
			`+countedOf("r.questions")+`, `+lookColumns+`
		FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind = 'day' AND r.day = ? AND r.user_id = ? AND r.finished_at IS NOT NULL`, day, viewer).
		Scan(&r.id, &mine.Name, &mine.Tag, &mine.Rights, &r.tie.closeness, &mine.Of, &avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return b, nil
	}
	if err != nil {
		return b, err
	}
	mine.Me, mine.Look = true, g.lookOf(viewer, avatar)
	// Finished: how each of the others' went, as counted, and the viewer's own.
	for i := range b.Top {
		b.Top[i].Trail = d.top[i].Trail
	}
	trails, err := trailsOf(ctx, g.DB.Read, day, []int64{r.id})
	if err != nil {
		return b, err
	}
	mine.Trail = trails[r.id]
	b.Mine = &mine
	r.rights, mine.tie = mine.Rights, r.tie
	// Their place: after everyone ahead of them in the count, which has them already, or not yet: finished since, or
	// played at a script's speed (counted for nobody else). Their row goes first among those equal to them.
	ahead := sort.Search(len(d.runs), func(i int) bool { return !d.runs[i].ahead(r) })
	b.Place = ahead + 1
	mine.Place = b.Place
	at := sort.Search(len(d.runs), func(i int) bool { return !d.runs[i].before(r) })
	if at < len(d.runs) && d.runs[at].id == r.id {
		if at < len(b.Top) {
			b.Top = slices.Delete(b.Top, at, at+1)
		}
	} else {
		b.Players++
	}
	if ahead < BoardTop {
		b.Top = slices.Insert(b.Top, ahead, mine)
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
	rows, err := tx.QueryContext(ctx, `SELECT id, rights, closeness FROM runs WHERE kind = 'day' AND day = ?
		AND finished_at IS NOT NULL AND `+othersSee("runs")+` ORDER BY `+dayOrder, day)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r boardRun
		if err := rows.Scan(&r.id, &r.rights, &r.tie.closeness); err != nil {
			rows.Close()
			return nil, err
		}
		d.runs, d.rights = append(d.runs, r), d.rights+r.rights
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = tx.QueryContext(ctx, `SELECT r.id, u.id, u.name, u.tag, r.rights, r.closeness,
			`+countedOf("r.questions")+`, `+lookColumns+`
		FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind = 'day' AND r.day = ? AND r.finished_at IS NOT NULL AND `+othersSee("r")+`
		ORDER BY `+resultOrder("r")+`, r.id LIMIT ?`, day, BoardTop)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var runs []int64 // each of top's game
	for rows.Next() {
		var run, id int64
		var s Score
		var avatar string
		if err := rows.Scan(&run, &id, &s.Name, &s.Tag, &s.Rights, &s.tie.closeness, &s.Of, &avatar); err != nil {
			return nil, err
		}
		s.Look = g.lookOf(id, avatar)
		d.top, d.users, runs = append(d.top, s), append(d.users, id), append(runs, run)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	// How each of the best went, counted with them (BoardOf shows it to a viewer who has finished the day).
	trails, err := trailsOf(ctx, tx, day, runs)
	if err != nil {
		return nil, err
	}
	for i, run := range runs {
		d.top[i].Trail = trails[run]
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

// tiebreak is what decides between games of the same right answers, on a board and in a duel: how close the hard
// number came (its score, in thousandths: a number short of right still came near or didn't), and nothing else (no
// time). A run keeps it (runs.closeness), as it keeps its right answers.
type tiebreak struct {
	closeness int
}

// add counts an answer into what breaks a tie: a number's score.
func (t *tiebreak) add(score float64, number bool) {
	if number {
		t.closeness = int(math.Round(1000 * score))
	}
}

// cmp is -1 if t breaks a tie ahead of o, 1 if behind, 0 if neither does.
func (t tiebreak) cmp(o tiebreak) int { return cmpInt(o.closeness, t.closeness) }

// othersSee is, in SQL over runs (an alias), whether a day's game is on the others' boards and in their counts: not a
// shadow (fair.go), nor the issue played a second time in one browser (runs.pencil: its answers were in sight).
func othersSee(run string) string { return `NOT ` + run + `.shadow AND NOT ` + run + `.pencil` }

func cmpInt(a, b int) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// resultOrder is a day's games best first, in SQL over runs under a name (ahead says the same in Go): more right
// answers, then what breaks a tie (tiebreak). Games equal by it share a place (placed). dayOrder is the whole order of
// the day's board: among equals, the earlier started (before), never the quicker.
func resultOrder(runs string) string {
	return runs + ".rights DESC, " + runs + ".closeness DESC"
}

var dayOrder = resultOrder("runs") + ", runs.id"

// boardRun is a game on a board, as far as its place goes.
type boardRun struct {
	id     int64
	rights int
	tie    tiebreak
}

// ahead says whether a game is placed ahead of another on a day's board (resultOrder): more right answers, then what
// breaks a tie (tiebreak). Neither ahead of the other, they share a place.
func (r boardRun) ahead(o boardRun) bool {
	if r.rights != o.rights {
		return r.rights > o.rights
	}
	return r.tie.cmp(o.tie) < 0
}

// before says whether a game comes before another in the order of a day's board (dayOrder): ahead, or equal and
// started earlier.
func (r boardRun) before(o boardRun) bool {
	if r.ahead(o) || o.ahead(r) {
		return r.ahead(o)
	}
	return r.id < o.id
}

// placed numbers a board's rows (best first, from the first) by their places: one more than how many are ahead, so
// that rows equal in right answers and what breaks a tie share one (1, 2, 2, 4).
func placed(rows []Score) {
	for i := range rows {
		rows[i].Place = i + 1
		if i > 0 && rows[i].Rights == rows[i-1].Rights && rows[i].tie == rows[i-1].tie {
			rows[i].Place = rows[i-1].Place
		}
	}
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
