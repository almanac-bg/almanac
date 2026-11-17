// Package room is playing live: a room has a code, its players see the same question at the same moment, and a
// scoreboard after each.
//
// A room is opened by a host, who chooses what it plays (Settings: a topic, how many questions, how hard) and sets
// the pace (anyone in it may while the host is away); between games the host may choose again (Change), keeping the
// code and the players. The standings are by points, then by the time the answers took, as in a duel. The host may
// also send a player out of the room (Remove): they're kept out of it from then on; and lock it (SetLocked), so that
// nobody new comes in (a class, once it's all there), while those in it still come back to it. A room never deals a
// question twice, over all its games, nor one of the day's.
//
// Who is in a room is its members (Join) and its host (In): only they follow it, play in it or see who's in it. The
// code is all it takes to join, so that a class or a party gets in by saying six digits; what keeps codes from being
// walked is the server's (a wrong code counts against whoever gave it). How many rooms are open is capped three
// ways, so that nobody can fill the hub and shut rooms for everyone: a host keeps at most MaxHosted (a new one closes
// their oldest), an address opens at most maxFrom, and the hub holds maxRooms at most, a guard for memory alone.
//
// A host may also lead from a big screen (Settings.Lead: a class's board, a pub's TV) rather than play: they're no
// member, on no board, and no question waits for them; their screen gets each answer with its fact, and they set the
// pace (Next: the answer now, or the next question; Hold: each answer stays up until Next; Finish: the game ends where
// it is). A held answer is a game under way, as any.
//
// As a game ends, each player's game in it is kept in the database as a run of theirs (Hub.Record: XP, goals,
// achievements, questions seen), outside the room's lock; the room counts as under way until that's done.
//
// Rooms live in memory: they're for playing now, and close on their own when nobody's left. A restart would end
// them, so the server keeps them over one: it pauses the hub first (Pause: no new game starts in any room, and the
// games under way, UnderWay, play to their end, for as long as the server waits), and saves the rooms (Save) for the
// next run of the server to open again (Restore), with their code, settings, host and players (and those sent out),
// the questions they've dealt, and the game under way or just over as it stands: every answer and point. A game cut
// by the restart goes on where it was, the question showing shown again with its time from the start (Restore). The
// server saves the rooms every few seconds too (Changes says when there's something new), so that a crash loses no
// more than those seconds. A player's screen comes back to its room by itself.
//
// A game's clock that panics (package safe stops it) ends its game where it is, each player's game kept (broken).
package room

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"math/big"
	mrand "math/rand/v2"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/safe"
)

const (
	// MaxPlayers is how many fit in a room: a class, a party.
	MaxPlayers = 50
	// Pause is how long a room shows an answer (and the standings) before it moves on by itself.
	Pause = 6 * time.Second
	// MaxHosted is how many rooms a host keeps open: opening one more closes their oldest (unless a game is under
	// way in it). One for the room being played, one for the room just left, where the others may play on.
	MaxHosted = 2
	// maxFrom is how many rooms may be open from one address (a school's or a pub's, many hosts behind it).
	maxFrom = 20
	// maxRooms caps the rooms open at once, so that nothing fills the server's memory with them: far above what the
	// caps per host and per address leave to anyone.
	maxRooms = 10_000
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
	// ErrPaused is a game not started because the server is about to restart (Pause).
	ErrPaused = errors.New("the server is about to restart")
	// ErrRemoved is a player the host has sent out of the room, coming back.
	ErrRemoved = errors.New("sent out of the room")
	// ErrNoPlayers is a game started in a room nobody has come into to play (its host leads it).
	ErrNoPlayers = errors.New("nobody to play")
	// ErrLocked is someone new coming into a room its host has locked (SetLocked).
	ErrLocked = errors.New("the room is locked")
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
	mu sync.Mutex
	// paused: no new game starts (an atomic, read under a room's lock, which comes after the hub's).
	paused atomic.Bool
	// changes counts every change to the rooms (Changes).
	changes atomic.Uint64
	rooms   map[string]*Room
	bank    func() *bank.Bank
	// Crowd, if set, is how players have answered a question, this version of it (shown with its answer).
	Crowd func(q bank.Question) *bank.Crowd
	// Barred, if set, are the questions no room may deal now (the day's: play.Game.DayQuestions).
	Barred func(context.Context) (map[string]bool, error)
	// Record, if set, keeps a player's game in a room once it's over, and says as which run (play.Game.RecordRoom).
	Record func(ctx context.Context, userID int64, p play.RoomPlay) (int64, error)
}

func NewHub(b func() *bank.Bank) *Hub { return &Hub{rooms: map[string]*Room{}, bank: b} }

// crowd is how players have answered a question, if the hub knows.
func (h *Hub) crowd(q bank.Question) *bank.Crowd {
	if h.Crowd == nil {
		return nil
	}
	return h.Crowd(q)
}

