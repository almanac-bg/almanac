// Package royal is Роял played live: every evening at the same time, everyone in it on the same question at the same
// moment. The first wrong answer (or the time running out) is the way out, and those out watch the rest to the end.
//
// The lobby opens a quarter of an hour before the start; whoever is there at the start plays. A tournament takes up
// to play.RoyalSize players: when one is full, the next to come start another, on the same questions. Each moves on
// at its own pace: a question's answer shows once everyone still in has answered, or when its time is up.
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
	// Pause is how long the answer to a question shows (and who went out on it) before the next.
	Pause = 6 * time.Second
	// results is how long, at least, the standings of an evening's games show once they're over.
	results = 2 * time.Minute
	// away is how long a player may be gone from the screen (the line dropped, a phone asleep) and still count as
	// there: for the start, and for the answer to show before the time is up.
	away = 15 * time.Second
)

// Errors a player may cause.
var (
	ErrClosed = errors.New("the lobby isn't open")
	ErrNotNow = errors.New("not now")
)

// Schedule is when the evenings are.
type Schedule struct {
	// Hour and Minute are the start, in Bulgaria, every day.
	Hour, Minute int
	// Every, when set, starts one every Every instead (for trying the game out: one each few minutes).
	Every time.Duration
	// Lobby is how long before the start the lobby opens.
	Lobby time.Duration
}

// Evening is Роял's: every day at 21:00, the lobby open from 20:45.
var Evening = Schedule{Hour: 21, Lobby: 15 * time.Minute}

// Next is the first start after now.
func (s Schedule) Next(now time.Time) time.Time {
	if s.Every > 0 {
		return now.Truncate(s.Every).Add(s.Every)
	}
	d := now.In(play.Bulgaria)
	t := time.Date(d.Year(), d.Month(), d.Day(), s.Hour, s.Minute, 0, 0, play.Bulgaria)
	if !t.After(now) {
		t = time.Date(d.Year(), d.Month(), d.Day()+1, s.Hour, s.Minute, 0, 0, play.Bulgaria)
	}
	return t
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
	wentOut int // on the question whose answer shows
}

type member struct {
	Player
	key     int
	run     int64
	seen    time.Time // last on the screen
	in      bool      // still in the game
	inQ     bool      // in it for the question now
	reached int       // questions answered right
	outAt   int
	// The question now: whether they've answered, what they gave (as shown), how it went.
	answered bool
	given    json.RawMessage
	res      play.Result
	place    int
	delta    int
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
			h.night = &night{start: l.StartsAt, picks: l.Picks, dealt: h.deal(l.Picks), told: true}
		}
		t := &table{id: l.ID, phase: l.Phase, n: l.N, at: now}
		for i, p := range l.Players {
			m := &member{Player: Player{ID: p.User, Name: p.Name, Tag: p.Tag}, key: i, run: p.Run, seen: now, outAt: -1}
			m.Look, _ = h.game.LookOf(ctx, p.User)
			if p.Run != 0 {
				t.entered++
				m.in, m.reached = !p.Out, p.Right
				if p.Out {
					m.outAt = p.At - 1
				}
				m.inQ = m.in || p.At == l.N+1
				m.answered = p.At > l.N
				m.res.Right = m.answered && p.Right == p.At
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
		h.night = &night{start: next}
		h.changed(nil)
	} else if over, since := n.over(); over && !n.start.Equal(next) &&
		(len(n.tables) == 0 || (!now.Before(next.Add(-h.sched.Lobby)) && now.Sub(since) >= results)) {
		// The evening is over (or nobody came), and its standings have shown: on to the next, whose lobby may be
		// open already.
		h.night = &night{start: next}
		h.changed(nil)
	}
	n := h.night
	if !n.told && !now.Before(n.opens(h.sched)) {
		n.told = true
		h.changed(nil)
	}
	for _, t := range n.tables {
		var err error
		switch t.phase {
		case play.RoyalLobby:
			if !now.Before(n.start) {
				err = h.begin(ctx, t, now)
			}
		case play.RoyalQuestion:
			if d := n.dealt[t.n]; d == nil || now.Sub(t.at) >= play.Limit(d.Question())+play.Grace {
				err = h.reveal(ctx, t, now)
			}
		case play.RoyalReveal:
			if now.Sub(t.at) >= Pause {
				err = h.next(ctx, t, now)
			}
		}
		if err != nil {
			slog.Error("royal", "tournament", t.id, "phase", t.phase, "err", err) // tried again at the next step
		}
	}
}

