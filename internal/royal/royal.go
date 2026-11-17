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
// comes late sits at the tournament with fewest in, over its size if every one is full.
//
// The tournaments of an evening go on one clock: a question's answer shows at all of them at once, once everyone
// playing it at any of them has answered (those cut too, so that their answers are taken, but not one who let the last
// one run out, nor one away), or when its time is up; the answer that a cut comes with shows longer (CutPause), with
// who goes on and when the next cut is. So no tournament ever sees an answer while another is still on its question:
// not a player with a second account at another table, nor anyone watching (who follows the first).
//
// The hub keeps the evening's clock and the screens following it. Everything a game does goes through the database
// first (package play), so that a restart of the server picks the game up again where it was. What changes the
// evening (its clock, a player in or out) goes one at a time (op), and writes to the database outside the lock on
// what's in memory (mu), which is held only for moments: an answer, or a screen's look, never waits on a write. An
// answer goes to the database by itself, outside both; the clock moves on only once the answers on their way are in.
// What a game earned its players (achievements, goals, the league) is kept after, off the clock, one player at a time
// (after).
//
// A screen is sent what its tournament's board shows (Board: the lobby before the start, the evening before that),
// made once for each change and the same bytes for every screen following it, with its own part (Own) joined on: a
// look costs the same whether a tournament has five players or fifty, and an answer tells only the screens of its own
// tournament (and those watching the first). The board holds only what's shown: in the lobby, how many are in and the
// first few; during a question, how many have answered; with its answer, and at the end, the standings.
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
	// few is how many of the lobby its board shows (and how many more there are).
	few = 12
)

// How often a screen looks again, at most, after a change: a moment in a game, where the clock runs; a second in the
// lobby, and for those watching a game they're not in, whom a second costs nothing. A change of the viewer's own (in,
// out, their answer taken) is looked at at once.
const (
	glance = 150 * time.Millisecond
	idle   = time.Second
)

// How many screens may follow the evening: all told, of those not signed in, from one address (a school's, a
// family's, a phone network's), and of one player (a phone, a computer, a tab or two). A screen over them is turned
// away (ErrBusy), to try again later.
const (
	maxScreens     = 20000
	maxAnonymous   = 5000
	maxFromAddress = 64
	maxOfPlayer    = 5
)

// Errors a player may cause.
var (
	ErrClosed = errors.New("the lobby isn't open")
	ErrShut   = errors.New("the door is shut") // the games are past the Late-th question
	ErrNotNow = errors.New("not now")
	ErrBusy   = errors.New("too many screens")
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

	// op orders what changes the evening (Step, Join, Leave, Load): one at a time, its writes outside mu.
	op sync.Mutex
	// mu guards everything below, held only for moments.
	mu    sync.Mutex
	night *night
	seats map[int64]seat // each player in tonight's tournaments: where
	subs  map[*Sub]struct{}
	// screens are each signed-in viewer's; lookers, those of viewers without a seat (they follow the first
	// tournament); from, how many each address has.
	screens map[int64]map[*Sub]struct{}
	lookers map[*Sub]struct{}
	from    map[string]int
	anon    int
	// The boards with no tournament of their own: the lobby's (all of its tables as one), and the evening's with
	// none (before its lobby opens, or nobody came).
	lobby, none board

	after after
}

func NewHub(g *play.Game, s Schedule) *Hub {
	return &Hub{game: g, sched: s, seats: map[int64]seat{}, subs: map[*Sub]struct{}{},
		screens: map[int64]map[*Sub]struct{}{}, lookers: map[*Sub]struct{}{}, from: map[string]int{}}
}

// night is an evening: its start, its questions, its tournaments, and its clock.
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
	// open (open). The database keeps them in their tournament, without a run.
	absent map[int64]Player
	// The clock, every tournament's: the phase (play.RoyalLobby until the games begin; then the question showing, or
	// its answer; play.RoyalEnd once over), the question, and when the phase began; paced, how far into the question
	// its screens were last shown more of it (bank.Paced).
	phase string
	n     int
	at    time.Time
	paced time.Duration
	// closing says the question showing takes no more answers: its answer shows once those on their way (sending)
	// are in.
	closing bool
	sending int
	// keys is the last key given: keys tell the evening's players apart (names may repeat).
	keys int
}

func newNight(start time.Time, told bool) *night {
	return &night{start: start, told: told, absent: map[int64]Player{}, phase: play.RoyalLobby}
}

func (n *night) opens(s Schedule) time.Time { return n.start.Add(-s.Lobby) }

// over says whether all of the evening's games are over (or none began), and since when.
func (n *night) over() (bool, time.Time) {
	if len(n.tables) == 0 {
		return true, time.Time{}
	}
	return n.phase == play.RoyalEnd, n.at
}

