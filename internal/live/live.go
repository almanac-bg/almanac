// Package live plays duels live: a player asks for a duel and is matched with whoever else is asking, or, if
// nobody comes in Wait, with a recording of a real player's earlier game. Both see the same question at the same
// moment and each other's answers come in; after each question both answers show, then the next comes. One whose
// screen goes is waited for a while (Away), then the duel goes on without them (gone), their time running out on each
// question; a recording isn't waited for where its player let the time run out. A player who isn't there when the
// first question is due (never came, or left as the duel was found) is waited for until Arrive; after it, the duel is
// called off and leaves nothing (play.DropLive), so leaving the wait at its last second never costs a lost duel. An
// answer sent again (its reply lost on the way) is taken as the first. One who left for good is named on the result
// (play.LeftLive: after which question).
//
// Once a duel between two people is over, either may ask for a rematch (Rematch): the other sees it, and if they ask
// too within RematchFor, a new duel between the two is made at once.
//
// Every answer goes through the player's own run (internal/play), as in any game: the score, XP, the questions'
// statistics and the duel's result are kept there, and only the timing lives here, in memory. A restart cuts the
// duels under way off; they end without a result (play.EndLive). So before one, the server pauses the hub (Pause):
// no new duel starts, not even with a recording; those asking go on waiting, told why (Seek.Held), and find their
// duel once the server is back, while the duels under way (UnderWay) play to their end; a rematch waiting for its yes
// is called off, told so (ErrPaused), as its duel would be lost. Resume undoes it.
package live

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
	// Wait is how long a player waits for someone to play before they play a recording: long enough to meet whoever
	// is looking at the same moment, short enough not to stand in front of an empty room.
	Wait = 10 * time.Second
	// Intro is how long the two are shown face to face before the first question.
	Intro = 4 * time.Second
	// Arrive is how long a duel waits for both players to be at it (come, and not gone again) before it's called off.
	Arrive = 15 * time.Second
	// Away is how long a player whose line dropped is waited for on a question; after it, the question goes on
	// without them (their time still runs out on it).
	Away = 30 * time.Second
	// Keep is how long an ended duel stays, for a screen that comes back to it.
	Keep = 2 * time.Minute
	// maxMatches caps the duels under way at once, so that nobody can fill the server's memory with them.
	maxMatches = 2000
	// RematchFor is how long one who asks for a rematch waits for the other to ask too.
	RematchFor = 15 * time.Second
)

var (
	ErrNoMatch = errors.New("no such duel")
	ErrNotNow  = errors.New("not now")
	ErrAnswer  = errors.New("an answer the question can't take")
	ErrTooMany = errors.New("too many duels")
	// ErrNoRematch is a rematch that didn't come about: the other didn't ask in time (or left), or the duel can't
	// have one (against a recording, not over, gone).
	ErrNoRematch = errors.New("no rematch")
	// ErrPaused is a rematch asked for while the server is about to restart: the duel it would be is lost with it.
	ErrPaused = errors.New("the server is about to restart")
)

// Player is someone in a duel, as the other sees them.
type Player struct {
	ID       int64
	Name     string
	Tag      string
	Look     play.Look
	Rating   int
	Division play.Division
}

// Hub matches players and holds the duels under way.
type Hub struct {
	game *play.Game
	// who is a player as a duel shows them (the recorded one's too).
	who  func(context.Context, int64) (Player, error)
	wait time.Duration

	mu       sync.Mutex
	paused   bool
	waiting  []*Seek
	starting map[int64]*Seek // players whose duel is being made
	// rematches are the rematches asked for by one of a duel's two (by the duel), waiting for the other.
	rematches map[int64]*Seek
	matches   map[int64]*Match // by duel
	playing   map[int64]*Match // the duel each player is in, until it ends
}

func NewHub(g *play.Game, who func(context.Context, int64) (Player, error)) *Hub {
	return &Hub{
		game: g, who: who, wait: Wait,
		starting: map[int64]*Seek{}, matches: map[int64]*Match{}, playing: map[int64]*Match{}, rematches: map[int64]*Seek{},
	}
}