// Join puts a player in the evening's lobby (again changes nothing): in the tournament with room for them.
func (h *Hub) Join(ctx context.Context, p Player) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	n := h.night
	if n == nil || now.Before(n.opens(h.sched)) || !now.Before(n.start) {
		return ErrClosed
	}
	if _, m := h.mine(p.ID); m != nil {
		m.Player, m.seen = p, now
		return nil
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

// begin starts a tournament with those of its lobby who are there.
func (h *Hub) begin(ctx context.Context, t *table, now time.Time) error {
	var there []int64
	for _, m := range t.members {
		if h.there(m, now) {
			there = append(there, m.ID)
		}
	}
	if len(there) == 0 {
		if _, err := h.game.SettleRoyal(ctx, t.id); err != nil {
			return err
		}
		t.members, t.phase = nil, play.RoyalEnd
		h.changed(nil)
		return nil
	}
	runs, err := h.game.StartRoyal(ctx, t.id, there)
	if err != nil {
		return err
	}
	t.members = slices.DeleteFunc(t.members, func(m *member) bool { return runs[m.ID] == 0 })
	for _, m := range t.members {
		m.run, m.in = runs[m.ID], true
	}
	t.entered = len(t.members)
	h.shown(t, 0, now)
	h.changed(nil)
	return nil
}

// shown is question n on everyone's screen (the database has it so already).
func (h *Hub) shown(t *table, n int, now time.Time) {
	t.phase, t.n, t.at, t.wentOut = play.RoyalQuestion, n, now, 0
	for _, m := range t.members {
		m.inQ, m.answered, m.given, m.res = m.in, false, nil, play.Result{}
	}
}

// Answer takes a player's answer to question n. A wrong one is the way out; once everyone still in has answered,
// the answer shows.
func (h *Hub) Answer(ctx context.Context, id int64, n int, raw json.RawMessage) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	t, m := h.mine(id)
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
	m.answered, m.given, m.res = true, res.Given, res
	if res.Right {
		m.reached++
	} else {
		m.in, m.outAt = false, n
	}
	now := h.now()
	for _, o := range t.members {
		if o.inQ && !o.answered && h.there(o, now) {
			h.changed(t)
			return nil
		}
	}
	return h.reveal(ctx, t, now)
}

// reveal shows the answer to the question now: whoever hasn't answered is out.
func (h *Hub) reveal(ctx context.Context, t *table, now time.Time) error {
	if err := h.game.RevealRoyal(ctx, t.id); err != nil {
		return err
	}
	t.phase, t.at, t.wentOut = play.RoyalReveal, now, 0
	for _, m := range t.members {
		if m.inQ && !m.answered {
			m.in, m.outAt, m.res = false, t.n, play.Result{TimedOut: true}
		}
		if m.inQ && !m.in {
			t.wentOut++
		}
	}
	h.changed(t)
	return nil
}

