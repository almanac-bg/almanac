// Package room is playing live: a room has a code, its players see the same question at the same moment, and a
// scoreboard after each.
//
// A room is opened by a host, who sets the pace (anyone may while the host is away).
//
// Rooms live in memory: they're for playing now, and close on their own when nobody's left.
package room

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	mrand "math/rand/v2"
	"slices"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
)

const (
	// MaxPlayers is how many fit in a room: a class, a party.
	MaxPlayers = 50
	// Grace is how late an answer may arrive and still count.
	Grace = time.Second
	// Pause is how long a room shows an answer (and the standings) before it moves on by itself.
	Pause = 6 * time.Second
	// maxRooms caps the rooms open at once, so that nobody can fill the server's memory with them.
	maxRooms = 2000
)

type Phase string

const (
	Lobby    Phase = "lobby"
	Question Phase = "question"
	Reveal   Phase = "reveal"
	End      Phase = "end"
)

// Errors a player may cause.
var (
	ErrNoRoom   = errors.New("no such room")
	ErrFull     = errors.New("the room is full")
	ErrNotYours = errors.New("only the host can do that")
	ErrNotNow   = errors.New("not now")
	ErrAnswer   = errors.New("an answer the question can't take")
	ErrTooMany  = errors.New("too many rooms")
)

// Player is someone in a room.
type Player struct {
	ID   int64
	Name string
	// Look is how they show (avatar, title, level).
	Look play.Look
}

// Hub holds the rooms open now.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*Room
	bank  func() *bank.Bank
	// Crowd, if set, is how players have answered a question (shown with its answer).
	Crowd func(id string) *bank.Crowd
	// OnArena, if set, is told how each arena ended (in a goroutine of its own); it may answer with Room.Settled.
	OnArena func(*Room, []Placed)
	// The arena's queue (arena.go): who waits, since when there have been enough of them, and the timer for then.
	queue    []*Ticket
	enough   time.Time
	matching *time.Timer
}

func NewHub(b func() *bank.Bank) *Hub { return &Hub{rooms: map[string]*Room{}, bank: b} }

// crowd is how players have answered a question, if the hub knows.
func (h *Hub) crowd(id string) *bank.Crowd {
	if h.Crowd == nil {
		return nil
	}
	return h.Crowd(id)
}

// newRoom makes a room under a free code. Called with the hub's lock held.
func (h *Hub) newRoom(category string) (*Room, error) {
	if len(h.rooms) >= maxRooms {
		return nil, ErrTooMany
	}
	for range 20 {
		n, _ := rand.Int(rand.Reader, big.NewInt(900_000))
		code := fmt.Sprint(100_000 + n.Int64())
		if _, taken := h.rooms[code]; taken {
			continue
		}
		r := &Room{
			code: code, category: category, phase: Lobby, hub: h,
			subs: map[*Sub]struct{}{}, opened: time.Now(), active: time.Now(),
		}
		h.rooms[code] = r
		return r, nil
	}
	return nil, errors.New("no free room code")
}

// Open makes a room for a topic ("" for all), with its host in it.
func (h *Hub) Open(host Player, category string) (*Room, error) {
	if category != "" && !slices.ContainsFunc(h.bank().Categories, func(c bank.Category) bool { return c.ID == category }) {
		return nil, play.ErrNoTopic
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	r, err := h.newRoom(category)
	if err != nil {
		return nil, err
	}
	r.host = host.ID
	r.players = []*member{{Player: host}}
	return r, nil
}

// Get finds an open room.
func (h *Hub) Get(code string) (*Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[code]
	if !ok {
		return nil, ErrNoRoom
	}
	return r, nil
}

// Sweep closes rooms nobody is in any more (for 15 minutes), and any open for 6 hours.
func (h *Hub) Sweep() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for code, r := range h.rooms {
		r.mu.Lock()
		idle := len(r.subs) == 0 && time.Since(r.active) > 15*time.Minute
		old := time.Since(r.opened) > 6*time.Hour
		if idle || old {
			r.close()
			delete(h.rooms, code)
		}
		r.mu.Unlock()
	}
	if len(h.queue) >= ArenaMin {
		h.match() // those who waited while the rooms were full
	}
}

// Room is one game played together.
type Room struct {
	mu         sync.Mutex
	hub        *Hub
	code       string
	category   string
	host       int64     // who opened it
	players    []*member // in the order they joined
	phase      Phase
	picks      []play.Pick
	dealt      []bank.Dealt
	n          int // the question now
	shownAt    time.Time
	revealedAt time.Time
	timer      *time.Timer
	subs       map[*Sub]struct{}
	opened     time.Time
	active     time.Time
	closed     bool
	// An arena (arena.go): filled by the hub, no host; deltas are what its places did to the players' ratings.
	arena  bool
	deltas map[int64]int
}

