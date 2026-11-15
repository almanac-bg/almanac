// Package royal is Роял played live: in the evening at the same time (on the days its Schedule says: Friday to Sunday
// until those evenings fill, then every evening, play.RoyalPaceOf), everyone in it on the same question at the same
// moment. A wrong answer puts nobody out: the game is cut after some questions (play.RoyalCuts) to those ahead, the
// most right answers first and the quickest of as many, and the last question is a final of three. Those cut keep
// answering to the end on the same clock, off the standings: their answers earn what any game's do, but never a place
// or rating. The game always reaches its last question, so an evening is an evening for everyone in it.
//
// The lobby opens a quarter of an hour before the start, and those in it are called again a minute before (Soon);
// whoever is there at the start plays. Those who come late may still come in until the answer to the third question
// shows (Late), well before the first cut: the questions they missed count as not answered. A lobby member whose
// screen was away at the start is in as soon as it's back, in that time. A tournament takes up to play.RoyalSize
// players at the start: those there are dealt into as few as hold everyone of the lobby (those away keep a seat), of
// sizes as even as can be (51: 26 and 25), on the same questions. Nobody is shut out while the door is open: one who
// comes late sits at the tournament with fewest in, over its size if every one is full. Each moves on at its own
// pace: a question's answer shows once everyone playing it has answered (those cut too, so that their answers are
// taken, but not one who let the last one run out, nor one away), or when its time is up; the answer that a cut comes
// with shows longer (CutPause), with who goes on and when the next cut is.
//
// The hub keeps the evening's clock and the screens following it. Everything a game does goes through the database
// first (package play), so that a restart of the server picks the game up again where it was.
package royal

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
)

const (
	// Pause is how long the answer to a question shows (and the standings with it) before the next…
	Pause = 6 * time.Second
	// …and CutPause, the answer a cut comes with: who goes on, and who's out.
	CutPause = 10 * time.Second
	// results is how long, at least, the standings of an evening's games show once they're over.
	results = 2 * time.Minute
	// away is how long a player may be gone from the screen (the line dropped, a phone asleep) and still count as
	// there: for the start, and for the answer to show before the time is up.
	away = 15 * time.Second
	// Call is how long before the start those in the lobby who aren't on its screen, and those who said they'd come
	// and haven't, are called again (Soon).
	Call = time.Minute
	// Late is how many questions in one may still come in: until the answer to the Late-th shows.
	Late = 3
)

// Errors a player may cause.
var (
	ErrClosed = errors.New("the lobby isn't open")
	ErrShut   = errors.New("the door is shut") // the games are past the Late-th question
	ErrNotNow = errors.New("not now")
)

// Schedule is when the evenings are.
type Schedule struct {
	// Hour and Minute are the start, in Bulgaria, on the days there's one.
	Hour, Minute int
	// On, if set, says whether there's one on the day of a start (play.Game.RoyalOn); unset, every day.
	On func(time.Time) bool
	// Every, when set, starts one every Every instead (for trying the game out: one each few minutes).
	Every time.Duration
	// Lobby is how long before the start the lobby opens.
	Lobby time.Duration
}

// Evening is Роял's: at 21:00, the lobby open from 20:45.
var Evening = Schedule{Hour: 21, Lobby: 15 * time.Minute}

// Next is the first start after now.
func (s Schedule) Next(now time.Time) time.Time {
	if s.Every > 0 {
		return now.Truncate(s.Every).Add(s.Every)
	}
	d := now.In(play.Bulgaria)
	var t time.Time
	for i := range 8 { // a week holds the days it always plays
		t = time.Date(d.Year(), d.Month(), d.Day()+i, s.Hour, s.Minute, 0, 0, play.Bulgaria)
		if t.After(now) && (s.On == nil || s.On(t)) {
			break
		}
	}
	return t
}

// Nightly says whether there's one every evening of the week from now.
func (s Schedule) Nightly(now time.Time) bool {
	if s.Every > 0 || s.On == nil {
		return true
	}
	for i := range 7 {
		if !s.On(now.AddDate(0, 0, i)) {
			return false
		}
	}
	return true
}

// Player is someone coming to Роял.
type Player struct {
	ID   int64
	Name string
	Tag  string
	Look play.Look
}

// Hub runs the evenings.
type Hub struct {
	game  *play.Game
	sched Schedule
	// News, if set, is told of the places of a tournament's players who were away from it when it ended.
	News func(context.Context, play.RoyalNews)
	// Opened, if set, is told (on its own goroutine) when an evening's lobby opens, with the evening's start. A
	// restart of the server in the lobby's time tells it again.
	Opened func(context.Context, time.Time)
	// Soon, if set, is told (on its own goroutine) Call before the start, with the start, those in the lobby who
	// aren't on its screen (away), and everyone in it (in). A restart of the server in that minute tells it again.
	Soon func(ctx context.Context, start time.Time, away, in []int64)

	mu     sync.Mutex
	night  *night
	subs   map[*Sub]struct{}
	online map[int64]int // the screens each player has following
}

func NewHub(g *play.Game, s Schedule) *Hub {
	return &Hub{game: g, sched: s, subs: map[*Sub]struct{}{}, online: map[int64]int{}}
}

