package royal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

type world struct {
	t    *testing.T
	db   *store.DB
	g    *play.Game
	h    *Hub
	now  time.Time
	next int
}

func setup(t *testing.T) *world {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	w := &world{t: t, db: db, now: time.Date(2026, 11, 14, 20, 0, 0, 0, play.Bulgaria)}
	w.g = play.New(db, func() *bank.Bank { return b })
	w.g.Now = func() time.Time { return w.now }
	w.h = NewHub(w.g, Evening)
	return w
}

func (w *world) at(hour, min, sec int) {
	d := w.now.In(play.Bulgaria)
	w.now = time.Date(d.Year(), d.Month(), d.Day(), hour, min, sec, 0, play.Bulgaria)
	w.h.Step(w.t.Context())
}

func (w *world) wait(d time.Duration) {
	w.now = w.now.Add(d)
	w.h.Step(w.t.Context())
}

func (w *world) player() Player {
	w.t.Helper()
	w.next++
	name := fmt.Sprintf("Играч %d", w.next)
	res, err := w.db.Write.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES (?, ?, 0, 0)`,
		name, fmt.Sprintf("player%d", w.next))
	if err != nil {
		w.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return Player{ID: id, Name: name}
}

// answer is the right (or a wrong) answer to the question showing to a player.
func (w *world) answer(p Player, right bool) json.RawMessage {
	w.t.Helper()
	v := w.h.View(p.ID)
	if v.Question == nil {
		w.t.Fatalf("no question showing: %+v", v)
	}
	raw, _ := json.Marshal(w.h.night.dealt[v.N].Reveal(nil))
	var rv struct {
		Pick  *int  `json:"pick"`
		Truth *bool `json:"truth"`
	}
	_ = json.Unmarshal(raw, &rv)
	var a any
	switch {
	case rv.Pick != nil:
		pick := *rv.Pick
		if !right {
			pick = (pick + 1) % bank.ChoiceOptions
		}
		a = map[string]int{"pick": pick}
	case rv.Truth != nil:
		a = map[string]bool{"truth": *rv.Truth == right}
	default:
		w.t.Fatalf("Роял asked something not quick: %s", raw)
	}
	out, _ := json.Marshal(a)
	return out
}

func (w *world) give(p Player, right bool) {
	w.t.Helper()
	v := w.h.View(p.ID)
	if err := w.h.Answer(w.t.Context(), p.ID, v.N, w.answer(p, right)); err != nil {
		w.t.Fatalf("%s's answer to %d: %v", p.Name, v.N, err)
	}
}

func TestNext(t *testing.T) {
	at := func(m time.Month, d, h, min int) time.Time { return time.Date(2026, m, d, h, min, 0, 0, play.Bulgaria) }
	for _, c := range []struct{ now, want time.Time }{
		{at(11, 14, 10, 0), at(11, 14, 21, 0)},
		{at(11, 14, 20, 59), at(11, 14, 21, 0)},
		{at(11, 14, 21, 0), at(11, 15, 21, 0)},
		{at(11, 14, 23, 30), at(11, 15, 21, 0)},
		{at(3, 29, 2, 0), at(3, 29, 21, 0)}, // the clocks go forward that night: still 21:00
	} {
		if got := Evening.Next(c.now); !got.Equal(c.want) {
			t.Errorf("Next(%v) = %v, want %v", c.now, got, c.want)
		}
	}
	every := Schedule{Every: 2 * time.Minute, Lobby: time.Minute}
	if got := every.Next(time.Date(2026, 11, 14, 10, 3, 10, 0, time.UTC)); !got.Equal(time.Date(2026, 11, 14, 10, 4, 0, 0, time.UTC)) {
		t.Errorf("every two minutes: %v", got)
	}
}

func TestEvening(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi, zed := w.player(), w.player(), w.player(), w.player()
	var told []play.RoyalNews
	w.h.News = func(_ context.Context, n play.RoyalNews) { told = append(told, n) }

	// Before the lobby opens, no way in.
	w.at(20, 0, 0)
	if v := w.h.View(ana.ID); v.Phase != "soon" || v.StartsAt != time.Date(2026, 11, 14, 21, 0, 0, 0, play.Bulgaria).UnixMilli() {
		t.Fatalf("the evening before its lobby opens: %+v", v)
	}
	if err := w.h.Join(ctx, ana); !errors.Is(err, ErrClosed) {
		t.Fatalf("joined before the lobby opened: %v", err)
	}

	// The lobby: four come; Zed doesn't stay.
	w.at(20, 50, 0)
	if v := w.h.View(ana.ID); v.Phase != play.RoyalLobby || v.In {
		t.Fatalf("the open lobby: %+v", v)
	}
	subs := map[int64]*Sub{}
	for _, p := range []Player{ana, bo, vi, zed} {
		subs[p.ID] = w.h.Follow(p.ID)
		if err := w.h.Join(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	w.h.Unfollow(subs[zed.ID])
	if v := w.h.View(bo.ID); !v.In || len(v.Players) != 4 {
		t.Fatalf("the lobby with four: %+v", v)
	}

	// 21:00: the three there play, on the same question at the same moment.
	w.at(21, 0, 0)
	v := w.h.View(ana.ID)
	if v.Phase != play.RoyalQuestion || v.N != 0 || v.Entered != 3 || v.Question == nil || v.Question.LeftMs != v.Question.LimitMs {
		t.Fatalf("the start: %+v", v)
	}
	if _, m := w.h.mine(zed.ID); m != nil {
		t.Fatal("Zed is in the game without being there")
	}
	if err := w.h.Join(ctx, zed); !errors.Is(err, ErrClosed) {
		t.Fatalf("joined after the start: %v", err)
	}
	// Zed may watch.
	if v := w.h.View(zed.ID); v.Phase != play.RoyalQuestion || v.In || v.Question == nil {
		t.Fatalf("watching: %+v", v)
	}

	// Question 1: Bo's wrong is the way out; once all three have answered, the answer shows at once.
	w.wait(2 * time.Second)
	w.give(ana, true)
	w.give(bo, false)
	if v := w.h.View(ana.ID); v.Phase != play.RoyalQuestion {
		t.Fatalf("the answer showed before Vi answered: %+v", v)
	}
	if err := w.h.Answer(ctx, bo.ID, 0, w.answer(bo, true)); !errors.Is(err, ErrNotNow) {
		t.Fatalf("answered twice: %v", err)
	}
	w.give(vi, true)
	v = w.h.View(bo.ID)
	if v.Phase != play.RoyalReveal || !v.Out || v.WentOut != 1 || v.Left != 2 || v.Question.Reveal == nil ||
		!v.Question.Reveal.Mine || v.Question.Reveal.Right {
		t.Fatalf("Bo's way out: %+v %+v", v, v.Question)
	}

	// Question 2: Vi lets the time run out.
	w.wait(Pause)
	if v := w.h.View(ana.ID); v.Phase != play.RoyalQuestion || v.N != 1 {
		t.Fatalf("the next question: %+v", v)
	}
	if err := w.h.Answer(ctx, bo.ID, 1, w.answer(ana, true)); !errors.Is(err, ErrNotNow) {
		t.Fatalf("Bo answered while out: %v", err)
	}
	w.give(ana, true)
	w.wait(20*time.Second + play.Grace)
	if v := w.h.View(vi.ID); v.Phase != play.RoyalReveal || !v.Out || !v.Question.Reveal.Missed {
		t.Fatalf("Vi's time ran out: %+v", v)
	}

	// Ana alone goes on. A question nobody gets right puts nobody out: her wrong answer spares her.
	w.wait(Pause)
	w.give(ana, true)
	w.wait(Pause)
	w.give(ana, false)
	if v := w.h.View(ana.ID); v.Phase != play.RoyalReveal || !v.Spared || v.WentOut != 0 || v.Left != 1 || v.Out {
		t.Fatalf("a question nobody got right: %+v", v)
	}
	// The time running out is the way out all the same: the end.
	w.wait(Pause)
	w.wait(20*time.Second + play.Grace)
	w.wait(Pause)
	v = w.h.View(ana.ID)
	if v.Phase != play.RoyalEnd || v.Place != 1 || v.Delta <= 0 || v.RunID == 0 || len(v.Players) != 3 {
		t.Fatalf("the end: %+v", v)
	}
	if p := v.Players; p[0].Name != ana.Name || p[1].Name != vi.Name || p[2].Name != bo.Name || p[2].Delta >= 0 {
		t.Fatalf("the places: %+v", p)
	}
	if len(told) != 0 {
		t.Fatalf("told those watching of the end: %+v", told)
	}
	r, err := w.g.RoyalsOf(ctx, ana.ID)
	if err != nil || len(r) != 1 || r[0].Players[0].Reached != 3 || r[0].Players[0].Place != 1 {
		t.Fatalf("Ana's tournaments: %+v %v", r, err)
	}
	if rv, err := w.g.Review(ctx, ana.ID, v.RunID); err != nil || len(rv) != 5 {
		t.Fatalf("Ana's game gone over: %d %v", len(rv), err)
	}
	var xp int
	_ = w.db.Read.QueryRow(`SELECT xp FROM runs WHERE id = ?`, v.RunID).Scan(&xp)
	if xp == 0 {
		t.Fatal("no XP for a Роял")
	}

	// The results show until the next evening's lobby opens.
	w.at(23, 0, 0)
	if v := w.h.View(vi.ID); v.Phase != play.RoyalEnd || v.Place != 2 {
		t.Fatalf("the results, later: %+v", v)
	}
	w.wait(21*time.Hour + 46*time.Minute)
	if v := w.h.View(vi.ID); v.Phase != play.RoyalLobby || v.In {
		t.Fatalf("the next evening: %+v", v)
	}
}

// A Роял run goes at its tournament's pace: not by the questions' own way.
func TestRunsKeepThePace(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.player()
	w.at(20, 50, 0)
	w.h.Follow(ana.ID)
	_ = w.h.Join(ctx, ana)
	w.at(21, 0, 0)
	_, m := w.h.mine(ana.ID)
	if _, err := w.g.Answer(ctx, ana.ID, m.run, 0, w.answer(ana, true)); !errors.Is(err, play.ErrOutOfStep) {
		t.Fatalf("a Роял run answered as any other: %v", err)
	}
	w.give(ana, true) // alone: the answer shows at once
	w.wait(Pause)
	if s, err := w.g.Show(ctx, ana.ID, m.run); err != nil || s.At != 1 {
		t.Fatalf("a Роял run's state: %+v %v", s, err)
	}
}

// A full tournament: the next to come start another, on the same questions.
func TestFull(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.at(20, 46, 0)
	var last Player
	for range play.RoyalSize + 1 {
		last = w.player()
		w.h.Follow(last.ID)
		if err := w.h.Join(ctx, last); err != nil {
			t.Fatal(err)
		}
	}
	if v := w.h.View(last.ID); v.Tables != 2 || len(v.Players) != 1 || !v.In {
		t.Fatalf("the one over: %+v", v)
	}
	w.at(21, 0, 0)
	n := w.h.night
	if n.tables[0].phase != play.RoyalQuestion || n.tables[1].phase != play.RoyalQuestion || n.tables[0].entered != play.RoyalSize {
		t.Fatalf("both start: %s %s", n.tables[0].phase, n.tables[1].phase)
	}
	// Alone in theirs, the last one's answer shows at once; the other tournament waits for its fifty.
	w.give(last, true)
	if n.tables[1].phase != play.RoyalReveal || n.tables[0].phase != play.RoyalQuestion {
		t.Fatalf("each at its own pace: %s %s", n.tables[0].phase, n.tables[1].phase)
	}
}

// A restart of the server mid-game picks it up again: the question showing shows again, its time from then.
func TestRestart(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.player(), w.player()
	w.at(20, 50, 0)
	for _, p := range []Player{ana, bo} {
		w.h.Follow(p.ID)
		_ = w.h.Join(ctx, p)
	}
	w.at(21, 0, 0)
	w.give(ana, true)
	w.give(bo, true)
	w.wait(Pause)
	w.give(ana, true) // question 2: Bo hasn't answered when the server restarts

	w.now = w.now.Add(30 * time.Second)
	w.h = NewHub(w.g, Evening)
	if err := w.h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	w.h.Step(ctx)
	v := w.h.View(bo.ID)
	if v.Phase != play.RoyalQuestion || v.N != 1 || !v.In || v.Out || v.Question.LeftMs != v.Question.LimitMs {
		t.Fatalf("Bo after the restart: %+v", v)
	}
	if a := w.h.View(ana.ID); a.Question.Given == nil && !a.Players[0].Answered && !a.Players[1].Answered {
		t.Fatalf("Ana's answer forgotten: %+v", a)
	}
	w.h.Follow(bo.ID)
	w.give(bo, false)
	if v := w.h.View(bo.ID); v.Phase != play.RoyalReveal || !v.Out || v.Left != 1 {
		t.Fatalf("after the restart, Bo's answer: %+v", v)
	}
	// The night goes on to its end: Ana is placed first.
	for range play.RoyalLength {
		w.wait(Pause)
		if w.h.View(ana.ID).Phase != play.RoyalQuestion {
			break
		}
		w.give(ana, true)
	}
	if v := w.h.View(ana.ID); v.Phase != play.RoyalEnd || v.Place != 1 {
		t.Fatalf("the end after a restart: %+v", v)
	}
}

// An evening the server missed (down from before the start to well after) is ended by SettleDue.
func TestMissed(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	var told []play.RoyalNews
	w.g.RoyalNews = func(_ context.Context, n play.RoyalNews) { told = append(told, n) }
	ana := w.player()
	w.at(20, 50, 0)
	w.h.Follow(ana.ID)
	_ = w.h.Join(ctx, ana)
	w.at(21, 0, 0)
	w.give(ana, true)

	w.now = w.now.Add(2 * time.Hour)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	r, _ := w.g.RoyalsOf(ctx, ana.ID)
	if len(r) != 1 || r[0].Players[0].Place != 1 || r[0].Players[0].Reached != 1 || len(told) != 1 {
		t.Fatalf("the missed evening, ended: %+v %+v", r, told)
	}
	w.h = NewHub(w.g, Evening)
	if err := w.h.Load(ctx); err != nil || w.h.night != nil {
		t.Fatalf("an ended evening picked up: %v", err)
	}
}

// The lobby's opening is told once an evening, and the evening at a glance follows it: soon, the lobby with how many are
// in it, the games with how many are still in, then the next evening.
func TestOpenedAndGlance(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	opened := make(chan time.Time, 4)
	w.h.Opened = func(_ context.Context, start time.Time) { opened <- start }
	start := time.Date(2026, 11, 14, 21, 0, 0, 0, play.Bulgaria)

	w.at(20, 0, 0)
	if g := w.h.Glance(); g.Phase != "soon" || g.StartsAt != start.UnixMilli() || g.Next != start.UnixMilli() || g.In != 0 {
		t.Fatalf("before the lobby: %+v", g)
	}
	select {
	case <-opened:
		t.Fatal("told before the lobby opened")
	default:
	}
	w.at(20, 45, 0)
	w.at(20, 46, 0)
	if got := <-opened; !got.Equal(start) {
		t.Fatalf("opened %v, want %v", got, start)
	}
	ana, bo := w.player(), w.player()
	for _, p := range []Player{ana, bo} {
		w.h.Follow(p.ID)
		if err := w.h.Join(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	if g := w.h.Glance(); g.Phase != "lobby" || g.In != 2 || g.StartsAt != start.UnixMilli() {
		t.Fatalf("the lobby: %+v", g)
	}
	w.at(21, 0, 0)
	if g := w.h.Glance(); g.Phase != "live" || g.In != 2 || g.Next != start.Add(24*time.Hour).UnixMilli() {
		t.Fatalf("the games: %+v", g)
	}
	w.give(ana, false)
	w.give(bo, false)
	for range 10 {
		w.wait(time.Minute)
	}
	if g := w.h.Glance(); g.Phase != "soon" || g.StartsAt != start.Add(24*time.Hour).UnixMilli() {
		t.Fatalf("after the evening: %+v", g)
	}
	select {
	case <-opened:
		t.Fatal("told twice")
	default:
	}
}

// A question nobody gets right puts nobody out; the next one gets right by one puts the other out.
func TestSpared(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.player(), w.player()
	w.at(20, 50, 0)
	for _, p := range []Player{ana, bo} {
		w.h.Follow(p.ID)
		if err := w.h.Join(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	w.at(21, 0, 0)
	w.wait(2 * time.Second)
	w.give(ana, false)
	w.give(bo, false)
	if v := w.h.View(bo.ID); v.Phase != play.RoyalReveal || !v.Spared || v.Out || v.Left != 2 || v.WentOut != 0 {
		t.Fatalf("both wrong: %+v", v)
	}
	w.wait(Pause)
	w.give(ana, true)
	w.give(bo, false)
	if v := w.h.View(bo.ID); v.Phase != play.RoyalReveal || v.Spared || !v.Out || v.Left != 1 || v.WentOut != 1 {
		t.Fatalf("Ana right, Bo wrong: %+v", v)
	}
}
