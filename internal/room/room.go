// Package room is playing live: a room has a code, its players see the same question at the same moment, and a
// scoreboard after each.
//
// A room is opened by a host, who plays in it as everyone does, chooses what it plays (Settings: its topics, how many
// questions, how hard) and starts its games (anyone in it may while the host is away; not before the host's screen has
// come, for a while: hostWait); between games the host may choose again (Change), keeping the code and the players.
// A game's questions are drawn across the topics chosen, evenly (play.DrawRoom). The standings are by points,
// then by the time the answers took, as in a duel; with each answer, everyone in the room sees how the room answered
// it (Split: what each option got, who knew it). The host may also send a player out of the room (Remove): they're
// kept out of it from then on, unless the host brings them back (Return: a slip undone); ask a player for another
// name (AskName: theirs in the room goes back to a drawn one, and no name taken away is taken again while the room
// is open); and lock it (SetLocked), so that nobody new comes in (once everyone is there), while those in it still
// come back to it. A room never deals a question twice, over all its games, nor one of the day's.
//
// Who is in a room is its members (Join, In), its host the first: only they follow it, play in it or see who's in
// it. The code is all it takes to join while no game is under way, so that a class or a party gets in by saying six digits;
// during a game, someone new needs the room's link (Key: the code and a secret no one can guess), so that a code
// guessed or overheard doesn't bring a stranger into the middle of a game. What keeps codes from being walked is the
// server's (a wrong code counts against whoever gave it). How many rooms are open is capped three ways, so that
// nobody can fill the hub and shut rooms for everyone: a host keeps at most MaxHosted (a new one closes their
// oldest), an address opens at most maxFrom, and the hub holds maxRooms at most, a guard for memory alone. A room's
// screens are capped too (maxScreensEach for one player, maxScreens in all), and only a player's first screen opened
// or last closed is news to the others (whether they're there), so that opening screens costs the room nothing.
//
// As a game ends, each player's game in it is kept in the database as a run of theirs (Hub.Record: XP, goals,
// achievements, questions seen), outside the room's lock; the room counts as under way until that's done. Each game
// has an id of its own (RoomPlay.Game), so that a game kept again (the same end played twice, over a crash) is kept
// once. What a game earns is by the questions it was dealt, not those it was cut to (a game whose clock broke ends
// where it is: broken): a game ended at its first question earns a game's share of one question, and no bonus for
// all right.
//
// Rooms live in memory: they're for playing now, and close on their own when nobody's left. A restart would end
// them, so the server keeps them over one: it pauses the hub first (Pause: no new game starts in any room, and the
// games under way, UnderWay, play to their end, for as long as the server waits), and saves the rooms (Save) for the
// next run of the server to open again (Restore), with their code, settings, host and players (and those sent out),
// the questions they've dealt, and the game under way or just over as it stands: every answer and point. A game cut
// by the restart goes on as if it hadn't stopped: the question showing has the time it had left (at least comeBack),
// and the players whose screens were open count as there for comeBack, while their screens come back by themselves,
// so that the first answer back doesn't end the question for the others; a host on their way in to a room just opened
// is waited for the rest of hostWait, as before. A room saved by an older server comes back as it can: what it kept
// that this one doesn't know (a host who led it from a big screen, an answer held for them, a single topic) is let
// go, and its game goes on at the room's own pace; a host who didn't play in it isn't in it. A game over whose
// players' games weren't all kept yet is kept then. The server saves the rooms every 15 seconds when they've changed, and at once as a game
// ends and as it's kept (Hub.Saving), so that a crash loses no more than those seconds of a game, and no game's end.
//
// A player's time on a question runs from when their own screen showed it, as it says (Seen, kept with them under the
// room's lock, and saved with it; play/seen.go: within bounds), so that a slow line or a picture coming in costs
// nobody points or a place; the question's time is up once it is for everyone still answering it (due).
//
// A game's clock that panics (package safe stops it) ends its game where it is, each player's game kept (broken).
package room

import (
	"cmp"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"math/big"
	mrand "math/rand/v2"
	"slices"
	"strings"
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
	// maxScreensEach is how many screens one player follows a room on at once: a phone, a laptop, a tab left open. One more closes their oldest (Sub.Moved), most likely a line that died unnoticed.
	maxScreensEach = 5
	// maxScreens is how many screens a room holds in all: two a player, and a few more. Past it, someone with no
	// screen on the room yet comes in in place of the oldest screen of whoever has the most; anyone else waits
	// (ErrBusy).
	maxScreens = 2*MaxPlayers + maxScreensEach
	// comeBack is how long a room restored after a restart (Restore) counts the players whose screens were open as
	// there still, while the screens come back by themselves (a browser reconnects in 1.5 to 6 seconds, and resends an
	// answer cut off from 0.5): a question waits for them as it would have. A question restored keeps at least as
	// much of its time, for them to answer it in.
	comeBack = 8 * time.Second
	// hostWait is how long a room just opened counts its host as there before any screen of theirs is on it: they're
	// on their way in (choosing a name for the room, on a slow line), and the first guest in doesn't take the lead
	// meanwhile. A host who never comes leaves the lead to whoever's there after it.
	hostWait = 2 * time.Minute
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
	// ErrNameAgain is a player bringing back the name the host asked them to change (AskName).
	ErrNameAgain = errors.New("the name the host asked to change")
	// ErrLocked is someone new coming into a room its host has locked (SetLocked).
	ErrLocked = errors.New("the room is locked")
	// ErrStarted is someone new coming into a room by its code alone while a game is under way in it: then it takes
	// the room's link (Key).
	ErrStarted = errors.New("a game is under way: the room's link is needed")
	// ErrBusy is a screen more than the room holds (maxScreens).
	ErrBusy = errors.New("too many screens on the room")
)

