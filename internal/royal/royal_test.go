package royal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/bank/banktest"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
	"github.com/almanac-bg/almanac/internal/store/storetest"
)

type world struct {
	t    testing.TB
	db   *store.DB
	g    *play.Game
	h    *Hub
	hubs []*Hub
	now  time.Time
	// tick guards now, read too by what the hub does on its own (after).
	tick sync.Mutex
	next int
	// addresses is how many screens have followed the evening, each from an address of its own.
	addresses int
}

func setup(t testing.TB) *world {
	t.Helper()
	db := storetest.Open(t)
	b := banktest.Sample(t)
	w := &world{t: t, db: db, now: time.Date(2026, 11, 14, 20, 0, 0, 0, play.Bulgaria)}
	w.g = play.New(db, func() *bank.Bank { return b })
	w.g.Now = w.clock
	w.hub(Evening)
	// What the games earned is kept before the database closes.
	t.Cleanup(func() {
		for _, h := range w.hubs {
			h.after.done.Wait()
		}
		w.g.Settled(context.Background()) // and what the game counts in the background, before the database closes
	})
	return w
}

// hub is a new hub (a restart of the server: Load).
func (w *world) hub(s Schedule) {
	w.h = NewHub(w.g, s)
	w.hubs = append(w.hubs, w.h)
}

func (w *world) clock() time.Time {
	w.tick.Lock()
	defer w.tick.Unlock()
	return w.now
}

func (w *world) set(now time.Time) {
	w.tick.Lock()
	defer w.tick.Unlock()
	w.now = now
}

func (w *world) at(hour, min, sec int) {
	d := w.now.In(play.Bulgaria)
	w.set(time.Date(d.Year(), d.Month(), d.Day(), hour, min, sec, 0, play.Bulgaria))
	w.h.Step(w.t.Context())
}