type member struct {
	Player
	points, rights int
	inRow          int // right answers in a row, the last ones
	online         int
	// The question now: whether they've answered, what they gave (as shown), how it went.
	answered bool
	given    json.RawMessage
	graded   bank.Graded
	gained   int
	speed    int // of gained, for being quick
	row      int // of gained, for the right answers in a row
	// Every answer of this game, for the review at its end.
	log []loggedAnswer
}

// loggedAnswer is one answer of a game, as its review shows it.
type loggedAnswer struct {
	questionID string
	shown      json.RawMessage // nil: no answer (the time ran out)
	points     int
	right      bool
}

func (r *Room) Code() string { return r.code }

func (r *Room) member(id int64) *member {
	for _, m := range r.players {
		if m.ID == id {
			return m
		}
	}
	return nil
}

// Join puts a player in the room (once; again changes nothing). Joining a room mid-game is fine, from the next
// answer on.
func (r *Room) Join(p Player) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return ErrNoRoom
	}
	if m := r.member(p.ID); m != nil {
		m.Player = p // a new name or look shows from now on
		return nil
	}
	if r.arena {
		return ErrNoRoom // an arena is for those the hub put in it
	}
	if len(r.players) >= MaxPlayers {
		return ErrFull
	}
	r.players = append(r.players, &member{Player: p})
	r.changed()
	return nil
}

// Sub is a screen following a room: C says the room changed (read View then), Done that the room is gone.
type Sub struct {
	C      chan struct{}
	Done   chan struct{}
	viewer int64
}

// Follow is a player's screen following the room (Join first).
func (r *Room) Follow(viewer int64) (*Sub, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.member(viewer)
	if m == nil || r.closed {
		return nil, ErrNoRoom
	}
	s := &Sub{C: make(chan struct{}, 1), Done: make(chan struct{}), viewer: viewer}
	r.subs[s] = struct{}{}
	m.online++
	r.changed()
	return s, nil
}

// Unfollow is a screen gone (closed, offline).
func (r *Room) Unfollow(s *Sub) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.subs[s]; !ok {
		return
	}
	delete(r.subs, s)
	if m := r.member(s.viewer); m != nil {
		m.online--
	}
	r.changed()
}

// changed tells every screen to look again. Called with the lock held.
func (r *Room) changed() {
	r.active = time.Now()
	for s := range r.subs {
		select {
		case s.C <- struct{}{}:
		default: // it hasn't looked since the last change; one look will do for both
		}
	}
}

func (r *Room) close() {
	r.closed = true
	if r.timer != nil {
		r.timer.Stop()
	}
	for s := range r.subs {
		close(s.Done)
		delete(r.subs, s)
	}
}

// mayLead says whether a player may start or move the game on: the host, or anyone while the host is away.
func (r *Room) mayLead(id int64) bool {
	if r.arena {
		return false // it runs by itself
	}
	if id == r.host {
		return true
	}
	h := r.member(r.host)
	return r.member(id) != nil && (h == nil || h.online == 0)
}

// Start begins a game: new questions, everyone from nought. From the lobby, or again after the end.
func (r *Room) Start(by int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.mayLead(by) {
		return ErrNotYours
	}
	if r.phase != Lobby && r.phase != End {
		return ErrNotNow
	}
	return r.start()
}

func (r *Room) start() error {
	b := r.bank()
	r.picks = play.Draw(b, r.category, 0, nil, mrand.New(mrand.NewPCG(mrand.Uint64(), mrand.Uint64())))
	r.dealt = r.dealt[:0]
	for _, p := range r.picks {
		q, ok := b.Get(p.ID)
		if !ok {
			return play.ErrNoQuestion
		}
		r.dealt = append(r.dealt, q.Deal(p.Seed))
	}
	if len(r.dealt) == 0 {
		return play.ErrNoQuestion
	}
	for _, m := range r.players {
		m.points, m.rights, m.inRow, m.log = 0, 0, 0, nil
	}
	r.show(0)
	return nil
}

func (r *Room) bank() *bank.Bank { return r.hub.bank() }

// show puts question n on every screen and starts its time.
func (r *Room) show(n int) {
	r.phase, r.n, r.shownAt = Question, n, time.Now()
	for _, m := range r.players {
		m.answered, m.given, m.graded, m.gained, m.speed, m.row = false, nil, bank.Graded{}, 0, 0, 0
	}
	limit := play.Limit(r.dealt[n].Question())
	r.after(limit+Grace, func() { r.reveal() })
	r.changed()
}

