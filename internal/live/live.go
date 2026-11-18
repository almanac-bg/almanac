// Package live plays duels live: a player asks for a duel and is matched with whoever else is asking, or, if
// nobody comes in Wait, with a recording of a real player's earlier game (shown unnamed, as the animal its player
// started as: play.RecordedAs). Both see the same question at the same
// moment and each other's answers come in; after each question both answers show, then the next comes. One whose
// screen goes is waited for a while (Away), then the duel goes on without them (gone), their time running out on each
// question; one who says they leave (Leave: asked on their screen, and confirmed) is gone at once, and the other told
// so. A recording isn't waited for where its player let the time run out. A player who isn't there when the
// first question is due (never came, or left as the duel was found) is waited for until Arrive; after it, the duel is
// called off and leaves nothing (play.DropLive), so leaving the wait at its last second never costs a lost duel. An
// answer sent again (its reply lost on the way) is taken as the first. One who left for good is named on the result
// (play.LeftLive: after which question). Either way, one who comes back to the duel is in it again.
//
// One who stays while the other is gone (left, or away past Away) and leads on points may take the win at once
// (Claim): the questions left are played out in a moment, unanswered by both, and the duel ends as it would have, the
// leaver's misses and all; or they play on, for the XP of the rest.
//
// Once a duel between two people is over, either may ask for a rematch (Rematch): the other sees it, with how long
// they have (SideView.RematchMs), and if they ask too within RematchFor, a new duel between the two is made at once.
//
// The hub pairs two whose ratings are close (Bands): within a narrow band at first, wider as the one who came first
// waits on, and anyone at all for the last seconds of Wait, before a recording. Live means live: a person close enough
// beats a recording, and a stranger beats a long wait. Whether a duel moves ratings is the game's to say as it ends
// (play.settleDuel): two who play from one network (Player.Net, kept with each one's game: play.FromNet) play a
// friendly, and a new player moves an established one's rating half as far.
//
// Every answer goes through the player's own run (internal/play), as in any game: the score, XP, the questions'
// statistics and the duel's result are kept there, and only the timing lives here, in memory. The run moves on the
// duel's clock alone: the duel starts each question's time on it at the moment it shows it to both (play.ShowLive) and
// hands it each answer with the moment it came (play.AnswerLive); the player can't show, start or answer it
// themselves, so nobody reads a question before the duel shows it. The duel deals its questions as it begins (a
// recording's as its player was shown them: play.Game.Deal), and each answer is graded through the deal shown,
// whatever the bank has become meanwhile. The duel's lock is never held across those writes (unlocked): a step of
// the clock decides under it, writes without it, and goes on under it again only if the duel hasn't been called off
// meanwhile; an answer being kept (side.sending) holds the question's answer back until it's in, so that an answer
// that came in time is never lost to the clock. So a slow write (the database busy with something else) slows the
// duel's own steps, never its screens, the other player's answer or the server's drain. A restart cuts the duels
// under way off; they end
// without a result (play.EndLive). So before one, the server pauses the hub (Pause): no new duel starts, not even with
// a recording; those asking go on waiting, told why (Seek.Held), and find their duel once the server is back, while
// the duels under way (UnderWay) play to their end, which each can tell (Longest at most); a rematch waiting for
// its yes is called off, told so (ErrPaused), as its duel would be lost. Resume undoes it.
//
// A duel's clock that panics (package safe stops it, and the process goes on) calls its duel off without a result, as
// a restart would (Match.broken); a wait for a duel whose clock panics ends, told so.
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
	"github.com/almanac-bg/almanac/internal/safe"
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
	// longestPause is the longest an answer shows before the next question (pauseFor).
	longestPause = 6 * time.Second
	// slack is what a duel's end may come after its clock says, for the database's writes on the way.
	slack = 10 * time.Second
	// writeFor is the longest a duel waits for one of its writes: past it, the write counts as failed (an answer
	// not kept is a question let go; a question not shown calls the duel off), and the duel goes on.
	writeFor = 10 * time.Second
	// Longest is the most a duel may take, from the moment it's made to its end: its players waited for, then each
	// question at its longest, its time run out, and its answer shown.
	Longest = Arrive + play.Length*(play.LongestLimit+play.Grace+longestPause) + slack
)

// Band is how far apart two ratings may be for a duel between them (Within; -1: any), once the one who has waited
// longer has waited After.
type Band struct {
	After  time.Duration
	Within int
}