// Settings are what a room plays, as its host opens it.
type Settings struct {
	// Category is a topic ("" for all).
	Category string `json:"category"`
	// Length is how many questions a game has (play.RoomLengths; 0 for play.Length), and Mix how hard they are (""
	// for mixed).
	Length int      `json:"length"`
	Mix    play.Mix `json:"mix"`
	// Lead is a host who leads the room from a big screen (a class's board, a pub's TV) and doesn't play: they're
	// on no board, and no question waits for them.
	Lead bool `json:"lead,omitempty"`
}

// newRoom makes a room under a free code, for host, opened from an address. Called with the hub's lock held.
func (h *Hub) newRoom(host int64, from string, s Settings) (*Room, error) {
	if err := h.makeWay(host, from); err != nil {
		return nil, err
	}
	for range 20 {
		n, _ := rand.Int(rand.Reader, big.NewInt(900_000))
		code := fmt.Sprint(100_000 + n.Int64())
		if _, taken := h.rooms[code]; taken {
			continue
		}
		r := &Room{
			code: code, Settings: s, host: host, from: from, phase: Lobby, hub: h, subs: map[*Sub]struct{}{},
			out: map[int64]bool{}, used: map[string]bool{}, opened: time.Now(), active: time.Now(),
		}
		h.rooms[code] = r
		h.changes.Add(1)
		return r, nil
	}
	return nil, errors.New("no free room code")
}

// makeWay makes way for one more room of host's, opened from an address: their oldest closes while they have
// MaxHosted (one with a game under way doesn't, and then there's no room for them now), and the address and the hub
// must have room for it. Nothing closes unless the new room then opens. Called with the hub's lock held.
func (h *Hub) makeWay(host int64, from string) error {
	var hosted []*Room
	fromHere := 0
	for _, r := range h.rooms {
		if r.host == host {
			hosted = append(hosted, r)
		}
		if from != "" && r.from == from {
			fromHere++
		}
	}
	slices.SortFunc(hosted, func(a, b *Room) int { return a.opened.Compare(b.opened) })
	var closing []*Room
	for _, r := range hosted {
		if len(hosted)-len(closing) < MaxHosted {
			break
		}
		r.mu.Lock()
		if !r.underWay() {
			closing = append(closing, r)
		}
		r.mu.Unlock()
	}
	open := len(h.rooms) - len(closing)
	for _, r := range closing {
		if from != "" && r.from == from {
			fromHere--
		}
	}
	if len(hosted)-len(closing) >= MaxHosted || fromHere >= maxFrom || open >= maxRooms {
		return ErrTooMany
	}
	for _, r := range closing {
		r.mu.Lock()
		if !r.underWay() { // as it is now: a game may have started in it meanwhile, and then it stays
			r.close()
			delete(h.rooms, r.code)
		}
		r.mu.Unlock()
	}
	return nil
}

// Open makes a room, with its host in it (as a player, unless they lead it), opened from an address ("": none known;
// the server gives a network: an IPv4 address, or an IPv6 /64, which one home or one school has all of).
func (h *Hub) Open(host Player, from string, s Settings) (*Room, error) {
	if s.Category != "" && !slices.ContainsFunc(h.bank().Categories, func(c bank.Category) bool { return c.ID == s.Category }) {
		return nil, play.ErrNoTopic
	}
	var err error
	if s.Length, s.Mix, err = play.RoomGame(s.Length, s.Mix); err != nil {
		return nil, err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	r, err := h.newRoom(host.ID, from, s)
	if err != nil {
		return nil, err
	}
	r.hostName = host.Name
	if !s.Lead {
		r.add(host)
	}
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
}

// Pause stops new games from starting in the rooms, for a restart; the games under way go on.
func (h *Hub) Pause() { h.paused.Store(true) }

// Resume undoes Pause.
func (h *Hub) Resume() { h.paused.Store(false) }

// UnderWay is how many rooms have a game being played: what a restart would cut.
func (h *Hub) UnderWay() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, r := range h.rooms {
		r.mu.Lock()
		if r.underWay() {
			n++
		}
		r.mu.Unlock()
	}
	return n
}

// Playing is the code of a room whose game a player is in now ("" for none): one whose screen went may come back to
// it by the code. Asked on every load of Начало, so it never holds two locks at once: the hub's for a copy of its
// rooms, then each room's in turn.
func (h *Hub) Playing(id int64) string {
	h.mu.Lock()
	rooms := slices.Collect(maps.Values(h.rooms))
	h.mu.Unlock()
	for _, r := range rooms {
		r.mu.Lock()
		in := (r.phase == Question || r.phase == Reveal) && !r.closed && r.member(id) != nil
		r.mu.Unlock()
		if in {
			return r.code
		}
	}
	return ""
}

// saved is a room as Save keeps it.
type saved struct {
	Code string `json:"code"`
	Settings
	Host     int64  `json:"host"`
	HostName string `json:"hostName,omitempty"`
	Held     bool   `json:"held,omitempty"`
	Locked   bool   `json:"locked,omitempty"`
	From     string `json:"from,omitempty"`
	Phase    Phase  `json:"phase"`
	// Picks are the game's questions (one under way, or just over), and N the one showing.
	Picks   []play.Pick   `json:"picks,omitempty"`
	N       int           `json:"n,omitempty"`
	Players []savedMember `json:"players"`
	Out     []int64       `json:"out,omitempty"`
	Used    []string      `json:"used,omitempty"`
	// Joined is how many have joined: the next one's key. Kept so that keys stay as the screens know them over a
	// restart (a player sent out leaves a gap).
	Joined int       `json:"joined,omitempty"`
	Opened time.Time `json:"opened"`
	Active time.Time `json:"active"`
}