// night is an evening: its start, its questions, and its tournaments.
type night struct {
	start  time.Time
	picks  []play.Pick
	dealt  []bank.Dealt
	tables []*table
	told   bool // that the lobby is open
	called bool // Opened, that it is
	soon   bool // Soon, that it starts in a minute
	held   bool // that its start came (play.HeldRoyal)
	// absent are those of the lobbies who weren't there at the start: in as soon as they're back, while the door is
	// open (table.open). The database keeps them in their tournament, without a run.
	absent map[int64]Player
}

func (n *night) opens(s Schedule) time.Time { return n.start.Add(-s.Lobby) }

// over says whether all of the evening's games are over, and since when.
func (n *night) over() (bool, time.Time) {
	var last time.Time
	for _, t := range n.tables {
		if t.phase != play.RoyalEnd {
			return false, last
		}
		if t.at.After(last) {
			last = t.at
		}
	}
	return true, last
}

// table is one tournament of an evening.
type table struct {
	id      int64
	members []*member
	phase   string
	n       int
	at      time.Time // when the phase began
	entered int
	wentOut int           // on the question whose answer shows
	paced   time.Duration // how far into the question its screens were last told of more showing (bank.Paced)
}

type member struct {
	Player
	key     int
	run     int64
	seen    time.Time // last on the screen
	in      bool      // still in the game (the standings)
	inQ     bool      // playing the question now (in, or on after a cut)
	idle    bool      // let the last question they played run out: once cut, not waited for until they answer again
	stood   bool      // in the standings for the question now
	reached int       // questions answered right, as of the last answer shown (to their cut, once out)
	ms      int64     // the time the right ones took
	rights  int       // questions answered right in all, after a cut too
	outAt   int
	// The question now: whether they've answered, what they gave (as shown), how it went.
	answered bool
	given    json.RawMessage
	res      play.Result
	place    int
	delta    int
}

// open says whether one may still come into t's game: until the answer to its Late-th question shows.
func (t *table) open() bool {
	return (t.phase == play.RoyalQuestion && t.n < Late) || (t.phase == play.RoyalReveal && t.n < Late-1)
}

func (t *table) member(id int64) *member {
	for _, m := range t.members {
		if m.ID == id {
			return m
		}
	}
	return nil
}

func (h *Hub) now() time.Time { return h.game.Now() }

// mine finds the player's tournament tonight, and them in it.
func (h *Hub) mine(id int64) (*table, *member) {
	if h.night == nil || id == 0 {
		return nil, nil
	}
	for _, t := range h.night.tables {
		if m := t.member(id); m != nil {
			return t, m
		}
	}
	return nil, nil
}

// watched is the tournament a viewer follows: theirs, or else the evening's first (the biggest).
func (h *Hub) watched(id int64) (*table, *member) {
	if t, m := h.mine(id); t != nil {
		return t, m
	}
	if h.night == nil || len(h.night.tables) == 0 {
		return nil, nil
	}
	return h.night.tables[0], nil
}

// there says whether a player is on the screen, or was a moment ago.
func (h *Hub) there(m *member, now time.Time) bool {
	return h.online[m.ID] > 0 || now.Sub(m.seen) < away
}

// Load picks up the tournaments the server was running before it restarted.
func (h *Hub) Load(ctx context.Context) error {
	live, err := h.game.LiveRoyals(ctx)
	if err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	for _, l := range live {
		if h.night == nil || !h.night.start.Equal(l.StartsAt) {
			if h.night != nil && h.night.start.After(l.StartsAt) {
				continue // an older evening's: SettleDue ends it
			}
			h.night = &night{start: l.StartsAt, picks: l.Picks, dealt: h.deal(l.Picks), told: true, absent: map[int64]Player{}}
		}
		t := &table{id: l.ID, phase: l.Phase, n: l.N, at: now}
		for i, p := range l.Players {
			m := &member{Player: Player{ID: p.User, Name: p.Name, Tag: p.Tag}, key: i, run: p.Run, seen: now, outAt: -1}
			m.Look, _ = h.game.LookOf(ctx, p.User)
			if p.Run == 0 && l.Phase != play.RoyalLobby {
				h.night.absent[p.User] = m.Player // away at the start
				continue
			}
			if p.Run != 0 {
				t.entered++
				m.in, m.reached, m.ms, m.rights, m.outAt = p.OutAt < 0, p.Right, p.RightMs, p.Rights, p.OutAt
				m.inQ, m.stood = true, m.in || p.OutAt == l.N
				m.answered = p.At > l.N
				m.res.Right = m.answered && p.LastRight
				if l.Phase == play.RoyalReveal && m.inQ && !m.answered {
					m.res.TimedOut = true
				}
			}
			t.members = append(t.members, m)
		}
		if l.Phase == play.RoyalQuestion {
			// The question shows again, its time from now, for those who hadn't answered it.
			if err := h.game.ShowRoyal(ctx, t.id, t.n); err != nil {
				return err
			}
		}
		h.night.tables = append(h.night.tables, t)
	}
	return nil
}

