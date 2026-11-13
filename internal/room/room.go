// Package room is playing live: a room has a code, its players see the same question at the same moment, and a
// scoreboard after each.
//
// A room is opened by a host, who sets the pace (anyone may while the host is away). A duel is a room of two that
// runs itself: two people who asked for an opponent at the same time, or one and a recording of someone else's game
// (a real game, said as such — never a made-up opponent).
//
// Rooms live in memory: they're for playing now, and close on their own when nobody's left. Duels are kept once
// they end (play.SaveDuel).
package room

import (
	"context"
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
	// Pause is how long a duel shows an answer before the next question.
	Pause = 6 * time.Second
	// maxRooms caps the rooms open at once, so that nobody can fill the server's memory with them.
	maxRooms = 2000
	// recordingID is the recorded player's place in a duel (no account has it).
	recordingID int64 = -1
	// InviteTime is how long a friend has to come to a duel they're asked to.
	InviteTime = 10 * time.Minute
)

// Why a room closed, when it's worth saying (Room.Ended).
const (
	Declined = "declined" // the friend asked to a duel said no (or the one asking called it off)
	Expired  = "expired"  // the friend didn't come in time
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
	ErrNobody   = errors.New("nobody to play against")
)

// Player is someone in a room.
type Player struct {
	ID   int64
	Name string
	// Look is how they show (avatar, title, level); none for a recording.
	Look play.Look
}

// Hub holds the rooms open now, and whoever is waiting for a duel.
type Hub struct {
	mu      sync.Mutex
	rooms   map[string]*Room
	waiting *waiter
	bank    func() *bank.Bank
	// Recording finds a recording for a player to duel when nobody else is waiting (play.Game.RecordingFor).
	Recording func(ctx context.Context, userID int64) (*play.Recording, error)
	// Kept receives each player's duel when it ends (play.Game.SaveDuel), off the room's lock.
	Kept func(play.Duel)
}

func NewHub(b func() *bank.Bank) *Hub { return &Hub{rooms: map[string]*Room{}, bank: b} }

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

type waiter struct {
	p    Player
	code chan string // the duel's code, once matched; "" if this wait was taken over
}

// Match finds a player an opponent for a duel: someone else asking at the same time, or after `wait` a recording.
// It returns the duel's room code.
func (h *Hub) Match(ctx context.Context, p Player, wait time.Duration) (string, error) {
	h.mu.Lock()
	if w := h.waiting; w != nil && w.p.ID != p.ID {
		h.waiting = nil
		r, err := h.newRoom("")
		if err != nil {
			h.mu.Unlock()
			w.code <- ""
			return "", err
		}
		r.duel = true
		r.players = []*member{{Player: w.p}, {Player: p}}
		h.mu.Unlock()
		w.code <- r.code
		return r.code, nil
	}
	if w := h.waiting; w != nil { // the same player again (another tab): this request takes over
		w.code <- ""
	}
	w := &waiter{p: p, code: make(chan string, 1)}
	h.waiting = w
	h.mu.Unlock()

	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case code := <-w.code:
		return matched(code)
	case <-timer.C:
	case <-ctx.Done():
	}
	h.mu.Lock()
	if h.waiting != w { // matched (or taken over) just now
		h.mu.Unlock()
		return matched(<-w.code)
	}
	h.waiting = nil
	h.mu.Unlock()
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	return h.recordedDuel(ctx, p)
}

func matched(code string) (string, error) {
	if code == "" {
		return "", ErrNotNow
	}
	return code, nil
}