func (w *world) wait(d time.Duration) {
	w.set(w.now.Add(d))
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
	v := w.view(p.ID)
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

// seen is what a screen is sent, read back: its board and its own part, one object.
type seen struct {
	Board
	Own
}

// view is what the viewer's screen is sent now.
func (w *world) view(viewer int64) seen {
	w.t.Helper()
	data, _ := w.h.look(viewer)
	var v seen
	if err := json.Unmarshal(data, &v); err != nil {
		w.t.Fatalf("what's sent: %v: %s", err, data)
	}
	return v
}

// mine is how the viewer's answer went (none: nothing).
func (v seen) mine() MineView {
	if v.Mine == nil {
		return MineView{}
	}
	return *v.Mine
}

// me says whether p is the viewer.
func (v seen) me(p PlayerView) bool { return v.Me != nil && v.Me.Key == p.Key }

// follow is the viewer's screen on the evening.
func (w *world) follow(viewer int64) *Sub {
	w.t.Helper()
	w.addresses++
	s, err := w.h.Follow(viewer, fmt.Sprint("address ", w.addresses))
	if err != nil {
		w.t.Fatal(err)
	}
	return s
}

// has says whether a player has an achievement (once what the games earned is kept).
func (w *world) has(p Player, id string) bool {
	w.h.after.done.Wait()
	var n int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM achievements WHERE user_id = ? AND id = ?`, p.ID, id).Scan(&n)
	return n > 0
}

// start puts players in the evening's lobby, and starts the evening.
func (w *world) start(ps ...Player) {
	w.t.Helper()
	w.at(20, 50, 0)
	for _, p := range ps {
		w.follow(p.ID)
		if err := w.h.Join(w.t.Context(), p); err != nil {
			w.t.Fatal(err)
		}
	}
	w.at(21, 0, 0)
}

func (w *world) give(p Player, right bool) {
	w.t.Helper()
	v := w.view(p.ID)
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

// onward waits for the answer showing to have shown: on to the next question (or the end).
func (w *world) onward() { w.wait(CutPause) }

// timeUp waits for the question showing's time to run out.
func (w *world) timeUp() { w.wait(20*time.Second + play.Grace) }

func TestKeep(t *testing.T) {
	for _, c := range []struct {
		entered int
		want    map[int]int // question (counted from 1) → how many go on after it
	}{
		{50, map[int]int{5: 30, 8: 20, 11: 10, 14: 3}},
		{20, map[int]int{5: 12, 8: 8, 11: 4, 14: 3}},
		{45, map[int]int{5: 27, 8: 18, 11: 9, 14: 3}},
		{13, map[int]int{5: 8, 8: 6, 11: 3, 14: 3}},
		{10, map[int]int{5: 6, 8: 4, 11: 2, 14: 2}},
		{5, map[int]int{5: 3, 8: 2, 11: 2, 14: 2}},
		{3, map[int]int{5: 2, 8: 2, 11: 2, 14: 2}},
		{2, map[int]int{5: 2, 8: 2, 11: 2, 14: 2}},
		{1, map[int]int{5: 1, 8: 1, 11: 1, 14: 1}},
	} {
		for n := range play.RoyalLength {
			if got := play.RoyalKeep(n, c.entered); got != c.want[n+1] {
				t.Errorf("of %d, after question %d: %d go on, want %d", c.entered, n+1, got, c.want[n+1])
			}
		}
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
	if v := w.view(ana.ID); v.Phase != "soon" || v.StartsAt != time.Date(2026, 11, 14, 21, 0, 0, 0, play.Bulgaria).UnixMilli() {
		t.Fatalf("the evening before its lobby opens: %+v", v)
	}
	if err := w.h.Join(ctx, ana); !errors.Is(err, ErrClosed) {
		t.Fatalf("joined before the lobby opened: %v", err)
	}

	// The lobby: four come; Zed doesn't stay.
	w.at(20, 50, 0)
	if v := w.view(ana.ID); v.Phase != play.RoyalLobby || v.In {
		t.Fatalf("the open lobby: %+v", v)
	}
	subs := map[int64]*Sub{}
	for _, p := range []Player{ana, bo, vi, zed} {
		subs[p.ID] = w.follow(p.ID)
		if err := w.h.Join(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	w.h.Unfollow(subs[zed.ID])
	if v := w.view(bo.ID); !v.In || len(v.Players) != 4 {
		t.Fatalf("the lobby with four: %+v", v)
	}

	// 21:00: the three there play, on the same question at the same moment.
	w.at(21, 0, 0)
	v := w.view(ana.ID)
	if v.Phase != play.RoyalQuestion || v.N != 0 || v.Entered != 3 || v.Question == nil || v.LeftMs != v.Question.LimitMs {
		t.Fatalf("the start: %+v", v)
	}
	if v.Cut == nil || v.Cut.After != 5 || v.Cut.Keep != 2 || v.Cut.Now || v.Cut.Line == nil {
		t.Fatalf("the first cut, ahead: %+v", v.Cut)
	}
	if _, m := w.h.mine(zed.ID); m != nil {
		t.Fatal("Zed is in the game without being there")
	}
	if !w.h.Playing(ana.ID) || !w.h.Playing(zed.ID) {
		t.Fatal("the game isn't under way for Ana, or for Zed, who may still come in")
	}
	// Zed may watch, and could still come in (TestLate).
	if v := w.view(zed.ID); v.Phase != play.RoyalQuestion || v.In || !v.Late || v.Question == nil {
		t.Fatalf("watching: %+v", v)
	}

	// Question 1: Bo's wrong puts him behind, not out; once all three have answered, the answer shows at once.
	w.wait(2 * time.Second)
	w.give(ana, true)
	w.give(bo, false)
	if v := w.view(ana.ID); v.Phase != play.RoyalQuestion {
		t.Fatalf("the answer showed before Vi answered: %+v", v)
	}
	if v := w.view(vi.ID); len(v.Players) != 0 || v.Answered != 2 || v.Playing != 3 || v.Me.Reached != 0 {
		t.Fatalf("Ana's answer told before it shows: %+v", v)
	}
	// A second answer is the first one sent again (its reply lost): it changes nothing.
	if err := w.h.Answer(ctx, bo.ID, 0, w.answer(bo, true)); err != nil {
		t.Fatalf("answered twice: %v", err)
	}
	w.wait(time.Second)
	w.give(vi, true)
	v = w.view(bo.ID)
	if v.Phase != play.RoyalReveal || v.Out || v.WentOut != 0 || v.Left != 3 || v.Question.Reveal == nil ||
		(v.Mine == nil) || v.mine().Right || v.Last {
		t.Fatalf("Bo's wrong answer: %+v %+v", v, v.Question)
	}
	// Ana first (as many right as Vi, and quicker), then Vi; Bo third; the line is Vi's.
	if p := v.Players; p[0].Name != ana.Name || p[0].Rank != 1 || p[1].Name != vi.Name || p[1].Rank != 2 ||
		p[2].Name != bo.Name || p[2].Rank != 3 || !v.me(p[2]) || p[0].Ms != 2000 || p[1].Ms != 3000 {
		t.Fatalf("the standings: %+v", p)
	}
	if c := v.Cut; c == nil || c.After != 5 || c.Now || c.Line == nil || c.Line.Rights != 1 || c.Line.Ms != 3000 {
		t.Fatalf("the line: %+v", v.Cut)
	}

	// Questions 2–5: all three right. Bo is one behind at the cut, and out.
	for n := 1; n < 5; n++ {
		w.onward()
		for _, p := range []Player{ana, vi, bo} {
			w.give(p, true)
		}
	}
	v = w.view(bo.ID)
	if v.Phase != play.RoyalReveal || v.N != 4 || !v.Out || v.WentOut != 1 || v.Left != 2 || v.Cut == nil || !v.Cut.Now ||
		v.Cut.Keep != 2 || v.Cut.Line.Rights != 5 {
		t.Fatalf("the cut after question 5: %+v %+v", v, v.Cut)
	}
	// The cut shows longer than an answer.
	w.wait(Pause)
	if v := w.view(ana.ID); v.Phase != play.RoyalReveal {
		t.Fatalf("the cut gone by in a pause: %+v", v)
	}
	w.wait(CutPause - Pause)
	// Two left, and no cut ahead can put either out: the rest is a final of two.
	if v := w.view(ana.ID); v.Phase != play.RoyalQuestion || v.N != 5 || v.Cut != nil {
		t.Fatalf("question 6, two in: %+v %+v", v, v.Cut)
	}

	// Question 6: Bo, out, plays on for himself; Vi lets the time run out, and plays on. Then Ana and Vi right to the
	// end, all fifteen; Bo answers every other one, and the answer waits for him (on the same clock) where he doesn't.
	w.give(bo, true)
	w.give(ana, true)
	if v := w.view(ana.ID); v.Phase != play.RoyalQuestion {
		t.Fatalf("the answer showed without waiting for Vi: %+v", v)
	}
	w.timeUp()
	if v := w.view(vi.ID); v.Phase != play.RoyalReveal || v.Out || !v.mine().Missed || v.Last {
		t.Fatalf("Vi's time ran out: %+v", v)
	}
	v = w.view(bo.ID)
	if !v.Out || v.Rights != 5 || (v.Mine == nil) || !v.mine().Right || v.Left != 2 || v.Cut != nil {
		t.Fatalf("Bo's answer, off the standings: %+v %+v", v, v.Mine)
	}
	if p := v.Players; p[2].Name != bo.Name || p[2].Reached != 4 || p[2].In || p[2].OutAt != 4 {
		t.Fatalf("Bo's standing, as at his cut: %+v", p)
	}
	for n := 6; n < play.RoyalLength; n++ {
		w.onward()
		if n%2 == 0 {
			w.give(bo, true)
		}
		w.give(ana, true)
		w.give(vi, true)
		if v := w.view(ana.ID); (v.Phase != play.RoyalReveal) != (n%2 == 1) {
			t.Fatalf("question %d, Bo out: %+v", n+1, v)
		}
		if n%2 == 1 {
			w.timeUp()
		}
	}
	if v := w.view(ana.ID); v.Phase != play.RoyalReveal || v.N != 14 || !v.Last || v.Cut != nil {
		t.Fatalf("the last question: %+v", v)
	}
	w.onward()
	v = w.view(ana.ID)
	if v.Phase != play.RoyalEnd || v.N != 14 || v.Place != 1 || v.Delta <= 0 || v.RunID == 0 || len(v.Players) != 3 {
		t.Fatalf("the end: %+v", v)
	}
	if p := v.Players; p[0].Name != ana.Name || p[1].Name != vi.Name || p[2].Name != bo.Name || p[2].Delta >= 0 ||
		p[2].Place != 3 || p[2].OutAt != 4 || p[2].Reached != 4 {
		t.Fatalf("the places: %+v", p)
	}
	if v := w.view(bo.ID); v.Place != 3 || v.Rights != 10 || v.RunID == 0 {
		t.Fatalf("Bo's end: %+v", v)
	}
	if len(told) != 0 {
		t.Fatalf("told those watching of the end: %+v", told)
	}
	r, err := w.g.RoyalsOf(ctx, ana.ID)
	if err != nil || len(r) != 1 || r[0].Players[0].Reached != 15 || r[0].Players[0].Place != 1 || r[0].Players[2].Reached != 10 {
		t.Fatalf("Ana's tournaments: %+v %v", r, err)
	}
	if rv, err := w.g.Review(ctx, ana.ID, v.RunID); err != nil || len(rv) != 15 {
		t.Fatalf("Ana's game gone over: %d %v", len(rv), err)
	}
	// Her game was played to its end, all right; Bo's too, out of the standings: what he answered right after his cut
	// counts in his run.
	xpOf := func(p Player) (xp int, finished bool) {
		_ = w.db.Read.QueryRow(`SELECT r.xp, r.finished_at IS NOT NULL FROM runs r JOIN royal_players p ON p.run_id = r.id
			WHERE p.user_id = ?`, p.ID).Scan(&xp, &finished)
		return
	}
	if xp, done := xpOf(ana); xp != 15*(play.XPAnswer+play.XPKnown)+play.XPFinish || !done {
		t.Fatalf("Ana's run: %d XP, finished %v", xp, done)
	}
	if xp, done := xpOf(bo); xp != play.XPAnswer+10*(play.XPAnswer+play.XPKnown)+33 || !done {
		t.Fatalf("Bo's run: %d XP, finished %v", xp, done)
	}
	if !w.has(ana, "royalWin") || w.has(vi, "royalWin") {
		t.Fatal("„Вечерта е твоя“ not Ana's alone")
	}

	// The results show until the next evening's lobby opens.
	w.at(23, 0, 0)
	if v := w.view(vi.ID); v.Phase != play.RoyalEnd || v.Place != 2 {
		t.Fatalf("the results, later: %+v", v)
	}
	w.wait(21*time.Hour + 46*time.Minute)
	if v := w.view(vi.ID); v.Phase != play.RoyalLobby || v.In {
		t.Fatalf("the next evening: %+v", v)
	}
}

// A Роял run goes at its tournament's pace: not by the questions' own way.
func TestRunsKeepThePace(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.player()
	w.at(20, 50, 0)
	w.follow(ana.ID)
	_ = w.h.Join(ctx, ana)
	w.at(21, 0, 0)
	_, m := w.h.mine(ana.ID)
	if _, err := w.g.Answer(ctx, ana.ID, m.run, 0, w.answer(ana, true)); !errors.Is(err, play.ErrOutOfStep) {
		t.Fatalf("a Роял run answered as any other: %v", err)
	}
	w.give(ana, true) // alone: the answer shows at once
	w.wait(Pause)
	if _, err := w.g.Show(ctx, ana.ID, m.run); !errors.Is(err, play.ErrOutOfStep) {
		t.Fatalf("a Роял run's next question shown by its player: %v", err)
	}
	if _, err := w.g.Start(ctx, ana.ID, m.run, 1); !errors.Is(err, play.ErrOutOfStep) {
		t.Fatalf("a Роял run's question started by its player: %v", err)
	}
	if s, err := w.g.State(ctx, ana.ID, m.run); err != nil || s.At != 1 {
		t.Fatalf("a Роял run's state: %+v %v", s, err)
	}
}

// A full tournament: the next to come start another, on the same questions. At the start, those there are dealt
// into tournaments as even as can be.
func TestFull(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.at(20, 46, 0)
	var all []Player
	for range play.RoyalSize + 1 {
		p := w.player()
		all = append(all, p)
		w.follow(p.ID)
		if err := w.h.Join(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	// The lobby is one, whatever the tables it fills: how many are in it, and the first few, to each (and each
	// themselves).
	for _, p := range []Player{all[0], all[50]} {
		if v := w.view(p.ID); v.Tables != 2 || len(v.Players) != few || v.Left != 51 || !v.In || v.Me == nil ||
			v.Me.Name != p.Name || !v.Me.Online || v.Players[0].Name != all[0].Name {
			t.Fatalf("the lobby of 51, to %s: %+v", p.Name, v)
		}
	}
	w.at(21, 0, 0)
	n := w.h.night
	if len(n.tables) != 2 || n.phase != play.RoyalQuestion || n.tables[0].entered != 26 || n.tables[1].entered != 25 {
		t.Fatalf("51 in two of 26 and 25: %+v %+v", n.tables[0], n.tables[1])
	}
	// The database has them so.
	var first, second int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM royal_players WHERE royal_id = ? AND run_id IS NOT NULL`, n.tables[0].id).Scan(&first)
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM royal_players WHERE royal_id = ? AND run_id IS NOT NULL`, n.tables[1].id).Scan(&second)
	if first != 26 || second != 25 {
		t.Fatalf("in the database: %d and %d", first, second)
	}
	// One clock: the second's 25 have all answered, and its answer waits for the first's 26, so that nobody at the
	// first may see it from the second (a second account), nor anyone watching (who follows the first).
	for _, p := range all[26:] {
		w.give(p, true)
	}
	for _, id := range []int64{all[0].ID, all[50].ID, 0} {
		if v := w.view(id); v.Phase != play.RoyalQuestion || v.Question.Reveal != nil || v.Mine != nil || len(v.Players) != 0 {
			t.Fatalf("the answer shown before everyone's had their time, to %d: %+v", id, v)
		}
	}
	if v := w.view(all[50].ID); v.Answered != 25 || v.Playing != 25 || v.Given == nil {
		t.Fatalf("the second, all answered: %+v", v)
	}
	for _, p := range all[:26] {
		w.give(p, true)
	}
	for _, id := range []int64{all[0].ID, all[50].ID, 0} {
		if v := w.view(id); v.Phase != play.RoyalReveal || v.Question.Reveal == nil {
			t.Fatalf("the answer, to %d: %+v", id, v)
		}
	}
}

// Those watching, not in, see the first tournament as its players do, but nothing of anyone's own.
func TestWatching(t *testing.T) {
	w := setup(t)
	ana, bo := w.player(), w.player()
	w.start(ana, bo)
	w.give(ana, true)
	v := w.view(0)
	if v.Phase != play.RoyalQuestion || v.In || v.Me != nil || v.Given != nil || !v.Late || v.Answered != 1 || v.Playing != 2 {
		t.Fatalf("one watching: %+v", v)
	}
	w.give(bo, false)
	v = w.view(0)
	if v.Phase != play.RoyalReveal || v.Mine != nil || len(v.Players) != 2 || v.Players[0].Name != ana.Name {
		t.Fatalf("one watching the answer: %+v", v)
	}
}

func TestDeal(t *testing.T) {
	for _, c := range []struct {
		all, k int
		want   []int
	}{
		{51, 2, []int{26, 25}},
		{100, 2, []int{50, 50}},
		{101, 3, []int{34, 34, 33}},
		{3, 1, []int{3}},
	} {
		got := make([]int, c.k)
		last := 0
		for i := range c.all {
			at := deal(i, c.all, c.k)
			if at < last {
				t.Fatalf("%d in %d: not in the order they came", c.all, c.k)
			}
			last = at
			got[at]++
		}
		if fmt.Sprint(got) != fmt.Sprint(c.want) {
			t.Errorf("%d in %d: %v, want %v", c.all, c.k, got, c.want)
		}
	}
}

// Late: those who come after the start come in until the answer to the third question shows, behind by the
// questions they missed; a lobby member away at the start is in as soon as their screen is back.
func TestLate(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi, zed := w.player(), w.player(), w.player(), w.player()
	w.at(20, 50, 0)
	subs := map[int64]*Sub{}
	for _, p := range []Player{ana, bo} {
		subs[p.ID] = w.follow(p.ID)
		if err := w.h.Join(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	w.h.Unfollow(subs[bo.ID]) // Bo's phone falls asleep in the lobby
	w.at(21, 0, 0)
	if v := w.view(ana.ID); v.Entered != 1 || v.Playing != 1 {
		t.Fatalf("Ana alone at the start: %+v", v)
	}
	if v := w.view(bo.ID); v.In || !v.Late {
		t.Fatalf("Bo, away: %+v", v)
	}
	w.give(ana, true)
	w.wait(Pause)

	// Vi comes during the second question: the first counts as not answered, the second is hers.
	w.wait(5 * time.Second)
	if err := w.h.Join(ctx, vi); err != nil {
		t.Fatal(err)
	}
	v := w.view(vi.ID)
	if !v.In || v.Out || v.Late || v.N != 1 || v.Entered != 2 || v.Question == nil || v.LeftMs != v.Question.LimitMs-5000 {
		t.Fatalf("Vi, late: %+v", v)
	}
	// The answer waits for her too.
	w.give(ana, true)
	if v := w.view(ana.ID); v.Phase != play.RoyalQuestion {
		t.Fatalf("the answer showed without waiting for Vi: %+v", v)
	}
	w.give(vi, true)
	if v := w.view(vi.ID); v.Phase != play.RoyalReveal || (v.Mine == nil) || !v.mine().Right {
		t.Fatalf("Vi's answer: %+v", v)
	}

	// Bo's screen is back while the second answer shows: he's in, both questions missed.
	w.follow(bo.ID)
	w.h.Step(ctx)
	if v := w.view(bo.ID); !v.In || v.Phase != play.RoyalReveal || v.Entered != 3 || (v.Mine != nil) {
		t.Fatalf("Bo, back: %+v", v)
	}
	w.wait(Pause)
	if v := w.view(bo.ID); v.Phase != play.RoyalQuestion || v.N != 2 || !v.In {
		t.Fatalf("Bo at the third: %+v", v)
	}
	for _, p := range []Player{ana, bo, vi} {
		w.give(p, true)
	}
	// The third's answer shows: the door is shut.
	if v := w.view(zed.ID); v.Phase != play.RoyalReveal || v.Late {
		t.Fatalf("the door after the third: %+v", v)
	}
	if err := w.h.Join(ctx, zed); !errors.Is(err, ErrShut) {
		t.Fatalf("Zed came in after the third: %v", err)
	}
	if v := w.view(ana.ID); v.Players[0].Name != ana.Name || v.Players[0].Reached != 3 || v.Players[1].Reached != 2 ||
		v.Players[2].Name != bo.Name || v.Players[2].Reached != 1 {
		t.Fatalf("the standings: %+v", v.Players)
	}
	// Their runs: Vi's first and Bo's first two recorded as missed.
	var missed int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM answers a JOIN royal_players p ON p.run_id = a.run_id
		WHERE p.user_id IN (?, ?) AND a.given IS NULL`, vi.ID, bo.ID).Scan(&missed)
	if missed != 3 {
		t.Fatalf("%d missed, want 3", missed)
	}
}