// after runs fn after d, if the room is then still on the same question and phase (and open).
func (r *Room) after(d time.Duration, fn func()) {
	if r.timer != nil {
		r.timer.Stop()
	}
	n, phase := r.n, r.phase
	r.timer = time.AfterFunc(d, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.n == n && r.phase == phase && !r.closed {
			fn()
		}
	})
}

// Answer takes a player's answer to question n. When everyone in the room has answered, the answer shows at once.
func (r *Room) Answer(by int64, n int, raw json.RawMessage) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.member(by)
	if m == nil {
		return ErrNoRoom
	}
	return r.answer(m, n, raw)
}

func (r *Room) answer(m *member, n int, raw json.RawMessage) error {
	if r.phase != Question || n != r.n || m.answered {
		return ErrNotNow
	}
	d := r.dealt[n]
	limit := play.Limit(d.Question())
	took := time.Since(r.shownAt)
	if took > limit+Grace {
		return ErrNotNow
	}
	g, err := d.Grade(raw)
	if err != nil {
		return ErrAnswer
	}
	// Points as in any game (play.WorthOf): for knowing, more for harder questions and right answers in a row, and a
	// part for being quick.
	m.answered, m.given, m.graded = true, g.Shown, g
	if g.Right {
		m.rights++
		m.inRow++
	} else {
		m.inRow = 0
	}
	w := play.WorthOf(d.Question(), g.Score, took, m.inRow)
	m.gained, m.speed, m.row = w.Points, w.Speed, w.Row
	m.points += m.gained
	m.log = append(m.log, loggedAnswer{questionID: d.Question().Base().ID, shown: g.Shown, points: m.gained, right: g.Right})
	for _, p := range r.players {
		if p.online > 0 && !p.answered {
			r.changed()
			return nil
		}
	}
	r.reveal()
	return nil
}

func (r *Room) reveal() {
	r.phase = Reveal
	d := r.dealt[r.n]
	for _, m := range r.players {
		if !m.answered { // the time ran out on them
			m.log = append(m.log, loggedAnswer{questionID: d.Question().Base().ID})
			m.inRow = 0
		}
	}
	if r.timer != nil {
		r.timer.Stop()
	}
	r.revealedAt = time.Now()
	r.after(Pause, func() { r.next() })
	r.changed()
}

func (r *Room) next() {
	if r.n+1 < len(r.dealt) {
		r.show(r.n + 1)
		return
	}
	r.phase = End
	for _, m := range r.players {
		if m.rights == len(r.dealt) {
			m.points += play.AllRight
		}
	}
	// An arena's places count the bonus too.
	if r.arena && r.hub.OnArena != nil {
		go r.hub.OnArena(r, r.places())
	}
	r.changed()
}

// View is the room as one player sees it.
type View struct {
	Code     string `json:"code"`
	Phase    Phase  `json:"phase"`
	Host     string `json:"host"`
	IsHost   bool   `json:"isHost"`
	CanLead  bool   `json:"canLead"`
	Category string `json:"category"`
	// Arena: a room the hub filled (arena.go); StartsMs is how long until its first question, in its lobby.
	Arena    bool          `json:"arena,omitempty"`
	StartsMs int64         `json:"startsMs,omitempty"`
	N        int           `json:"n"`
	Total    int           `json:"total"`
	Players  []PlayerView  `json:"players"`
	Question *QuestionView `json:"question,omitempty"`
	// Review is every question of the game with the viewer's answer, once it's over: the facts behind the answers and
	// a word about a question are kept for then, so that the game itself flows.
	Review []ReviewedView `json:"review,omitempty"`
	// AllRight is what the viewer's game earned at its end for every answer right (in their points).
	AllRight int `json:"allRight,omitempty"`
}

// ReviewedView is one question of a finished game, as the viewer answered it (as play.Reviewed is for a run).
type ReviewedView struct {
	N        int             `json:"n"`
	Category string          `json:"category"`
	View     any             `json:"view"`
	Reveal   any             `json:"reveal"`
	Given    json.RawMessage `json:"given"`
	Points   int             `json:"points"`
	Right    bool            `json:"right"`
}

type PlayerView struct {
	play.Look
	// Key tells players apart in a room (names may repeat): the order they came in.
	Key      int    `json:"key"`
	Name     string `json:"name"`
	Points   int    `json:"points"`
	Rights   int    `json:"rights"`
	Online   bool   `json:"online"`
	Answered bool   `json:"answered"`
	Me       bool   `json:"me,omitempty"`
	// Gained and Right are this question's, once its answer shows.
	Gained int  `json:"gained,omitempty"`
	Right  bool `json:"right,omitempty"`
	// Place is where an arena's player ended, and Delta what it did to their rating (once it's known).
	Place int  `json:"place,omitempty"`
	Delta *int `json:"delta,omitempty"`
}