func (h *Hub) deal(picks []play.Pick) []bank.Dealt {
	b := h.game.Bank()
	out := make([]bank.Dealt, len(picks))
	for i, p := range picks {
		if q, ok := b.Get(p.ID); ok {
			out[i] = q.Deal(p.Seed)
		}
	}
	return out
}

// Step moves the evening on: the lobby opens, the game starts, a question's time runs out, the next question shows,
// the game ends. Run it a few times a second.
func (h *Hub) Step(ctx context.Context) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	next := h.sched.Next(now)
	if n := h.night; n == nil {
		h.night = &night{start: next, absent: map[int64]Player{}}
		h.changed(nil)
	} else if over, since := n.over(); over && !n.start.Equal(next) &&
		(len(n.tables) == 0 || (!now.Before(next.Add(-h.sched.Lobby)) && now.Sub(since) >= results)) {
		// The evening is over (or nobody came), and its standings have shown: on to the next, whose lobby may be
		// open already.
		h.night = &night{start: next, absent: map[int64]Player{}}
		h.changed(nil)
	} else if len(n.tables) == 0 && now.Before(n.opens(h.sched)) && !n.start.Equal(next) {
		// The days it plays on changed (play.RoyalPaceOf, a day's) before this one's lobby opened.
		h.night = &night{start: next, absent: map[int64]Player{}}
		h.changed(nil)
	}
	n := h.night
	if !n.told && !now.Before(n.opens(h.sched)) {
		n.told = true
		h.changed(nil)
	}
	if !n.called && !now.Before(n.opens(h.sched)) && now.Before(n.start) {
		n.called = true
		if h.Opened != nil {
			go h.Opened(context.WithoutCancel(ctx), n.start)
		}
	}
	if !n.soon && !now.Before(n.start.Add(-Call)) && now.Before(n.start) {
		n.soon = true
		if h.Soon != nil {
			var away, in []int64
			for _, t := range n.tables {
				for _, m := range t.members {
					in = append(in, m.ID)
					if h.online[m.ID] == 0 {
						away = append(away, m.ID)
					}
				}
			}
			go h.Soon(context.WithoutCancel(ctx), n.start, away, in)
		}
	}
	if !n.held && !now.Before(n.start) {
		n.held = true
		if err := h.game.HeldRoyal(ctx, n.start); err != nil {
			slog.Error("royal", "held", n.start, "err", err)
		}
	}
	if !now.Before(n.start) && slices.ContainsFunc(n.tables, func(t *table) bool { return t.phase == play.RoyalLobby }) {
		if err := h.begin(ctx, now); err != nil {
			slog.Error("royal", "start", n.start, "err", err) // tried again at the next step
			return
		}
	}
	// Those away at the start whose screen is back come in, while the door is open.
	for id, p := range n.absent {
		if h.online[id] > 0 {
			if err := h.late(ctx, p, now); err != nil && !errors.Is(err, ErrShut) {
				slog.Error("royal", "late", id, "err", err)
			}
		}
	}
	for _, t := range slices.Clone(n.tables) {
		var err error
		switch {
		case t.phase == play.RoyalLobby || t.phase == play.RoyalEnd:
		case len(t.members) == 0 && !t.open():
			// Nobody was there at the start, and nobody came in while the door was open.
			err = h.empty(ctx, t)
		case t.phase == play.RoyalQuestion:
			d := n.dealt[t.n]
			if d == nil || now.Sub(t.at) >= play.Limit(d.Question())+play.Grace {
				err = h.reveal(ctx, t, now)
			} else if next := bank.NextStep(d, t.paced); next > 0 && now.Sub(t.at) >= t.paced+next {
				// More of the question shows (its next clue): the screens look again.
				t.paced += next
				h.changed(t)
			}
		case t.phase == play.RoyalReveal:
			if now.Sub(t.at) >= h.pause(t) {
				err = h.next(ctx, t, now)
			}
		}
		if err != nil {
			slog.Error("royal", "tournament", t.id, "phase", t.phase, "err", err) // tried again at the next step
		}
	}
}

// Join puts a player in the evening's lobby (again changes nothing): in the tournament with room for them. Once the
// games have begun, it puts them in one late, while the door is open (Late; ErrShut after). Once they're over, it
// puts them in the next evening's lobby if that's open already (evenings a few minutes apart, to try the game out).
func (h *Hub) Join(ctx context.Context, p Player) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	n := h.night
	if n != nil && !now.Before(n.start) {
		if over, _ := n.over(); over {
			if next := h.sched.Next(now); !now.Before(next.Add(-h.sched.Lobby)) {
				h.night = &night{start: next, told: true, absent: map[int64]Player{}}
				h.changed(nil)
				n = h.night
			}
		}
	}
	if n == nil || now.Before(n.opens(h.sched)) {
		return ErrClosed
	}
	if _, m := h.mine(p.ID); m != nil {
		m.Player, m.seen = p, now
		return nil
	}
	if !now.Before(n.start) {
		return h.late(ctx, p, now)
	}
	var t *table
	if k := len(n.tables); k > 0 && len(n.tables[k-1].members) < play.RoyalSize {
		t = n.tables[k-1]
	} else {
		if n.picks == nil {
			picks, err := h.game.DrawRoyal(ctx)
			if err != nil {
				return err
			}
			n.picks, n.dealt = picks, h.deal(picks)
		}
		id, err := h.game.NewRoyal(ctx, n.start, n.picks)
		if err != nil {
			return err
		}
		t = &table{id: id, phase: play.RoyalLobby}
		n.tables = append(n.tables, t)
	}
	if err := h.game.JoinRoyal(ctx, t.id, p.ID); err != nil {
		return err
	}
	key := 0
	if k := len(t.members); k > 0 {
		key = t.members[k-1].key + 1
	}
	t.members = append(t.members, &member{Player: p, key: key, seen: now, outAt: -1})
	h.changed(t)
	return nil
}

