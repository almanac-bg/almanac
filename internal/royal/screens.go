package royal

import (
	"context"
	"encoding/json"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/safe"
)

// What the screens following the evening are sent: a board, the same for everyone following the same thing, made
// once for each change; and each viewer's own part, joined on as they look.

// Board is what everyone following a tournament sees (before the start, the lobby, all its tables as one; before
// that, or with none, the evening). It holds only what a screen shows: in the lobby, how many are in and the first
// few; during a question, how many have answered it; with its answer, and at the end, the standings.
type Board struct {
	// Phase is "soon" (the lobby isn't open, or nobody came), or the tournament's: "lobby", "question", "reveal",
	// "end".
	Phase    string `json:"phase"`
	StartsAt int64  `json:"startsAt"`
	OpensAt  int64  `json:"opensAt"`
	// Next is the next evening's start (StartsAt's, until the evening's begun).
	Next int64 `json:"next"`
	// Nightly says there's one every evening (else on its days: Friday to Sunday).
	Nightly bool `json:"nightly,omitempty"`
	// Wait, in the lobby, is until when it waits for more, the start having come with fewer than Least there.
	Wait   int64 `json:"wait,omitempty"`
	Least  int   `json:"least,omitempty"`
	Length int   `json:"length"`
	Round  int   `json:"round"`
	Size   int   `json:"size"`
	// Tables is how many tournaments there are this evening.
	Tables  int `json:"tables"`
	N       int `json:"n"`
	Entered int `json:"entered"`
	// Left is how many are still in (in the lobby, how many are in it); WentOut, how many went out on the question
	// whose answer shows (a cut).
	Left    int `json:"left"`
	WentOut int `json:"wentOut"`
	// Answered is how many have answered the question showing, of Playing (those cut too).
	Answered int `json:"answered"`
	Playing  int `json:"playing"`
	// Cut is the game's next cut: the one the answer showing comes with, while it shows (none once the final's on).
	Cut *CutView `json:"cut,omitempty"`
	// Last says the game ends once the answer showing has shown: the standings come next.
	Last bool `json:"last,omitempty"`
	// Players are the lobby's first few (few), or, with an answer and at the end, everyone in the tournament in their
	// order; none during a question.
	Players  []PlayerView  `json:"players"`
	Question *QuestionView `json:"question,omitempty"`
}

// Own is what the viewer alone sees, with the board they follow.
type Own struct {
	// Now is the server's clock, for the countdowns.
	Now int64 `json:"now"`
	// In says the viewer is in this tournament (its lobby, or its game), and Out that a cut put them out of its
	// standings (they play on).
	In  bool `json:"in"`
	Out bool `json:"out"`
	// Rights is how many the viewer has answered right in all (after a cut too), as of the last answer shown.
	Rights int `json:"rights,omitempty"`
	// Late says the viewer, not in, may still come in: the games have begun, and the door is open (Late).
	Late bool `json:"late,omitempty"`
	// Off says the viewer was in the lobby of this evening, called off: too few came (Schedule.Least).
	Off bool `json:"off,omitempty"`
	// Me is the viewer as the board would show them (the lobby's few may not, nor a question's board).
	Me *PlayerView `json:"me,omitempty"`
	// LeftMs is how long the question showing has left; NextMs, while its answer shows, how long until the game
	// moves on.
	LeftMs int64 `json:"leftMs"`
	NextMs int64 `json:"nextMs,omitempty"`
	// Given is the viewer's answer to the question now, as shown (once given), and Mine how it went, once the
	// answer shows (if they were in for it).
	Given json.RawMessage `json:"given,omitempty"`
	Mine  *MineView       `json:"mine,omitempty"`
	// RunID is the viewer's run, once it's over: to go over its questions.
	RunID int64 `json:"runId,omitempty"`
	Place int   `json:"place,omitempty"`
	Delta int   `json:"delta,omitempty"`
}