// Seek is a player asking for a duel: Done closes once it's settled, with a Match or an Err (play.ErrNobody: nobody
// came and there's no recording to play).
type Seek struct {
	hub    *Hub
	player Player
	refs   int // the screens asking (a second tab, a line that dropped and came back)
	until  time.Time
	timer  *time.Timer
	held   bool          // waiting while the hub is paused
	told   chan struct{} // held changed
	// rematch is the duel a rematch is asked for after (0: a duel with whoever comes).
	rematch int64
	done    chan struct{}
	Match   *Match
	Err     error
}

func newSeek(h *Hub, p Player) *Seek {
	return &Seek{hub: h, player: p, refs: 1, done: make(chan struct{}), told: make(chan struct{}, 1)}
}

// Done closes when the seek is settled.
func (s *Seek) Done() <-chan struct{} { return s.done }

// Left is how long the player still waits for someone before a recording.
func (s *Seek) Left() time.Duration { return max(0, time.Until(s.until)) }

// Held says whether the player waits for the server to restart (the hub is paused) rather than for someone to come.
func (s *Seek) Held() bool {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	return s.held
}

// Changed says Held may have changed.
func (s *Seek) Changed() <-chan struct{} { return s.told }

// hold marks a waiting seek held or not. Called with the hub's lock held.
func (s *Seek) hold(held bool) {
	if s.held == held {
		return
	}
	s.held = held
	select {
	case s.told <- struct{}{}:
	default:
	}
}

func (s *Seek) settle(m *Match, err error) {
	s.Match, s.Err = m, err
	close(s.done)
}

// Seek asks for a duel for a player: the one they're in if they're in one, else with whoever is waiting, else they
// wait (and get a recording after Wait). While the hub is paused, they wait, held, for as long as it is. Leave it
// when the screen goes.
func (h *Hub) Seek(p Player) *Seek {
	h.mu.Lock()
	if m := h.playing[p.ID]; m != nil {
		h.mu.Unlock()
		s := newSeek(h, p)
		s.settle(m, nil)
		return s
	}
	if s := h.starting[p.ID]; s != nil {
		s.refs++
		h.mu.Unlock()
		return s
	}
	for _, s := range h.waiting {
		if s.player.ID == p.ID {
			s.refs++
			h.mu.Unlock()
			return s
		}
	}
	s := newSeek(h, p)
	s.until = time.Now().Add(h.wait)
	if h.paused || len(h.waiting) == 0 {
		s.timer = time.AfterFunc(h.wait, func() { h.expire(s) })
		s.held = h.paused
		h.waiting = append(h.waiting, s)
		h.mu.Unlock()
		return s
	}
	other := h.waiting[0]
	h.waiting = h.waiting[1:]
	start := h.pair(other, s)
	h.mu.Unlock()
	start()
	return s
}

// pair makes a duel of two seeks taken out of the queue; what it returns starts it, to run once the hub's lock is let
// go. Called with the lock held.
func (h *Hub) pair(a, b *Seek) func() {
	for _, s := range []*Seek{a, b} {
		if s.timer != nil {
			s.timer.Stop()
		}
		s.hold(false)
	}
	if len(h.matches) >= maxMatches {
		return func() {
			a.settle(nil, ErrTooMany)
			b.settle(nil, ErrTooMany)
		}
	}
	h.starting[a.player.ID], h.starting[b.player.ID] = a, b
	return func() {
		m, err := h.launch([]int64{a.player.ID, b.player.ID}, func(ctx context.Context) (play.Live, [2]Player, error) {
			l, err := h.game.StartLive(ctx, a.player.ID, b.player.ID)
			return l, [2]Player{a.player, b.player}, err
		})
		a.settle(m, err)
		b.settle(m, err)
	}
}

// Pause stops new duels from starting, for a restart: whoever asks for one waits, held, and the duels under way go on.
// A rematch waiting for the other's yes is called off at once, told so: the duel it was for is lost with the restart.
func (h *Hub) Pause() {
	h.mu.Lock()
	h.paused = true
	for _, s := range h.waiting {
		s.hold(true)
	}
	var off []*Seek
	for id, s := range h.rematches {
		delete(h.rematches, id)
		s.timer.Stop()
		off = append(off, s)
	}
	h.mu.Unlock()
	for _, s := range off {
		h.unwant(s)
		s.settle(nil, ErrPaused)
	}
}