// Leave takes a player out of the lobby.
func (h *Hub) Leave(ctx context.Context, id int64) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	t, m := h.mine(id)
	if m == nil {
		return nil
	}
	if t.phase != play.RoyalLobby {
		return ErrNotNow
	}
	if err := h.game.LeaveRoyal(ctx, t.id, id); err != nil {
		return err
	}
	t.members = slices.DeleteFunc(t.members, func(x *member) bool { return x == m })
	h.changed(nil) // a watcher may have followed this one, and follows another now
	return nil
}

// begin starts the evening's tournaments with those of their lobbies who are there, dealt into as few as hold
// everyone of the lobbies (those not there too: each keeps a seat), of sizes as even as can be, in the order they
// came. Those not there are kept aside (absent), in the first: they're in if they come back while the door is open. A
// tournament nobody is left in, and nobody may come back to, ends.
func (h *Hub) begin(ctx context.Context, now time.Time) error {
	n := h.night
	var lobbies []*table
	var there, away []*member
	for _, t := range n.tables {
		if t.phase != play.RoyalLobby {
			continue
		}
		lobbies = append(lobbies, t)
		for _, m := range t.members {
			if h.there(m, now) {
				there = append(there, m)
			} else {
				away = append(away, m)
			}
		}
	}
	// As many as hold everyone of the lobbies, those away too: a seat is kept for each (nobody there, but some may
	// come back: a game runs for them).
	k := (len(there) + len(away) + play.RoyalSize - 1) / play.RoyalSize
	// Each player's seat: the first tables take one more, while there are more than divide evenly.
	seats := map[*member]*table{}
	for i, m := range there {
		seats[m] = lobbies[deal(i, len(there), k)]
	}
	for _, m := range away {
		seats[m] = lobbies[0]
	}
	moved := map[*table][]*member{}
	for _, t := range lobbies {
		for _, m := range t.members {
			to := seats[m]
			if to != t {
				if err := h.game.MoveRoyal(ctx, t.id, to.id, m.ID); err != nil {
					return err
				}
			}
			moved[to] = append(moved[to], m)
		}
	}
	// Everyone's seat in memory as the database has it now, before any table starts: should a start fail, the next
	// try finds each player where they were moved.
	for _, t := range lobbies {
		t.members = moved[t]
	}
	for i, t := range lobbies {
		if i >= k {
			if err := h.empty(ctx, t); err != nil {
				return err
			}
			continue
		}
		var ids []int64
		for _, m := range t.members {
			if h.there(m, now) {
				ids = append(ids, m.ID)
			}
		}
		runs, err := h.game.StartRoyal(ctx, t.id, ids)
		if err != nil {
			return err
		}
		t.members = slices.DeleteFunc(t.members, func(m *member) bool {
			if runs[m.ID] == 0 {
				n.absent[m.ID] = m.Player
				return true
			}
			return false
		})
		for _, m := range t.members {
			m.run, m.in = runs[m.ID], true
		}
		t.entered = len(t.members)
		h.shown(t, 0, now)
	}
	h.changed(nil)
	return nil
}

// deal is the table (of k) the i-th of those there sits at, of them all: in the order they came, the first tables
// one more while there are more than divide evenly (51 in two: 26 and 25).
func deal(i, all, k int) int {
	size, more := all/k, all%k
	if i < more*(size+1) {
		return i / (size + 1)
	}
	return more + (i-more*(size+1))/size
}

// empty ends a tournament nobody plays (those of its lobby gone, or away and never back), and takes it off the
// evening.
func (h *Hub) empty(ctx context.Context, t *table) error {
	if _, err := h.game.SettleRoyal(ctx, t.id); err != nil {
		return err
	}
	for _, m := range t.members {
		delete(h.night.absent, m.ID)
	}
	t.members, t.phase = nil, play.RoyalEnd
	h.night.tables = slices.DeleteFunc(h.night.tables, func(x *table) bool { return x == t })
	h.changed(nil)
	return nil
}