type savedMember struct {
	ID      int64         `json:"id"`
	Key     int           `json:"key"`
	Name    string        `json:"name"`
	Look    play.Look     `json:"look"`
	Points  int           `json:"points,omitempty"`
	Rights  int           `json:"rights,omitempty"`
	InRow   int           `json:"inRow,omitempty"`
	Ms      int64         `json:"ms,omitempty"`
	Run     int64         `json:"run,omitempty"`
	Answers []savedAnswer `json:"answers,omitempty"`
	// Now is how the question showing went for them, once they've answered it.
	Now *savedNow `json:"now,omitempty"`
}

type savedAnswer struct {
	Question string          `json:"question"`
	N        int             `json:"n,omitempty"`
	Shown    json.RawMessage `json:"shown,omitempty"`
	Given    json.RawMessage `json:"given,omitempty"`
	Score    float64         `json:"score,omitempty"`
	Points   int             `json:"points,omitempty"`
	Ms       int64           `json:"ms,omitempty"`
	At       time.Time       `json:"at,omitzero"`
	Right    bool            `json:"right,omitempty"`
}

type savedNow struct {
	Given  json.RawMessage `json:"given,omitempty"`
	Gained int             `json:"gained,omitempty"`
	Speed  int             `json:"speed,omitempty"`
	Row    int             `json:"row,omitempty"`
	Right  bool            `json:"right,omitempty"`
	Exact  bool            `json:"exact,omitempty"`
}

// Changes counts the changes to the rooms (one opened, closed, or changed in any way): Save again only once it moves.
func (h *Hub) Changes() uint64 { return h.changes.Load() }

// Save writes the rooms open now, for Restore after a restart: with the game under way in one, as it stands.
func (h *Hub) Save(w io.Writer) error {
	h.mu.Lock()
	rooms := slices.Collect(maps.Values(h.rooms))
	h.mu.Unlock()
	out := make([]saved, 0, len(rooms))
	for _, r := range rooms {
		r.mu.Lock()
		if !r.closed {
			out = append(out, r.saved())
		}
		r.mu.Unlock()
	}
	return json.NewEncoder(w).Encode(out)
}

// saved is the room as Save keeps it. Called with the lock held.
func (r *Room) saved() saved {
	sv := saved{Code: r.code, Settings: r.Settings, Host: r.host, HostName: r.hostName, Held: r.held, Locked: r.locked,
		From: r.from, Phase: r.phase, Opened: r.opened, Active: r.active, Joined: r.joined}
	played := r.phase != Lobby
	if played {
		sv.Picks, sv.N = r.picks, r.n
	}
	for id := range r.used {
		sv.Used = append(sv.Used, id)
	}
	for _, m := range r.players {
		sm := savedMember{ID: m.ID, Key: m.key, Name: m.Name, Look: m.Look}
		if played {
			sm.Points, sm.Rights, sm.InRow, sm.Ms, sm.Run = m.points, m.rights, m.inRow, m.ms, m.run
			for _, l := range m.log {
				sm.Answers = append(sm.Answers, savedAnswer{Question: l.questionID, N: l.n, Shown: l.shown, Given: l.given,
					Score: l.score, Points: l.points, Ms: l.ms, At: l.at, Right: l.right})
			}
			if r.phase == Question && m.answered {
				sm.Now = &savedNow{Given: m.given, Gained: m.gained, Speed: m.speed, Row: m.row, Right: m.graded.Right,
					Exact: m.graded.Exact}
			}
		}
		sv.Players = append(sv.Players, sm)
	}
	for id := range r.out {
		sv.Out = append(sv.Out, id)
	}
	return sv
}