// Nobody there at the start, but someone away: the game runs while the door is open, and ends if nobody comes.
func TestNobodyBack(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.player()
	w.at(20, 50, 0)
	sub := w.follow(ana.ID)
	if err := w.h.Join(ctx, ana); err != nil {
		t.Fatal(err)
	}
	w.h.Unfollow(sub)
	w.at(21, 0, 0)
	if v := w.view(ana.ID); v.Phase != play.RoyalQuestion || v.In || !v.Late {
		t.Fatalf("the game, for Ana to come back to: %+v", v)
	}
	for range 3 {
		w.timeUp()
		w.wait(Pause)
	}
	if len(w.h.night.tables) != 0 {
		t.Fatalf("a game nobody plays goes on: %+v", w.h.night.tables[0])
	}
	var rows int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM royal_players`).Scan(&rows)
	if rows != 0 {
		t.Fatalf("%d left in", rows)
	}
}

// A minute before the start, those in the lobby are told, with who of them is away.
func TestSoon(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	type call struct {
		start    time.Time
		away, in []int64
	}
	calls := make(chan call, 4)
	w.h.Soon = func(_ context.Context, start time.Time, away, in []int64) { calls <- call{start, away, in} }
	ana, bo := w.player(), w.player()
	w.at(20, 50, 0)
	sub := w.follow(ana.ID)
	w.follow(bo.ID)
	for _, p := range []Player{ana, bo} {
		if err := w.h.Join(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	w.h.Unfollow(sub)
	w.at(20, 58, 59)
	select {
	case <-calls:
		t.Fatal("called two minutes before")
	default:
	}
	w.at(20, 59, 0)
	c := <-calls
	if !c.start.Equal(time.Date(2026, 11, 14, 21, 0, 0, 0, play.Bulgaria)) || fmt.Sprint(c.away) != fmt.Sprint([]int64{ana.ID}) ||
		len(c.in) != 2 {
		t.Fatalf("the call: %+v", c)
	}
	w.at(20, 59, 30)
	select {
	case <-calls:
		t.Fatal("called twice")
	default:
	}
}

// A restart of the server mid-game picks it up again: the question showing shows again, its time from then, and the
// standings are as they were.
func TestRestart(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.player(), w.player()
	w.start(ana, bo)
	w.wait(time.Second)
	w.give(ana, true)
	w.wait(time.Second)
	w.give(bo, true)
	w.onward()
	w.give(ana, true) // question 2: Bo hasn't answered when the server restarts
	shown := w.view(bo.ID).Question.Shown

	w.set(w.now.Add(30 * time.Second))
	w.hub(Evening)
	if err := w.h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	w.h.Step(ctx)
	v := w.view(bo.ID)
	// The question shows again, as a new one: the screens draw it again, its time from now.
	if v.Phase != play.RoyalQuestion || v.N != 1 || !v.In || v.Out || v.LeftMs != v.Question.LimitMs ||
		v.Question.Shown != shown+30_000 {
		t.Fatalf("Bo after the restart: %+v", v)
	}
	if a := w.view(ana.ID); a.Given == nil || a.Answered != 1 || a.Playing != 2 {
		t.Fatalf("Ana's answer forgotten: %+v", a)
	}
	w.follow(bo.ID)
	w.give(bo, false)
	v = w.view(bo.ID)
	if v.Phase != play.RoyalReveal || v.Out || v.Left != 2 || v.Last {
		t.Fatalf("after the restart, Bo's answer: %+v", v)
	}
	if p := v.Players; p[0].Name != ana.Name || p[0].Reached != 2 || p[0].Ms != 1000 || p[1].Reached != 1 || p[1].Ms != 2000 {
		t.Fatalf("the standings after a restart: %+v", p)
	}
	// Another restart while the answer shows: the game goes on.
	w.hub(Evening)
	if err := w.h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	if v := w.view(ana.ID); v.Phase != play.RoyalReveal || v.Left != 2 || v.Players[1].Ms != 2000 {
		t.Fatalf("the answer showing, after a restart: %+v", v)
	}
	w.onward()
	if v := w.view(ana.ID); v.Phase != play.RoyalQuestion || v.N != 2 {
		t.Fatalf("the next question after a restart: %+v", v)
	}
}

// Level at a cut's line, all go on: a cut never tells apart those it can't.
func TestLevelGoOn(t *testing.T) {
	w := setup(t)
	ana, bo, vi := w.player(), w.player(), w.player()
	w.start(ana, bo, vi)
	for n := range 5 {
		if n > 0 {
			w.onward()
		}
		for _, p := range []Player{ana, bo, vi} {
			w.give(p, n != 2) // all wrong on the third
		}
	}
	v := w.view(vi.ID)
	if v.Phase != play.RoyalReveal || v.N != 4 || v.Out || v.WentOut != 0 || v.Left != 3 || !v.Cut.Now ||
		v.Players[2].Rank != 1 {
		t.Fatalf("level at the cut: %+v %+v", v, v.Cut)
	}
}

// Of as many right, the quicker go on: the time the right answers took, not the wrong ones.
func TestQuickerGoOn(t *testing.T) {
	w := setup(t)
	ana, bo, vi := w.player(), w.player(), w.player()
	w.start(ana, bo, vi)
	for n := range 5 {
		if n > 0 {
			w.onward()
		}
		w.wait(time.Second)
		w.give(ana, n != 0) // a slow miss costs nothing: Ana's wrong one is quick, but not counted
		w.give(bo, true)
		w.wait(time.Second)
		w.give(vi, true)
	}
	v := w.view(vi.ID)
	if v.Phase != play.RoyalReveal || v.Out || v.WentOut != 1 || v.Players[0].Name != bo.Name || v.Players[1].Name != vi.Name {
		t.Fatalf("Ana a right answer behind, out: %+v", v)
	}
	if v := w.view(ana.ID); !v.Out {
		t.Fatalf("Ana still in: %+v", v)
	}
	// Bo and Vi as many right: Bo, quicker, ahead.
	if v.Players[0].Rank != 1 || v.Players[1].Rank != 2 || v.Players[0].Ms != 5000 || v.Players[1].Ms != 10000 {
		t.Fatalf("Bo ahead of Vi: %+v", v.Players)
	}
}

// Alone in a tournament, there's nobody to be cut against: all fifteen, whatever the answers.
func TestAlone(t *testing.T) {
	w := setup(t)
	ana := w.player()
	w.start(ana)
	for n := range play.RoyalLength {
		if n > 0 {
			w.onward()
		}
		w.give(ana, n%2 == 0)
		if v := w.view(ana.ID); v.Phase != play.RoyalReveal || v.Out || v.Cut != nil || v.Last != (n == 14) {
			t.Fatalf("question %d, alone: %+v", n+1, v)
		}
	}
	w.wait(Pause)
	if v := w.view(ana.ID); v.Phase != play.RoyalEnd || v.Place != 1 || v.Entered != 1 || v.Players[0].Reached != 8 {
		t.Fatalf("the end, alone: %+v", v)
	}
	if w.has(ana, "royalWin") {
		t.Fatal("a Роял won alone")
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
	w.follow(ana.ID)
	_ = w.h.Join(ctx, ana)
	w.at(21, 0, 0)
	w.give(ana, true)

	w.set(w.now.Add(2 * time.Hour))
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	r, _ := w.g.RoyalsOf(ctx, ana.ID)
	if len(r) != 1 || r[0].Players[0].Place != 1 || r[0].Players[0].Reached != 1 || len(told) != 1 {
		t.Fatalf("the missed evening, ended: %+v %+v", r, told)
	}
	w.hub(Evening)
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
		w.follow(p.ID)
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
	// Neither answers again: the game runs its fifteen questions out, a step at a time.
	w.give(ana, false)
	w.give(bo, false)
	for range 2 * play.RoyalLength {
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

// Two in a tournament play it to its end as a duel: no cut can put either out, so none shows.
func TestTwo(t *testing.T) {
	w := setup(t)
	ana, bo := w.player(), w.player()
	w.start(ana, bo)
	for n := range 5 {
		if n > 0 {
			w.wait(Pause)
		}
		if v := w.view(ana.ID); v.Phase != play.RoyalQuestion || v.N != n || v.Cut != nil {
			t.Fatalf("question %d of two: %+v %+v", n+1, v, v.Cut)
		}
		w.give(ana, true)
		w.give(bo, false)
	}
	if v := w.view(bo.ID); v.Out || v.WentOut != 0 || w.h.pause() != Pause {
		t.Fatalf("after question 5, of two: %+v", v)
	}
}

// Near: from lead before the lobby opens until the evening's games are over.
func TestNear(t *testing.T) {
	w := setup(t)
	lead := 6 * time.Minute
	w.at(20, 38, 59)
	if w.h.Near(lead) {
		t.Fatal("near at 20:38")
	}
	w.at(20, 39, 0)
	if !w.h.Near(lead) {
		t.Fatal("not near at 20:39")
	}
	ana := w.player()
	w.start(ana)
	w.wait(10 * time.Minute)
	if !w.h.Near(lead) {
		t.Fatal("not near while the game is on")
	}
	for v := w.view(ana.ID); v.Phase != play.RoyalEnd; v = w.view(ana.ID) {
		w.wait(time.Minute)
	}
	w.h.after.done.Wait() // once what the game earned is kept
	if w.h.Near(lead) {
		t.Fatalf("near once over, at %s", w.now.In(play.Bulgaria).Format(time.TimeOnly))
	}
	// An evening nobody came to is over at its start.
	w.set(w.now.Add(23 * time.Hour))
	w.at(20, 50, 0)
	if !w.h.Near(lead) {
		t.Fatal("not near in the next evening's lobby")
	}
	w.at(21, 0, 1)
	if w.h.Near(lead) {
		t.Fatal("near after an evening nobody came to")
	}
}

// Those cut play on through a restart of the server: still off the standings, as they stood at their cut.
func TestRestartOut(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi := w.player(), w.player(), w.player()
	w.start(ana, bo, vi)
	for n := range 5 {
		if n > 0 {
			w.onward()
		}
		for _, p := range []Player{ana, bo, vi} {
			w.give(p, p != bo || n > 0)
		}
	}
	w.onward()
	w.give(bo, true) // question 6, out
	w.give(ana, true)

	w.hub(Evening)
	if err := w.h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	w.h.Step(ctx)
	v := w.view(bo.ID)
	if v.Phase != play.RoyalQuestion || v.N != 5 || !v.In || !v.Out || v.Rights != 4 || v.Given == nil ||
		v.Answered != 2 || v.Playing != 3 || len(v.Players) != 0 || v.Me.Reached != 4 || v.Me.Rank != 3 || v.Left != 2 {
		t.Fatalf("Bo after the restart: %+v", v)
	}
	w.give(vi, true)
	v = w.view(bo.ID)
	if v.Phase != play.RoyalReveal || (v.Mine == nil) || v.Rights != 5 || v.Cut != nil {
		t.Fatalf("question 6 after the restart: %+v", v)
	}
	if p := v.Players; p[2].Name != bo.Name || p[2].Reached != 4 || p[2].OutAt != 4 {
		t.Fatalf("Bo's standing after the restart: %+v", p)
	}
}

// On the days it plays: Friday to Sunday, and every evening once they fill. A change of the days shows before the
// next lobby opens; an evening held is kept.
func TestDays(t *testing.T) {
	w := setup(t) // Saturday, 14 November
	nightly := false
	sched := Evening
	sched.On = func(t time.Time) bool {
		d := t.In(play.Bulgaria).Weekday()
		return nightly || d == time.Friday || d == time.Saturday || d == time.Sunday
	}
	at := func(d, h int) time.Time { return time.Date(2026, 11, d, h, 0, 0, 0, play.Bulgaria) }
	for _, c := range []struct{ now, want time.Time }{
		{at(14, 10), at(14, 21)},
		{at(15, 22), at(20, 21)}, // Sunday's over: Friday
		{at(18, 10), at(20, 21)},
	} {
		if got := sched.Next(c.now); !got.Equal(c.want) {
			t.Errorf("Next(%v) = %v, want %v", c.now, got, c.want)
		}
	}
	if sched.Nightly(at(14, 10)) {
		t.Fatal("nightly on weekends")
	}
	w.hub(sched)
	ana := w.player()
	w.set(at(15, 20))
	w.start(ana)
	var held int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM royal_evenings WHERE day = '2026-11-15'`).Scan(&held)
	if held != 1 {
		t.Fatal("Sunday's evening not kept as held")
	}
	for v := w.view(ana.ID); v.Phase != play.RoyalEnd; v = w.view(ana.ID) {
		w.wait(time.Minute)
	}
	w.wait(time.Hour)
	if g := w.h.Glance(); g.StartsAt != at(20, 21).UnixMilli() || g.Nightly {
		t.Fatalf("after Sunday's: %+v", g)
	}
	// Monday: the evenings filled. Tonight's on.
	nightly = true
	w.set(at(16, 10))
	w.h.Step(t.Context())
	if g := w.h.Glance(); g.StartsAt != at(16, 21).UnixMilli() || g.Next != at(16, 21).UnixMilli() || !g.Nightly {
		t.Fatalf("once nightly: %+v", g)
	}
}