// late puts a player in a game under way, while its door is open: the one that has fewest in, over play.RoyalSize if
// every one is full (nobody is shut out while the door is open). The questions before the one showing count as not
// answered; the one showing is theirs to answer in the time it has left.
func (h *Hub) late(ctx context.Context, p Player, now time.Time) error {
	var t *table
	for _, x := range h.night.tables {
		if x.open() && (t == nil || len(x.members) < len(t.members)) {
			t = x
		}
	}
	if t == nil {
		return ErrShut
	}
	run, err := h.game.EnterRoyal(ctx, t.id, p.ID)
	if err != nil {
		return err
	}
	delete(h.night.absent, p.ID)
	key := 0
	for _, m := range t.members {
		key = max(key, m.key+1)
	}
	m := &member{Player: p, key: key, run: run, seen: now, in: true, outAt: -1}
	if p.Look == (play.Look{}) {
		m.Look, _ = h.game.LookOf(ctx, p.ID)
	}
	m.inQ = t.phase == play.RoyalQuestion
	m.stood = m.inQ
	if t.phase == play.RoyalReveal {
		m.res = play.Result{TimedOut: true} // the answer showing: they weren't in for it
	}
	t.members = append(t.members, m)
	t.entered++
	h.changed(nil) // a watcher of another tournament may follow this one now
	return nil
}

// shown is question n on everyone's screen (the database has it so already).
func (h *Hub) shown(t *table, n int, now time.Time) {
	t.phase, t.n, t.at, t.wentOut, t.paced = play.RoyalQuestion, n, now, 0, 0
	for _, m := range t.members {
		m.inQ, m.stood, m.answered, m.given, m.res = true, m.in, false, nil, play.Result{}
	}
}

// Answer takes a player's answer to question n (still in, or on after a cut). Once everyone playing it has answered,
// the answer shows: those cut too, on the same clock, but not one away or who let the last question run out (until they
// answer again). An answer sent again (its reply lost on the way) is the one taken already: no error, while its
// question or its answer shows.
func (h *Hub) Answer(ctx context.Context, id int64, n int, raw json.RawMessage) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	t, m := h.mine(id)
	if m != nil && n == t.n && m.inQ && m.answered && (t.phase == play.RoyalQuestion || t.phase == play.RoyalReveal) {
		return nil
	}
	if m == nil || t.phase != play.RoyalQuestion || n != t.n || !m.inQ || m.answered {
		return ErrNotNow
	}
	if len(raw) == 0 || string(raw) == "null" {
		return play.ErrBadAnswer
	}
	res, err := h.game.AnswerRoyal(ctx, id, m.run, n, raw)
	if errors.Is(err, play.ErrOutOfStep) {
		return ErrNotNow // the time ran out
	}
	if err != nil {
		return err
	}
	// How it went shows to the others with the answer (reveal), not before.
	m.answered, m.given, m.res, m.idle = true, res.Given, res, false
	now := h.now()
	for _, o := range t.members {
		if o.inQ && !o.answered && (o.in || !o.idle) && h.there(o, now) {
			h.changed(t)
			return nil
		}
	}
	return h.reveal(ctx, t, now)
}

// reveal shows the answer to the question now, with the standings it makes, and takes out whoever a cut after it
// puts out (play.RevealRoyal).
func (h *Hub) reveal(ctx context.Context, t *table, now time.Time) error {
	scores, out, err := h.game.RevealRoyal(ctx, t.id)
	if err != nil {
		return err
	}
	t.phase, t.at, t.wentOut = play.RoyalReveal, now, 0
	for _, s := range scores {
		if m := t.member(s.User); m != nil {
			m.reached, m.ms = s.Rights, s.Ms
		}
	}
	for _, m := range t.members {
		if !m.inQ {
			continue
		}
		if !m.answered {
			m.res = play.Result{TimedOut: true}
		}
		m.idle = !m.answered
		if m.res.Right {
			m.rights++
		}
		if slices.Contains(out, m.ID) {
			m.in, m.outAt = false, t.n
			t.wentOut++
		}
	}
	h.changed(t)
	return nil
}

// keep is how many go on at a cut after question n (play.RoyalKeep), 0 if none: none either where it can't put
// anyone out, with no more in than it keeps (two players, or a few after an earlier cut). Those in now are those in
// the standings for question n, if it's the question now, or at most those who will be, for one ahead.
func (t *table) keep(n int) int {
	k, in := play.RoyalKeep(n, t.entered), 0
	for _, m := range t.members {
		if (n == t.n && m.stood) || (n != t.n && m.in) {
			in++
		}
	}
	if k >= in {
		return 0
	}
	return k
}

// pause is how long the answer showing shows.
func (h *Hub) pause(t *table) time.Duration {
	if t.keep(t.n) > 0 {
		return CutPause
	}
	return Pause
}

// last says whether t's game ends once the answer showing has shown: after the last question.
func (h *Hub) last(t *table) bool {
	return t.n+1 >= len(h.night.picks) || h.night.dealt[t.n+1] == nil
}

// next shows the next question, or ends the game (last).
func (h *Hub) next(ctx context.Context, t *table, now time.Time) error {
	if !h.last(t) {
		if err := h.game.ShowRoyal(ctx, t.id, t.n+1); err != nil {
			return err
		}
		h.shown(t, t.n+1, now)
		h.changed(t)
		return nil
	}
	places, err := h.game.SettleRoyal(ctx, t.id)
	if err != nil {
		return err
	}
	t.phase, t.at = play.RoyalEnd, now
	for _, p := range places {
		m := t.member(p.User)
		if m == nil {
			continue
		}
		m.place, m.delta = p.Place, p.Delta
		if h.News != nil && !h.there(m, now) {
			h.News(ctx, play.RoyalNews{To: m.ID, Place: p.Place, Of: len(places), Delta: p.Delta})
		}
	}
	h.changed(t)
	return nil
}

