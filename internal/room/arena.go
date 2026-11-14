package room

import (
	"slices"
	"time"
)

// Арена is a room the hub fills by itself: players who want a game wait in one queue, and as soon as there are
// ArenaMax of them (or ArenaMin who've waited ArenaWait), they're put in a room together. It starts on its own after
// a short countdown, moves on by itself, and has no host and no second game. The most points win; the places go to
// the hub's OnArena, which may move ratings and tell the room what they did (Room.Settled).

const (
	ArenaMin = 3
	ArenaMax = 5
	// ArenaWait is how long a queue of ArenaMin or more waits for more players before they play as many as they are.
	ArenaWait = 15 * time.Second
	// ArenaCountdown is how long an arena shows who's in it before its first question.
	ArenaCountdown = 5 * time.Second
)

// Ticket is a player waiting in the arena's queue: C says the queue changed (read Queue then), Done that the wait is
// over, with a room (Code) or without (another screen of theirs took their place, or they left).
type Ticket struct {
	player Player
	C      chan struct{}
	Done   chan struct{}
	code   string
}

// Code is the room the ticket was put in ("" while it waits, or if it was replaced).
func (t *Ticket) Code() string { return t.code }

// QueueView is the queue as a waiting player sees it.
type QueueView struct {
	Waiting int `json:"waiting"`
	Min     int `json:"min"`
	Max     int `json:"max"`
	// StartsMs is how long until those waiting play, if no more come (0: not enough of them yet).
	StartsMs int64 `json:"startsMs,omitempty"`
}

// Placed is how a player ended an arena.
type Placed struct {
	ID     int64
	Place  int
	Points int
	Rights int
}

// Enqueue puts a player in the arena's queue. A player still in an arena that hasn't ended gets a ticket to it at
// once; one already waiting (another tab) takes over the place in the queue.
func (h *Hub) Enqueue(p Player) (*Ticket, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	t := &Ticket{player: p, C: make(chan struct{}, 1), Done: make(chan struct{})}
	for _, r := range h.rooms {
		r.mu.Lock()
		in := r.arena && !r.closed && r.phase != End && r.member(p.ID) != nil
		r.mu.Unlock()
		if in {
			t.code = r.code
			close(t.Done)
			return t, nil
		}
	}
	if i := slices.IndexFunc(h.queue, func(q *Ticket) bool { return q.player.ID == p.ID }); i >= 0 {
		close(h.queue[i].Done)
		h.queue[i] = t // the same place in the queue
	} else {
		h.queue = append(h.queue, t)
	}
	if len(h.queue) == ArenaMin {
		h.enough = time.Now()
	}
	h.match()
	return t, nil
}

// Leave takes a ticket out of the queue (its screen is gone). Once matched, it's no use: the room plays on.
func (h *Hub) Leave(t *Ticket) {
	h.mu.Lock()
	defer h.mu.Unlock()
	i := slices.Index(h.queue, t)
	if i < 0 {
		return
	}
	h.queue = slices.Delete(h.queue, i, i+1)
	close(t.Done)
	h.match()
}

// Queue is the queue now.
func (h *Hub) Queue() QueueView {
	h.mu.Lock()
	defer h.mu.Unlock()
	v := QueueView{Waiting: len(h.queue), Min: ArenaMin, Max: ArenaMax}
	if len(h.queue) >= ArenaMin {
		v.StartsMs = max(1, (ArenaWait - time.Since(h.enough)).Milliseconds())
	}
	return v
}

// match puts those waiting in arenas while there are enough of them, and tells the rest how the queue stands.
// Called with the hub's lock held.
func (h *Hub) match() {
	if h.matching != nil {
		h.matching.Stop()
		h.matching = nil
	}
	for len(h.queue) >= ArenaMax || (len(h.queue) >= ArenaMin && time.Since(h.enough) >= ArenaWait) {
		n := min(len(h.queue), ArenaMax)
		if err := h.openArena(h.queue[:n]); err != nil {
			break // too many rooms: they wait until one closes, or a minute (Sweep)
		}
		h.queue = slices.Delete(h.queue, 0, n)
		h.enough = time.Now() // those left over (if enough) have their own ArenaWait from now
	}
	if len(h.queue) >= ArenaMin {
		h.matching = time.AfterFunc(ArenaWait-time.Since(h.enough), func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.match()
		})
	}
	for _, t := range h.queue {
		select {
		case t.C <- struct{}{}:
		default:
		}
	}
}

// openArena makes a room for the tickets and sends each to it. Called with the hub's lock held.
func (h *Hub) openArena(tickets []*Ticket) error {
	r, err := h.newRoom("")
	if err != nil {
		return err
	}
	r.arena = true
	r.host = 0
	for _, t := range tickets {
		r.players = append(r.players, &member{Player: t.player})
	}
	// Nobody has r yet but the hub, so its lock isn't needed until the countdown ends (after takes it then).
	r.shownAt = time.Now()
	r.after(ArenaCountdown, func() {
		if err := r.start(); err != nil {
			r.close() // no questions to play: the screens hear the room is gone
		}
	})
	for _, t := range tickets {
		t.code = r.code
		close(t.Done)
	}
	return nil
}

// Settled is what an arena's places did to each player's rating, to show at its end.
func (r *Room) Settled(deltas map[int64]int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deltas = deltas
	r.changed()
}

// places are the players' places by points: equal points, equal place. Called with the lock held.
func (r *Room) places() []Placed {
	out := make([]Placed, 0, len(r.players))
	for _, m := range r.players {
		out = append(out, Placed{ID: m.ID, Points: m.points, Rights: m.rights})
	}
	slices.SortStableFunc(out, func(a, b Placed) int { return b.Points - a.Points })
	for i := range out {
		out[i].Place = i + 1
		if i > 0 && out[i].Points == out[i-1].Points {
			out[i].Place = out[i-1].Place
		}
	}
	return out
}