// A cut, as its answer shows, says which comes next: of five, three go on after the fifth, two after the eighth.
func TestThen(t *testing.T) {
	w := setup(t)
	var all []Player
	for range 5 {
		all = append(all, w.player())
	}
	w.start(all...)
	for n := range 5 {
		if n > 0 {
			w.onward()
		}
		for i, p := range all {
			w.give(p, i < 3 || n > 0) // two a right answer behind
		}
	}
	v := w.view(all[0].ID)
	if c := v.Cut; c == nil || !c.Now || c.After != 5 || c.Keep != 3 || c.Then != 8 || v.WentOut != 2 {
		t.Fatalf("the cut after the fifth: %+v %+v", v, v.Cut)
	}
}

// An answer sent again (the reply to the first lost on the way: the line dropped, the server restarted) is the one
// taken: no error, nothing changed, while its question shows and once its answer does. One who didn't answer is still
// refused once the answer shows.
func TestAnswerAgain(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi := w.player(), w.player(), w.player()
	w.start(ana, bo, vi)
	w.wait(2 * time.Second)
	a := w.answer(ana, true)
	for range 2 {
		if err := w.h.Answer(ctx, ana.ID, 0, a); err != nil {
			t.Fatalf("Ana's answer, sent again: %v", err)
		}
	}
	w.wait(time.Second)
	if err := w.h.Answer(ctx, ana.ID, 0, w.answer(ana, false)); err != nil {
		t.Fatalf("Ana's answer, sent again later: %v", err)
	}
	w.give(bo, true)
	w.timeUp()
	if err := w.h.Answer(ctx, ana.ID, 0, a); err != nil {
		t.Fatalf("Ana's answer, sent again as the answer shows: %v", err)
	}
	if err := w.h.Answer(ctx, vi.ID, 0, w.answer(vi, true)); !errors.Is(err, ErrNotNow) {
		t.Fatalf("Vi's answer, after the answer showed: %v", err)
	}
	v := w.view(ana.ID)
	if v.Phase != play.RoyalReveal || !v.mine().Right || v.Players[0].Name != ana.Name || v.Players[0].Ms != 2000 {
		t.Fatalf("Ana's answer, taken once: %+v %+v", v.Mine, v.Players)
	}
	var answers int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM answers a JOIN royal_players p ON p.run_id = a.run_id
		WHERE p.user_id = ?`, ana.ID).Scan(&answers)
	if answers != 1 {
		t.Fatalf("Ana has %d answers kept", answers)
	}
}

// lobby puts k new players in the evening's lobby, on its screen.
func (w *world) lobby(k int) ([]Player, []*Sub) {
	w.t.Helper()
	var ps []Player
	var subs []*Sub
	for range k {
		p := w.player()
		subs = append(subs, w.follow(p.ID))
		if err := w.h.Join(w.t.Context(), p); err != nil {
			w.t.Fatal(err)
		}
		ps = append(ps, p)
	}
	return ps, subs
}

// sizes are how many each of the evening's tournaments has in.
func (w *world) sizes() []int {
	var out []int
	for _, t := range w.h.night.tables {
		out = append(out, len(t.members))
	}
	return out
}

// Nobody who was in the lobby is shut out because the tournaments are full: those away at the start are counted in
// the deal, and come back to a seat.
func TestSeatsForThoseAway(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.at(20, 46, 0)
	w.lobby(50)
	away, subs := w.lobby(51)
	w.wait(time.Minute)
	for _, s := range subs {
		w.h.Unfollow(s) // their phones asleep, well before the start
	}
	w.at(21, 0, 0)
	if got := fmt.Sprint(w.sizes()); got != "[17 17 16]" {
		t.Fatalf("the 50 there, dealt with seats for the 51 away: %s", got)
	}
	w.wait(5 * time.Second)
	for _, p := range away {
		w.follow(p.ID)
	}
	w.h.Step(ctx)
	for _, p := range away {
		if v := w.view(p.ID); !v.In || v.Phase != play.RoyalQuestion {
			t.Fatalf("%s, back during the first question: %+v", p.Name, v)
		}
	}
	if got := fmt.Sprint(w.sizes()); got != "[34 34 33]" {
		t.Fatalf("all back: %s", got)
	}
}

// Nobody who comes while the door is open is shut out because the tournaments are full: they sit at the one with
// fewest in, over its size if every one is full.
func TestLateToFullTables(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.at(20, 46, 0)
	w.lobby(2 * play.RoyalSize)
	w.at(21, 0, 0)
	if got := fmt.Sprint(w.sizes()); got != "[50 50]" {
		t.Fatalf("100 there: %s", got)
	}
	w.wait(5 * time.Second)
	for range 3 {
		p := w.player()
		w.follow(p.ID)
		if err := w.h.Join(ctx, p); err != nil {
			t.Fatalf("late, the tournaments full: %v", err)
		}
		if v := w.view(p.ID); !v.In || v.Phase != play.RoyalQuestion {
			t.Fatalf("late, the tournaments full: %+v", v)
		}
	}
	if got := fmt.Sprint(w.sizes()); got != "[52 51]" {
		t.Fatalf("three late: %s", got)
	}
	if v := w.view(w.player().ID); !v.Late {
		t.Fatalf("the door, the tournaments full: %+v", v)
	}
}

// Trying the game out, an evening every few minutes: once one's games are over, the next one's lobby (open while its
// standings still show) takes those who come, rather than the door of the one over.
func TestNextLobbyAfterAnEvening(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.hub(Schedule{Every: 12 * time.Minute, Lobby: 11 * time.Minute})
	w.at(20, 50, 0)
	ana := w.player()
	w.follow(ana.ID)
	if err := w.h.Join(ctx, ana); err != nil {
		t.Fatal(err)
	}
	w.at(21, 0, 0)
	for range play.RoyalLength {
		w.give(ana, true)
		w.onward()
	}
	if v := w.view(ana.ID); v.Phase != play.RoyalEnd {
		t.Fatalf("the evening over: %+v", v)
	}
	bo := w.player()
	w.follow(bo.ID)
	if err := w.h.Join(ctx, bo); err != nil {
		t.Fatalf("into the next lobby: %v", err)
	}
	if v := w.view(bo.ID); v.Phase != play.RoyalLobby || !v.In || v.StartsAt != time.Date(2026, 11, 14, 21, 12, 0, 0, play.Bulgaria).UnixMilli() {
		t.Fatalf("Bo in the next lobby: %+v", v)
	}
}

// Those cut play on on the same clock: the answer waits for them too, so that theirs are taken; one who let a
// question's time run out isn't waited for until they answer again.
func TestCutPlayOn(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ps := []Player{w.player(), w.player(), w.player(), w.player(), w.player()}
	in, cut := ps[:3], ps[3:]
	w.start(ps...)
	for n := range 5 {
		if n > 0 {
			w.onward()
		}
		for i, p := range ps {
			w.give(p, i < 3)
		}
	}
	if v := w.view(cut[0].ID); !v.Out || v.WentOut != 2 {
		t.Fatalf("the cut after the fifth: %+v", v)
	}
	shows := func(q string, want bool) {
		t.Helper()
		if v := w.view(in[0].ID); (v.Phase == play.RoyalReveal) != want {
			t.Fatalf("%s: %+v", q, v)
		}
	}

	// Question 6: those in answer; the answer waits for the two cut, and shows once they've answered.
	w.onward()
	for _, p := range in {
		w.give(p, true)
	}
	shows("question 6, the cut not answered", false)
	w.give(cut[0], true)
	shows("question 6, one cut not answered", false)
	w.give(cut[1], false)
	shows("question 6, all answered", true)
	if v := w.view(cut[0].ID); !v.Out || (v.Mine == nil) || !v.mine().Right || v.Rights != 1 {
		t.Fatalf("a cut one's answer, taken: %+v %+v", v, v.Mine)
	}

	// Question 7: the second cut one lets the time run out.
	w.wait(Pause)
	for _, p := range append(slices.Clone(in), cut[0]) {
		w.give(p, true)
	}
	shows("question 7, waiting for the second cut one", false)
	w.timeUp()
	shows("question 7, the time up", true)

	// Question 8: they aren't waited for, until they answer again.
	w.wait(Pause)
	for _, p := range append(slices.Clone(in), cut[0]) {
		w.give(p, true)
	}
	shows("question 8, one cut who let the last one go isn't waited for", true)
	if err := w.h.Answer(ctx, cut[1].ID, 7, w.answer(cut[1], true)); !errors.Is(err, ErrNotNow) {
		t.Fatalf("an answer after the answer showed: %v", err)
	}
	// Question 9 (one more cut after the eighth): the second cut one answers again; the answer waits for the first.
	w.onward()
	for _, p := range append(slices.Clone(in), cut[1]) {
		w.give(p, true)
	}
	shows("question 9, waiting for the first cut one", false)
	w.give(cut[0], true)
	shows("question 9, all answered", true)
}

// A restart of the server while an answer shows picks it up as it was: who answered what, what it brought, and who
// let the time run out.
func TestRestartInReveal(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi := w.player(), w.player(), w.player()
	w.start(ana, bo, vi)
	w.wait(2 * time.Second)
	w.give(ana, true)
	w.give(bo, false)
	w.timeUp() // Vi lets it run out
	before := map[int64]*MineView{}
	for _, p := range []Player{ana, bo, vi} {
		before[p.ID] = w.view(p.ID).Mine
	}
	given := w.view(ana.ID).Given

	w.hub(Evening)
	if err := w.h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	for _, p := range []Player{ana, bo, vi} {
		v := w.view(p.ID)
		r, was := v.Mine, before[p.ID]
		if v.Phase != play.RoyalReveal || r == nil || r.Right != was.Right || r.Missed != was.Missed || r.Points != was.Points {
			t.Fatalf("%s's answer after the restart: %+v, before: %+v", p.Name, r, was)
		}
	}
	if v := w.view(vi.ID); !v.mine().Missed || v.Given != nil {
		t.Fatalf("Vi, the time ran out: %+v", v.Question)
	}
	if v := w.view(ana.ID); string(v.Given) != string(given) || v.mine().Points == 0 {
		t.Fatalf("Ana's answer after the restart: %+v", v.Question)
	}
}

// The time an answer took is read as it arrives, not once the hub (busy with others' answers) takes it.
func TestAnswerTimedAsItArrives(t *testing.T) {
	w := setup(t)
	ana, bo := w.player(), w.player()
	w.start(ana, bo)
	w.wait(2 * time.Second)
	var clock atomic.Int64
	clock.Store(w.now.UnixNano())
	w.g.Now = func() time.Time { return time.Unix(0, clock.Load()).In(play.Bulgaria) }
	a := w.answer(ana, true)
	w.h.mu.Lock() // the hub busy
	done := make(chan error)
	go func() { done <- w.h.Answer(t.Context(), ana.ID, 0, a) }()
	time.Sleep(50 * time.Millisecond) // it has arrived, and waits
	clock.Add(int64(700 * time.Millisecond))
	w.h.mu.Unlock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	w.set(time.Unix(0, clock.Load()).In(play.Bulgaria))
	w.g.Now = w.clock
	w.give(bo, true)
	if p := w.view(ana.ID).Players; p[0].Name != ana.Name || p[0].Ms != 2000 {
		t.Fatalf("Ana's answer, timed: %+v", p)
	}
}

// Nobody opens screens without end: a player a few, an address some more; one gone makes room. A screen in a game
// looks again a moment after a change; one in the lobby, or watching, a second after.
func TestScreens(t *testing.T) {
	w := setup(t)
	ana, bo := w.player(), w.player()
	var mine []*Sub
	for range maxOfPlayer {
		mine = append(mine, w.follow(ana.ID))
	}
	if _, err := w.h.Follow(ana.ID, "elsewhere"); !errors.Is(err, ErrBusy) {
		t.Fatalf("a screen too many of a player's: %v", err)
	}
	w.h.Unfollow(mine[0])
	s, err := w.h.Follow(ana.ID, "elsewhere")
	if err != nil {
		t.Fatalf("a screen gone, and no room: %v", err)
	}
	for _, s := range append(mine[1:], s) {
		w.h.Unfollow(s)
	}
	for range maxFromAddress {
		if _, err := w.h.Follow(0, "one address"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := w.h.Follow(bo.ID, "one address"); !errors.Is(err, ErrBusy) {
		t.Fatalf("a screen too many from an address: %v", err)
	}

	w.start(ana, bo)
	if _, pace := w.h.look(ana.ID); pace != glance {
		t.Fatalf("a player's screen in a game looks again after %v", pace)
	}
	if _, pace := w.h.look(0); pace != idle {
		t.Fatalf("one watching looks again after %v", pace)
	}
}

// A screen in the lobby looks again only a second after a change (someone came in), but at the start at once: the
// first question is on every screen the moment its time starts.
func TestStartAtOnce(t *testing.T) {
	w := setup(t)
	ana, bo := w.player(), w.player()
	w.at(20, 50, 0)
	s := w.follow(ana.ID)
	if err := w.h.Join(t.Context(), ana); err != nil {
		t.Fatal(err)
	}
	if _, pace := w.h.Look(s); pace != idle {
		t.Fatalf("the lobby looks again after %v", pace)
	}
	for len(s.Now) > 0 {
		<-s.Now
	}
	w.follow(bo.ID)
	if err := w.h.Join(t.Context(), bo); err != nil {
		t.Fatal(err)
	}
	if len(s.Now) != 0 {
		t.Fatal("someone in, and the lobby looks at once")
	}
	w.at(21, 0, 0)
	if len(s.Now) != 1 {
		t.Fatal("the start, and the lobby's screen waits its second")
	}
}

// The server stopped as the clock moved its tournaments on, one by one: the one it hadn't moved yet is brought to the
// others, and the answer shows at both.
func TestRestartAStepApart(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.at(20, 46, 0)
	all, _ := w.lobby(play.RoyalSize + 1)
	w.at(21, 0, 0)
	for _, p := range all[1:] {
		w.give(p, true)
	}
	first, second := w.h.night.tables[0], w.h.night.tables[1]
	if _, err := w.g.RevealRoyal(ctx, second.id); err != nil { // the second's answer shown; then the server stopped
		t.Fatal(err)
	}

	w.hub(Evening)
	if err := w.h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	for _, p := range []Player{all[0], all[50]} {
		if v := w.view(p.ID); v.Phase != play.RoyalReveal || v.N != 0 || v.Question.Reveal == nil || v.Mine == nil {
			t.Fatalf("after the restart, to %s: %+v", p.Name, v)
		}
	}
	if v := w.view(all[0].ID); !v.Mine.Missed || v.Mine.Right {
		t.Fatalf("the first's own, unanswered: %+v", v.Mine)
	}
	var phase string
	_ = w.db.Read.QueryRow(`SELECT phase FROM royals WHERE id = ?`, first.id).Scan(&phase)
	if phase != play.RoyalReveal {
		t.Fatalf("the first, in the database: %s", phase)
	}
	w.onward()
	if v := w.view(all[0].ID); v.Phase != play.RoyalQuestion || v.N != 1 {
		t.Fatalf("on from there: %+v", v)
	}
}