// Sub is a screen following the evening: C says it changed (read View then).
type Sub struct {
	C      chan struct{}
	viewer int64
}

// Follow is a player's screen following the evening (0: someone not signed in, who may look).
func (h *Hub) Follow(viewer int64) *Sub {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := &Sub{C: make(chan struct{}, 1), viewer: viewer}
	h.subs[s] = struct{}{}
	s.C <- struct{}{} // the evening as it is
	if viewer != 0 {
		h.online[viewer]++
		if t, _ := h.mine(viewer); t != nil {
			h.changed(t)
		}
	}
	return s
}

// Unfollow is a screen gone (closed, offline).
func (h *Hub) Unfollow(s *Sub) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.subs[s]; !ok {
		return
	}
	delete(h.subs, s)
	if s.viewer == 0 {
		return
	}
	if h.online[s.viewer]--; h.online[s.viewer] <= 0 {
		delete(h.online, s.viewer)
	}
	if t, m := h.mine(s.viewer); m != nil {
		m.seen = h.now()
		h.changed(t)
	}
}

// changed tells the screens following t to look again (nil: every screen). Called with the lock held.
func (h *Hub) changed(t *table) {
	for s := range h.subs {
		if t != nil {
			if w, _ := h.watched(s.viewer); w != t {
				continue
			}
		}
		select {
		case s.C <- struct{}{}:
		default: // it hasn't looked since the last change; one look will do for both
		}
	}
}

// Glance is the evening at a glance, for those not on its screen: when it starts, and how many are in.
type Glance struct {
	// Phase is "soon" (the lobby isn't open), "lobby" (it is), or "live" (its games are under way).
	Phase    string `json:"phase"`
	StartsAt int64  `json:"startsAt"`
	OpensAt  int64  `json:"opensAt"`
	Now      int64  `json:"now"`
	// Next is the first start after now: the evening one can still say they'll come to.
	Next int64 `json:"next"`
	// Nightly says there's one every evening (else on its days: Friday to Sunday).
	Nightly bool `json:"nightly,omitempty"`
	// In is how many are in its lobbies, or still in its games.
	In int `json:"in"`
}

// Near says whether an evening is near or on: from lead before its lobby opens until its games are over. A restart of
// the server waits for it to pass (the game would come back, but not without a gap at its best moment).
func (h *Hub) Near(lead time.Duration) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	if n := h.night; n != nil && !now.Before(n.start) {
		if over, _ := n.over(); !over {
			return true
		}
	}
	next := h.sched.Next(now)
	if n := h.night; n != nil && n.start.After(now) {
		next = n.start
	}
	return !now.Before(next.Add(-h.sched.Lobby - lead))
}

// Glance is the evening now, at a glance.
func (h *Hub) Glance() Glance {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	g := Glance{Phase: "soon", Now: now.UnixMilli(), Next: h.sched.Next(now).UnixMilli(), Nightly: h.sched.Nightly(now)}
	n := h.night
	if n == nil {
		next := h.sched.Next(now)
		g.StartsAt, g.OpensAt = next.UnixMilli(), next.Add(-h.sched.Lobby).UnixMilli()
		return g
	}
	g.StartsAt, g.OpensAt = n.start.UnixMilli(), n.opens(h.sched).UnixMilli()
	if over, _ := n.over(); now.Before(n.opens(h.sched)) || (over && !now.Before(n.start)) {
		if !now.Before(n.start) {
			// Over: the next one is what's coming, its lobby maybe open already (and nobody in it yet).
			next := h.sched.Next(now)
			g.StartsAt, g.OpensAt = next.UnixMilli(), next.Add(-h.sched.Lobby).UnixMilli()
			if !now.Before(next.Add(-h.sched.Lobby)) {
				g.Phase = "lobby"
			}
		}
		return g
	}
	g.Phase = "lobby"
	if !now.Before(n.start) {
		g.Phase = "live"
	}
	for _, t := range n.tables {
		for _, m := range t.members {
			if t.phase == play.RoyalLobby || m.in {
				g.In++
			}
		}
	}
	return g
}