// Restore opens again the rooms Save kept, and says how many. A game under way goes on where it was: the question
// showing shows again, with its time from the start for whoever hadn't answered it (an answer given stays), and an
// answer showing shows again for its Pause. A room whose game's questions the bank no longer has as they were shown
// comes back to its lobby; one whose code is taken meanwhile doesn't come back.
func (h *Hub) Restore(rd io.Reader) (int, error) {
	var in []saved
	if err := json.NewDecoder(rd).Decode(&in); err != nil {
		return 0, err
	}
	b := h.bank()
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, sv := range in {
		if _, taken := h.rooms[sv.Code]; taken || (len(sv.Players) == 0 && !sv.Lead) || len(h.rooms) >= maxRooms {
			continue
		}
		r := &Room{
			code: sv.Code, Settings: sv.Settings, host: sv.Host, hostName: sv.HostName, held: sv.Held, locked: sv.Locked,
			from: sv.From, phase: Lobby, hub: h, subs: map[*Sub]struct{}{}, out: map[int64]bool{}, used: map[string]bool{},
			opened: sv.Opened, active: sv.Active,
		}
		if l, m, err := play.RoomGame(r.Length, r.Mix); err == nil {
			r.Length, r.Mix = l, m
		} else {
			r.Length, r.Mix = play.Length, play.MixMixed
		}
		for _, id := range sv.Out {
			r.out[id] = true
		}
		for _, id := range sv.Used {
			r.used[id] = true
		}
		if sv.Phase == Question || sv.Phase == Reveal || sv.Phase == End {
			r.phase, r.picks = sv.Phase, sv.Picks
			for _, p := range sv.Picks {
				q, ok := b.Get(p.ID)
				if !ok || p.V != "" && bank.Version(q) != p.V { // gone, or changed: not what the game showed
					r.phase, r.picks, r.dealt = Lobby, nil, nil
					break
				}
				r.dealt = append(r.dealt, q.Deal(p.Seed))
			}
			if len(r.dealt) == 0 {
				r.phase, r.picks, r.dealt = Lobby, nil, nil
			}
			r.n = min(max(0, sv.N), len(r.dealt)-1)
			if r.phase == End {
				r.n = max(0, len(r.dealt)-1)
			}
		}
		for _, sm := range sv.Players {
			m := r.add(Player{ID: sm.ID, Name: sm.Name, Look: sm.Look})
			if sv.Joined > 0 { // saved since keys are kept: each as it was
				m.key = sm.Key
			}
			if r.phase == Lobby {
				continue
			}
			m.points, m.rights, m.inRow, m.ms, m.run = sm.Points, sm.Rights, sm.InRow, sm.Ms, sm.Run
			for _, a := range sm.Answers {
				m.log = append(m.log, loggedAnswer{questionID: a.Question, n: a.N, shown: a.Shown, given: a.Given,
					score: a.Score, points: a.Points, ms: a.Ms, at: a.At, right: a.Right})
			}
			if r.phase == Question && sm.Now != nil {
				m.answered, m.given, m.gained, m.speed, m.row = true, sm.Now.Given, sm.Now.Gained, sm.Now.Speed, sm.Now.Row
				m.graded = bank.Graded{Right: sm.Now.Right, Exact: sm.Now.Exact, Shown: sm.Now.Given}
			}
		}
		r.joined = max(r.joined, sv.Joined)
		if r.phase != Lobby {
			r.game = 1
		}
		switch r.phase { // the clock goes on: from the start of what shows
		case Question:
			r.shownAt = time.Now()
			r.after(play.Limit(r.dealt[r.n].Question())+play.Grace, func() { r.reveal() })
			r.pace(r.n)
		case Reveal:
			r.revealedAt = time.Now()
			if !r.held {
				r.after(Pause, func() { r.next() })
			}
		}
		h.rooms[r.code] = r
		n++
	}
	h.changes.Add(1)
	return n, nil
}

// Room is one game played together.
type Room struct {
	mu   sync.Mutex
	hub  *Hub
	code string
	Settings
	host     int64  // who opened it
	from     string // the address it was opened from
	hostName string
	// locked: nobody new comes in (SetLocked); those in it come back as ever.
	locked bool
	// qr is the room's link as a QR code, once drawn (QR).
	qr string
	// hostOnline is how many screens the host leading from (Lead) has open: they're no member.
	hostOnline int
	// held: an answer stays up until the host moves on (Next), rather than for Pause.
	held    bool
	players []*member // in the order they joined
	joined  int       // how many have joined: the next one's key
	out     map[int64]bool
	used    map[string]bool // every question its games have dealt: none comes again
	phase   Phase
	game    int // the games begun: a game's runs are kept for it alone
	// recording is how many games are being kept in the database (Hub.Record), after their end: under way still.
	recording  int
	picks      []play.Pick
	dealt      []bank.Dealt
	n          int // the question now
	shownAt    time.Time
	revealedAt time.Time
	timer      *time.Timer
	paceTimer  *time.Timer // the next clue of the question now (bank.Paced)
	subs       map[*Sub]struct{}
	opened     time.Time
	active     time.Time
	closed     bool
}

type member struct {
	Player
	key            int // tells them apart on the screens while the room is open: the order they came in
	points, rights int
	ms             int64 // the time their answers took, this game: of as many points, the quicker stands first
	inRow          int   // right answers in a row, the last ones
	online         int
	// The question now: whether they've answered, what they gave (as shown), how it went.
	answered bool
	given    json.RawMessage
	graded   bank.Graded
	gained   int
	speed    int // of gained, for being quick
	row      int // of gained, for the right answers in a row
	// Every answer of this game, for the review at its end, and the run it's kept as (Hub.Record).
	log []loggedAnswer
	run int64
}

// loggedAnswer is one answer of a game, as its review shows it (and as it's kept: the rest).
type loggedAnswer struct {
	questionID string
	shown      json.RawMessage // nil: no answer (the time ran out)
	points     int
	n          int
	given      json.RawMessage
	score      float64
	ms         int64
	at         time.Time
	right      bool
}

