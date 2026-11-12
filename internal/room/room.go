// Package room is playing together, live: a room has a code, its players see the same question at the same moment,
// and a scoreboard after each. The host sets the pace; if the host is away, anyone in the room can.
//
// Rooms live in memory only: they're for playing now, and end on their own when nobody's left.
package room

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math"
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
}

// Hub holds the rooms open now.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*Room
	bank  func() *bank.Bank
}

func NewHub(b func() *bank.Bank) *Hub { return &Hub{rooms: map[string]*Room{}, bank: b} }

// Open makes a room for a topic ("" for all), with its host in it.
func (h *Hub) Open(host Player, category string) (*Room, error) {
	if category != "" && !slices.ContainsFunc(h.bank().Categories, func(c bank.Category) bool { return c.ID == category }) {
		return nil, play.ErrNoTopic
	}
	h.mu.Lock()
	defer h.mu.Unlock()
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
			code: code, category: category, host: host.ID, phase: Lobby, bank: h.bank,
			subs: map[*Sub]struct{}{}, opened: time.Now(), active: time.Now(),
		}
		r.players = []*member{{Player: host}}
		h.rooms[code] = r
		return r, nil
	}
	return nil, errors.New("no free room code")
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
}

// Room is one game played together.
type Room struct {
	mu       sync.Mutex
	code     string
	category string
	host     int64
	players  []*member // in the order they joined
	phase    Phase
	dealt    []bank.Dealt
	n        int // the question now
	shownAt  time.Time
	timer    *time.Timer
	subs     map[*Sub]struct{}
	opened   time.Time
	active   time.Time
	closed   bool
	bank     func() *bank.Bank
}

type member struct {
	Player
	points, rights int
	online         int
	// The question now: what they gave (as shown), how it went.
	answered bool
	given    json.RawMessage
	graded   bank.Graded
	gained   int
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

// Join puts a player in the room (once; again changes nothing). Joining mid-game is fine: from the next answer on.
func (r *Room) Join(p Player) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return ErrNoRoom
	}
	if m := r.member(p.ID); m != nil {
		m.Name = p.Name
		return nil
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
	b := r.bank()
	picks := play.Draw(b, r.category, 0.6, nil, mrand.New(mrand.NewPCG(mrand.Uint64(), mrand.Uint64())))
	r.dealt = r.dealt[:0]
	for _, p := range picks {
		if q, ok := b.Get(p.ID); ok {
			r.dealt = append(r.dealt, q.Deal(p.Seed))
		}
	}
	if len(r.dealt) == 0 {
		return play.ErrNoQuestion
	}
	for _, m := range r.players {
		m.points, m.rights = 0, 0
	}
	r.show(0)
	return nil
}

// show puts question n on every screen and starts its time.
func (r *Room) show(n int) {
	r.phase, r.n, r.shownAt = Question, n, time.Now()
	for _, m := range r.players {
		m.answered, m.given, m.graded, m.gained = false, nil, bank.Graded{}, 0
	}
	if r.timer != nil {
		r.timer.Stop()
	}
	r.timer = time.AfterFunc(play.Limit(r.dealt[n].Question())+Grace, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.phase == Question && r.n == n && !r.closed {
			r.reveal()
		}
	})
	r.changed()
}

// Answer takes a player's answer to question n. When everyone in the room has answered, the answer shows at once.
func (r *Room) Answer(by int64, n int, raw json.RawMessage) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.member(by)
	if m == nil {
		return ErrNoRoom
	}
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
	// Up to 100 for a right answer: half for being right, half for being quick.
	left := max(0, 1-float64(took)/float64(limit))
	m.answered, m.given, m.graded = true, g.Shown, g
	m.gained = int(math.Round(play.MaxPoints * g.Score * (0.5 + 0.5*left)))
	m.points += m.gained
	if g.Right {
		m.rights++
	}
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
	if r.timer != nil {
		r.timer.Stop()
	}
	r.changed()
}

// Next moves on from an answer: to the next question, or to the end.
func (r *Room) Next(by int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.mayLead(by) {
		return ErrNotYours
	}
	if r.phase != Reveal {
		return ErrNotNow
	}
	if r.n+1 < len(r.dealt) {
		r.show(r.n + 1)
	} else {
		r.phase = End
		r.changed()
	}
	return nil
}

// View is the room as one player sees it.
type View struct {
	Code     string        `json:"code"`
	Phase    Phase         `json:"phase"`
	Host     string        `json:"host"`
	IsHost   bool          `json:"isHost"`
	CanLead  bool          `json:"canLead"`
	Category string        `json:"category"`
	N        int           `json:"n"`
	Total    int           `json:"total"`
	Players  []PlayerView  `json:"players"`
	Question *QuestionView `json:"question,omitempty"`
}

type PlayerView struct {
	Name     string `json:"name"`
	Points   int    `json:"points"`
	Rights   int    `json:"rights"`
	Online   bool   `json:"online"`
	Answered bool   `json:"answered"`
	Me       bool   `json:"me,omitempty"`
	// Gained and Right are this question's, once its answer shows.
	Gained int  `json:"gained,omitempty"`
	Right  bool `json:"right,omitempty"`
}

type QuestionView struct {
	Category string `json:"category"`
	View     any    `json:"view"`
	LimitMs  int64  `json:"limitMs"`
	LeftMs   int64  `json:"leftMs"`
	// Given is the viewer's answer, as shown (once given).
	Given json.RawMessage `json:"given,omitempty"`
	// Reveal is the answer, once it shows, with how the viewer's went.
	Reveal *RevealView `json:"reveal,omitempty"`
}

type RevealView struct {
	Answer any  `json:"answer"`
	Points int  `json:"points"`
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
		Category: r.category, N: r.n, Total: len(r.dealt), Players: []PlayerView{},
	}
	if h := r.member(r.host); h != nil {
		v.Host = h.Name
	}
	for _, m := range r.players {
		p := PlayerView{Name: m.Name, Points: m.points, Rights: m.rights, Online: m.online > 0, Answered: m.answered, Me: m.ID == viewer}
		if r.phase == Reveal {
			p.Gained, p.Right = m.gained, m.graded.Right
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
				q.Reveal = &RevealView{Answer: d.Reveal(), Points: me.gained, Right: me.graded.Right, Exact: me.graded.Exact, Missed: !me.answered}
			}
		}
		if r.phase == Reveal {
			q.LeftMs = 0
		}
		v.Question = q
	}
	return v
}