// View is the evening as one player sees it.
type View struct {
	// Phase is "soon" (the lobby isn't open), or the tournament's: "lobby", "question", "reveal", "end".
	Phase    string `json:"phase"`
	StartsAt int64  `json:"startsAt"`
	OpensAt  int64  `json:"opensAt"`
	// Next is the next evening's start (StartsAt's, until the evening's begun).
	Next int64 `json:"next"`
	// Nightly says there's one every evening (else on its days: Friday to Sunday).
	Nightly bool `json:"nightly,omitempty"`
	// Now is the server's clock, for the countdowns.
	Now    int64 `json:"now"`
	Length int   `json:"length"`
	Round  int   `json:"round"`
	Size   int   `json:"size"`
	// In says the viewer is in this tournament (its lobby, or its game), and Out that a cut put them out of its
	// standings (they play on).
	In  bool `json:"in"`
	Out bool `json:"out"`
	// Rights is how many the viewer has answered right in all (after a cut too), as of the last answer shown.
	Rights int `json:"rights,omitempty"`
	// Late says the viewer, not in, may still come in: the games have begun, and a door is open (Late).
	Late bool `json:"late,omitempty"`
	// Tables is how many tournaments there are this evening.
	Tables  int `json:"tables"`
	N       int `json:"n"`
	Entered int `json:"entered"`
	// Left is how many are still in; WentOut, how many went out on the question whose answer shows (a cut).
	Left    int `json:"left"`
	WentOut int `json:"wentOut"`
	// Cut is the game's next cut: the one the answer showing comes with, while it shows (none once the final's on).
	Cut *CutView `json:"cut,omitempty"`
	// Last says the game ends once the answer showing has shown: the standings come next.
	Last bool `json:"last,omitempty"`
	// Players are the tournament's: before the start, everyone in the lobby, whatever tournament they'll be dealt to.
	Players  []PlayerView  `json:"players"`
	Question *QuestionView `json:"question,omitempty"`
	// RunID is the viewer's run, once it's over: to go over its questions.
	RunID int64 `json:"runId,omitempty"`
	Place int   `json:"place,omitempty"`
	Delta int   `json:"delta,omitempty"`
}

// CutView is a cut of the game: after which question (counted from 1), how many of those who began go on, and the
// line, as the standings are now: the score of the last who'd go on (nil: everyone in would).
type CutView struct {
	After int        `json:"after"`
	Keep  int        `json:"keep"`
	Line  *ScoreView `json:"line,omitempty"`
	// Now says it's the answer showing that the cut comes with: those behind the line are out.
	Now bool `json:"now,omitempty"`
	// Then is, with Now, the cut after it (after which question, counted from 1; 0: none, the final is next).
	Then int `json:"then,omitempty"`
}

// ScoreView is a score: right answers, and the time they took.
type ScoreView struct {
	Rights int   `json:"rights"`
	Ms     int64 `json:"ms"`
}

type PlayerView struct {
	play.Look
	// Key tells players apart in a tournament (names may repeat).
	Key  int    `json:"key"`
	Name string `json:"name"`
	Tag  string `json:"tag"`
	In   bool   `json:"in"`
	// Reached is how many they've answered right (as of the last answer shown), and Ms the time those took.
	Reached int   `json:"reached"`
	Ms      int64 `json:"ms"`
	// Rank is where they stand now (those level share it): the place, once it's ended. Goes says they'd go on at the
	// next cut as they stand (those level with its line too), or have gone on at the cut the answer showing comes with.
	Rank int  `json:"rank"`
	Goes bool `json:"goes,omitempty"`
	// OutAt is the question they went out on (-1: they haven't).
	OutAt    int  `json:"outAt"`
	Online   bool `json:"online"`
	Answered bool `json:"answered"`
	Place    int  `json:"place,omitempty"`
	Delta    int  `json:"delta,omitempty"`
	Me       bool `json:"me,omitempty"`
}

type QuestionView struct {
	Category string `json:"category"`
	View     any    `json:"view"`
	LimitMs  int64  `json:"limitMs"`
	LeftMs   int64  `json:"leftMs"`
	// Shown is when the question showed (the server's clock): again after a restart of the server, its time from then,
	// so that a screen draws it again.
	Shown int64 `json:"shown"`
	// NextMs is how long until the game moves on, while an answer shows.
	NextMs int64 `json:"nextMs,omitempty"`
	// Given is the viewer's answer, as shown (once given).
	Given json.RawMessage `json:"given,omitempty"`
	// Reveal is the answer, once it shows, with how the viewer's went (if they were in for it).
	Reveal *RevealView `json:"reveal,omitempty"`
}

type RevealView struct {
	Answer any  `json:"answer"`
	Mine   bool `json:"mine"` // the viewer answered it (or was in for it)
	Points int  `json:"points"`
	Speed  int  `json:"speed,omitempty"`
	Right  bool `json:"right"`
	Exact  bool `json:"exact,omitempty"`
	Missed bool `json:"missed,omitempty"`
}