// recordedDuel opens a duel against a recording of someone else's game.
func (h *Hub) recordedDuel(ctx context.Context, p Player) (string, error) {
	if h.Recording == nil {
		return "", ErrNobody
	}
	rec, err := h.Recording(ctx, p.ID)
	if err != nil {
		return "", err
	}
	if rec == nil {
		return "", ErrNobody
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	r, err := h.newRoom("")
	if err != nil {
		return "", err
	}
	r.duel, r.recording = true, rec
	r.picks = rec.Picks
	r.players = []*member{{Player: p}, {Player: Player{ID: recordingID, Name: rec.Name}, online: 1}}
	return r.code, nil
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

// Invite opens a duel between two friends: the one asking, who waits in it, and the friend asked, who has InviteTime
// to come. Asking the same friend again while the first is still open gives the same duel.
func (h *Hub) Invite(from, to Player) (*Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, r := range h.rooms {
		r.mu.Lock()
		same := r.invited == to.ID && !r.closed && r.phase == Lobby && r.players[0].ID == from.ID
		r.mu.Unlock()
		if same {
			return r, nil
		}
	}
	r, err := h.newRoom("")
	if err != nil {
		return nil, err
	}
	r.duel, r.invited = true, to.ID
	r.players = []*member{{Player: from}, {Player: to}}
	return r, nil
}

// Invitation is a duel a friend asks a player to, waiting for them.
type Invitation struct {
	Code   string `json:"code"`
	From   string `json:"from"`
	FromID int64  `json:"fromId"`
	// LeftMs is how long it stays open.
	LeftMs int64 `json:"leftMs"`
}

// InvitesFor lists the duels friends ask a player to now: still open, with whoever asked still waiting in them.
func (h *Hub) InvitesFor(userID int64) []Invitation {
	h.mu.Lock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()
	list := []Invitation{}
	for _, r := range rooms {
		r.mu.Lock()
		if r.invited == userID && !r.closed && r.phase == Lobby && r.players[0].online > 0 {
			if left := InviteTime - time.Since(r.opened); left > 0 {
				from := r.players[0]
				list = append(list, Invitation{Code: r.code, From: from.Name, FromID: from.ID, LeftMs: left.Milliseconds()})
			}
		}
		r.mu.Unlock()
	}
	slices.SortFunc(list, func(a, b Invitation) int { return int(b.LeftMs - a.LeftMs) })
	return list
}

// Sweep closes rooms nobody is in any more (for 15 minutes), and any open for 6 hours.
func (h *Hub) Sweep() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for code, r := range h.rooms {
		r.mu.Lock()
		idle := len(r.subs) == 0 && time.Since(r.active) > 15*time.Minute
		old := time.Since(r.opened) > 6*time.Hour
		if r.invited != 0 && r.phase == Lobby && !r.closed && time.Since(r.opened) > InviteTime {
			r.ended = Expired
			r.close()
		}
		if idle || old {
			r.close()
			delete(h.rooms, code)
		}
		r.mu.Unlock()
	}
}

// Room is one game played together.
type Room struct {
	mu        sync.Mutex
	hub       *Hub
	code      string
	category  string
	host      int64 // none in a duel
	duel      bool
	invited   int64 // a duel between friends: the one asked to it
	ended     string
	recording *play.Recording
	// waitRecording is whether the recording answers the question now (else nobody waits for it).
	waitRecording bool
	players       []*member // in the order they joined
	phase         Phase
	picks         []play.Pick
	dealt         []bank.Dealt
	n             int // the question now
	shownAt       time.Time
	timer         *time.Timer
	subs          map[*Sub]struct{}
	opened        time.Time
	active        time.Time
	closed        bool
}

type member struct {
	Player
	points, rights int
	online         int
	// The question now: whether they've answered, what they gave (as shown), how it went.
	answered bool
	given    json.RawMessage
	graded   bank.Graded
	gained   int
	// Every answer of this game, for keeping a duel.
	log []play.DuelAnswer
}

func (r *Room) Code() string { return r.code }

// Decline turns down a duel between friends: the friend asked says no, or the one asking calls it off. The duel
// closes, and both screens say why.
func (r *Room) Decline(by int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.invited == 0 || r.closed || r.phase != Lobby || r.member(by) == nil {
		return ErrNotNow
	}
	r.ended = Declined
	r.close()
	return nil
}

// Ended says why a room closed, when there's more to say than that it did: Declined or Expired ("" otherwise).
func (r *Room) Ended() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ended
}

func (r *Room) member(id int64) *member {
	for _, m := range r.players {
		if m.ID == id {
			return m
		}
	}
	return nil
}