func (r *Room) Code() string { return r.code }

// Players are who's in the room now, by their keys (PlayerView.Key): for a screen to befriend one by the key it shows.
func (r *Room) Players() map[int]int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[int]int64, len(r.players))
	for _, m := range r.players {
		out[m.key] = m.ID
	}
	return out
}

// In says whether someone is in the room: a member of it, or its host (who may lead it and not play). To anyone
// else, the room is as good as not there.
func (r *Room) In(id int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return !r.closed && (id == r.host || r.member(id) != nil)
}

// QR is the room's link as a QR code (drawn by draw, from the code), drawn once and kept with the room.
func (r *Room) QR(draw func(code string) (string, error)) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.qr == "" {
		svg, err := draw(r.code)
		if err != nil {
			return "", err
		}
		r.qr = svg
	}
	return r.qr, nil
}

func (r *Room) member(id int64) *member {
	for _, m := range r.players {
		if m.ID == id {
			return m
		}
	}
	return nil
}

// Join puts a player in the room (once; again only brings their name and look up to date), unless the host has
// locked it to anyone new. Joining a room mid-game is fine, from the next answer on.
func (r *Room) Join(p Player) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return ErrNoRoom
	}
	if r.out[p.ID] {
		return ErrRemoved
	}
	if p.ID == r.host && r.Lead { // leading, not playing
		r.hostName = p.Name
		r.changed()
		return nil
	}
	if m := r.member(p.ID); m != nil {
		m.Player = p // a new name or look shows from now on
		r.changed()
		return nil
	}
	if r.locked {
		return ErrLocked
	}
	if len(r.players) >= MaxPlayers {
		return ErrFull
	}
	r.add(p)
	r.changed()
	return nil
}

// add puts a player in the room, under the next key. Called with the lock held (or before anyone can see the room).
func (r *Room) add(p Player) *member {
	m := &member{Player: p, key: r.joined}
	r.joined++
	r.players = append(r.players, m)
	return m
}

// Remove is the host sending a player (by their key) out of the room: their screens are told so, and they can't come
// back. Whatever the room waited on them for goes on without them.
func (r *Room) Remove(by int64, key int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if by != r.host {
		return ErrNotYours
	}
	i := slices.IndexFunc(r.players, func(m *member) bool { return m.key == key })
	if i < 0 || r.players[i].ID == r.host {
		return ErrNotNow
	}
	id := r.players[i].ID
	r.players = slices.Delete(r.players, i, i+1)
	r.out[id] = true
	for s := range r.subs {
		if s.viewer == id {
			s.removed = true
			close(s.Done)
			delete(r.subs, s)
		}
	}
	if r.phase == Question && r.allAnswered() {
		r.reveal()
		return nil
	}
	r.changed()
	return nil
}

// SetLocked is the host locking the room (on: nobody new comes in, a class once it's all there) or opening it again.
// Whoever is in it already, or comes back to it, isn't held out.
func (r *Room) SetLocked(by int64, on bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if by != r.host {
		return ErrNotYours
	}
	r.locked = on
	r.changed()
	return nil
}

// Sub is a screen following a room: C says the room changed (read View then), Done that the room is gone, or that
// the host sent its player out (Removed).
type Sub struct {
	C       chan struct{}
	Done    chan struct{}
	viewer  int64
	removed bool // set before Done is closed
}

// Removed says, once Done is closed, whether it was for the host sending the player out.
func (s *Sub) Removed() bool { return s.removed }

// Follow is a player's screen following the room (Join first), or the leading host's.
func (r *Room) Follow(viewer int64) (*Sub, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.member(viewer)
	leads := viewer == r.host && r.Lead
	if (m == nil && !leads) || r.closed {
		return nil, ErrNoRoom
	}
	s := &Sub{C: make(chan struct{}, 1), Done: make(chan struct{}), viewer: viewer}
	r.subs[s] = struct{}{}
	if leads {
		r.hostOnline++
	} else {
		m.online++
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
	} else if s.viewer == r.host && r.Lead {
		r.hostOnline--
	}
	r.changed()
}

// changed tells every screen to look again. Called with the lock held.
func (r *Room) changed() {
	r.hub.changes.Add(1)
	r.active = time.Now()
	for s := range r.subs {
		select {
		case s.C <- struct{}{}:
		default: // it hasn't looked since the last change; one look will do for both
		}
	}
}

// underWay is whether the room has a game being played, or one just over still being kept. Called with the lock held.
func (r *Room) underWay() bool {
	return r.phase == Question || r.phase == Reveal || r.recording > 0
}

func (r *Room) close() {
	r.closed = true
	r.hub.changes.Add(1)
	r.stop()
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
	away := r.hostOnline == 0
	if h := r.member(r.host); h != nil {
		away = h.online == 0
	}
	return r.member(id) != nil && away
}