// open says whether one may still come into the games: until the answer to the Late-th question shows.
func (n *night) open() bool {
	return (n.phase == play.RoyalQuestion && n.n < Late) || (n.phase == play.RoyalReveal && n.n < Late-1)
}

// key is a key no other player of the evening has.
func (n *night) key() int {
	n.keys++
	return n.keys
}

// table is one tournament of an evening.
type table struct {
	id      int64
	members []*member
	entered int
	wentOut int // on the question whose answer shows
	// order is its players as they stand (rank), and cut its next cut.
	order []*member
	cut   *CutView
	// done is where the database has it, as the clock moves on (one tournament at a time): the reveal it made (or
	// the places), kept until every tournament has its own.
	done   step
	shown  *play.RoyalShown
	places []play.RoyalStanding
	board  board
}

// step is a phase of the clock at a question.
type step struct {
	phase string
	n     int
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
	// The question now: whether they've answered (or their answer is on its way: sending), what they gave (as
	// shown), how it went.
	answered bool
	sending  bool
	given    json.RawMessage
	res      play.Result
	place    int
	delta    int
	// rank is where they stand, and goes whether they'd go on at the next cut as they stand (rank).
	rank int
	goes bool
}

type seat struct {
	t *table
	m *member
}

func (h *Hub) now() time.Time { return h.game.Now() }

// mine finds the player's tournament tonight, and them in it.
func (h *Hub) mine(id int64) (*table, *member) {
	s, ok := h.seats[id]
	if !ok {
		return nil, nil
	}
	return s.t, s.m
}

// sit seats a player at t; unsit takes their seat away. Their screens follow t, or the first tournament.
func (h *Hub) sit(t *table, m *member) {
	h.seats[m.ID] = seat{t, m}
	for s := range h.screens[m.ID] {
		delete(h.lookers, s)
	}
	h.tell(m.ID)
}

func (h *Hub) unsit(id int64) {
	if _, ok := h.seats[id]; !ok {
		return
	}
	delete(h.seats, id)
	for s := range h.screens[id] {
		h.lookers[s] = struct{}{}
	}
	h.tell(id)
}

// there says whether a player is on the screen, or was a moment ago.
func (h *Hub) there(m *member, now time.Time) bool {
	return len(h.screens[m.ID]) > 0 || now.Sub(m.seen) < away
}

// renew starts an evening (the one after the last), its lobby open already if told.
func (h *Hub) renew(start time.Time, told bool) {
	h.night = newNight(start, told)
	for id := range h.seats {
		h.unsit(id)
	}
	h.changed()
}