// Player is someone in a room.
type Player struct {
	ID   int64
	Name string
	// RoomName is a name for this room alone (Join), not the player's own.
	RoomName bool
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
	// Past, if set, is what a room's next game is drawn by, for its players (play.Game.RoomPast): the questions no
	// room may deal now (the day's), and how many of the players have seen each question (those none has come first).
	Past func(ctx context.Context, players []int64) (barred map[string]bool, seen map[string]int, err error)
	// Record, if set, keeps a player's game in a room once it's over, and says as which run (play.Game.RecordRoom).
	// The same game (RoomPlay.Game) kept again is kept once: the run it was kept as.
	Record func(ctx context.Context, userID int64, p play.RoomPlay) (int64, error)
	// saving says a game has ended, or been kept: the rooms are worth saving at once (Saving).
	saving chan struct{}
}

func NewHub(b func() *bank.Bank) *Hub {
	return &Hub{rooms: map[string]*Room{}, bank: b, saving: make(chan struct{}, 1)}
}

// Saving says when the rooms are worth saving at once, not on the next round: a game has ended (a crash replaying
// its end would show its last question again), or its players' games have been kept.
func (h *Hub) Saving() <-chan struct{} { return h.saving }

// saveSoon tells Saving. Called with any lock held: it never waits.
func (h *Hub) saveSoon() {
	select {
	case h.saving <- struct{}{}:
	default:
	}
}

// secret is a random string no one can guess: a room's key, a game's id.
func secret() string { return rand.Text()[:16] }

// crowd is how players have answered a question, if the hub knows.
func (h *Hub) crowd(q bank.Question) *bank.Crowd {
	if h.Crowd == nil {
		return nil
	}
	return h.Crowd(q)
}

// Settings are what a room plays, as its host opens it.
type Settings struct {
	// Categories are its topics, in the bank's order (none: all of them).
	Categories []string `json:"categories"`
	// Length is how many questions a game has (play.RoomLengths; 0 for play.Length), and Mix how hard they are (""
	// for mixed).
	Length int      `json:"length"`
	Mix    play.Mix `json:"mix"`
}

// check is the settings as a room keeps them, or why it can't: the topics the bank has, each once, in its order
// (every one of them is none: all), and the defaults in place of none.
func (s Settings) check(b *bank.Bank) (Settings, error) {
	var topics []string
	for _, c := range b.Categories {
		if slices.Contains(s.Categories, c.ID) {
			topics = append(topics, c.ID)
		}
	}
	for _, id := range s.Categories {
		if !slices.Contains(topics, id) {
			return s, play.ErrNoTopic
		}
	}
	if len(topics) == len(b.Categories) {
		topics = nil
	}
	s.Categories = topics
	var err error
	s.Length, s.Mix, err = play.RoomGame(s.Length, s.Mix)
	return s, err
}

// topic is the room's one topic, as its games are kept (play.RoomPlay): "" for several, or all.
func (s Settings) topic() string {
	if len(s.Categories) == 1 {
		return s.Categories[0]
	}
	return ""
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
			code: code, key: secret(), Settings: s, host: host, from: from, phase: Lobby, hub: h, subs: map[*Sub]struct{}{},
			out: map[int64]*member{}, used: map[string]bool{}, opened: time.Now(), active: time.Now(),
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

// Open makes a room, with its host in it as a player, opened from an address ("": none known; the server gives a
// network: an IPv4 address, or an IPv6 /64, which one home or one school has all of).
func (h *Hub) Open(host Player, from string, s Settings) (*Room, error) {
	s, err := s.check(h.bank())
	if err != nil {
		return nil, err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	r, err := h.newRoom(host.ID, from, s)
	if err != nil {
		return nil, err
	}
	back := time.Now().Add(hostWait)
	r.add(host).back = back
	r.waitHost(back)
	return r, nil
}

// waitHost has the others' screens look again as the host's wait (hostWait) ends at back, the host still not in by
// then (no screen of theirs ever on the room): whoever's there may lead.
func (r *Room) waitHost(back time.Time) {
	safe.AfterFunc(time.Until(back), "room: the host's wait", func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if !r.closed && r.hostWaited().Equal(back) {
			r.changed()
		}
	})
}

// hostWaited is until when the host counts as there with no screen of theirs on the room (back). Called with the lock
// held, or before anyone sees the room.
func (r *Room) hostWaited() time.Time {
	if m := r.member(r.host); m != nil {
		return m.back
	}
	return time.Time{}
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
	Key  string `json:"key"`
	Settings
	Host   int64  `json:"host"`
	Locked bool   `json:"locked,omitempty"`
	From   string `json:"from,omitempty"`
	Phase  Phase  `json:"phase"`
	// Picks are the game's questions (one under way, or just over), and N the one showing; Game the game's id and
	// Planned how many questions it was dealt (a broken clock may have cut Picks short).
	Picks   []play.Pick `json:"picks,omitempty"`
	N       int         `json:"n,omitempty"`
	Game    string      `json:"game,omitempty"`
	Planned int         `json:"planned,omitempty"`
	// ShownAt and RevealedAt are when the question, or its answer, showed; SavedAt when the room was saved: the time
	// it had had then is what it has had after a restart.
	ShownAt    time.Time     `json:"shownAt,omitzero"`
	RevealedAt time.Time     `json:"revealedAt,omitzero"`
	SavedAt    time.Time     `json:"savedAt,omitzero"`
	Players    []savedMember `json:"players"`
	// Out are those sent out, and Removed who they are, for the host to bring back (Return).
	Out     []int64       `json:"out,omitempty"`
	Removed []savedMember `json:"removed,omitempty"`
	Used    []string      `json:"used,omitempty"`
	// Joined is how many have joined: the next one's key. Kept so that keys stay as the screens know them over a
	// restart (a player sent out leaves a gap).
	Joined int       `json:"joined,omitempty"`
	Opened time.Time `json:"opened"`
	Active time.Time `json:"active"`
}

type savedMember struct {
	ID   int64     `json:"id"`
	Key  int       `json:"key"`
	Name string    `json:"name"`
	Here bool      `json:"here,omitempty"` // a name for this room alone (Player.RoomName)
	Look play.Look `json:"look"`
	// Asked is a player the host has asked for another name, and Refused the names taken away (AskName).
	Asked   bool     `json:"asked,omitempty"`
	Refused []string `json:"refused,omitempty"`
	// Away is a player with no screen on the room: they aren't waited for once it's back. Back is until when they
	// count as there with none (member.back: the host of a room just opened, on their way in).
	Away bool      `json:"away,omitempty"`
	Back time.Time `json:"back,omitzero"`
	// Saw is when their screen showed the question showing (Seen), once it said.
	Saw     time.Time     `json:"saw,omitzero"`
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
			out = append(out, r.saved(time.Now()))
		}
		r.mu.Unlock()
	}
	return json.NewEncoder(w).Encode(out)
}