// CutView is a cut of the game: after which question (counted from 1), how many of those who began go on (and all
// level with the last of them on right answers, up to play.RoyalCap), and the line, as the standings are now: the
// score of the last who'd go on (nil: everyone in would). Timed says the time decides at the line, among those level
// on right answers with it (more of them than the cap); else right answers alone do.
type CutView struct {
	After int        `json:"after"`
	Keep  int        `json:"keep"`
	Line  *ScoreView `json:"line,omitempty"`
	Timed bool       `json:"timed,omitempty"`
	// Now says it's the answer showing that the cut comes with: those behind the line are out.
	Now bool `json:"now,omitempty"`
	// Then is, with Now, the cut after it (after which question, counted from 1; 0: none, the final is next).
	Then int `json:"then,omitempty"`
}

// ScoreView is a score: right answers, and the time they took.
type ScoreView struct {
	Rights int   `json:"rights"`
	Ms     int64 `json:"ms"`
}

type PlayerView struct {
	play.Look
	// Key tells players apart in an evening (names may repeat).
	Key  int    `json:"key"`
	Name string `json:"name"`
	Tag  string `json:"tag"`
	In   bool   `json:"in"`
	// Reached is how many they've answered right (as of the last answer shown; to their cut, once out), and Ms the
	// time those took; Rights, how many in all, those after a cut too.
	Reached int   `json:"reached"`
	Ms      int64 `json:"ms"`
	Rights  int   `json:"rights"`
	// Rank is where they stand now (those level share it): the place, once it's ended. Goes says they'd go on at the
	// next cut as they stand (those level with its line too), or have gone on at the cut the answer showing comes with.
	Rank int  `json:"rank"`
	Goes bool `json:"goes,omitempty"`
	// OutAt is the question they went out on (-1: they haven't).
	OutAt int `json:"outAt"`
	// Online says they're on the screen (in the lobby).
	Online bool `json:"online,omitempty"`
	Place  int  `json:"place,omitempty"`
	Delta  int  `json:"delta,omitempty"`
}

type QuestionView struct {
	Category string `json:"category"`
	View     any    `json:"view"`
	LimitMs  int64  `json:"limitMs"`
	// Shown is when the question showed (the server's clock): again after a restart of the server, its time from then,
	// so that a screen draws it again.
	Shown int64 `json:"shown,omitempty"`
	// Reveal is the answer, once it shows.
	Reveal *RevealView `json:"reveal,omitempty"`
}

type RevealView struct {
	Answer any `json:"answer"`
}

// MineView is how the viewer's answer went: Ms is the time it took (as it came), and InRow the right answers in a
// row it makes (two or more), as in any game.
type MineView struct {
	Points int   `json:"points"`
	Speed  int   `json:"speed,omitempty"`
	Right  bool  `json:"right"`
	Exact  bool  `json:"exact,omitempty"`
	Missed bool  `json:"missed,omitempty"`
	Ms     int64 `json:"ms,omitempty"`
	InRow  int   `json:"inRow,omitempty"`
}

// board is a Board as it's sent, made again only after a change (ver).
type board struct {
	ver, made uint64
	data      []byte
}

func (b *board) changed() { b.ver++ }

// watched is the board a viewer follows: their tournament's, or else the evening's first (the biggest); the lobby's
// before the start; the evening's with none before the lobby opens or when nobody came. Called with mu held.
func (h *Hub) watched(viewer int64) (*board, *table, *member) {
	n := h.night
	if n == nil {
		return &h.none, nil, nil
	}
	t, m := h.mine(viewer)
	switch {
	case n.phase == play.RoyalLobby && len(n.tables) > 0:
		return &h.lobby, t, m
	case n.phase == play.RoyalLobby:
		return &h.none, nil, nil
	case m != nil:
		return &t.board, t, m
	case len(n.tables) > 0:
		return &n.tables[0].board, n.tables[0], nil
	}
	return &h.none, nil, nil
}