// Load picks up the tournaments the server was running before it restarted. Those it finds a step apart (it stopped
// as the clock moved them on, one by one) are brought to the one furthest on; a lobby whose evening began is let go,
// those in it free to come in late.
func (h *Hub) Load(ctx context.Context) error {
	live, err := h.game.LiveRoyals(ctx)
	if err != nil {
		return err
	}
	h.op.Lock()
	defer h.op.Unlock()
	now := h.now()
	var n *night
	var lobbies []*table
	for _, l := range live {
		if n == nil || !n.start.Equal(l.StartsAt) {
			if n != nil && n.start.After(l.StartsAt) {
				continue // an older evening's: SettleDue ends it
			}
			n = newNight(l.StartsAt, true)
			n.picks, n.dealt = l.Picks, h.deal(l.Picks)
			lobbies = nil
		}
		t := &table{id: l.ID, done: step{l.Phase, l.N}}
		for _, p := range l.Players {
			m := &member{Player: Player{ID: p.User, Name: p.Name, Tag: p.Tag}, key: n.key(), run: p.Run, seen: now, outAt: -1}
			m.Look, _ = h.game.LookOf(ctx, p.User)
			if p.Run == 0 && l.Phase != play.RoyalLobby {
				n.absent[p.User] = m.Player // away at the start
				continue
			}
			if p.Run != 0 {
				t.entered++
				m.in, m.reached, m.ms, m.rights, m.outAt = p.OutAt < 0, p.Right, p.RightMs, p.Rights, p.OutAt
				m.inQ, m.stood = true, m.in || p.OutAt == l.N
				// Their answer to the question now, as it was: given, or (its answer showing) their time run out.
				m.answered = p.Now && (p.Gave || l.Phase == play.RoyalQuestion)
				if m.answered {
					m.given = p.Shown
					m.res = play.Result{Right: p.NowRight, Points: p.Points, Given: p.Shown}
				}
				if l.Phase == play.RoyalReveal && !m.answered {
					m.res.TimedOut = true
				}
				m.idle = l.Phase == play.RoyalReveal && !m.answered
			}
			t.members = append(t.members, m)
		}
		if l.Phase == play.RoyalLobby {
			lobbies = append(lobbies, t)
		}
		n.tables = append(n.tables, t)
	}
	if n == nil {
		return nil
	}
	// The clock: the furthest on of those begun.
	for _, t := range n.tables {
		if t.done.phase != play.RoyalLobby && (n.phase == play.RoyalLobby || further(t.done, step{n.phase, n.n})) {
			n.phase, n.n = t.done.phase, t.done.n
		}
	}
	h.mu.Lock()
	h.night = n
	h.mu.Unlock()
	if n.phase != play.RoyalLobby {
		n.held = true
		for _, t := range lobbies {
			// Begun without it: those in it come in late, while the door is open.
			for _, m := range t.members {
				n.absent[m.ID] = m.Player
			}
			t.members = nil
			if err := h.empty(ctx, t); err != nil {
				return err
			}
		}
		for _, t := range n.tables {
			for t.done != (step{n.phase, n.n}) {
				if err := h.catchUp(ctx, t); err != nil {
					return err
				}
			}
		}
		n.at = now
		if n.phase == play.RoyalQuestion {
			// The question shows again, its time from now, for those who hadn't answered it.
			at, err := h.game.ShowRoyal(ctx, n.n, h.ids(n.tables)...)
			if err != nil {
				return err
			}
			n.at = at
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, t := range n.tables {
		for _, m := range t.members {
			h.sit(t, m)
		}
		h.rank(t)
	}
	h.changed()
	return nil
}

// further says whether a is further on than b.
func further(a, b step) bool {
	if a.n != b.n {
		return a.n > b.n
	}
	return a.phase == play.RoyalReveal && b.phase == play.RoyalQuestion
}

// catchUp moves a tournament found behind the clock at a restart on by one step, as the clock would have.
func (h *Hub) catchUp(ctx context.Context, t *table) error {
	if t.done.phase == play.RoyalQuestion {
		rv, err := h.game.RevealRoyal(ctx, t.id)
		if err != nil {
			return err
		}
		t.shown, t.done.phase = &rv, play.RoyalReveal
		h.later(rv.Ended, true)
		h.revealed(t, t.done.n)
		return nil
	}
	if _, err := h.game.ShowRoyal(ctx, t.done.n+1, t.id); err != nil {
		return err
	}
	t.done = step{play.RoyalQuestion, t.done.n + 1}
	h.question(t)
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

func (h *Hub) ids(tables []*table) []int64 {
	ids := make([]int64, len(tables))
	for i, t := range tables {
		ids[i] = t.id
	}
	return ids
}

// Step moves the evening on: the lobby opens, the game starts, a question's time runs out, the next question shows,
// the game ends. Run it a few times a second.
func (h *Hub) Step(ctx context.Context) {
	h.op.Lock()
	defer h.op.Unlock()
	h.mu.Lock()
	now := h.now()
	next := h.sched.Next(now)
	if n := h.night; n == nil {
		h.renew(next, false)
	} else if over, since := n.over(); over && !n.start.Equal(next) &&
		(len(n.tables) == 0 || (!now.Before(next.Add(-h.sched.Lobby)) && now.Sub(since) >= results)) {
		// The evening is over (or nobody came), and its standings have shown: on to the next, whose lobby may be
		// open already.
		h.renew(next, false)
	} else if len(n.tables) == 0 && now.Before(n.opens(h.sched)) && !n.start.Equal(next) {
		// The days it plays on changed (play.RoyalPaceOf, a day's) before this one's lobby opened.
		h.renew(next, false)
	}
	n := h.night
	if !n.told && !now.Before(n.opens(h.sched)) {
		n.told = true
		h.changed()
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
					if len(h.screens[m.ID]) == 0 {
						away = append(away, m.ID)
					}
				}
			}
			go h.Soon(context.WithoutCancel(ctx), n.start, away, in)
		}
	}
	held := !n.held && !now.Before(n.start)
	if held {
		n.held = true
		h.changed() // begun: those not in see the first tournament, or that there's none
	}
	begin := !now.Before(n.start) && n.phase == play.RoyalLobby && len(n.tables) > 0
	var back []Player
	if n.open() {
		for id, p := range n.absent {
			if len(h.screens[id]) > 0 {
				back = append(back, p)
			}
		}
	}
	h.mu.Unlock()

	if held {
		if err := h.game.HeldRoyal(ctx, n.start); err != nil {
			slog.Error("royal", "held", n.start, "err", err)
		}
	}
	if begin {
		if err := h.begin(ctx, now); err != nil {
			slog.Error("royal", "start", n.start, "err", err) // tried again at the next step
			return
		}
	}
	// Those away at the start whose screen is back come in, while the door is open.
	for _, p := range back {
		if err := h.late(ctx, p, now); err != nil && !errors.Is(err, ErrShut) {
			slog.Error("royal", "late", p.ID, "err", err)
		}
	}
	// A tournament nobody was there for at the start, and nobody came into while the door was open, ends.
	if n.phase != play.RoyalLobby && n.phase != play.RoyalEnd && !n.open() {
		for _, t := range slices.Clone(n.tables) {
			if len(t.members) == 0 {
				if err := h.empty(ctx, t); err != nil {
					slog.Error("royal", "tournament", t.id, "empty", err)
				}
			}
		}
	}
	if err := h.tick(ctx); err != nil {
		slog.Error("royal", "start", n.start, "phase", n.phase, "n", n.n, "err", err) // tried again at the next step
	}
}