// Join puts a player in the room (once; again changes nothing). Joining a room mid-game is fine, from the next
// answer on; a duel is for its two only.
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
	if r.duel || len(r.players) >= MaxPlayers {
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

// Follow is a player's screen following the room (Join first). A duel starts once both are there.
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
	if r.duel && r.phase == Lobby && !slices.ContainsFunc(r.players, func(m *member) bool { return m.online == 0 }) {
		_ = r.start()
		return s, nil
	}
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

// mayLead says whether a player may start or move the game on: the host, or anyone while the host is away. Nobody
// leads a duel: it runs itself.
func (r *Room) mayLead(id int64) bool {
	if r.duel {
		return false
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
	if r.recording == nil {
		r.picks = play.Draw(b, r.category, 0.6, nil, mrand.New(mrand.NewPCG(mrand.Uint64(), mrand.Uint64())))
	}
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
		m.points, m.rights, m.log = 0, 0, nil
	}
	r.show(0)
	return nil
}

func (r *Room) bank() *bank.Bank { return r.hub.bank() }

// show puts question n on every screen and starts its time; a recording answers as it did, when it did.
func (r *Room) show(n int) {
	r.phase, r.n, r.shownAt = Question, n, time.Now()
	for _, m := range r.players {
		m.answered, m.given, m.graded, m.gained = false, nil, bank.Graded{}, 0
	}
	limit := play.Limit(r.dealt[n].Question())
	r.after(limit+Grace, func() { r.reveal() })
	r.waitRecording = false
	if rec := r.recording; rec != nil {
		if a, ok := rec.Answers[n]; ok && time.Duration(a.Ms)*time.Millisecond < limit {
			r.waitRecording = true
			time.AfterFunc(time.Duration(a.Ms)*time.Millisecond, func() {
				r.mu.Lock()
				defer r.mu.Unlock()
				if r.phase == Question && r.n == n && !r.closed {
					_ = r.answer(r.member(recordingID), n, a.Shown)
				}
			})
		}
	}
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
	if m == nil || by == recordingID {
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
	// Up to 100 for a right answer: half for being right, half for being quick.
	left := max(0, 1-float64(took)/float64(limit))
	m.answered, m.given, m.graded = true, g.Shown, g
	m.gained = int(math.Round(play.MaxPoints * g.Score * (0.5 + 0.5*left)))
	m.points += m.gained
	if g.Right {
		m.rights++
	}
	m.log = append(m.log, play.DuelAnswer{
		QuestionID: d.Question().Base().ID, Given: g.Given, Shown: g.Shown,
		Score: g.Score, Points: m.gained, Right: g.Right, Ms: min(took, limit).Milliseconds(),
	})
	for _, p := range r.players {
		waits := p.online > 0 && (p.ID != recordingID || r.waitRecording)
		if waits && !p.answered {
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
			m.log = append(m.log, play.DuelAnswer{QuestionID: d.Question().Base().ID, Ms: play.Limit(d.Question()).Milliseconds()})
		}
	}
	if r.timer != nil {
		r.timer.Stop()
	}
	if r.duel {
		r.after(Pause, func() { r.next() })
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
	r.next()
	return nil
}

func (r *Room) next() {
	if r.n+1 < len(r.dealt) {
		r.show(r.n + 1)
		return
	}
	r.phase = End
	if r.duel {
		r.keep()
	}
	r.changed()
}

// keep hands each person's duel to the hub to keep (off the lock: it writes to the database).
func (r *Room) keep() {
	if r.hub.Kept == nil || len(r.players) != 2 {
		return
	}
	for i, m := range r.players {
		if m.ID == recordingID || len(m.log) != len(r.picks) {
			continue
		}
		other := r.players[1-i]
		outcome := "draw"
		if m.points > other.points {
			outcome = "won"
		} else if m.points < other.points {
			outcome = "lost"
		}
		d := play.Duel{
			UserID: m.ID, Picks: r.picks, Answers: slices.Clone(m.log),
			Opponent: other.Name, Recorded: other.ID == recordingID, Outcome: outcome,
			OpponentID: max(0, other.ID),
		}
		go r.hub.Kept(d)
	}
}

// View is the room as one player sees it.
type View struct {
	Code string `json:"code"`
	Duel bool   `json:"duel,omitempty"`
	// Invite marks a duel between friends (one asked the other to it).
	Invite   bool          `json:"invite,omitempty"`
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
	play.Look
	Name     string `json:"name"`
	Points   int    `json:"points"`
	Rights   int    `json:"rights"`
	Online   bool   `json:"online"`
	Answered bool   `json:"answered"`
	Me       bool   `json:"me,omitempty"`
	// Recording marks a recorded game played against.
	Recording bool `json:"recording,omitempty"`
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
		Code: r.code, Duel: r.duel, Invite: r.invited != 0, Phase: r.phase, IsHost: !r.duel && viewer == r.host,
		CanLead:  r.mayLead(viewer),
		Category: r.category, N: r.n, Total: len(r.picks), Players: []PlayerView{},
	}
	if h := r.member(r.host); h != nil && !r.duel {
		v.Host = h.Name
	}
	for _, m := range r.players {
		p := PlayerView{
			Look: m.Look, Name: m.Name, Points: m.points, Rights: m.rights, Online: m.online > 0, Answered: m.answered,
			Me: m.ID == viewer, Recording: m.ID == recordingID,
		}
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