// Look is what a screen is sent now (one JSON object: its board, with its own part), and how long it may wait before
// it looks again after a change (the clock moving on, or a change of its own, is looked at at once: Sub.Now).
func (h *Hub) Look(s *Sub) ([]byte, time.Duration) { return h.look(s.viewer) }

func (h *Hub) look(viewer int64) ([]byte, time.Duration) {
	var data []byte
	var own Own
	pace := glance
	h.locked(func() {
		now := h.now()
		b, t, m := h.watched(viewer)
		if b.data == nil || b.made != b.ver {
			b.data, _ = json.Marshal(h.render(b, t, now))
			b.made = b.ver
		}
		data = b.data
		own = h.own(viewer, t, m, now)
		if h.night == nil || h.night.phase == play.RoyalLobby || m == nil {
			pace = idle
		}
	})
	mine, _ := json.Marshal(own)
	// {own…} and {board…} as one object: their fields are apart.
	return slices.Concat(mine[:len(mine)-1], []byte{','}, data[1:]), pace
}

// render makes a board as it is now. Called with mu held.
func (h *Hub) render(b *board, t *table, now time.Time) Board {
	v := Board{Phase: "soon", Length: play.RoyalLength, Round: play.RoyalRound, Size: play.RoyalSize, Players: []PlayerView{}}
	n := h.night
	if n == nil {
		return v
	}
	v.StartsAt, v.OpensAt, v.Tables = n.start.UnixMilli(), n.opens(h.sched).UnixMilli(), len(n.tables)
	v.Next, v.Nightly = h.sched.Next(now).UnixMilli(), h.sched.Nightly(now)
	if !n.off.IsZero() {
		// Called off: what's ahead is the next evening.
		next := h.sched.Next(now)
		v.StartsAt, v.OpensAt = next.UnixMilli(), next.Add(-h.sched.Lobby).UnixMilli()
	}
	switch {
	case b == &h.none:
		if n.told && !n.held {
			v.Phase = play.RoyalLobby // open, and nobody in yet
		}
		return v
	case b == &h.lobby:
		v.Phase, v.Least = play.RoyalLobby, h.sched.Least
		if n.short {
			v.Wait = n.start.Add(h.sched.Wait).UnixMilli()
		}
		for _, x := range n.tables {
			v.Left += len(x.members)
			for _, m := range x.members {
				if len(v.Players) < few {
					v.Players = append(v.Players, h.player(m, true))
				}
			}
		}
		return v
	}
	v.Phase, v.N, v.Entered, v.WentOut, v.Cut = n.phase, n.n, t.entered, t.wentOut, t.cut
	v.Last = n.phase == play.RoyalReveal && h.last()
	for _, m := range t.members {
		if m.in {
			v.Left++
		}
	}
	if n.phase == play.RoyalQuestion {
		v.Playing = len(t.members)
		for _, m := range t.members {
			if m.inQ && m.answered {
				v.Answered++
			}
		}
	} else {
		for _, m := range t.order {
			v.Players = append(v.Players, h.player(m, false))
		}
	}
	if d := h.dealt(); d != nil {
		limit, since := play.Limit(d.Question()), n.paced
		q := &QuestionView{Category: d.Question().Base().Category, LimitMs: limit.Milliseconds()}
		if n.phase == play.RoyalQuestion {
			q.Shown = n.at.UnixMilli()
		} else {
			since = limit // everything shows with the answer
			q.Reveal = &RevealView{Answer: d.Reveal(h.game.Crowd(d.Question()))}
		}
		q.View = bank.ViewAt(d, since)
		v.Question = q
	}
	return v
}

// dealt is the question showing (or its answer), if one is.
func (h *Hub) dealt() bank.Dealt {
	n := h.night
	if n.phase != play.RoyalQuestion && n.phase != play.RoyalReveal {
		return nil
	}
	return n.dealt[n.n]
}