// Bands are the hub's, widest last: a player first meets someone about as strong, and anyone before a recording.
var Bands = []Band{{0, 100}, {3 * time.Second, 250}, {6 * time.Second, -1}}

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
	// errBroken is a duel (or the wait for one) whose clock panicked: stopped, reported (package safe), and over.
	errBroken = errors.New("the duel broke off")
)

// Player is someone in a duel, as the other sees them.
type Player struct {
	ID       int64
	Name     string
	Tag      string
	Look     play.Look
	Rating   int
	Division play.Division
	// Net is the network the player asks from (a keyed hash: play.FromNet), kept with their game of the duel: two
	// from one network play a friendly (play/fair.go). None for a recording's player.
	Net []byte
	// Device is what the player plays on (play.FromDevice), kept with their game for /admin.
	Device string
}

// from is ctx with the network and the device the player plays from, for their game of a duel.
func (p Player) from(ctx context.Context) context.Context {
	return play.FromDevice(play.FromNet(ctx, p.ID, p.Net), p.ID, p.Device)
}

// Hub matches players and holds the duels under way.
type Hub struct {
	game *play.Game
	// who is a player as a duel shows them (the recorded one's too).
	who   func(context.Context, int64) (Player, error)
	wait  time.Duration
	bands []Band

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
		game: g, who: who, wait: Wait, bands: Bands,
		starting: map[int64]*Seek{}, matches: map[int64]*Match{}, playing: map[int64]*Match{}, rematches: map[int64]*Seek{},
	}
}

// Seek is a player asking for a duel: Done closes once it's settled, with a Match or an Err (play.ErrNobody: nobody
// came and there's no recording to play).
type Seek struct {
	hub    *Hub
	player Player
	refs   int // the screens asking (a second tab, a line that dropped and came back)
	since  time.Time
	until  time.Time
	timer  *time.Timer
	widen  *time.Timer   // the band widening as they wait (Bands)
	held   bool          // waiting while the hub is paused
	told   chan struct{} // held changed
	// rematch is the duel a rematch is asked for after (0: a duel with whoever comes).
	rematch int64
	done    chan struct{}
	settled sync.Once
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

// settle says how the seek came out, once: a second time (a clock that broke after the first) changes nothing.
func (s *Seek) settle(m *Match, err error) {
	s.settled.Do(func() {
		s.Match, s.Err = m, err
		close(s.done)
	})
}

// broken settles a seek whose clock panicked, if nothing else has.
func (s *Seek) broken() { s.settle(nil, errBroken) }

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
	s.since = time.Now()
	s.until = s.since.Add(h.wait)
	if !h.paused {
		for i, other := range h.waiting {
			if h.fits(other, s, s.since) {
				h.waiting = slices.Delete(h.waiting, i, i+1)
				start := h.pair(other, s)
				h.mu.Unlock()
				start()
				return s
			}
		}
	}
	s.timer = safe.AfterFunc(h.wait, "live: a wait for a duel", func() { h.expire(s) }, s.broken)
	s.held = h.paused
	h.waiting = append(h.waiting, s)
	h.widening(s)
	h.mu.Unlock()
	return s
}

// band is how far apart two ratings may be after a wait of waited (-1: any).
func (h *Hub) band(waited time.Duration) int {
	within := -1
	for _, b := range h.bands {
		if waited >= b.After {
			within = b.Within
		}
	}
	return within
}

// fits says two who wait may play each other now: their ratings within the band of the longer wait of the two.
func (h *Hub) fits(a, b *Seek, now time.Time) bool {
	first := a.since
	if b.since.Before(first) {
		first = b.since
	}
	within := h.band(now.Sub(first))
	d := a.player.Rating - b.player.Rating
	return within < 0 || (d <= within && -d <= within)
}

// widening sets when a waiting seek's band next widens: then it may meet one it didn't fit before. Called with the
// hub's lock held.
func (h *Hub) widening(s *Seek) {
	waited := time.Since(s.since)
	for _, b := range h.bands {
		if b.After > waited {
			s.widen = safe.AfterFunc(b.After-waited, "live: a wait's band widening", func() { h.widened(s) }, s.broken)
			return
		}
	}
}