// Start begins a game: new questions, everyone from nought. From the lobby, or again after the end; with somebody
// to play it. The day's questions (Hub.Barred, from the database) are read with no lock held, between a first look
// and a second: nothing that reads the room, or the hub, waits on the database.
func (r *Room) Start(by int64) error {
	r.mu.Lock()
	err := r.startable(by)
	r.mu.Unlock()
	if err != nil {
		return err
	}
	barred := map[string]bool{}
	if r.hub.Barred != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		day, err := r.hub.Barred(ctx)
		cancel()
		if err != nil {
			return err
		}
		maps.Copy(barred, day)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.startable(by); err != nil { // as it is now: another may have started it meanwhile
		return err
	}
	return r.start(barred)
}

// startable says why by can't start a game now, if they can't. Called with the lock held.
func (r *Room) startable(by int64) error {
	if r.closed {
		return ErrNoRoom
	}
	if !r.mayLead(by) {
		return ErrNotYours
	}
	if r.phase != Lobby && r.phase != End {
		return ErrNotNow
	}
	if len(r.players) == 0 {
		return ErrNoPlayers
	}
	if r.hub.paused.Load() {
		return ErrPaused
	}
	return nil
}

// Change is the host choosing what the room plays next (a topic, how many questions, how hard), in its lobby or
// between games: the code and the players stay, and whether the host leads from a big screen.
func (r *Room) Change(by int64, s Settings) error {
	if s.Category != "" && !slices.ContainsFunc(r.bank().Categories, func(c bank.Category) bool { return c.ID == s.Category }) {
		return play.ErrNoTopic
	}
	var err error
	if s.Length, s.Mix, err = play.RoomGame(s.Length, s.Mix); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if by != r.host {
		return ErrNotYours
	}
	if r.phase != Lobby && r.phase != End {
		return ErrNotNow
	}
	s.Lead = r.Lead
	r.Settings = s
	r.changed()
	return nil
}

// Next is who leads moving the game on at once: the answer now, while a question is up; the next question (or the
// end) while an answer shows.
func (r *Room) Next(by int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.mayLead(by) {
		return ErrNotYours
	}
	switch r.phase {
	case Question:
		r.reveal()
	case Reveal:
		r.next()
	default:
		return ErrNotNow
	}
	return nil
}

// Hold is who leads keeping each answer up until they move on (Next), to talk it over; or (on false) letting the room
// move on by itself again, Pause after the answer showing now.
func (r *Room) Hold(by int64, on bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.mayLead(by) {
		return ErrNotYours
	}
	r.held = on
	if r.phase == Reveal {
		if on {
			if r.timer != nil {
				r.timer.Stop()
			}
		} else {
			r.revealedAt = time.Now()
			r.after(Pause, func() { r.next() })
		}
	}
	r.changed()
	return nil
}

// Finish is who leads ending the game where it is: the question up now is answered as it stands, and the game is
// one of the questions asked.
func (r *Room) Finish(by int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.mayLead(by) {
		return ErrNotYours
	}
	if r.phase != Question && r.phase != Reveal {
		return ErrNotNow
	}
	r.finish()
	return nil
}

// finish ends the game under way where it is: the question up now is answered as it stands, and the game is one of
// the questions asked. Called with the lock held, a game under way.
func (r *Room) finish() {
	if r.phase == Question {
		r.reveal() // what was given counts; the end follows at once (the move on it set comes to nothing)
	}
	r.picks, r.dealt = r.picks[:r.n+1], r.dealt[:r.n+1]
	r.end()
}

// start deals a new game: the room's settings, none of barred (the day's questions), none of the room's earlier
// games'. Called with the lock held.
func (r *Room) start(barred map[string]bool) error {
	b := r.bank()
	maps.Copy(barred, r.used)
	picks := play.DrawRoom(b, r.Category, r.Length, r.Mix, barred, mrand.New(mrand.NewPCG(mrand.Uint64(), mrand.Uint64())))
	var dealt []bank.Dealt
	for _, p := range picks {
		q, ok := b.Get(p.ID)
		if !ok {
			return play.ErrNoQuestion
		}
		dealt = append(dealt, q.Deal(p.Seed))
	}
	if len(dealt) == 0 {
		return play.ErrNoQuestion
	}
	r.picks, r.dealt = picks, dealt
	for _, p := range picks {
		r.used[p.ID] = true
	}
	r.game++
	for _, m := range r.players {
		m.points, m.rights, m.inRow, m.ms, m.log, m.run = 0, 0, 0, 0, nil, 0
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
	r.after(limit+play.Grace, func() { r.reveal() })
	r.pace(n)
	r.changed()
}

// pace tells every screen to look again as more of question n shows (its next clue), while it's still up.
func (r *Room) pace(n int) {
	if r.paceTimer != nil {
		r.paceTimer.Stop()
	}
	next := bank.NextStep(r.dealt[n], time.Since(r.shownAt))
	if next == 0 {
		return
	}
	r.paceTimer = safe.AfterFunc(next, "room: a question's clues", func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.n == n && r.phase == Question && !r.closed {
			r.changed()
			r.pace(n)
		}
	}, r.broken)
}