// own is the viewer's own part: they're m, at t (nil: not in). Called with mu held.
func (h *Hub) own(viewer int64, t *table, m *member, now time.Time) Own {
	o := Own{Now: now.UnixMilli()}
	n := h.night
	if n == nil {
		return o
	}
	o.Off = n.offFor[viewer]
	if m == nil {
		o.Late = t != nil && n.phase != play.RoyalLobby && n.open()
	} else {
		me := h.player(m, n.phase == play.RoyalLobby)
		o.In, o.Out, o.Rights, o.Me = true, n.phase != play.RoyalLobby && !m.in, m.rights, &me
		o.Place, o.Delta = m.place, m.delta
		if n.phase == play.RoyalEnd {
			o.RunID = m.run
		}
	}
	d := h.dealt()
	if t == nil || d == nil {
		return o
	}
	limit, since := play.Limit(d.Question()), now.Sub(n.at)
	if n.phase == play.RoyalQuestion {
		left := limit - since
		if m != nil && m.inQ { // from when their own screen showed it (Seen)
			left = min(limit, play.LiveDue(n.at, m.saw, d.Question()).Sub(now))
		}
		o.LeftMs = max(0, left.Milliseconds())
	} else {
		o.NextMs = max(1, (h.pause() - since).Milliseconds())
	}
	if m != nil && m.inQ {
		o.Given = m.given
		if n.phase == play.RoyalReveal {
			r := m.res
			o.Mine = &MineView{Points: r.Points, Speed: r.Speed, Right: r.Right, Exact: r.Exact, Missed: !m.answered,
				Ms: m.took, InRow: r.InRow}
		}
	}
	return o
}

// player is m as a board shows them (in the lobby, with whether they're on the screen).
func (h *Hub) player(m *member, lobby bool) PlayerView {
	p := PlayerView{Look: m.Look, Key: m.key, Name: m.Name, Tag: m.Tag, In: m.in, Reached: m.reached, Ms: m.ms,
		Rights: m.rights, Rank: m.rank, Goes: m.goes, OutAt: m.outAt, Place: m.place, Delta: m.delta}
	if lobby {
		p.Online = len(h.screens[m.ID]) > 0
	}
	return p
}

// after keeps what the evening's games earned their players (play.Game.AfterRoyal), one player after another, off
// its clock: each goes over a player's history, and a tournament's end is fifty at once. While it has some left, the
// evening counts as on (Near). What a restart of the server cuts short is kept as each player plays again.
type after struct {
	mu      sync.Mutex
	due     []afterOf
	running bool
	done    sync.WaitGroup
}

type afterOf struct {
	user  int64
	ended bool
}

// later has what the games of users earned kept (ended: their runs ended; else, their places).
func (h *Hub) later(users []int64, ended bool) {
	if len(users) == 0 {
		return
	}
	a := &h.after
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, u := range users {
		a.due = append(a.due, afterOf{u, ended})
	}
	if !a.running {
		a.running = true
		a.done.Add(1)
		go h.earn() // each player's in it stopped if it panics (safe.Do)
	}
}

func (h *Hub) earn() {
	a := &h.after
	defer a.done.Done()
	for {
		a.mu.Lock()
		if len(a.due) == 0 {
			a.running = false
			a.mu.Unlock()
			return
		}
		x := a.due[0]
		a.due = a.due[1:]
		a.mu.Unlock()
		// One player's that panics is lost alone (package safe stops it): the rest are kept, and the queue goes on.
		safe.Do("royal: what a game earned", func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			if err := h.game.AfterRoyal(ctx, x.user, x.ended); err != nil {
				slog.Error("royal", "after", x.user, "err", err)
			}
		})
	}
}

// Earned waits until what the players' games earned is kept (AfterRoyal, in the background): for a caller that reads it
// next, as the seeding of a database does.
func (h *Hub) Earned() { h.after.done.Wait() }

func (a *after) busy() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.running
}