type QuestionView struct {
	Category string `json:"category"`
	View     any    `json:"view"`
	LimitMs  int64  `json:"limitMs"`
	LeftMs   int64  `json:"leftMs"`
	// NextMs is how long until the room moves on, while an answer shows.
	NextMs int64 `json:"nextMs,omitempty"`
	// Given is the viewer's answer, as shown (once given).
	Given json.RawMessage `json:"given,omitempty"`
	// Reveal is the answer, once it shows, with how the viewer's went.
	Reveal *RevealView `json:"reveal,omitempty"`
}

type RevealView struct {
	Answer any `json:"answer"`
	Points int `json:"points"`
	// Speed is how many of the points were for being quick, and Row how many for the right answers in a row InRow.
	Speed  int  `json:"speed,omitempty"`
	Row    int  `json:"row,omitempty"`
	InRow  int  `json:"inRow,omitempty"`
	Right  bool `json:"right"`
	Exact  bool `json:"exact,omitempty"`
	Missed bool `json:"missed,omitempty"`
}

// View builds what one player sees now.
func (r *Room) View(viewer int64) View {
	r.mu.Lock()
	defer r.mu.Unlock()
	v := View{
		Code: r.code, Phase: r.phase, IsHost: viewer == r.host, CanLead: r.mayLead(viewer),
		Category: r.category, N: r.n, Total: len(r.picks), Players: []PlayerView{}, Arena: r.arena,
	}
	if r.arena && r.phase == Lobby {
		v.StartsMs = max(1, (ArenaCountdown - time.Since(r.shownAt)).Milliseconds())
	}
	var places map[int64]int
	if r.arena && r.phase == End {
		places = map[int64]int{}
		for _, p := range r.places() {
			places[p.ID] = p.Place
		}
	}
	if h := r.member(r.host); h != nil {
		v.Host = h.Name
	}
	for i, m := range r.players {
		p := PlayerView{
			Key: i, Look: m.Look, Name: m.Name, Points: m.points, Rights: m.rights, Online: m.online > 0, Answered: m.answered,
			Me: m.ID == viewer,
		}
		if r.phase == Reveal {
			p.Gained, p.Right = m.gained, m.graded.Right
		}
		if places != nil {
			p.Place = places[m.ID]
			if d, ok := r.deltas[m.ID]; ok {
				p.Delta = &d
			}
		}
		v.Players = append(v.Players, p)
	}
	if r.phase != Lobby {
		// Best first, once there's a score (ties: who joined first).
		slices.SortStableFunc(v.Players, func(a, b PlayerView) int { return b.Points - a.Points })
	}
	if r.phase == Question || r.phase == Reveal {
		d := r.dealt[r.n]
		limit := play.Limit(d.Question())
		q := &QuestionView{
			Category: d.Question().Base().Category, View: d.View(),
			LimitMs: limit.Milliseconds(), LeftMs: max(0, (limit - time.Since(r.shownAt)).Milliseconds()),
		}
		if me := r.member(viewer); me != nil {
			q.Given = me.given
			if r.phase == Reveal {
				q.Reveal = &RevealView{Answer: d.Reveal(r.hub.crowd(d.Question().Base().ID)), Points: me.gained, Speed: me.speed, Row: me.row,
					Right: me.graded.Right, Exact: me.graded.Exact, Missed: !me.answered}
				if me.row > 0 {
					q.Reveal.InRow = me.inRow
				}
			}
		}
		if r.phase == Reveal {
			q.LeftMs = 0
			q.NextMs = max(1, (Pause - time.Since(r.revealedAt)).Milliseconds())
		}
		v.Question = q
	}
	if me := r.member(viewer); me != nil && r.phase == End {
		v.Review = r.review(me)
		if me.rights == len(r.dealt) {
			v.AllRight = play.AllRight
		}
	}
	return v
}

// review is the game's questions with how m answered each (the answer log holds one entry per question, in order).
func (r *Room) review(m *member) []ReviewedView {
	out := make([]ReviewedView, 0, len(r.dealt))
	for i, d := range r.dealt {
		it := ReviewedView{N: i, Category: d.Question().Base().Category, View: d.View(), Reveal: d.Reveal(r.hub.crowd(d.Question().Base().ID)), Given: json.RawMessage("null")}
		if i < len(m.log) && m.log[i].questionID == d.Question().Base().ID && m.log[i].shown != nil {
			it.Given, it.Points, it.Right = m.log[i].shown, m.log[i].points, m.log[i].right
		}
		out = append(out, it)
	}
	return out
}