// widened is a waiting seek's band wider: it meets the first one waiting that it fits now, if any, and waits on (to
// its next widening) if none.
func (h *Hub) widened(s *Seek) {
	h.mu.Lock()
	if !slices.Contains(h.waiting, s) || h.paused { // matched, or gone, meanwhile; or held until the hub resumes
		h.mu.Unlock()
		return
	}
	start := h.meet(s)
	if start == nil {
		h.widening(s)
	}
	h.mu.Unlock()
	if start != nil {
		start()
	}
}

// meet takes a waiting seek, and the first other one waiting that it fits, out of the queue, and makes their duel
// (what it returns starts it, once the lock is let go); nil if it fits nobody. Called with the hub's lock held.
func (h *Hub) meet(s *Seek) func() {
	now := time.Now()
	for _, other := range h.waiting {
		if other != s && h.fits(other, s, now) {
			h.waiting = slices.DeleteFunc(h.waiting, func(w *Seek) bool { return w == s || w == other })
			return h.pair(other, s)
		}
	}
	return nil
}

// pair makes a duel of two seeks taken out of the queue; what it returns starts it, to run once the hub's lock is let
// go. Called with the lock held.
func (h *Hub) pair(a, b *Seek) func() {
	for _, s := range []*Seek{a, b} {
		if s.timer != nil {
			s.timer.Stop()
		}
		if s.widen != nil {
			s.widen.Stop()
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
		defer safe.Recover("live: making a duel", a.broken, b.broken)
		m, err := h.launch([]int64{a.player.ID, b.player.ID}, func(ctx context.Context) (play.Live, [2]Player, error) {
			ctx = b.player.from(a.player.from(ctx))
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
		s.timer = safe.AfterFunc(RematchFor, "live: a wait for a rematch", func() { h.rematchOver(s) }, s.broken)
		h.rematches[id] = s
		h.mu.Unlock()
		m.want(p.ID, s.until)
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
		m.want(s.player.ID, time.Time{})
	}
}

// want marks a player of the duel as asking for a rematch until then, or (zero) no longer.
func (m *Match) want(id int64, until time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s := m.side(id); s != nil && !s.rematch.Equal(until) {
		s.rematch = until
		m.changed()
	}
}

// Resume undoes Pause: those waiting meet each other two by two, as their bands let them (most have waited long enough
// for anyone), and one left alone waits out the rest of their Wait (if any is left) before a recording.
func (h *Hub) Resume() {
	h.mu.Lock()
	if !h.paused {
		h.mu.Unlock()
		return
	}
	h.paused = false
	var starts []func()
	for i := 0; i < len(h.waiting); {
		if start := h.meet(h.waiting[i]); start != nil {
			starts = append(starts, start)
			continue // two fewer in the queue: the one at i now is the next to look at
		}
		i++
	}
	for _, s := range h.waiting {
		s.hold(false)
		s.timer.Reset(s.Left())
		if s.widen != nil {
			s.widen.Stop()
		}
		h.widening(s)
	}
	h.mu.Unlock()
	for _, start := range starts {
		go start() // stopped there if it panics (pair)
	}
}

// UnderWay is how many duels a restart would cut now (those being played, and those being made), and how long they
// may still take, at most: the longest of them, by its own clock (Match.left). Nothing more starts while the hub is
// paused, so a restart that waits that long cuts no duel. A deploy asks it every few seconds (server's drain), so it
// never waits on a duel: one busy at the moment (its lock held, as while it keeps an answer) counts as under way, for
// all of a duel (Longest), and is seen as it is next time.
func (h *Hub) UnderWay() (n int, left time.Duration) {
	h.mu.Lock()
	n = len(h.starting)
	if n > 0 { // being made: all of a duel to come
		left = Longest
	}
	all := make([]*Match, 0, len(h.matches))
	for _, m := range h.matches {
		all = append(all, m)
	}
	h.mu.Unlock()
	for _, m := range all {
		if !m.mu.TryLock() {
			n++
			left = Longest
			continue
		}
		if !m.over() {
			n++
			left = max(left, m.left())
		}
		m.mu.Unlock()
	}
	return n, left
}

// Playing says whether a player is in a duel under way: one whose screen went may come back to it (Seek finds it).
func (h *Hub) Playing(id int64) bool {
	h.mu.Lock()
	m := h.playing[id]
	h.mu.Unlock()
	if m == nil {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return !m.over()
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
		safe.Go("live: a rematch no longer asked for", func() { h.unwant(s) }) // the match's lock comes before the hub's
		return
	}
	for i, w := range h.waiting {
		if w == s {
			h.waiting = append(h.waiting[:i], h.waiting[i+1:]...)
			s.timer.Stop()
			if s.widen != nil {
				s.widen.Stop()
			}
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
	if s.widen != nil {
		s.widen.Stop()
	}
	if len(h.matches) >= maxMatches {
		h.mu.Unlock()
		s.settle(nil, ErrTooMany)
		return
	}
	h.starting[s.player.ID] = s
	h.mu.Unlock()
	s.settle(h.launch([]int64{s.player.ID}, func(ctx context.Context) (play.Live, [2]Player, error) {
		l, err := h.game.StartRecorded(s.player.from(ctx), s.player.ID)
		if err != nil {
			return l, [2]Player{}, err
		}
		rec, err := h.who(ctx, l.Users[1])
		// A stranger's game: shown as the animal its player started as, nothing that leads to them (play.RecordedAs).
		rec.Name, rec.Look = play.RecordedAs(l.Users[1], rec.Look.Level)
		rec.Tag = ""
		return l, [2]Player{s.player, rec}, err
	}))
}

// launch makes a duel (in the database, by start) and starts it; the players it's made for stop starting either way.
func (h *Hub) launch(players []int64, start func(context.Context) (play.Live, [2]Player, error)) (*Match, error) {
	ctx := context.Background()
	made := false
	defer func() {
		if !made { // a panic on the way (stopped by the caller): the players aren't left being matched for ever
			h.mu.Lock()
			for _, id := range players {
				delete(h.starting, id)
			}
			h.mu.Unlock()
		}
	}()
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
	made = true
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
	revealDue  bool          // the answer is due to show, held until the answers being kept are in (side.sending)
	timer      *time.Timer
	recTimer   *time.Timer // the recording's answer to the question now
	paceTimer  *time.Timer // the next clue of the question now (bank.Paced)
	subs       map[*Sub]struct{}

	// rushed is a duel won by Claim, its questions left played out at once.
	rushed bool
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
	left      bool // said they leave (Leave): gone at once, until they come back
	points    int
	rights    int
	marks     []play.Mark
	// sending is their answer to the question now being kept (closed once it's in), nil while none is.
	sending chan struct{}
	// The question now: whether they've answered, how long it took, what they gave (as shown) and how it went.
	answered bool
	took     time.Duration
	given    json.RawMessage
	gained   int
	speed    int
	inRow    int // right answers in a row, this one counted
	right    bool
	exact    bool

	// rematch is until when they ask for a rematch, once the duel is over (Hub.Rematch); zero while they don't.
	rematch time.Time
	// forfeit is gone for good as the other took the win (Claim): named on the result as one who left, back or not.
	forfeit bool
}

func (s *side) human() bool { return s.recording == nil }

// gone says a player has left the duel, or been away from it longer than Away: it goes on without them.
func (s *side) gone() bool {
	return s.human() && (s.left || s.online == 0 && s.came && time.Since(s.leftAt) >= Away)
}

// answers says whether a recording has an answer to question n (else its player let the time run out there).
func (s *side) answers(n int) bool {
	return n < len(s.recording) && s.recording[n].Shown != nil
}

func newMatch(h *Hub, l play.Live, players [2]Player) (*Match, error) {
	m := &Match{hub: h, id: l.DuelID, phase: PhaseIntro, opened: time.Now(), subs: map[*Sub]struct{}{}}
	for _, p := range l.Picks {
		d, ok := h.game.Deal(p) // a recording's: the version its player answered
		if !ok {
			return nil, play.ErrNoQuestion
		}
		m.dealt = append(m.dealt, d)
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
	s.left = false
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
	if s.online == 0 && !s.left { // one who said they leave left then
		s.leftAt = time.Now()
		s.leftAfter = m.n
		if m.phase == PhaseReveal {
			s.leftAfter++ // its answer seen: that question was played
		}
		// Once they've been away too long, the question up then (whichever it is) goes on if it waits only for them,
		// and the other is told they're gone.
		safe.AfterFunc(Away+time.Millisecond, "live: a player away", func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			switch {
			case m.over():
			case m.phase == PhaseQuestion:
				m.maybeReveal()
			default:
				m.changed()
			}
		}, m.broken)
	}
	m.changed()
}

// Leave is a player leaving the duel under way of their own will (asked on their screen, and confirmed): it goes on
// without them at once, not after Away. The other is told they're gone, the question up waits only for the other,
// and the leaver's time runs out on it and on the rest, as for one away too long. Before the first question and once
// it's over, there's nothing to leave: the duel calls itself off or has ended.
func (m *Match) Leave(id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.side(id)
	if s == nil {
		return ErrNoMatch
	}
	if s.left || (m.phase != PhaseQuestion && m.phase != PhaseReveal) {
		return nil
	}
	s.left = true
	if s.online > 0 { // still on its screen as they say so: they leave now (else when it went)
		s.leftAt, s.leftAfter = time.Now(), m.n
		if m.phase == PhaseReveal {
			s.leftAfter++ // its answer seen: that question was played
		}
	}
	if m.phase == PhaseQuestion {
		m.maybeReveal()
	} else {
		m.changed()
	}
	return nil
}

// Claim is a player taking the win from the other, gone for good (left, or away past Away), while they lead on points:
// the duel doesn't wait out the questions left. They're played out at once, unanswered by both (no time on them, no
// screen shown them), and the duel ends as it would have, the leaver's misses and all, named on the result as one
// who left. The player gives up the XP of the questions left; playing on is theirs to choose. ErrNotNow unless the
// other is gone, the player is here and leads, and a question is up or its answer shows.
func (m *Match) Claim(id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	me := m.side(id)
	if me == nil {
		return ErrNoMatch
	}
	other := m.sides[0]
	if other == me {
		other = m.sides[1]
	}
	if m.rushed || (m.phase != PhaseQuestion && m.phase != PhaseReveal) || !other.gone() || me.left ||
		me.points <= other.points {
		return ErrNotNow
	}
	m.rushed, other.forfeit = true, true
	if m.phase == PhaseQuestion {
		m.reveal()
	} else {
		m.next(0)
	}
	return nil
}

// changed tells every screen to look again. Called with the lock held. Not while a duel won by Claim is played out:
// its screens see its end.
func (m *Match) changed() {
	if m.rushed && !m.over() {
		return
	}
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
	m.paceTimer = safe.AfterFunc(next, "live: a question's clues", func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.n == n && m.phase == PhaseQuestion {
			m.changed()
			m.pace(n)
		}
	}, m.broken)
}

// after runs fn after d, if the duel is then still on the same question and phase.
func (m *Match) after(d time.Duration, fn func()) {
	if m.timer != nil {
		m.timer.Stop()
	}
	n, phase := m.n, m.phase
	m.timer = safe.AfterFunc(d, "live: a duel's clock", func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.n == n && m.phase == phase {
			fn()
		}
	}, m.broken)
}

// broken ends a duel whose clock panicked (package safe stopped it, the lock let go): what it holds can't be trusted,
// so it isn't played on. It's called off without a result, as one cut off by a restart, and its players are free.
func (m *Match) broken() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.over() {
		m.cancel()
	}
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
	m.hub.release(m)
	m.changed()
	m.unlocked(func() {
		ctx, cancel := context.WithTimeout(context.Background(), writeFor)
		defer cancel()
		if err := end(ctx, m.id); err != nil {
			slog.Error("live duel", "duel", m.id, "err", err)
		}
	})
}

// unlocked runs fn, the duel's writes to the database, with its lock let go, so that nothing waits on them but the
// step that makes them. Called with the lock held, which is held again when it returns: what the duel is then (called
// off meanwhile, say) is the caller's to look at again.
func (m *Match) unlocked(fn func()) {
	m.mu.Unlock()
	defer m.mu.Lock()
	fn()
}

// left is how long the duel may still take, at most, by its own clock: the rest of the wait for its players, of the
// question up or its answer, and every question after at its longest, with the slack for the database. Called with the
// lock held.
func (m *Match) left() time.Duration {
	if m.over() {
		return 0
	}
	var left time.Duration
	after := m.n // the questions to come in full, from this one
	switch m.phase {
	case PhaseIntro:
		left = Arrive - time.Since(m.opened)
	case PhaseQuestion:
		q := m.dealt[m.n].Question()
		left = play.Limit(q) + play.Grace - time.Since(m.shownAt) + pauseFor(q)
		after++
	case PhaseReveal:
		left = m.pause - time.Since(m.revealedAt)
		after++
	}
	left = max(0, left)
	for _, d := range m.dealt[after:] {
		left += play.Limit(d.Question()) + play.Grace + pauseFor(d.Question())
	}
	return left + slack
}

// show puts question n up for both, and starts its time, on each player's run too (which keeps the score) at the same
// moment as here: one clock for the duel.
//
// The runs are written first, the lock let go (unlocked): until they are, the screens show what they showed (the
// answer before, or the two face to face), and nobody can answer a question their run doesn't show yet.
func (m *Match) show(n int) {
	at, dealt := time.Now(), m.dealt[n]
	var humans []*side
	for _, s := range m.sides {
		if s.human() {
			humans = append(humans, s)
		}
	}
	var err error
	m.unlocked(func() {
		ctx, cancel := context.WithTimeout(context.Background(), writeFor)
		defer cancel()
		for _, s := range humans {
			if err = m.hub.game.ShowLive(ctx, s.ID, s.run, n, at, dealt); err != nil {
				return
			}
		}
	})
	if m.over() { // called off meanwhile
		return
	}
	if err != nil {
		slog.Error("live duel", "duel", m.id, "err", err)
		m.cancel()
		return
	}
	m.phase, m.n, m.shownAt = PhaseQuestion, n, at
	for _, s := range m.sides {
		s.answered, s.took, s.given, s.gained, s.speed, s.inRow, s.right, s.exact = false, 0, nil, 0, 0, 0, false, false
	}
	if m.rushed { // won by Claim: nobody answers the rest
		m.reveal()
		return
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
		m.recTimer = safe.AfterFunc(at, "live: a recording's answer", func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.phase != PhaseQuestion || m.n != n || s.answered {
				return
			}
			s.answered, s.took, s.given, s.gained, s.right = true, at, r.Shown, r.Points, r.Right
			m.maybeReveal()
		}, m.broken)
	}
	m.changed()
}

// Answer takes a player's answer to question n. Once both have answered, both answers show. An answer sent again (its
// reply lost on the way) is the one taken already: no error, while its question or its answer shows; sent again
// while the first is being kept, it waits for that.
//
// The answer is kept in the player's run with the lock let go (unlocked); meanwhile the question's answer doesn't
// show (side.sending holds it back: revealDue), so that its time running out can't take an answer that came in time.
func (m *Match) Answer(by int64, n int, raw json.RawMessage) error {
	at := time.Now() // its time is to when it came, not to when the duel takes it
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.side(by)
	if s == nil {
		return ErrNoMatch
	}
	for s.sending != nil { // sent again while the first is being kept: as the first goes
		sending := s.sending
		m.unlocked(func() { <-sending })
	}
	if n == m.n && s.answered && (m.phase == PhaseQuestion || m.phase == PhaseReveal) {
		return nil
	}
	if m.phase != PhaseQuestion || n != m.n || s.answered || s.left {
		return ErrNotNow
	}
	took := max(0, at.Sub(m.shownAt))
	dealt := m.dealt[n]
	g, err := bank.GradeAt(dealt, raw, took)
	if err != nil {
		return ErrAnswer
	}
	var res play.Result
	s.sending = make(chan struct{})
	m.unlocked(func() {
		ctx, cancel := context.WithTimeout(context.Background(), writeFor)
		defer cancel()
		res, err = m.hub.game.AnswerLive(ctx, s.ID, s.run, n, raw, at, dealt)
	})
	close(s.sending)
	s.sending = nil
	// Whatever came of it, the answer held back for it shows now (if it's still this question's).
	defer func() {
		if m.revealDue && !m.over() && m.phase == PhaseQuestion && m.n == n {
			m.reveal()
		}
	}()
	switch {
	case m.over():
		return ErrNotNow
	case errors.Is(err, play.ErrOutOfStep):
		return ErrNotNow
	case errors.Is(err, play.ErrBadAnswer):
		return ErrAnswer
	case err != nil:
		slog.Error("live duel: an answer not kept", "duel", m.id, "err", err)
		return err
	}
	s.answered, s.took, s.given = true, took, g.Shown
	s.gained, s.speed, s.inRow, s.right, s.exact = res.Points, res.Speed, res.InRow, res.Right, res.Exact
	if res.TimedOut {
		s.given = nil
	}
	if !m.revealDue {
		m.maybeReveal()
	}
	return nil
}

// maybeReveal shows the answers if nobody is still waited for: a player here (or away only a moment, and not left)
// who hasn't answered, or a recording whose answer is still to come (not one whose player let the time run out there).
func (m *Match) maybeReveal() {
	for _, s := range m.sides {
		if s.answered || (!s.human() && !s.answers(m.n)) {
			continue
		}
		if !s.human() || (!s.left && (s.online > 0 || time.Since(s.leftAt) < Away)) {
			m.changed()
			return
		}
	}
	m.reveal()
}

// reveal shows the answer: a player who didn't answer gets nothing for it (their run is told so, the lock let go).
// While an answer is being kept, it waits for it (revealDue: Answer shows it once that's in).
func (m *Match) reveal() {
	for _, s := range m.sides {
		if s.sending != nil {
			m.revealDue = true
			return
		}
	}
	m.revealDue = false
	m.phase, m.revealedAt = PhaseReveal, time.Now()
	if m.recTimer != nil {
		m.recTimer.Stop()
	}
	n, dealt := m.n, m.dealt[m.n]
	var absent []*side
	for _, s := range m.sides {
		if !s.answered && s.human() {
			absent = append(absent, s)
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
	m.pause = pauseFor(dealt.Question())
	m.changed()
	if len(absent) > 0 {
		m.unlocked(func() {
			ctx, cancel := context.WithTimeout(context.Background(), writeFor)
			defer cancel()
			for _, s := range absent {
				if _, err := m.hub.game.AnswerLive(ctx, s.ID, s.run, n, nil, time.Now(), dealt); err != nil &&
					!errors.Is(err, play.ErrOutOfStep) {
					slog.Error("live duel", "duel", m.id, "err", err)
				}
			}
		})
		if m.over() { // called off meanwhile
			return
		}
	}
	// The next step once the pause is over, counted from when the answer showed: the runs are written by then, so
	// the next question finds each at its place.
	pause := max(0, m.pause-time.Since(m.revealedAt))
	if m.rushed {
		pause = 0
	}
	m.next(pause)
}

// next moves the duel on after d, from the answer showing: to the next question, or to its end after the last.
func (m *Match) next(d time.Duration) {
	n := m.n
	if n+1 < len(m.dealt) {
		m.after(d, func() { m.show(n + 1) })
	} else {
		m.after(d, m.end)
	}
}

// pauseFor is how long an answer shows: longer where there's more to look at.
func pauseFor(q bank.Question) time.Duration {
	switch q.Base().Type {
	case "choice", "truefalse":
		return 4 * time.Second
	}
	return longestPause
}

// end is the last answer shown: the duel's result is kept already (the runs settled it as their last answers came).
// A side with every answer right gets the bonus for it, as its run did.
func (m *Match) end() {
	m.stop()
	type left struct {
		id    int64
		after int
	}
	var gone []left
	for _, s := range m.sides {
		if s.rights == len(m.dealt) {
			s.points += play.AllRight
		}
		// One who left for good is named on the result: when they left, and that it went on without them.
		if s.gone() || s.forfeit {
			gone = append(gone, left{s.ID, s.leftAfter})
		}
	}
	if len(gone) > 0 {
		m.unlocked(func() {
			ctx, cancel := context.WithTimeout(context.Background(), writeFor)
			defer cancel()
			for _, l := range gone {
				if err := m.hub.game.LeftLive(ctx, m.id, l.id, l.after); err != nil {
					slog.Error("live duel", "duel", m.id, "err", err)
				}
			}
		})
		if m.over() { // called off meanwhile
			return
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
	// Rematch says they ask for a rematch (the duel is over), and RematchMs how long the other still has to ask too.
	Rematch   bool  `json:"rematch,omitempty"`
	RematchMs int64 `json:"rematchMs,omitempty"`
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
	// InRow is how many right answers in a row the answer makes, from 2: the climb's feel, worth no points.
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
			q.Reveal = &RevealView{Answer: d.Reveal(m.hub.game.Crowd(d.Question())), Points: me.gained, Speed: me.speed, InRow: me.inRow,
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
		Online: !s.human() || s.online > 0, Answered: s.answered, Gone: s.gone(),
	}
	if left := time.Until(s.rematch); left > 0 {
		v.Rematch, v.RematchMs = true, left.Milliseconds()
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