// after runs fn after d, if the room is then still on the same question and phase (and open).
func (r *Room) after(d time.Duration, fn func()) {
	if r.timer != nil {
		r.timer.Stop()
	}
	n, phase := r.n, r.phase
	r.timer = safe.AfterFunc(d, "room: a game's clock", func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.n == n && r.phase == phase && !r.closed {
			fn()
		}
	}, r.broken)
}

// stop stops the room's clocks.
func (r *Room) stop() {
	if r.timer != nil {
		r.timer.Stop()
	}
	if r.paceTimer != nil {
		r.paceTimer.Stop()
	}
}

// broken ends a game whose clock panicked (package safe stopped it, the lock let go): what it holds can't be
// trusted, so it isn't played on. It ends where it is, as Finish ends it, each player's game kept as far as it went;
// should that panic too, the room goes back to its lobby, the game lost.
func (r *Room) broken() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || (r.phase != Question && r.phase != Reveal) {
		return
	}
	r.stop()
	if !safe.Do("room: ending a broken game", r.finish) {
		r.stop()
		r.phase = Lobby
		r.changed()
	}
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
	if took > limit+play.Grace {
		return ErrNotNow
	}
	g, err := bank.GradeAt(d, raw, took)
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
	m.ms += min(took, limit).Milliseconds()
	m.log = append(m.log, loggedAnswer{questionID: d.Question().Base().ID, shown: g.Shown, points: m.gained, right: g.Right,
		n: n, given: g.Given, score: g.Score, ms: min(took, limit).Milliseconds(), at: time.Now()})
	if !r.allAnswered() {
		r.changed()
		return nil
	}
	r.reveal()
	return nil
}

// allAnswered is whether everyone in the room now has answered the question showing.
func (r *Room) allAnswered() bool {
	return !slices.ContainsFunc(r.players, func(p *member) bool { return p.online > 0 && !p.answered })
}

func (r *Room) reveal() {
	r.phase = Reveal
	d := r.dealt[r.n]
	for _, m := range r.players {
		if !m.answered { // the time ran out on them
			m.log = append(m.log, loggedAnswer{questionID: d.Question().Base().ID, n: r.n,
				ms: play.Limit(d.Question()).Milliseconds(), at: time.Now()})
			m.ms += play.Limit(d.Question()).Milliseconds()
			m.inRow = 0
		}
	}
	if r.timer != nil {
		r.timer.Stop()
	}
	r.revealedAt = time.Now()
	if !r.held { // held, it waits for Next
		r.after(Pause, func() { r.next() })
	}
	r.changed()
}

func (r *Room) next() {
	if r.n+1 < len(r.dealt) {
		r.show(r.n + 1)
		return
	}
	r.end()
}

// end is the game over: its bonus for every answer right, and each player's game kept.
func (r *Room) end() {
	r.phase = End
	for _, m := range r.players {
		if m.rights == len(r.dealt) {
			m.points += play.AllRight
		}
	}
	r.record()
	r.changed()
}

// record keeps each player's game just over (Hub.Record), once it's over, outside the room's lock: a player who gave
// no answer has nothing to keep. The room counts as under way until it's done (a restart waits for it), and each
// player's screen hears of their run.
func (r *Room) record() {
	if r.hub.Record == nil {
		return
	}
	type kept struct {
		id   int64
		play play.RoomPlay
	}
	var games []kept
	for _, m := range r.players {
		p := play.RoomPlay{Category: r.Category, Picks: r.picks, Points: m.points}
		given := false
		for _, l := range m.log {
			p.Answers = append(p.Answers, play.RoomAnswer{N: l.n, Given: l.given, Shown: l.shown, Score: l.score,
				Right: l.right, Points: l.points, Ms: l.ms, At: l.at})
			given = given || l.given != nil
		}
		if given {
			games = append(games, kept{m.ID, p})
		}
	}
	if len(games) == 0 {
		return
	}
	r.recording++
	game := r.game
	safe.Go("room: keeping a game", func() {
		runs := map[int64]int64{}
		for _, k := range games {
			// One player's game that panics is lost alone: the others' are kept, and the room is under way no more.
			safe.Do("room: keeping a player's game", func() {
				id, err := r.hub.Record(context.Background(), k.id, k.play)
				if err != nil {
					slog.Error("keeping a room's game", "room", r.code, "player", k.id, "err", err)
					return
				}
				runs[k.id] = id
			})
		}
		r.mu.Lock()
		defer r.mu.Unlock()
		r.recording--
		if r.game != game {
			return // another game has begun meanwhile
		}
		for _, m := range r.players {
			if id, ok := runs[m.ID]; ok {
				m.run = id
			}
		}
		r.changed()
	})
}