// tick moves the clock on, once it's time: the answer shows (the question closed, everyone playing it having
// answered: Answer; or its time is up), the next question shows, or the games end. Called with op held.
func (h *Hub) tick(ctx context.Context) error {
	h.mu.Lock()
	n, now := h.night, h.now()
	switch n.phase {
	case play.RoyalQuestion:
		d := n.dealt[n.n]
		if !n.closing && d != nil && now.Sub(n.at) < play.Limit(d.Question())+play.Grace {
			if next := bank.NextStep(d, n.paced); next > 0 && now.Sub(n.at) >= n.paced+next {
				// More of the question shows (its next clue): the screens look again.
				n.paced += next
				h.changed()
			}
			h.mu.Unlock()
			return nil
		}
		n.closing = true
		if n.sending > 0 {
			h.mu.Unlock()
			return nil // the answers on their way go in first: the last of them moves the clock on
		}
		tables := slices.Clone(n.tables)
		h.mu.Unlock()
		return h.reveal(ctx, tables)
	case play.RoyalReveal:
		if now.Sub(n.at) < h.pause() {
			h.mu.Unlock()
			return nil
		}
		last, tables := h.last(), slices.Clone(n.tables)
		h.mu.Unlock()
		if last {
			return h.end(ctx, tables)
		}
		return h.show(ctx, tables, n.n+1)
	}
	h.mu.Unlock()
	return nil
}

// allIn says whether everyone playing the question now, at every tournament, has answered it: those cut too, but not
// one who let the last question they played run out (until they answer again), nor one away.
func (h *Hub) allIn(now time.Time) bool {
	for _, t := range h.night.tables {
		for _, o := range t.members {
			if o.inQ && !o.answered && (o.in || !o.idle) && h.there(o, now) {
				return false
			}
		}
	}
	return true
}