// Rematch asks for a new duel between the two players of a live duel just over (id), against a person: the first to
// ask waits up to RematchFor for the other, who sees that they asked (SideView.Rematch); once both have, the duel is
// made, and both seeks settle with it. ErrNoRematch if the other doesn't ask in time, or the duel can't have one (not
// over, against a recording, gone, one of the two in another duel); ErrPaused while the hub is paused. Leave it when
// the screen goes, as any seek: the one who asked first, gone, isn't waited for.
func (h *Hub) Rematch(p Player, id int64) *Seek {
	s := newSeek(h, p)
	m, err := h.Get(id)
	if err != nil {
		s.settle(nil, ErrNoRematch)
		return s
	}
	m.mu.Lock()
	me, other := m.sides[0], m.sides[1]
	if other.ID == p.ID {
		me, other = other, me
	}
	can := m.phase == PhaseEnd && me.ID == p.ID && me.human() && other.human()
	m.mu.Unlock()
	if !can {
		s.settle(nil, ErrNoRematch)
		return s
	}
	h.mu.Lock()
	if h.paused {
		h.mu.Unlock()
		s.settle(nil, ErrPaused)
		return s
	}
	if h.playing[p.ID] != nil || h.playing[other.ID] != nil || h.starting[p.ID] != nil || h.starting[other.ID] != nil {
		h.mu.Unlock()
		s.settle(nil, ErrNoRematch)
		return s
	}
	w := h.rematches[id]
	switch {
	case w == nil: // the first to ask: they wait for the other
		s.rematch, s.until = id, time.Now().Add(RematchFor)
		s.timer = time.AfterFunc(RematchFor, func() { h.rematchOver(s) })
		h.rematches[id] = s
		h.mu.Unlock()
		m.want(p.ID, true)
		return s
	case w.player.ID == p.ID: // asked again (a second screen, a line come back)
		w.refs++
		h.mu.Unlock()
		return w
	}
	delete(h.rematches, id)
	start := h.pair(w, s)
	h.mu.Unlock()
	start()
	return s
}

// rematchOver is a rematch the other didn't ask for in time.
func (h *Hub) rematchOver(s *Seek) {
	h.mu.Lock()
	if h.rematches[s.rematch] != s { // met, or gone, meanwhile
		h.mu.Unlock()
		return
	}
	delete(h.rematches, s.rematch)
	h.mu.Unlock()
	h.unwant(s)
	s.settle(nil, ErrNoRematch)
}

// unwant is a rematch asked for no longer: the other's screen stops saying so. Called without the hub's lock.
func (h *Hub) unwant(s *Seek) {
	if m, err := h.Get(s.rematch); err == nil {
		m.want(s.player.ID, false)
	}
}

// want marks a player of the duel as asking for a rematch, or no longer.
func (m *Match) want(id int64, on bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s := m.side(id); s != nil && s.rematch != on {
		s.rematch = on
		m.changed()
	}
}

// Resume undoes Pause: those waiting meet each other two by two, and one left alone waits out the rest of their Wait
// (if any is left) before a recording.
func (h *Hub) Resume() {
	h.mu.Lock()
	if !h.paused {
		h.mu.Unlock()
		return
	}
	h.paused = false
	var starts []func()
	for len(h.waiting) >= 2 {
		a, b := h.waiting[0], h.waiting[1]
		h.waiting = h.waiting[2:]
		starts = append(starts, h.pair(a, b))
	}
	for _, s := range h.waiting {
		s.hold(false)
		s.timer.Reset(s.Left())
	}
	h.mu.Unlock()
	for _, start := range starts {
		go start()
	}
}

// UnderWay is how many duels a restart would cut now: those being played, and those being made.
func (h *Hub) UnderWay() int {
	h.mu.Lock()
	n := len(h.starting)
	all := make([]*Match, 0, len(h.matches))
	for _, m := range h.matches {
		all = append(all, m)
	}
	h.mu.Unlock()
	for _, m := range all {
		m.mu.Lock()
		if !m.over() {
			n++
		}
		m.mu.Unlock()
	}
	return n
}