// View is the room as one player sees it.
type View struct {
	Code    string `json:"code"`
	Phase   Phase  `json:"phase"`
	Host    string `json:"host"`
	IsHost  bool   `json:"isHost"`
	CanLead bool   `json:"canLead"`
	Settings
	N        int           `json:"n"`
	Total    int           `json:"total"`
	Players  []PlayerView  `json:"players"`
	Question *QuestionView `json:"question,omitempty"`
	// Review is every question of the game with the viewer's answer, once it's over: the facts behind the answers and
	// a word about a question are kept for then, so that the game itself flows.
	Review []ReviewedView `json:"review,omitempty"`
	// AllRight is what the viewer's game earned at its end for every answer right (in their points).
	AllRight int `json:"allRight,omitempty"`
	// Run is the viewer's game just over, as it's kept (play.Game.RecordRoom), once it is: what it earned is the
	// run's news.
	Run int64 `json:"run,omitempty"`
	// Held is an answer kept up until who leads moves on (Room.Hold).
	Held bool `json:"held,omitempty"`
	// Locked is a room nobody new comes into (Room.SetLocked).
	Locked bool `json:"locked,omitempty"`
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
	// Key tells players apart in a room (names may repeat), and is how the host sends one out (Remove).
	Key      int    `json:"key"`
	Name     string `json:"name"`
	Points   int    `json:"points"`
	Rights   int    `json:"rights"`
	Online   bool   `json:"online"`
	Answered bool   `json:"answered"`
	Me       bool   `json:"me,omitempty"`
	// Place is where they stand (once there's a score): by points, then, of as many, by the time their answers took
	// (as in a duel or Роял); those level on both share it.
	Place int `json:"place,omitempty"`
	// ms is the time their answers took, for the order.
	ms int64
	// Gained and Right are this question's, once its answer shows.
	Gained int  `json:"gained,omitempty"`
	Right  bool `json:"right,omitempty"`
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
		Settings: r.Settings, N: r.n, Total: len(r.picks), Players: []PlayerView{},
	}
	v.Host, v.Held, v.Locked = r.hostName, r.held, r.locked
	if h := r.member(r.host); h != nil {
		v.Host = h.Name
	}
	for _, m := range r.players {
		p := PlayerView{
			Key: m.key, Look: m.Look, Name: m.Name, Points: m.points, Rights: m.rights, Online: m.online > 0, Answered: m.answered,
			Me: m.ID == viewer, ms: m.ms,
		}
		if r.phase == Reveal {
			p.Gained, p.Right = m.gained, m.graded.Right
		}
		v.Players = append(v.Players, p)
	}
	if r.phase != Lobby {
		// Best first, once there's a score: more points, then the quicker; those level on both share a place.
		ahead := func(a, b PlayerView) int { return cmp.Or(b.Points-a.Points, cmp.Compare(a.ms, b.ms)) }
		slices.SortStableFunc(v.Players, ahead)
		for i := range v.Players {
			v.Players[i].Place = i + 1
			if i > 0 && ahead(v.Players[i-1], v.Players[i]) == 0 {
				v.Players[i].Place = v.Players[i-1].Place
			}
		}
	}
	if r.phase == Question || r.phase == Reveal {
		d := r.dealt[r.n]
		limit, since := play.Limit(d.Question()), time.Since(r.shownAt)
		if r.phase == Reveal {
			since = limit // everything shows with the answer
		}
		q := &QuestionView{
			Category: d.Question().Base().Category, View: bank.ViewAt(d, since),
			LimitMs: limit.Milliseconds(), LeftMs: max(0, (limit - since).Milliseconds()),
		}
		if me := r.member(viewer); me != nil {
			q.Given = me.given
			if r.phase == Reveal {
				q.Reveal = &RevealView{Answer: d.Reveal(r.hub.crowd(d.Question())), Points: me.gained, Speed: me.speed, Row: me.row,
					Right: me.graded.Right, Exact: me.graded.Exact, Missed: !me.answered}
				if me.row > 0 {
					q.Reveal.InRow = me.inRow
				}
			}
		} else if r.phase == Reveal && viewer == r.host {
			// The host leading: the answer (and its fact) for the big screen.
			q.Reveal = &RevealView{Answer: d.Reveal(r.hub.crowd(d.Question()))}
		}
		if r.phase == Reveal {
			q.LeftMs = 0
			if !r.held {
				q.NextMs = max(1, (Pause - time.Since(r.revealedAt)).Milliseconds())
			}
		}
		v.Question = q
	}
	if me := r.member(viewer); me != nil && r.phase == End {
		v.Review, v.Run = r.review(me), me.run
		if me.rights == len(r.dealt) {
			v.AllRight = play.AllRight
		}
	}
	return v
}

// review is the game's questions with how m answered each. The answer log holds one entry per question from the one
// m joined on (a player who comes mid-game has none before it): looked up by question, not by place.
func (r *Room) review(m *member) []ReviewedView {
	logged := make(map[string]loggedAnswer, len(m.log))
	for _, l := range m.log {
		logged[l.questionID] = l
	}
	out := make([]ReviewedView, 0, len(r.dealt))
	for i, d := range r.dealt {
		it := ReviewedView{N: i, Category: d.Question().Base().Category, View: d.View(), Reveal: d.Reveal(r.hub.crowd(d.Question())), Given: json.RawMessage("null")}
		if l, ok := logged[d.Question().Base().ID]; ok && l.shown != nil {
			it.Given, it.Points, it.Right = l.shown, l.points, l.right
		}
		out = append(out, it)
	}
	return out
}