// reveal shows the answer to the question now, at every tournament at once, with the standings it makes, and takes
// out whoever a cut after it puts out (play.RevealRoyal). A tournament whose answer the database shows already (a try
// before failed at another) keeps what it made.
func (h *Hub) reveal(ctx context.Context, tables []*table) error {
	n := h.night
	for _, t := range tables {
		if t.done == (step{play.RoyalReveal, n.n}) {
			continue
		}
		rv, err := h.game.RevealRoyal(ctx, t.id)
		if err != nil {
			return err
		}
		t.shown, t.done = &rv, step{play.RoyalReveal, n.n}
		h.later(rv.Ended, true)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	n.phase, n.at, n.closing = play.RoyalReveal, h.now(), false
	for _, t := range n.tables {
		h.revealed(t, n.n)
	}
	h.changed()
	return nil
}

// revealed is the answer to question k shown at t, as the database made it (t.shown).
func (h *Hub) revealed(t *table, k int) {
	rv := t.shown
	t.shown, t.wentOut = nil, 0
	if rv == nil {
		return // shown before a restart: its players are as the database had them
	}
	scores := map[int64]play.RoyalScore{}
	for _, s := range rv.Scores {
		scores[s.User] = s
	}
	for _, m := range t.members {
		if s, ok := scores[m.ID]; ok {
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
		if slices.Contains(rv.Out, m.ID) {
			m.in, m.outAt = false, k
			t.wentOut++
		}
	}
	h.rank(t)
}

// show puts question k on every tournament's screens at once.
func (h *Hub) show(ctx context.Context, tables []*table, k int) error {
	at, err := h.game.ShowRoyal(ctx, k, h.ids(tables)...)
	if err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	n := h.night
	n.phase, n.n, n.at, n.paced, n.closing = play.RoyalQuestion, k, at, 0, false
	for _, t := range n.tables {
		t.done = step{play.RoyalQuestion, k}
		h.question(t)
	}
	h.changed()
	return nil
}

// question is a new question on t's screens: everyone plays it.
func (h *Hub) question(t *table) {
	t.wentOut = 0
	for _, m := range t.members {
		m.inQ, m.stood, m.answered, m.given, m.res = true, m.in, false, nil, play.Result{}
	}
	h.rank(t)
}

// end ends the games: the places, and the ratings they move (play.SettleRoyal). Those away hear how theirs went.
func (h *Hub) end(ctx context.Context, tables []*table) error {
	for _, t := range tables {
		if t.done.phase == play.RoyalEnd {
			continue
		}
		places, err := h.game.SettleRoyal(ctx, t.id)
		if err != nil {
			return err
		}
		t.places, t.done = places, step{play.RoyalEnd, h.night.n}
		for _, p := range places {
			h.later([]int64{p.User}, p.Ended)
		}
	}
	var news []play.RoyalNews
	h.mu.Lock()
	n, now := h.night, h.now()
	n.phase, n.at = play.RoyalEnd, now
	for _, t := range n.tables {
		for _, p := range t.places {
			_, m := h.mine(p.User)
			if m == nil {
				continue
			}
			m.place, m.delta = p.Place, p.Delta
			if !h.there(m, now) {
				news = append(news, play.RoyalNews{To: m.ID, Place: p.Place, Of: len(t.places), Delta: p.Delta})
			}
		}
		t.places = nil
		h.rank(t)
	}
	h.changed()
	h.mu.Unlock()
	if h.News != nil {
		for _, x := range news {
			h.News(ctx, x)
		}
	}
	return nil
}

// Join puts a player in the evening's lobby (again changes nothing): in the tournament with room for them. Once the
// games have begun, it puts them in one late, while the door is open (Late; ErrShut after). Once they're over, it
// puts them in the next evening's lobby if that's open already (evenings a few minutes apart, to try the game out).
func (h *Hub) Join(ctx context.Context, p Player) error {
	h.op.Lock()
	defer h.op.Unlock()
	h.mu.Lock()
	now := h.now()
	n := h.night
	if n != nil && !now.Before(n.start) {
		if over, _ := n.over(); over {
			if next := h.sched.Next(now); !now.Before(next.Add(-h.sched.Lobby)) {
				h.renew(next, true)
				n = h.night
			}
		}
	}
	if n == nil || now.Before(n.opens(h.sched)) {
		h.mu.Unlock()
		return ErrClosed
	}
	if t, m := h.mine(p.ID); m != nil {
		m.Player, m.seen = p, now
		h.touch(t)
		h.mu.Unlock()
		return nil
	}
	if !now.Before(n.start) {
		h.mu.Unlock()
		return h.late(ctx, p, now)
	}
	var t *table
	if k := len(n.tables); k > 0 && len(n.tables[k-1].members) < play.RoyalSize {
		t = n.tables[k-1]
	}
	picks := n.picks
	h.mu.Unlock()

	if t == nil {
		if picks == nil {
			var err error
			if picks, err = h.game.DrawRoyal(ctx); err != nil {
				return err
			}
		}
		id, err := h.game.NewRoyal(ctx, n.start, picks)
		if err != nil {
			return err
		}
		t = &table{id: id, done: step{play.RoyalLobby, 0}}
		h.mu.Lock()
		if n.picks == nil {
			n.picks, n.dealt = picks, h.deal(picks)
		}
		n.tables = append(n.tables, t)
		h.mu.Unlock()
	}
	if err := h.game.JoinRoyal(ctx, t.id, p.ID); err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	m := &member{Player: p, key: n.key(), seen: now, outAt: -1}
	t.members = append(t.members, m)
	h.sit(t, m)
	h.touch(t)
	return nil
}

// Leave takes a player out of the lobby.
func (h *Hub) Leave(ctx context.Context, id int64) error {
	h.op.Lock()
	defer h.op.Unlock()
	h.mu.Lock()
	t, m := h.mine(id)
	n := h.night // set, with a seat
	begun := m != nil && (n.phase != play.RoyalLobby || !h.now().Before(n.start))
	h.mu.Unlock()
	if m == nil {
		return nil
	}
	if begun {
		return ErrNotNow
	}
	if err := h.game.LeaveRoyal(ctx, t.id, id); err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	t.members = slices.DeleteFunc(t.members, func(x *member) bool { return x == m })
	h.unsit(id)
	h.touch(t)
	return nil
}

// begin starts the evening's tournaments with those of their lobbies who are there, dealt into as few as hold
// everyone of the lobbies (those not there too: each keeps a seat), of sizes as even as can be, in the order they
// came. Those not there are kept aside (absent), in the first: they're in if they come back while the door is open. A
// tournament nobody is left in, and nobody may come back to, ends. A start that fails part way is tried again whole:
// each player keeps the seat and the run it gave them (play.StartRoyal).
func (h *Hub) begin(ctx context.Context, now time.Time) error {
	h.mu.Lock()
	n := h.night
	lobbies := slices.Clone(n.tables)
	var there, away []*member
	for _, t := range lobbies {
		for _, m := range t.members {
			if h.there(m, now) {
				there = append(there, m)
			} else {
				away = append(away, m)
			}
		}
	}
	h.mu.Unlock()
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
	h.mu.Lock()
	for _, t := range lobbies {
		t.members = moved[t]
		for _, m := range t.members {
			h.seats[m.ID] = seat{t, m}
		}
	}
	h.mu.Unlock()
	for _, t := range lobbies[k:] {
		if err := h.empty(ctx, t); err != nil {
			return err
		}
	}
	lobbies = lobbies[:k]
	if k == 0 {
		return nil // everyone left: no game
	}
	here := map[*member]bool{}
	for _, m := range there {
		here[m] = true
	}
	runs := map[int64]int64{}
	var at time.Time
	for _, t := range lobbies {
		var ids []int64
		for _, m := range t.members {
			if here[m] {
				ids = append(ids, m.ID)
			}
		}
		got, shown, err := h.game.StartRoyal(ctx, t.id, ids)
		if err != nil {
			return err
		}
		for id, run := range got {
			runs[id] = run
		}
		t.done, at = step{play.RoyalQuestion, 0}, shown
	}
	if len(lobbies) > 1 {
		// One clock: the first question's time starts for all of them at once, now that all have it.
		var err error
		if at, err = h.game.ShowRoyal(ctx, 0, h.ids(lobbies)...); err != nil {
			return err
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	n.phase, n.n, n.at, n.paced, n.closing = play.RoyalQuestion, 0, at, 0, false
	for _, t := range lobbies {
		t.members = slices.DeleteFunc(t.members, func(m *member) bool {
			if runs[m.ID] == 0 {
				n.absent[m.ID] = m.Player
				h.unsit(m.ID)
				return true
			}
			return false
		})
		for _, m := range t.members {
			m.run, m.in = runs[m.ID], true
		}
		t.entered = len(t.members)
		h.question(t)
	}
	h.changed()
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
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, m := range t.members {
		delete(h.night.absent, m.ID)
		h.unsit(m.ID)
	}
	t.members, t.done = nil, step{play.RoyalEnd, 0}
	h.night.tables = slices.DeleteFunc(h.night.tables, func(x *table) bool { return x == t })
	h.changed() // those watching the first may watch another now
	return nil
}

// late puts a player in a game under way, while its door is open: the one that has fewest in, over play.RoyalSize if
// every one is full (nobody is shut out while the door is open). The questions before the one showing count as not
// answered; the one showing is theirs to answer in the time it has left. Called with op held.
func (h *Hub) late(ctx context.Context, p Player, now time.Time) error {
	h.mu.Lock()
	n := h.night
	var t *table
	if n.open() {
		for _, x := range n.tables {
			if t == nil || len(x.members) < len(t.members) {
				t = x
			}
		}
	}
	h.mu.Unlock()
	if t == nil {
		return ErrShut
	}
	run, err := h.game.EnterRoyal(ctx, t.id, p.ID)
	if err != nil {
		return err
	}
	if p.Look == (play.Look{}) {
		p.Look, _ = h.game.LookOf(ctx, p.ID)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(n.absent, p.ID)
	m := &member{Player: p, key: n.key(), run: run, seen: now, in: true, outAt: -1}
	m.inQ = n.phase == play.RoyalQuestion
	m.stood = m.inQ
	if n.phase == play.RoyalReveal {
		m.res = play.Result{TimedOut: true} // the answer showing: they weren't in for it
	}
	t.members = append(t.members, m)
	t.entered++
	h.sit(t, m)
	h.rank(t)
	h.touch(t)
	return nil
}

// Answer takes a player's answer to question n (still in, or on after a cut). Once everyone playing it, at every
// tournament, has answered, the answer shows: those cut too, on the same clock, but not one away or who let the last
// question run out (until they answer again). An answer sent again (its reply lost on the way) is the one taken
// already: no error, while its question or its answer shows.
func (h *Hub) Answer(ctx context.Context, id int64, n int, raw json.RawMessage) error {
	at := h.now() // its time is to when it came, not to when the hub (busy with others') takes it
	h.mu.Lock()
	t, m := h.mine(id)
	night := h.night
	if m != nil && n == night.n && m.inQ && m.answered &&
		(night.phase == play.RoyalQuestion || night.phase == play.RoyalReveal) {
		h.mu.Unlock()
		return nil
	}
	if m == nil || night.phase != play.RoyalQuestion || night.closing || n != night.n || !m.inQ || m.answered || m.sending {
		h.mu.Unlock()
		return ErrNotNow
	}
	if len(raw) == 0 || string(raw) == "null" {
		h.mu.Unlock()
		return play.ErrBadAnswer
	}
	m.sending, night.sending = true, night.sending+1
	run := m.run
	h.mu.Unlock()

	res, err := h.game.AnswerRoyal(ctx, id, run, n, raw, at)

	h.mu.Lock()
	m.sending, night.sending = false, night.sending-1
	if err == nil {
		// How it went shows to the others with the answer (reveal), not before.
		m.answered, m.given, m.res, m.idle = true, res.Given, res, false
		h.touch(t)
		if h.allIn(h.now()) {
			night.closing = true // the answer shows now: the clock moves on (tick)
		}
	}
	move := night.sending == 0 && night.closing
	h.mu.Unlock()

	if err == nil && res.State.Done {
		h.later([]int64{id}, true)
	}
	if move {
		h.Step(context.WithoutCancel(ctx))
	}
	if errors.Is(err, play.ErrOutOfStep) {
		return ErrNotNow // the time ran out
	}
	return err
}

// keep is how many go on at t's cut after question k (play.RoyalKeep), 0 if none: none either where it can't put
// anyone out, with no more in than it keeps (two players, or a few after an earlier cut). Those in now are those in
// the standings for question k, if it's the question now, or at most those who will be, for one ahead.
func (h *Hub) keep(t *table, k int) int {
	c, in := play.RoyalKeep(k, t.entered), 0
	for _, m := range t.members {
		if (k == h.night.n && m.stood) || (k != h.night.n && m.in) {
			in++
		}
	}
	if c >= in {
		return 0
	}
	return c
}

// pause is how long the answer showing shows: longer where it comes with a cut, at any tournament.
func (h *Hub) pause() time.Duration {
	for _, t := range h.night.tables {
		if h.keep(t, h.night.n) > 0 {
			return CutPause
		}
	}
	return Pause
}

// last says whether the games end once the answer showing has shown: after the last question.
func (h *Hub) last() bool {
	n := h.night
	return n.n+1 >= len(n.picks) || n.dealt[n.n+1] == nil
}

// rank puts t's players in their order: before its end, those still in first, then those out, the last to go out
// first, each as they stand (those level share a rank), with its next cut and who'd go on at it; at its end, by their
// places.
func (h *Hub) rank(t *table) {
	order := slices.Clone(t.members)
	t.cut = nil
	switch h.night.phase {
	case play.RoyalLobby:
	case play.RoyalEnd:
		slices.SortStableFunc(order, func(a, b *member) int { return a.place - b.place })
		for _, m := range order {
			m.rank, m.goes = m.place, false
		}
	default:
		ahead := func(a, b *member) int {
			if a.in != b.in {
				if a.in {
					return -1
				}
				return 1
			}
			if a.outAt != b.outAt {
				return b.outAt - a.outAt
			}
			return play.RoyalAhead(play.RoyalScore{Rights: a.reached, Ms: a.ms}, play.RoyalScore{Rights: b.reached, Ms: b.ms})
		}
		slices.SortStableFunc(order, ahead)
		for i, m := range order {
			m.rank = i + 1
			if i > 0 && ahead(order[i-1], m) == 0 {
				m.rank = order[i-1].rank
			}
		}
		t.cut = h.cutOf(t, order)
		for _, m := range order {
			m.goes = t.cut != nil && m.in && (t.cut.Line == nil ||
				play.RoyalAhead(play.RoyalScore{Rights: m.reached, Ms: m.ms}, play.RoyalScore{Rights: t.cut.Line.Rights, Ms: t.cut.Line.Ms}) <= 0)
		}
	}
	t.order = order
	t.board.changed()
}

// cutOf is t's next cut as its players (in their order, those in first) see it: the one after the question now, or a
// later one (none once no cut is left that can put anyone out).
func (h *Hub) cutOf(t *table, order []*member) *CutView {
	n := h.night
	from := n.n
	if n.phase == play.RoyalReveal && h.keep(t, n.n) == 0 {
		from++ // the answer showing has no cut: the next one's ahead
	}
	in := 0
	for _, m := range order {
		if m.in {
			in++
		}
	}
	for k := from; k < len(n.picks)-1; k++ {
		keep := h.keep(t, k)
		if keep == 0 {
			continue
		}
		c := &CutView{After: k + 1, Keep: keep, Now: n.phase == play.RoyalReveal && k == n.n}
		if c.Now {
			// Those out are out already: the line is the last who went on.
			if in > 0 {
				m := order[in-1]
				c.Line = &ScoreView{Rights: m.reached, Ms: m.ms}
			}
			for j := k + 1; j < len(n.picks)-1; j++ {
				if h.keep(t, j) > 0 {
					c.Then = j + 1
					break
				}
			}
		} else if in > keep {
			m := order[keep-1]
			c.Line = &ScoreView{Rights: m.reached, Ms: m.ms}
		}
		return c
	}
	return nil
}

// Sub is a screen following the evening: C says it changed (Look then), and Own that the viewer's own part did
// (look at once, whatever the pause after the last).
type Sub struct {
	C, Own chan struct{}
	viewer int64
	from   string
}

// Follow is a player's screen following the evening (viewer 0: someone not signed in, who may look), from an address
// (a network: those of an IPv6 /64 are one). ErrBusy: too many screens, of the player's, the address's or all.
func (h *Hub) Follow(viewer int64, from string) (*Sub, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.subs) >= maxScreens || h.from[from] >= maxFromAddress || len(h.screens[viewer]) >= maxOfPlayer ||
		(viewer == 0 && h.anon >= maxAnonymous) {
		return nil, ErrBusy
	}
	s := &Sub{C: make(chan struct{}, 1), Own: make(chan struct{}, 1), viewer: viewer, from: from}
	h.subs[s] = struct{}{}
	h.from[from]++
	s.C <- struct{}{} // the evening as it is
	if viewer == 0 {
		h.anon++
		h.lookers[s] = struct{}{}
		return s, nil
	}
	if h.screens[viewer] == nil {
		h.screens[viewer] = map[*Sub]struct{}{}
	}
	h.screens[viewer][s] = struct{}{}
	t, m := h.mine(viewer)
	if m == nil {
		h.lookers[s] = struct{}{}
	} else if h.night.phase == play.RoyalLobby && len(h.screens[viewer]) == 1 {
		h.touch(t) // on the screen again: their chip shows so
	}
	return s, nil
}

// Unfollow is a screen gone (closed, offline).
func (h *Hub) Unfollow(s *Sub) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.subs[s]; !ok {
		return
	}
	delete(h.subs, s)
	delete(h.lookers, s)
	if h.from[s.from]--; h.from[s.from] <= 0 {
		delete(h.from, s.from)
	}
	if s.viewer == 0 {
		h.anon--
		return
	}
	delete(h.screens[s.viewer], s)
	if len(h.screens[s.viewer]) > 0 {
		return
	}
	delete(h.screens, s.viewer)
	if t, m := h.mine(s.viewer); m != nil {
		m.seen = h.now()
		if h.night.phase == play.RoyalLobby {
			h.touch(t)
		}
	}
}

// changed tells every screen to look again: the clock moved, so every board changed. Called with mu held.
func (h *Hub) changed() {
	h.lobby.changed()
	h.none.changed()
	if h.night != nil {
		for _, t := range h.night.tables {
			t.board.changed()
		}
	}
	for s := range h.subs {
		wake(s.C)
	}
}

// touch tells the screens following t that it changed: its players', and those watching the first, if it is (the
// lobby's, before the start: everyone's). Called with mu held.
func (h *Hub) touch(t *table) {
	t.board.changed()
	if h.night.phase == play.RoyalLobby {
		h.lobby.changed()
		for s := range h.subs {
			wake(s.C)
		}
		return
	}
	for _, m := range t.members {
		for s := range h.screens[m.ID] {
			wake(s.C)
		}
	}
	if len(h.night.tables) > 0 && h.night.tables[0] == t {
		for s := range h.lookers {
			wake(s.C)
		}
	}
}

// tell tells a player's screens their own part changed. Called with mu held.
func (h *Hub) tell(id int64) {
	for s := range h.screens[id] {
		wake(s.C)
		wake(s.Own)
	}
}

func wake(c chan struct{}) {
	select {
	case c <- struct{}{}:
	default: // it hasn't looked since the last change; one look will do for both
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

// Near says whether an evening is near or on: from lead before its lobby opens until its games are over and what
// they earned is kept (after). A restart of the server waits for it to pass (the game would come back, but not
// without a gap at its best moment).
func (h *Hub) Near(lead time.Duration) bool {
	if h.after.busy() {
		return true
	}
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

// Playing says whether a player's game tonight is under way (they're in a tournament past its lobby and before its
// end, or were in a lobby, away at the start, and may still come in): one whose screen went may come back to it.
func (h *Hub) Playing(id int64) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := h.night
	if n == nil {
		return false
	}
	if _, m := h.mine(id); m != nil {
		return n.phase == play.RoyalQuestion || n.phase == play.RoyalReveal
	}
	_, away := n.absent[id]
	return away && n.open()
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
			if n.phase == play.RoyalLobby || m.in {
				g.In++
			}
		}
	}
	return g
}