// saved is the room as Save keeps it, now. Called with the lock held.
func (r *Room) saved(now time.Time) saved {
	sv := saved{Code: r.code, Key: r.key, Settings: r.Settings, Host: r.host, Locked: r.locked, From: r.from,
		Phase: r.phase, Opened: r.opened, Active: r.active, Joined: r.joined, SavedAt: now}
	played := r.phase != Lobby
	if played {
		sv.Picks, sv.N, sv.Game, sv.Planned = r.picks, r.n, r.gameID, r.planned
		sv.ShownAt, sv.RevealedAt = r.shownAt, r.revealedAt
	}
	for id := range r.used {
		sv.Used = append(sv.Used, id)
	}
	for _, m := range r.players {
		sm := savedMember{ID: m.ID, Key: m.key, Name: m.Name, Here: m.RoomName, Look: m.Look,
			Away: away(m.online, m.back, m.left, now), Back: m.back, Asked: m.asked, Refused: m.refused}
		if played {
			sm.Points, sm.Rights, sm.InRow, sm.Ms, sm.Run = m.points, m.rights, m.inRow, m.ms, m.run
			if r.phase == Question {
				sm.Saw = m.saw
			}
			for _, l := range m.log {
				sm.Answers = append(sm.Answers, savedAnswer{Question: l.questionID, N: l.n, Shown: l.shown, Given: l.given,
					Score: l.score, Points: l.points, Ms: l.ms, At: l.at, Right: l.right})
			}
			if r.phase == Question && m.answered {
				sm.Now = &savedNow{Given: m.given, Gained: m.gained, Speed: m.speed, Right: m.graded.Right,
					Exact: m.graded.Exact}
			}
		}
		sv.Players = append(sv.Players, sm)
	}
	for id, m := range r.out {
		sv.Out = append(sv.Out, id)
		if m != nil {
			sv.Removed = append(sv.Removed, savedMember{ID: m.ID, Key: m.key, Name: m.Name, Here: m.RoomName, Look: m.Look,
				Asked: m.asked, Refused: m.refused})
		}
	}
	return sv
}