// Leave is a screen that asked giving up (closed, gone offline): when none is left, the player stops waiting.
func (s *Seek) Leave() {
	h := s.hub
	h.mu.Lock()
	defer h.mu.Unlock()
	s.refs--
	if s.refs > 0 {
		return
	}
	if s.rematch != 0 && h.rematches[s.rematch] == s {
		delete(h.rematches, s.rematch)
		s.timer.Stop()
		go h.unwant(s) // the match's lock comes before the hub's
		return
	}
	for i, w := range h.waiting {
		if w == s {
			h.waiting = append(h.waiting[:i], h.waiting[i+1:]...)
			s.timer.Stop()
			return
		}
	}
}

// expire is a player's wait over with nobody come: they play a recording.
func (h *Hub) expire(s *Seek) {
	h.mu.Lock()
	i := slices.Index(h.waiting, s)
	if i < 0 || h.paused { // matched, or gone, meanwhile; or held until the hub resumes
		h.mu.Unlock()
		return
	}
	h.waiting = slices.Delete(h.waiting, i, i+1)
	if len(h.matches) >= maxMatches {
		h.mu.Unlock()
		s.settle(nil, ErrTooMany)
		return
	}
	h.starting[s.player.ID] = s
	h.mu.Unlock()
	s.settle(h.launch([]int64{s.player.ID}, func(ctx context.Context) (play.Live, [2]Player, error) {
		l, err := h.game.StartRecorded(ctx, s.player.ID)
		if err != nil {
			return l, [2]Player{}, err
		}
		rec, err := h.who(ctx, l.Users[1])
		return l, [2]Player{s.player, rec}, err
	}))
}

// launch makes a duel (in the database, by start) and starts it; the players it's made for stop starting either way.
func (h *Hub) launch(players []int64, start func(context.Context) (play.Live, [2]Player, error)) (*Match, error) {
	ctx := context.Background()
	l, sides, err := start(ctx)
	var m *Match
	if err == nil {
		m, err = newMatch(h, l, sides)
	}
	if err != nil && l.DuelID != 0 {
		_ = h.game.DropLive(ctx, l.DuelID)
	}
	h.mu.Lock()
	for _, id := range players {
		delete(h.starting, id)
	}
	if m != nil {
		h.matches[m.id] = m
		for _, s := range m.sides {
			if s.human() {
				h.playing[s.ID] = m
			}
		}
	}
	h.mu.Unlock()
	if m == nil {
		return nil, err
	}
	m.mu.Lock()
	m.after(Intro, m.begin)
	m.mu.Unlock()
	return m, nil
}

// release is a duel over: its players are free to play another.
func (h *Hub) release(m *Match) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, s := range m.sides {
		if h.playing[s.ID] == m {
			delete(h.playing, s.ID)
		}
	}
}

// Get finds a duel under way (or just over).
func (h *Hub) Get(id int64) (*Match, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	m, ok := h.matches[id]
	if !ok {
		return nil, ErrNoMatch
	}
	return m, nil
}

// Sweep forgets duels over for a while (and calls off any that has gone on far too long).
func (h *Hub) Sweep() {
	h.mu.Lock()
	all := make([]*Match, 0, len(h.matches))
	for _, m := range h.matches {
		all = append(all, m)
	}
	h.mu.Unlock()
	for _, m := range all {
		m.mu.Lock()
		if !m.over() && time.Since(m.opened) > play.LiveFor {
			m.cancel()
		}
		gone := m.over() && time.Since(m.ended) > Keep
		if gone {
			m.close()
		}
		m.mu.Unlock()
		if gone {
			h.mu.Lock()
			delete(h.matches, m.id)
			h.mu.Unlock()
		}
	}
}

type Phase string

const (
	PhaseIntro    Phase = "intro"
	PhaseQuestion Phase = "question"
	PhaseReveal   Phase = "reveal"
	PhaseEnd      Phase = "end"
	// PhaseOff is a duel called off without a result: a player wasn't there as it began, or it was cut off.
	PhaseOff Phase = "off"
)

// Match is one duel being played.
type Match struct {
	hub   *Hub
	id    int64
	dealt []bank.Dealt
	topic string // against a recording of a game in one topic: which

	mu         sync.Mutex
	sides      [2]*side
	phase      Phase
	n          int // the question now
	opened     time.Time
	shownAt    time.Time
	revealedAt time.Time
	ended      time.Time
	pause      time.Duration // how long the answer now shows
	timer      *time.Timer
	recTimer   *time.Timer // the recording's answer to the question now
	paceTimer  *time.Timer // the next clue of the question now (bank.Paced)
	subs       map[*Sub]struct{}
}