// next shows the next question, or ends the game: after the last question, or once nobody's left in it.
func (h *Hub) next(ctx context.Context, t *table, now time.Time) error {
	left := slices.ContainsFunc(t.members, func(m *member) bool { return m.in })
	if left && t.n+1 < len(h.night.picks) && h.night.dealt[t.n+1] != nil {
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

// View is the evening as one player sees it.
type View struct {
	// Phase is "soon" (the lobby isn't open), or the tournament's: "lobby", "question", "reveal", "end".
	Phase    string `json:"phase"`
	StartsAt int64  `json:"startsAt"`
	OpensAt  int64  `json:"opensAt"`
	// Next is the next evening's start (StartsAt's, until the evening's begun).
	Next int64 `json:"next"`
	// Now is the server's clock, for the countdowns.
	Now    int64 `json:"now"`
	Length int   `json:"length"`
	Round  int   `json:"round"`
	Size   int   `json:"size"`
	// In says the viewer is in this tournament (its lobby, or its game), and Out that they're out of its game.
	In  bool `json:"in"`
	Out bool `json:"out"`
	// Tables is how many tournaments there are this evening.
	Tables  int `json:"tables"`
	N       int `json:"n"`
	Entered int `json:"entered"`
	// Left is how many are still in; WentOut, how many went out on the question whose answer shows.
	Left     int           `json:"left"`
	WentOut  int           `json:"wentOut"`
	Players  []PlayerView  `json:"players"`
	Question *QuestionView `json:"question,omitempty"`
	// RunID is the viewer's run, once it's over: to go over its questions.
	RunID int64 `json:"runId,omitempty"`
	Place int   `json:"place,omitempty"`
	Delta int   `json:"delta,omitempty"`
}

type PlayerView struct {
	play.Look
	// Key tells players apart in a tournament (names may repeat).
	Key     int    `json:"key"`
	Name    string `json:"name"`
	Tag     string `json:"tag"`
	In      bool   `json:"in"`
	Reached int    `json:"reached"`
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
	v.Next = h.sched.Next(now).UnixMilli()
	t, me := h.watched(viewer)
	if t == nil {
		if !now.Before(n.opens(h.sched)) && now.Before(n.start) {
			v.Phase = play.RoyalLobby // open, and nobody in yet
		}
		return v
	}
	v.Phase, v.N, v.Entered, v.WentOut = t.phase, t.n, t.entered, t.wentOut
	if me != nil {
		v.In, v.Out = true, t.phase != play.RoyalLobby && !me.in
		if t.phase == play.RoyalEnd || (v.Out && t.phase != play.RoyalQuestion) {
			v.RunID = me.run
		}
		v.Place, v.Delta = me.place, me.delta
	}
	for _, m := range t.members {
		if m.in {
			v.Left++
		}
		v.Players = append(v.Players, PlayerView{
			Look: m.Look, Key: m.key, Name: m.Name, Tag: m.Tag, In: m.in, Reached: m.reached, OutAt: m.outAt,
			Online: h.online[m.ID] > 0, Answered: m.answered, Place: m.place, Delta: m.delta, Me: m == me,
		})
	}
	switch t.phase {
	case play.RoyalLobby:
		v.Left = len(t.members)
	case play.RoyalEnd:
		slices.SortStableFunc(v.Players, func(a, b PlayerView) int { return a.Place - b.Place })
	default:
		// Those still in first, then those out, the last to go out first.
		slices.SortStableFunc(v.Players, func(a, b PlayerView) int {
			if a.In != b.In {
				if a.In {
					return -1
				}
				return 1
			}
			return b.OutAt - a.OutAt
		})
	}
	if (t.phase == play.RoyalQuestion || t.phase == play.RoyalReveal) && n.dealt[t.n] != nil {
		d := n.dealt[t.n]
		limit := play.Limit(d.Question())
		q := &QuestionView{
			Category: d.Question().Base().Category, View: d.View(),
			LimitMs: limit.Milliseconds(), LeftMs: max(0, (limit - now.Sub(t.at)).Milliseconds()),
		}
		if me != nil && me.inQ {
			q.Given = me.given
		}
		if t.phase == play.RoyalReveal {
			q.LeftMs = 0
			q.NextMs = max(1, (Pause - now.Sub(t.at)).Milliseconds())
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