// View builds what a viewer sees now.
func (h *Hub) View(viewer int64) View {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	v := View{
		Phase: "soon", Now: now.UnixMilli(), Length: play.RoyalLength, Round: play.RoyalRound, Size: play.RoyalSize,
		Players: []PlayerView{},
	}
	n := h.night
	if n == nil {
		return v
	}
	v.StartsAt, v.OpensAt, v.Tables = n.start.UnixMilli(), n.opens(h.sched).UnixMilli(), len(n.tables)
	v.Next, v.Nightly = h.sched.Next(now).UnixMilli(), h.sched.Nightly(now)
	t, me := h.watched(viewer)
	if t == nil {
		if !now.Before(n.opens(h.sched)) && now.Before(n.start) {
			v.Phase = play.RoyalLobby // open, and nobody in yet
		}
		return v
	}
	v.Phase, v.N, v.Entered, v.WentOut = t.phase, t.n, t.entered, t.wentOut
	v.Last = t.phase == play.RoyalReveal && h.last(t)
	if me == nil && t.phase != play.RoyalLobby {
		v.Late = slices.ContainsFunc(n.tables, (*table).open)
	}
	if me != nil {
		v.In, v.Out, v.Rights = true, t.phase != play.RoyalLobby && !me.in, me.rights
		if t.phase == play.RoyalEnd {
			v.RunID = me.run
		}
		v.Place, v.Delta = me.place, me.delta
	}
	members := t.members
	if t.phase == play.RoyalLobby {
		// The lobby is one, whatever the tournaments it fills before the start deals them.
		members = nil
		for _, x := range n.tables {
			if x.phase == play.RoyalLobby {
				members = append(members, x.members...)
			}
		}
	}
	for _, m := range members {
		if m.in {
			v.Left++
		}
		v.Players = append(v.Players, PlayerView{
			Look: m.Look, Key: m.key, Name: m.Name, Tag: m.Tag, In: m.in, Reached: m.reached, Ms: m.ms, OutAt: m.outAt,
			Online: h.online[m.ID] > 0, Answered: m.answered, Place: m.place, Delta: m.delta, Me: m == me,
		})
	}
	switch t.phase {
	case play.RoyalLobby:
		v.Left = len(members)
	case play.RoyalEnd:
		slices.SortStableFunc(v.Players, func(a, b PlayerView) int { return a.Place - b.Place })
		for i := range v.Players {
			v.Players[i].Rank = v.Players[i].Place
		}
	default:
		// Those still in first, then those out, the last to go out first; each as they stand.
		ahead := func(a, b PlayerView) int {
			if a.In != b.In {
				if a.In {
					return -1
				}
				return 1
			}
			if a.OutAt != b.OutAt {
				return b.OutAt - a.OutAt
			}
			return play.RoyalAhead(play.RoyalScore{Rights: a.Reached, Ms: a.Ms}, play.RoyalScore{Rights: b.Reached, Ms: b.Ms})
		}
		slices.SortStableFunc(v.Players, ahead)
		for i := range v.Players {
			v.Players[i].Rank = i + 1
			if i > 0 && ahead(v.Players[i-1], v.Players[i]) == 0 {
				v.Players[i].Rank = v.Players[i-1].Rank
			}
		}
		v.Cut = h.cut(t, v.Players)
		if v.Cut != nil {
			for i, p := range v.Players {
				v.Players[i].Goes = p.In && (v.Cut.Line == nil ||
					play.RoyalAhead(play.RoyalScore{Rights: p.Reached, Ms: p.Ms}, play.RoyalScore{Rights: v.Cut.Line.Rights, Ms: v.Cut.Line.Ms}) <= 0)
			}
		}
	}
	if (t.phase == play.RoyalQuestion || t.phase == play.RoyalReveal) && n.dealt[t.n] != nil {
		d := n.dealt[t.n]
		limit, since := play.Limit(d.Question()), now.Sub(t.at)
		if t.phase == play.RoyalReveal {
			since = limit // everything shows with the answer
		}
		q := &QuestionView{
			Category: d.Question().Base().Category, View: bank.ViewAt(d, since),
			LimitMs: limit.Milliseconds(), LeftMs: max(0, (limit - since).Milliseconds()),
		}
		if t.phase == play.RoyalQuestion {
			q.Shown = t.at.UnixMilli()
		}
		if me != nil && me.inQ {
			q.Given = me.given
		}
		if t.phase == play.RoyalReveal {
			q.LeftMs = 0
			q.NextMs = max(1, (h.pause(t) - now.Sub(t.at)).Milliseconds())
			q.Reveal = &RevealView{Answer: d.Reveal(h.game.Crowd(d.Question().Base().ID))}
			if me != nil && me.inQ {
				r := me.res
				q.Reveal.Mine, q.Reveal.Points, q.Reveal.Speed = true, r.Points, r.Speed
				q.Reveal.Right, q.Reveal.Exact, q.Reveal.Missed = r.Right, r.Exact, !me.answered
			}
		}
		v.Question = q
	}
	return v
}

// cut is t's next cut as its players (in their order, those in first) see it: the one after the question now, or a later
// one (none once no cut is left that can put anyone out).
func (h *Hub) cut(t *table, players []PlayerView) *CutView {
	from := t.n
	if t.phase == play.RoyalReveal && t.keep(t.n) == 0 {
		from++ // the answer showing has no cut: the next one's ahead
	}
	for n := from; n < len(h.night.picks)-1; n++ {
		keep := t.keep(n)
		if keep == 0 {
			continue
		}
		c := &CutView{After: n + 1, Keep: keep, Now: t.phase == play.RoyalReveal && n == t.n}
		in := 0
		for _, p := range players {
			if p.In {
				in++
			}
		}
		if c.Now {
			// Those out are out already: the line is the last who went on.
			if in > 0 {
				p := players[in-1]
				c.Line = &ScoreView{Rights: p.Reached, Ms: p.Ms}
			}
			for m := n + 1; m < len(h.night.picks)-1; m++ {
				if t.keep(m) > 0 {
					c.Then = m + 1
					break
				}
			}
		} else if in > keep {
			p := players[keep-1]
			c.Line = &ScoreView{Rights: p.Reached, Ms: p.Ms}
		}
		return c
	}
	return nil
}