// Restore opens again the rooms Save kept, and says how many. A game under way goes on as if it hadn't stopped: the
// question showing shows again with the time it had left (at least comeBack) for whoever hadn't answered it (an
// answer given stays), and an answer showing shows again for its Pause; whoever had a screen on the room counts as
// there for comeBack, while it comes back. A game over is kept for whoever's game wasn't yet (Hub.Record keeps a game
// once). A room whose game's questions the bank no longer has as they were shown comes back to its lobby, and its
// topics as the bank has them (all, if it has none of them now); one whose code is taken meanwhile, or with nobody in
// it, doesn't come back.
func (h *Hub) Restore(rd io.Reader) (int, error) {
	var in []saved
	if err := json.NewDecoder(rd).Decode(&in); err != nil {
		return 0, err
	}
	b := h.bank()
	h.mu.Lock()
	defer h.mu.Unlock()
	n, now := 0, time.Now()
	for _, sv := range in {
		if _, taken := h.rooms[sv.Code]; taken || len(sv.Players) == 0 || len(h.rooms) >= maxRooms {
			continue
		}
		r := &Room{
			code: sv.Code, key: cmp.Or(sv.Key, secret()), host: sv.Host, locked: sv.Locked, from: sv.From, phase: Lobby,
			hub: h, subs: map[*Sub]struct{}{}, out: map[int64]*member{}, used: map[string]bool{}, opened: sv.Opened,
			active: sv.Active,
		}
		r.mu.Lock() // as the hub's is: nobody sees the room yet, but its clocks will
		// Its topics as the bank has them now, and a game's length and mix as rooms have them, or the defaults.
		sv.Categories = slices.DeleteFunc(sv.Categories, func(id string) bool {
			return !slices.ContainsFunc(b.Categories, func(c bank.Category) bool { return c.ID == id })
		})
		var err error
		if r.Settings, err = sv.Settings.check(b); err != nil {
			r.Settings, _ = Settings{Categories: sv.Categories}.check(b)
		}
		for _, id := range sv.Out {
			r.out[id] = nil // sent out, who they were not known: nobody to bring back
		}
		for _, sm := range sv.Removed {
			r.out[sm.ID] = &member{Player: Player{ID: sm.ID, Name: sm.Name, RoomName: sm.Here, Look: sm.Look}, key: sm.Key,
				asked: sm.Asked, refused: sm.Refused}
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
			m := r.add(Player{ID: sm.ID, Name: sm.Name, RoomName: sm.Here, Look: sm.Look})
			m.asked, m.refused = sm.Asked, sm.Refused
			if sv.Joined > 0 { // saved since keys are kept: each as it was
				m.key = sm.Key
			}
			if !sm.Away {
				m.back = later(now.Add(comeBack), sm.Back)
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
				m.answered, m.given, m.gained, m.speed = true, sm.Now.Given, sm.Now.Gained, sm.Now.Speed
				m.graded = bank.Graded{Right: sm.Now.Right, Exact: sm.Now.Exact, Shown: sm.Now.Given}
			}
		}
		r.joined = max(r.joined, sv.Joined)
		if r.phase != Lobby {
			r.game = 1
			r.gameID, r.planned = sv.Game, sv.Planned
			if r.gameID == "" { // saved before games had ids: kept as a new one
				r.gameID = secret()
			}
			if r.planned < len(r.dealt) {
				r.planned = len(r.dealt)
			}
		}
		switch r.phase { // the clock goes on where it was
		case Question:
			// The time the question had had as it was saved, less at least comeBack before its end: the time it had left
			// is the time it has. The answers given since count their time from then.
			limit, up := play.Limit(r.dealt[r.n].Question()), time.Duration(0)
			if !sv.ShownAt.IsZero() && !sv.SavedAt.IsZero() {
				up = min(max(0, sv.SavedAt.Sub(sv.ShownAt)), max(0, limit-comeBack))
			}
			r.shownAt = now.Add(-up)
			for i, sm := range sv.Players { // each screen's moment, as far after the question's as it was
				if m := r.players[i]; !sm.Saw.IsZero() && !sv.ShownAt.IsZero() && m.ID == sm.ID {
					m.saw = play.Saw(r.shownAt, sm.Saw.Add(r.shownAt.Sub(sv.ShownAt)), r.dealt[r.n].Question())
				}
			}
			r.timeUp()
			r.pace(r.n)
			r.recheck(comeBack)
		case Reveal:
			// The answer shows again for its Pause, which the screens coming back need as much as anyone.
			r.revealedAt = now
			r.after(Pause, func() { r.next() })
		case End:
			if sv.Game != "" { // a game whose end may not all have been kept: kept now (once, by its id)
				r.record()
			}
		}
		// The host still on their way in (hostWait), as they were before the restart: the rest of the wait, and the
		// others' screens told as it ends.
		if back := r.hostWaited(); back.After(now.Add(comeBack)) {
			r.waitHost(back)
		}
		r.mu.Unlock()
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
	// key is the secret in the room's link (Key): who has it comes in during a game too.
	key string
	Settings
	host int64  // who opened it
	from string // the address it was opened from
	// locked: nobody new comes in (SetLocked); those in it come back as ever.
	locked  bool
	players []*member // in the order they joined
	joined  int       // how many have joined: the next one's key
	// out are those the host sent out (Remove), as they were, for the host to bring back (Return); nil: someone sent
	// out before a restart that didn't keep who they were.
	out   map[int64]*member
	used  map[string]bool // every question its games have dealt: none comes again
	phase Phase
	game  int // the games begun: a game's runs are kept for it alone
	// gameID tells the game under way (or just over) from every other, in any room: it's kept once (RoomPlay.Game).
	gameID string
	// planned is how many questions the game was dealt: what it earns is by them, though it's cut short (broken).
	planned int
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
	screens    uint64 // screens opened on the room: the next one's place in the order (Sub.n)
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
	online         int   // their screens on the room
	// asked: the host has asked them for another name (AskName); refused are the names taken away, not taken again
	// while the room is open.
	asked   bool
	refused []string
	// back is until when they count as there though no screen of theirs is on the room yet: in a room restored after a
	// restart (comeBack), one was open as the server stopped, and comes back by itself; in a room just opened, the
	// host is on their way in (hostWait). left is when their last screen went.
	back, left time.Time
	// The question now: when their screen showed it (Seen: zero until it says), whether they've answered, what they
	// gave (as shown), how it went.
	saw      time.Time
	answered bool
	given    json.RawMessage
	graded   bank.Graded
	gained   int
	speed    int // of gained, for being quick
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

// In says whether someone is in the room: a member of it. To anyone else, the room is as good as not there.
func (r *Room) In(id int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return !r.closed && r.member(id) != nil
}

func (r *Room) member(id int64) *member {
	for _, m := range r.players {
		if m.ID == id {
			return m
		}
	}
	return nil
}

// Key is the secret in the room's link (the code, then the key: /r/<code>#<key>), for who's in the room to pass on:
// with it, someone new comes in during a game too (Join). Set as the room opens, and never changed.
func (r *Room) Key() string { return r.key }

// Join puts a player in the room (once; again only brings their name and look up to date, though a name for this room
// alone, Player.RoomName, stays until another is given), with the key they have of it ("": the code alone). Someone
// new comes in unless the host has locked it, and during a game only with the key: joining mid-game is fine, from the
// next answer on, for whom the room's link was sent. A player the host asked for another name (AskName) keeps the one
// drawn for them until they give one, and can't give back a name taken away, then or later (ErrNameAgain).
func (r *Room) Join(p Player, key string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.admits(p.ID, key); err != nil {
		return err
	}
	if m := r.member(p.ID); m != nil {
		if p.RoomName {
			if slices.ContainsFunc(m.refused, func(n string) bool { return strings.EqualFold(n, p.Name) }) {
				return ErrNameAgain
			}
			m.asked = false
		}
		if m.RoomName && !p.RoomName {
			p.Name, p.RoomName = m.Name, true
		}
		m.Player = p // a new name or look shows from now on
		r.changed()
		return nil
	}
	r.add(p)
	r.changed()
	return nil
}

// Admits says why someone (0: nobody signed in yet, so someone new) couldn't come into the room now with the key they
// have of it, if they couldn't: as Join would say, changing nothing.
func (r *Room) Admits(id int64, key string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.admits(id, key)
}

// admits is Admits. Called with the lock held.
func (r *Room) admits(id int64, key string) error {
	switch {
	case r.closed:
		return ErrNoRoom
	case id != 0 && r.isOut(id):
		return ErrRemoved
	case id != 0 && r.member(id) != nil:
		return nil // back
	case r.locked:
		return ErrLocked
	case r.playing() && subtle.ConstantTimeCompare([]byte(key), []byte(r.key)) != 1:
		return ErrStarted
	case len(r.players) >= MaxPlayers:
		return ErrFull
	}
	return nil
}

// playing is whether a game is being played: a question or its answer up. Called with the lock held.
func (r *Room) playing() bool { return r.phase == Question || r.phase == Reveal }

// add puts a player in the room, under the next key. Called with the lock held (or before anyone can see the room).
func (r *Room) add(p Player) *member {
	m := &member{Player: p, key: r.joined}
	r.joined++
	r.players = append(r.players, m)
	return m
}

// isOut is whether the host has sent a player out. Called with the lock held.
func (r *Room) isOut(id int64) bool {
	_, out := r.out[id]
	return out
}

// Remove is the host sending a player (by their key) out of the room: their screens are told so, and they can't come
// back unless the host brings them back (Return). Whatever the room waited on them for goes on without them.
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
	m := r.players[i]
	id := m.ID
	r.players = slices.Delete(r.players, i, i+1)
	r.out[id] = m
	m.online, m.left = 0, time.Now()
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

// Return is the host bringing back a player they sent out (by the key they had): in the room again as they were, with
// their game's points, though it's locked (they were in it); they come back to it by its code or link, as anyone who
// left it does.
func (r *Room) Return(by int64, key int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if by != r.host {
		return ErrNotYours
	}
	var m *member
	for _, o := range r.out {
		if o != nil && o.key == key {
			m = o
		}
	}
	if m == nil {
		return ErrNotNow
	}
	if len(r.players) >= MaxPlayers {
		return ErrFull
	}
	delete(r.out, m.ID)
	// The question up now counts as answered if they answered it before they went (an answer isn't taken twice).
	m.answered = r.phase == Question && slices.ContainsFunc(m.log, func(l loggedAnswer) bool { return l.n == r.n && l.given != nil })
	if !m.answered {
		m.given, m.graded, m.gained, m.speed = nil, bank.Graded{}, 0, 0
	}
	r.players = append(r.players, m)
	r.changed()
	return nil
}

// AskName is the host asking a player (by their key) for another name, in the room's lobby or between games: theirs
// in the room is drawn (`drawn`: their animal's) until they give another, which can't be the one taken away (Join).
func (r *Room) AskName(by int64, key int, drawn string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if by != r.host {
		return ErrNotYours
	}
	if r.phase != Lobby && r.phase != End {
		return ErrNotNow
	}
	i := slices.IndexFunc(r.players, func(m *member) bool { return m.key == key })
	if i < 0 || r.players[i].ID == r.host {
		return ErrNotNow
	}
	m := r.players[i]
	if !m.asked { // asked again before giving another: the name now is the drawn one, not theirs
		m.refused = append(m.refused, m.Name)
	}
	m.Name, m.RoomName, m.asked = drawn, true, true
	r.changed()
	return nil
}

// SetLocked is the host locking the room (on: nobody new comes in, once everyone is there) or opening it again.
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

// Sub is a screen following a room: C says the room changed (read View then), Done that the room is gone, that the
// host sent its player out (Removed), or that the player opened it on one screen too many (Moved).
type Sub struct {
	C      chan struct{}
	Done   chan struct{}
	viewer int64
	n      uint64 // its place in the order the room's screens opened
	// Why Done was closed, set before it is.
	removed, moved bool
}

// Removed says, once Done is closed, whether it was for the host sending the player out.
func (s *Sub) Removed() bool { return s.removed }

// Moved says, once Done is closed, whether it was for the room opened on another screen (maxScreensEach, maxScreens).
func (s *Sub) Moved() bool { return s.moved }

// Follow is a player's screen following the room (Join first). One screen more than
// maxScreensEach closes their oldest; past maxScreens in all, someone with no screen on the room yet comes in in place
// of the oldest screen of whoever has the most, and anyone else is told ErrBusy. Only a player's first screen is news
// to the others (they're there now): any other is this screen's alone.
func (r *Room) Follow(viewer int64) (*Sub, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.member(viewer)
	if m == nil || r.closed {
		return nil, ErrNoRoom
	}
	switch {
	case m.online >= maxScreensEach:
		r.drop(r.oldest(viewer))
	case len(r.subs) >= maxScreens:
		counts := map[int64]int{}
		most := int64(0)
		for s := range r.subs {
			counts[s.viewer]++
			if counts[s.viewer] > counts[most] {
				most = s.viewer
			}
		}
		if m.online > 0 || counts[most] < 2 {
			return nil, ErrBusy
		}
		r.drop(r.oldest(most))
	}
	r.screens++
	s := &Sub{C: make(chan struct{}, 1), Done: make(chan struct{}), viewer: viewer, n: r.screens}
	r.subs[s] = struct{}{}
	if m.online++; m.online == 1 {
		m.back = time.Time{} // their screen is here: counted as there by it from now on, not by a wait for it
		r.changed()
	} else {
		s.C <- struct{}{} // its first look
	}
	return s, nil
}

// Unfollow is a screen gone (closed, offline). Only a player's last screen is news to the others: they're away now.
func (r *Room) Unfollow(s *Sub) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.subs[s]; !ok {
		return
	}
	delete(r.subs, s)
	if m := r.member(s.viewer); m != nil {
		if m.online--; m.online == 0 {
			m.left = time.Now()
			r.changed()
		}
	}
}

// oldest is a viewer's screen opened first. Called with the lock held.
func (r *Room) oldest(viewer int64) *Sub {
	var first *Sub
	for s := range r.subs {
		if s.viewer == viewer && (first == nil || s.n < first.n) {
			first = s
		}
	}
	return first
}

// drop closes a screen to make way for another (Moved): its viewer has others still, so it's news to nobody. Called
// with the lock held.
func (r *Room) drop(s *Sub) {
	if s == nil {
		return
	}
	s.moved = true
	close(s.Done)
	delete(r.subs, s)
	if m := r.member(s.viewer); m != nil {
		m.online--
	}
}

// there says whether a player is in the room now: a screen of theirs on it, or, just after a restart, one that was
// and is coming back (back). Called with the lock held.
func (m *member) there(now time.Time) bool { return m.online > 0 || now.Before(m.back) }

// away says, as the room is saved, whether a player is to be waited for no more once it's restored: no screen of
// theirs on it, nor one a moment ago (comeBack), as every screen closes when the server stops, just before it saves.
func away(online int, back, left, now time.Time) bool {
	return online == 0 && !now.Before(back) && now.Sub(left) >= comeBack
}

// later is the later of two times.
func later(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
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

// mayLead says whether a player may start a game: the host, or anyone in the room while the host is away (or not in
// it at all: a room saved by an older server, its host leading from a big screen).
func (r *Room) mayLead(id int64) bool {
	if r.member(id) == nil {
		return false
	}
	h := r.member(r.host)
	return id == r.host || h == nil || !h.there(time.Now())
}

// Start begins a game: new questions, everyone from nought. From the lobby, or again after the end. What the game is
// drawn by (Hub.Past, from the database: the
// day's questions, and those its players have seen) is read with no lock held, between a first look and a second:
// nothing that reads the room, or the hub, waits on the database.
func (r *Room) Start(by int64) error {
	r.mu.Lock()
	err := r.startable(by)
	players := make([]int64, 0, len(r.players))
	for _, m := range r.players {
		players = append(players, m.ID)
	}
	r.mu.Unlock()
	if err != nil {
		return err
	}
	barred := map[string]bool{}
	var seen map[string]int
	if r.hub.Past != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		day, s, err := r.hub.Past(ctx, players)
		cancel()
		if err != nil {
			return err
		}
		maps.Copy(barred, day)
		seen = s
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.startable(by); err != nil { // as it is now: another may have started it meanwhile
		return err
	}
	return r.start(barred, seen)
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
	if r.hub.paused.Load() {
		return ErrPaused
	}
	return nil
}

// Change is the host choosing what the room plays next (its topics, how many questions, how hard), in its lobby or
// between games: the code and the players stay.
func (r *Room) Change(by int64, s Settings) error {
	s, err := s.check(r.bank())
	if err != nil {
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
	r.Settings = s
	r.changed()
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
// games', those none of its players has seen first (seen: how many of them have each). Called with the lock held.
func (r *Room) start(barred map[string]bool, seen map[string]int) error {
	b := r.bank()
	maps.Copy(barred, r.used)
	picks := play.DrawRoom(b, r.Categories, r.Length, r.Mix, barred, seen, mrand.New(mrand.NewPCG(mrand.Uint64(), mrand.Uint64())))
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
	r.gameID, r.planned = secret(), len(dealt)
	for _, m := range slices.Concat(r.players, slices.Collect(maps.Values(r.out))) {
		if m != nil { // those sent out too: brought back, they start this game from nought
			m.points, m.rights, m.inRow, m.ms, m.log, m.run = 0, 0, 0, 0, nil, 0
		}
	}
	r.show(0)
	return nil
}

func (r *Room) bank() *bank.Bank { return r.hub.bank() }

// show puts question n on every screen and starts its time.
func (r *Room) show(n int) {
	r.phase, r.n, r.shownAt = Question, n, time.Now()
	for _, m := range r.players {
		m.saw, m.answered, m.given, m.graded, m.gained, m.speed = time.Time{}, false, nil, bank.Graded{}, 0, 0
	}
	r.timeUp()
	r.pace(n)
	r.changed()
}

// due is when the question now is up: its Limit after it showed, or after the latest that someone still answering it,
// and there, could have seen it (play.LiveDue: a screen that hasn't said when, at the latest it could). Called with
// the lock held.
func (r *Room) due() time.Time {
	q, now := r.dealt[r.n].Question(), time.Now()
	due := r.shownAt.Add(play.Limit(q))
	for _, m := range r.players {
		if !m.answered && m.there(now) {
			if d := play.LiveDue(r.shownAt, m.saw, q); d.After(due) {
				due = d
			}
		}
	}
	return due
}

// timeUp sets the question now to show its answer once its time is up for everyone (due), and the Grace an answer on
// its way has. Called with the lock held.
func (r *Room) timeUp() {
	r.after(max(0, time.Until(r.due())+play.Grace), func() { r.reveal() })
}

// Seen is a player's screen saying it shows question n now, drawn with its pictures in: their time on it runs from
// then (play.Saw: no earlier than the room showed it, no later than play.LagOf after). Only its first word counts,
// and only while they haven't answered: a screen can't put its start off once it's said.
func (r *Room) Seen(by int64, n int) error {
	at := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.member(by)
	if m == nil {
		return ErrNoRoom
	}
	if r.phase != Question || n != r.n || m.answered || !m.saw.IsZero() {
		return nil // too late to count, or said already: nothing to do
	}
	m.saw = play.Saw(r.shownAt, at, r.dealt[n].Question())
	r.timeUp()
	return nil
}

// recheck shows the answer to the question now at d, should everyone there have answered it by then: as those coming
// back after a restart stop counting (comeBack), the others may be all. Called with the lock held.
func (r *Room) recheck(d time.Duration) {
	n, game := r.n, r.gameID
	safe.AfterFunc(d, "room: a restored question", func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if !r.closed && r.phase == Question && r.n == n && r.gameID == game && r.allAnswered() {
			r.reveal()
		}
	}, r.broken)
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
// trusted, so it isn't played on. It ends where it is (finish), each player's game kept as far as it went;
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
	if r.counted(m, n) {
		return nil // sent again, its reply lost on the way: it counted the first time, and stays as it was
	}
	if r.phase != Question || n != r.n {
		return ErrNotNow
	}
	d, now := r.dealt[n], time.Now()
	limit := play.Limit(d.Question())
	if now.After(play.LiveDue(r.shownAt, m.saw, d.Question()).Add(play.Grace)) {
		return ErrNotNow
	}
	// Their time, from when their screen showed it (Seen); what a clue is worth, on the room's clock.
	took := play.LiveTook(r.shownAt, m.saw, now)
	g, err := bank.GradeAt(d, raw, now.Sub(r.shownAt))
	if err != nil {
		return ErrAnswer
	}
	// Points as in any game (play.WorthOf): for knowing, more for harder questions, and a part for being quick. The
	// right answers in a row are counted for the climb's feel, never for points.
	m.answered, m.given, m.graded = true, g.Shown, g
	if g.Right {
		m.rights++
		m.inRow++
	} else {
		m.inRow = 0
	}
	w := play.WorthOf(d.Question(), g.Score, took)
	m.gained, m.speed = w.Points, w.Speed
	m.points += m.gained
	m.ms += min(took, limit).Milliseconds()
	m.log = append(m.log, loggedAnswer{questionID: d.Question().Base().ID, shown: g.Shown, points: m.gained, right: g.Right,
		n: n, given: g.Given, score: g.Score, ms: min(took, limit).Milliseconds(), at: time.Now()})
	if !r.allAnswered() {
		r.timeUp() // once it is for those still answering: one whose time is up isn't waited for
		r.changed()
		return nil
	}
	r.reveal()
	return nil
}

// counted is whether m's answer to question n of the game is in already. Called with the lock held.
func (r *Room) counted(m *member, n int) bool {
	if r.phase == Question && n == r.n && m.answered {
		return true
	}
	return r.phase != Lobby && slices.ContainsFunc(m.log, func(l loggedAnswer) bool { return l.n == n && l.given != nil })
}

// allAnswered is whether everyone in the room now (there: just after a restart, those coming back too) has answered
// the question showing. A room where nobody has answered hasn't, though nobody is there: one whose screens haven't
// come back after a restart waits for the question's time.
func (r *Room) allAnswered() bool {
	now := time.Now()
	return slices.ContainsFunc(r.players, func(p *member) bool { return p.answered }) &&
		!slices.ContainsFunc(r.players, func(p *member) bool { return p.there(now) && !p.answered })
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
	r.after(Pause, func() { r.next() })
	r.changed()
}

func (r *Room) next() {
	if r.n+1 < len(r.dealt) {
		r.show(r.n + 1)
		return
	}
	r.end()
}

// end is the game over: its bonus for every answer right, and each player's game kept. The rooms are saved at once:
// a crash then can't play the end again.
func (r *Room) end() {
	r.phase = End
	for _, m := range r.players {
		if r.allRight(m) {
			m.points += play.AllRight
		}
	}
	r.record()
	r.changed()
	r.hub.saveSoon()
}

// allRight is whether m answered every question of the game right: every one it was dealt, so that a game cut short
// (broken) isn't all right for the one question asked. Called with the lock held.
func (r *Room) allRight(m *member) bool { return r.planned > 0 && m.rights >= r.planned }

// record keeps each player's game just over (Hub.Record), once it's over, outside the room's lock: a player who gave
// no answer has nothing to keep, nor one whose game is kept already (a room restored, its end kept before). The room
// counts as under way until it's done (a restart waits for it), and each player's screen hears of their run. Called
// with the lock held.
func (r *Room) record() {
	if r.hub.Record == nil {
		return
	}
	type kept struct {
		id   int64
		play play.RoomPlay
	}
	var games []kept
	players := 0 // who played the game, kept already or not: one played alone counts for less (play.RoomPlay)
	for _, m := range r.players {
		if slices.ContainsFunc(m.log, func(l loggedAnswer) bool { return l.given != nil }) {
			players++
		}
	}
	for _, m := range r.players {
		if m.run != 0 {
			continue
		}
		p := play.RoomPlay{Game: r.gameID, Category: r.topic(), Picks: r.picks, Length: r.planned, Points: m.points,
			Players: players}
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
		r.hub.saveSoon()
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
	// Locked is a room nobody new comes into (Room.SetLocked).
	Locked bool `json:"locked,omitempty"`
	// Key is the secret in the room's link (Room.Key), for who's in it to pass on.
	Key string `json:"key,omitempty"`
	// Out are those the host sent out, for the host to bring back (Room.Return): to the host alone.
	Out []PlayerView `json:"out,omitempty"`
	// AskName is the viewer asked by the host for another name (Room.AskName).
	AskName bool `json:"askName,omitempty"`
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
	// Split is how the room answered it, once the answer shows (Room.split): the same for everyone in the room.
	Split *Split `json:"split,omitempty"`
}

// Split is how the room itself answered the question whose answer shows: its crowd, as the bank counts one
// (bank.CrowdOf: how many had the question, the share right, a choice's picks in the order shown, where a number's
// guesses fell), over those in the room for it (who answered, and who was there and didn't); and who got it right,
// the quickest first, by their keys (PlayerView.Key). So that the room sees what it said („половината казаха
// Китай“) and who knew it. Nothing kept: it's counted from the answers the room holds.
type Split struct {
	Crowd *bank.CrowdView `json:"crowd,omitempty"`
	Right []int           `json:"right"`
}

type RevealView struct {
	Answer any `json:"answer"`
	Points int `json:"points"`
	// Speed is how many of the points were for being quick. InRow is how many right answers in a row the answer
	// makes, from 2: the climb's feel, worth no points.
	Speed  int  `json:"speed,omitempty"`
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
	v.Locked = r.locked
	if h := r.member(r.host); h != nil {
		v.Host = h.Name
	}
	if r.member(viewer) != nil {
		v.Key = r.key
	}
	if viewer == r.host {
		for _, m := range r.out {
			if m != nil {
				v.Out = append(v.Out, PlayerView{Key: m.key, Look: m.Look, Name: m.Name})
			}
		}
		slices.SortFunc(v.Out, func(a, b PlayerView) int { return a.Key - b.Key })
	}
	if me := r.member(viewer); me != nil {
		v.AskName = me.asked
	}
	now := time.Now()
	for _, m := range r.players {
		p := PlayerView{
			Key: m.key, Look: m.Look, Name: m.Name, Points: m.points, Rights: m.rights, Online: m.there(now), Answered: m.answered,
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
			// Their time left, from when their own screen showed it (Seen).
			left := min(limit, time.Until(play.LiveDue(r.shownAt, me.saw, d.Question())))
			q.LeftMs, q.Given = max(0, left.Milliseconds()), me.given
			if r.phase == Reveal {
				q.Reveal = &RevealView{Answer: d.Reveal(r.hub.crowd(d.Question())), Points: me.gained, Speed: me.speed,
					Right: me.graded.Right, Exact: me.graded.Exact, Missed: !me.answered}
				if me.answered && me.graded.Right && me.inRow > 1 {
					q.Reveal.InRow = me.inRow
				}
			}
		}
		if r.phase == Reveal {
			q.Split = r.split(d, now)
			q.LeftMs = 0
			q.NextMs = max(1, (Pause - time.Since(r.revealedAt)).Milliseconds())
		}
		v.Question = q
	}
	if me := r.member(viewer); me != nil && r.phase == End {
		v.Review, v.Run = r.review(me), me.run
		if r.allRight(me) {
			v.AllRight = play.AllRight
		}
	}
	return v
}

// split is how the room answered the question showing, dealt as d (Split). Called with the lock held.
func (r *Room) split(d bank.Dealt, now time.Time) *Split {
	type right struct {
		key int
		ms  int64
	}
	var tallies []bank.Tally
	var rights []right
	for _, m := range r.players {
		i := slices.IndexFunc(m.log, func(l loggedAnswer) bool { return l.n == r.n && l.given != nil })
		if i < 0 {
			if m.there(now) {
				tallies = append(tallies, bank.Tally{N: 1}) // there, and let the time run out
			}
			continue
		}
		l := m.log[i]
		t := bank.Tally{Given: l.given, N: 1}
		if l.right {
			t.Right = 1
			rights = append(rights, right{m.key, l.ms})
		}
		tallies = append(tallies, t)
	}
	slices.SortStableFunc(rights, func(a, b right) int { return cmp.Compare(a.ms, b.ms) })
	s := &Split{Crowd: bank.CrowdOf(d.Question(), tallies).In(d), Right: make([]int, 0, len(rights))}
	for _, x := range rights {
		s.Right = append(s.Right, x.key)
	}
	return s
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