type side struct {
	Player
	run int64
	// recording, for the side that plays one back: how it answered each question.
	recording []play.Recorded
	online    int
	came      bool // has followed the duel at least once
	leftAt    time.Time
	leftAfter int  // how many questions they had played when they last left
	rematch   bool // asks for a rematch, once the duel is over (Hub.Rematch)
	points    int
	rights    int
	marks     []play.Mark
	// The question now: whether they've answered, how long it took, what they gave (as shown) and how it went.
	answered bool
	took     time.Duration
	given    json.RawMessage
	gained   int
	speed    int
	row      int // of gained, for the right answers in a row
	inRow    int // right answers in a row, this one counted
	right    bool
	exact    bool
}

func (s *side) human() bool { return s.recording == nil }

// gone says a player has been away from the duel longer than Away: it goes on without them.
func (s *side) gone() bool {
	return s.human() && s.online == 0 && s.came && time.Since(s.leftAt) >= Away
}

// answers says whether a recording has an answer to question n (else its player let the time run out there).
func (s *side) answers(n int) bool {
	return n < len(s.recording) && s.recording[n].Shown != nil
}

func newMatch(h *Hub, l play.Live, players [2]Player) (*Match, error) {
	b := h.game.Bank()
	m := &Match{hub: h, id: l.DuelID, phase: PhaseIntro, opened: time.Now(), subs: map[*Sub]struct{}{}}
	for _, p := range l.Picks {
		q, ok := b.Get(p.ID)
		if !ok {
			return nil, play.ErrNoQuestion
		}
		m.dealt = append(m.dealt, q.Deal(p.Seed))
	}
	if len(m.dealt) == 0 {
		return nil, play.ErrNoQuestion
	}
	for i := range m.sides {
		m.sides[i] = &side{Player: players[i], run: l.Runs[i]}
	}
	if l.Recording != nil {
		m.sides[1].recording = l.Recording
		m.topic = l.Topic
		m.sides[1].came = true
	}
	return m, nil
}

func (m *Match) ID() int64 { return m.id }

func (m *Match) over() bool { return m.phase == PhaseEnd || m.phase == PhaseOff }

func (m *Match) side(id int64) *side {
	for _, s := range m.sides {
		if s.ID == id && s.human() {
			return s
		}
	}
	return nil
}

// Sub is a screen following a duel: C says it changed (read View then), Done that it's gone.
type Sub struct {
	C      chan struct{}
	Done   chan struct{}
	viewer int64
}

// Follow is a player's screen following their duel.
func (m *Match) Follow(viewer int64) (*Sub, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.side(viewer)
	if s == nil || m.subs == nil {
		return nil, ErrNoMatch
	}
	sub := &Sub{C: make(chan struct{}, 1), Done: make(chan struct{}), viewer: viewer}
	m.subs[sub] = struct{}{}
	s.online++
	s.came = true
	m.changed()
	return sub, nil
}

// Unfollow is a screen gone (closed, offline).
func (m *Match) Unfollow(sub *Sub) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.subs[sub]; !ok {
		return
	}
	delete(m.subs, sub)
	s := m.side(sub.viewer)
	if s == nil {
		return
	}
	s.online--
	if s.online == 0 {
		s.leftAt = time.Now()
		s.leftAfter = m.n
		if m.phase == PhaseReveal {
			s.leftAfter++ // its answer seen: that question was played
		}
		// Once they've been away too long, the question up then (whichever it is) goes on if it waits only for them,
		// and the other is told they're gone.
		time.AfterFunc(Away+time.Millisecond, func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			switch {
			case m.over():
			case m.phase == PhaseQuestion:
				m.maybeReveal()
			default:
				m.changed()
			}
		})
	}
	m.changed()
}

// changed tells every screen to look again. Called with the lock held.
func (m *Match) changed() {
	for s := range m.subs {
		select {
		case s.C <- struct{}{}:
		default: // it hasn't looked since the last change; one look will do for both
		}
	}
}

// close tells the screens the duel is gone.
func (m *Match) close() {
	m.stop()
	for s := range m.subs {
		close(s.Done)
	}
	m.subs = nil
}

func (m *Match) stop() {
	if m.timer != nil {
		m.timer.Stop()
	}
	if m.recTimer != nil {
		m.recTimer.Stop()
	}
	if m.paceTimer != nil {
		m.paceTimer.Stop()
	}
}

// pace tells both screens to look again as more of question n shows (its next clue), while it's still up.
func (m *Match) pace(n int) {
	if m.paceTimer != nil {
		m.paceTimer.Stop()
	}
	next := bank.NextStep(m.dealt[n], time.Since(m.shownAt))
	if next == 0 {
		return
	}
	m.paceTimer = time.AfterFunc(next, func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.n == n && m.phase == PhaseQuestion {
			m.changed()
			m.pace(n)
		}
	})
}

// after runs fn after d, if the duel is then still on the same question and phase.
func (m *Match) after(d time.Duration, fn func()) {
	if m.timer != nil {
		m.timer.Stop()
	}
	n, phase := m.n, m.phase
	m.timer = time.AfterFunc(d, func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.n == n && m.phase == phase {
			fn()
		}
	})
}

// begin puts the first question up once both players are at the duel. One who never comes, or who left before it
// began (their screen closed as the duel was found), is waited for until Arrive; then the duel is called off before
// anything was played, and leaves nothing.
func (m *Match) begin() {
	for _, s := range m.sides {
		if s.human() && s.online == 0 {
			if time.Since(m.opened) < Arrive {
				m.after(time.Second, m.begin)
			} else {
				m.off(m.hub.game.DropLive)
			}
			return
		}
	}
	m.show(0)
}

// cancel calls the duel off under way, without a result.
func (m *Match) cancel() { m.off(m.hub.game.CancelLive) }

// off calls the duel off, ending it as end keeps it (CancelLive, or DropLive before it began).
func (m *Match) off(end func(context.Context, int64) error) {
	m.stop()
	m.phase, m.ended = PhaseOff, time.Now()
	if err := end(context.Background(), m.id); err != nil {
		slog.Error("live duel", "duel", m.id, "err", err)
	}
	m.hub.release(m)
	m.changed()
}

// show puts question n up for both, and starts its time (on each player's run too, which keeps the score).
func (m *Match) show(n int) {
	m.phase, m.n, m.shownAt = PhaseQuestion, n, time.Now()
	for _, s := range m.sides {
		s.answered, s.took, s.given, s.gained, s.speed, s.row, s.inRow, s.right, s.exact = false, 0, nil, 0, 0, 0, 0, false, false
		if s.human() {
			if _, err := m.hub.game.ShowNow(context.Background(), s.ID, s.run); err != nil {
				slog.Error("live duel", "duel", m.id, "err", err)
				m.cancel()
				return
			}
		}
	}
	limit := play.Limit(m.dealt[n].Question())
	m.after(limit+play.Grace, m.reveal)
	m.pace(n)
	// The recording answers when it did.
	if m.recTimer != nil {
		m.recTimer.Stop()
	}
	for _, s := range m.sides {
		if s.recording == nil || n >= len(s.recording) || s.recording[n].Shown == nil {
			continue
		}
		r := s.recording[n]
		at := min(time.Duration(r.Ms)*time.Millisecond, limit)
		m.recTimer = time.AfterFunc(at, func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.phase != PhaseQuestion || m.n != n || s.answered {
				return
			}
			s.answered, s.took, s.given, s.gained, s.right = true, at, r.Shown, r.Points, r.Right
			m.maybeReveal()
		})
	}
	m.changed()
}

// Answer takes a player's answer to question n. Once both have answered, both answers show. An answer sent again (its
// reply lost on the way) is the one taken already: no error, while its question or its answer shows.
func (m *Match) Answer(by int64, n int, raw json.RawMessage) error {
	at := time.Now() // its time is to when it came, not to when the duel takes it
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.side(by)
	if s == nil {
		return ErrNoMatch
	}
	if n == m.n && s.answered && (m.phase == PhaseQuestion || m.phase == PhaseReveal) {
		return nil
	}
	if m.phase != PhaseQuestion || n != m.n || s.answered {
		return ErrNotNow
	}
	took := max(0, at.Sub(m.shownAt))
	g, err := bank.GradeAt(m.dealt[n], raw, took)
	if err != nil {
		return ErrAnswer
	}
	res, err := m.hub.game.AnswerAt(context.Background(), s.ID, s.run, n, raw, at)
	if errors.Is(err, play.ErrOutOfStep) {
		return ErrNotNow
	}
	if errors.Is(err, play.ErrBadAnswer) {
		return ErrAnswer
	}
	if err != nil {
		return err
	}
	s.answered, s.took, s.given = true, took, g.Shown
	s.gained, s.speed, s.row, s.inRow, s.right, s.exact = res.Points, res.Speed, res.Row, res.InRow, res.Right, res.Exact
	if res.TimedOut {
		s.given = nil
	}
	m.maybeReveal()
	return nil
}

// maybeReveal shows the answers if nobody is still waited for: a player here (or away only a moment) who hasn't
// answered, or a recording whose answer is still to come (not one whose player let the time run out there).
func (m *Match) maybeReveal() {
	for _, s := range m.sides {
		if s.answered || (!s.human() && !s.answers(m.n)) {
			continue
		}
		if !s.human() || s.online > 0 || time.Since(s.leftAt) < Away {
			m.changed()
			return
		}
	}
	m.reveal()
}

// reveal shows the answer: a player who didn't answer gets nothing for it (their run is told so).
func (m *Match) reveal() {
	m.phase, m.revealedAt = PhaseReveal, time.Now()
	if m.recTimer != nil {
		m.recTimer.Stop()
	}
	for _, s := range m.sides {
		if !s.answered && s.human() {
			if _, err := m.hub.game.Answer(context.Background(), s.ID, s.run, m.n, nil); err != nil &&
				!errors.Is(err, play.ErrOutOfStep) {
				slog.Error("live duel", "duel", m.id, "err", err)
			}
		}
		if !s.answered {
			s.given, s.gained, s.right, s.exact = nil, 0, false, false
		}
		s.points += s.gained
		if s.right {
			s.rights++
		}
		s.marks = append(s.marks, play.Mark{Points: s.gained, Right: s.right, Partial: s.gained > 0 && !s.right})
	}
	m.pause = pauseFor(m.dealt[m.n].Question())
	if m.n+1 < len(m.dealt) {
		m.after(m.pause, func() { m.show(m.n + 1) })
	} else {
		m.after(m.pause, m.end)
	}
	m.changed()
}

// pauseFor is how long an answer shows: longer where there's more to look at.
func pauseFor(q bank.Question) time.Duration {
	switch q.Base().Type {
	case "choice", "truefalse":
		return 4 * time.Second
	}
	return 6 * time.Second
}

// end is the last answer shown: the duel's result is kept already (the runs settled it as their last answers came).
// A side with every answer right gets the bonus for it, as its run did.
func (m *Match) end() {
	m.stop()
	for _, s := range m.sides {
		if s.rights == len(m.dealt) {
			s.points += play.AllRight
		}
		// One who left for good is named on the result: when they left, and that it went on without them.
		if s.gone() {
			if err := m.hub.game.LeftLive(context.Background(), m.id, s.ID, s.leftAfter); err != nil {
				slog.Error("live duel", "duel", m.id, "err", err)
			}
		}
	}
	m.phase, m.ended = PhaseEnd, time.Now()
	m.hub.release(m)
	m.changed()
}

// View is the duel as one of its players sees it.
type View struct {
	ID    int64 `json:"id"`
	Phase Phase `json:"phase"`
	N     int   `json:"n"`
	Total int   `json:"total"`
	// Recorded is a duel against a recording of the other's game; Topic, the one topic that game was in (a topic's
	// game, which the duel's player didn't choose), if it was.
	Recorded bool     `json:"recorded,omitempty"`
	Topic    string   `json:"topic,omitempty"`
	You      SideView `json:"you"`
	Them     SideView `json:"them"`
	// StartsMs is how long until the first question, while the two are shown.
	StartsMs int64         `json:"startsMs,omitempty"`
	Question *QuestionView `json:"question,omitempty"`
}

// SideView is one side of a duel: who, how they stand, and how the question now goes for them.
type SideView struct {
	play.Look
	Name     string      `json:"name"`
	Tag      string      `json:"tag,omitempty"`
	Rating   int         `json:"rating"`
	Division string      `json:"division"`
	Points   int         `json:"points"`
	Rights   int         `json:"rights"`
	Trail    []play.Mark `json:"trail"`
	Online   bool        `json:"online"`
	// Gone says they've been away longer than Away: the duel goes on without them (their time runs out on each question).
	Gone bool `json:"gone,omitempty"`
	// Rematch says they ask for a rematch (the duel is over): the other has RematchFor to ask too.
	Rematch bool `json:"rematch,omitempty"`
	// Answered says they've answered the question now, and TookMs how quickly; what they gave and how it went show
	// only with the answer (Given, Gained, Right), so nobody can follow the other's lead.
	Answered bool            `json:"answered"`
	TookMs   int64           `json:"tookMs,omitempty"`
	Given    json.RawMessage `json:"given,omitempty"`
	Gained   int             `json:"gained,omitempty"`
	Right    bool            `json:"right,omitempty"`
	Missed   bool            `json:"missed,omitempty"`
}

type QuestionView struct {
	Category string `json:"category"`
	View     any    `json:"view"`
	LimitMs  int64  `json:"limitMs"`
	LeftMs   int64  `json:"leftMs"`
	// NextMs is how long until the duel moves on, while an answer shows.
	NextMs int64 `json:"nextMs,omitempty"`
	// Given is the viewer's answer, as shown (once given).
	Given json.RawMessage `json:"given,omitempty"`
	// Reveal is the answer, once it shows, with how the viewer's went.
	Reveal *RevealView `json:"reveal,omitempty"`
}

type RevealView struct {
	Answer any `json:"answer"`
	Points int `json:"points"`
	// Speed is how many of the points were for being quick.
	Speed int `json:"speed,omitempty"`
	// Row is how many of the points were for the right answers in a row InRow.
	Row    int  `json:"row,omitempty"`
	InRow  int  `json:"inRow,omitempty"`
	Right  bool `json:"right"`
	Exact  bool `json:"exact,omitempty"`
	Missed bool `json:"missed,omitempty"`
}

// View builds what one player sees now.
func (m *Match) View(viewer int64) View {
	m.mu.Lock()
	defer m.mu.Unlock()
	me, them := m.sides[0], m.sides[1]
	if me.ID != viewer || !me.human() {
		me, them = them, me
	}
	shown := m.phase == PhaseReveal
	v := View{
		ID: m.id, Phase: m.phase, N: m.n, Total: len(m.dealt), Recorded: !them.human(), Topic: m.topic,
		You: m.sideView(me, true, shown), Them: m.sideView(them, false, shown),
	}
	if m.phase == PhaseIntro {
		v.StartsMs = max(0, (Intro - time.Since(m.opened)).Milliseconds())
	}
	if m.phase == PhaseQuestion || m.phase == PhaseReveal {
		d := m.dealt[m.n]
		limit, since := play.Limit(d.Question()), time.Since(m.shownAt)
		if shown {
			since = limit // everything shows with the answer
		}
		q := &QuestionView{
			Category: d.Question().Base().Category, View: bank.ViewAt(d, since),
			LimitMs: limit.Milliseconds(), LeftMs: max(0, (limit - since).Milliseconds()),
			Given: me.given,
		}
		if shown {
			q.LeftMs = 0
			q.NextMs = max(1, (m.pause - time.Since(m.revealedAt)).Milliseconds())
			q.Reveal = &RevealView{Answer: d.Reveal(m.hub.game.Crowd(d.Question().Base().ID)), Points: me.gained, Speed: me.speed, Row: me.row, InRow: me.inRow,
				Right: me.right, Exact: me.exact, Missed: !me.answered}
		}
		v.Question = q
	}
	return v
}

func (m *Match) sideView(s *side, mine, shown bool) SideView {
	v := SideView{
		Look: s.Look, Name: s.Name, Tag: s.Tag, Rating: s.Rating, Division: s.Division.ID,
		Points: s.points, Rights: s.rights, Trail: append([]play.Mark{}, s.marks...),
		Online: !s.human() || s.online > 0, Answered: s.answered, Gone: s.gone(), Rematch: s.rematch,
	}
	if s.answered {
		v.TookMs = s.took.Milliseconds()
	}
	if shown {
		v.Gained, v.Right, v.Missed = s.gained, s.right, !s.answered
		if !mine {
			v.Given = s.given
		}
	}
	return v
}
