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

// has says whether a player has an achievement.
func (w *world) has(p Player, id string) bool {
	var n int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM achievements WHERE user_id = ? AND id = ?`, p.ID, id).Scan(&n)
	return n > 0
}

// start puts players in the evening's lobby, and starts the evening.
func (w *world) start(ps ...Player) {
	w.t.Helper()
	w.at(20, 50, 0)
	for _, p := range ps {
		w.h.Follow(p.ID)
		if err := w.h.Join(w.t.Context(), p); err != nil {
			w.t.Fatal(err)
		}
	}
	w.at(21, 0, 0)
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
	if v.Cut == nil || v.Cut.After != 5 || v.Cut.Keep != 2 || v.Cut.Now || v.Cut.Line == nil {
		t.Fatalf("the first cut, ahead: %+v", v.Cut)
	}
	if _, m := w.h.mine(zed.ID); m != nil {
		t.Fatal("Zed is in the game without being there")
	}
	// Zed may watch, and could still come in (TestLate).
	if v := w.h.View(zed.ID); v.Phase != play.RoyalQuestion || v.In || !v.Late || v.Question == nil {
		t.Fatalf("watching: %+v", v)
	}

	// Question 1: Bo's wrong puts him behind, not out; once all three have answered, the answer shows at once.
	w.wait(2 * time.Second)
	w.give(ana, true)
	w.give(bo, false)
	if v := w.h.View(ana.ID); v.Phase != play.RoyalQuestion {
		t.Fatalf("the answer showed before Vi answered: %+v", v)
	}
	if v := w.h.View(vi.ID); v.Players[0].Reached != 0 {
		t.Fatalf("Ana's answer told before it shows: %+v", v.Players)
	}
	if err := w.h.Answer(ctx, bo.ID, 0, w.answer(bo, true)); !errors.Is(err, ErrNotNow) {
		t.Fatalf("answered twice: %v", err)
	}
	w.wait(time.Second)
	w.give(vi, true)
	v = w.h.View(bo.ID)
	if v.Phase != play.RoyalReveal || v.Out || v.WentOut != 0 || v.Left != 3 || v.Question.Reveal == nil ||
		!v.Question.Reveal.Mine || v.Question.Reveal.Right || v.Last {
		t.Fatalf("Bo's wrong answer: %+v %+v", v, v.Question)
	}
	// Ana first (as many right as Vi, and quicker), then Vi; Bo third; the line is Vi's.
	if p := v.Players; p[0].Name != ana.Name || p[0].Rank != 1 || p[1].Name != vi.Name || p[1].Rank != 2 ||
		p[2].Name != bo.Name || p[2].Rank != 3 || !p[2].Me || p[0].Ms != 2000 || p[1].Ms != 3000 {
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
	v = w.h.View(bo.ID)
	if v.Phase != play.RoyalReveal || v.N != 4 || !v.Out || v.WentOut != 1 || v.Left != 2 || v.Cut == nil || !v.Cut.Now ||
		v.Cut.Keep != 2 || v.Cut.Line.Rights != 5 {
		t.Fatalf("the cut after question 5: %+v %+v", v, v.Cut)
	}
	// The cut shows longer than an answer.
	w.wait(Pause)
	if v := w.h.View(ana.ID); v.Phase != play.RoyalReveal {
		t.Fatalf("the cut gone by in a pause: %+v", v)
	}
	w.wait(CutPause - Pause)
	// Two left, and no cut ahead can put either out: the rest is a final of two.
	if v := w.h.View(ana.ID); v.Phase != play.RoyalQuestion || v.N != 5 || v.Cut != nil {
		t.Fatalf("question 6, two in: %+v %+v", v, v.Cut)
	}

	// Question 6: Bo, out, plays on for himself; Vi lets the time run out, and plays on. Then Ana and Vi right to the
	// end, all fifteen; Bo answers every other one, and isn't waited for.
	w.give(bo, true)
	w.give(ana, true)
	if v := w.h.View(ana.ID); v.Phase != play.RoyalQuestion {
		t.Fatalf("the answer showed without waiting for Vi: %+v", v)
	}
	w.timeUp()
	if v := w.h.View(vi.ID); v.Phase != play.RoyalReveal || v.Out || !v.Question.Reveal.Missed || v.Last {
		t.Fatalf("Vi's time ran out: %+v", v)
	}
	v = w.h.View(bo.ID)
	if !v.Out || v.Rights != 5 || !v.Question.Reveal.Mine || !v.Question.Reveal.Right || v.Left != 2 || v.Cut != nil {
		t.Fatalf("Bo's answer, off the standings: %+v %+v", v, v.Question.Reveal)
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
		if v := w.h.View(ana.ID); v.Phase != play.RoyalReveal {
			t.Fatalf("question %d waits for Bo, out: %+v", n+1, v)
		}
	}
	if v := w.h.View(ana.ID); v.Phase != play.RoyalReveal || v.N != 14 || !v.Last || v.Cut != nil {
		t.Fatalf("the last question: %+v", v)
	}
	w.onward()
	v = w.h.View(ana.ID)
	if v.Phase != play.RoyalEnd || v.N != 14 || v.Place != 1 || v.Delta <= 0 || v.RunID == 0 || len(v.Players) != 3 {
		t.Fatalf("the end: %+v", v)
	}
	if p := v.Players; p[0].Name != ana.Name || p[1].Name != vi.Name || p[2].Name != bo.Name || p[2].Delta >= 0 ||
		p[2].Place != 3 || p[2].OutAt != 4 || p[2].Reached != 4 {
		t.Fatalf("the places: %+v", p)
	}
	if v := w.h.View(bo.ID); v.Place != 3 || v.Rights != 10 || v.RunID == 0 {
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
		w.h.Follow(p.ID)
		if err := w.h.Join(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	if v := w.h.View(all[50].ID); v.Tables != 2 || len(v.Players) != 1 || !v.In {
		t.Fatalf("the one over: %+v", v)
	}
	w.at(21, 0, 0)
	n := w.h.night
	if len(n.tables) != 2 || n.tables[0].phase != play.RoyalQuestion || n.tables[1].phase != play.RoyalQuestion ||
		n.tables[0].entered != 26 || n.tables[1].entered != 25 {
		t.Fatalf("51 in two of 26 and 25: %+v %+v", n.tables[0], n.tables[1])
	}
	// The database has them so.
	var first, second int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM royal_players WHERE royal_id = ? AND run_id IS NOT NULL`, n.tables[0].id).Scan(&first)
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM royal_players WHERE royal_id = ? AND run_id IS NOT NULL`, n.tables[1].id).Scan(&second)
	if first != 26 || second != 25 {
		t.Fatalf("in the database: %d and %d", first, second)
	}
	// Each at its own pace: once the second's 25 have answered, its answer shows; the first waits for its 26.
	for _, p := range all[26:] {
		w.give(p, true)
	}
	if n.tables[1].phase != play.RoyalReveal || n.tables[0].phase != play.RoyalQuestion {
		t.Fatalf("each at its own pace: %s %s", n.tables[0].phase, n.tables[1].phase)
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
		subs[p.ID] = w.h.Follow(p.ID)
		if err := w.h.Join(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	w.h.Unfollow(subs[bo.ID]) // Bo's phone falls asleep in the lobby
	w.at(21, 0, 0)
	if v := w.h.View(ana.ID); v.Entered != 1 || len(v.Players) != 1 {
		t.Fatalf("Ana alone at the start: %+v", v)
	}
	if v := w.h.View(bo.ID); v.In || !v.Late {
		t.Fatalf("Bo, away: %+v", v)
	}
	w.give(ana, true)
	w.wait(Pause)

	// Vi comes during the second question: the first counts as not answered, the second is hers.
	w.wait(5 * time.Second)
	if err := w.h.Join(ctx, vi); err != nil {
		t.Fatal(err)
	}
	v := w.h.View(vi.ID)
	if !v.In || v.Out || v.Late || v.N != 1 || v.Entered != 2 || v.Question == nil || v.Question.LeftMs != v.Question.LimitMs-5000 {
		t.Fatalf("Vi, late: %+v", v)
	}
	// The answer waits for her too.
	w.give(ana, true)
	if v := w.h.View(ana.ID); v.Phase != play.RoyalQuestion {
		t.Fatalf("the answer showed without waiting for Vi: %+v", v)
	}
	w.give(vi, true)
	if v := w.h.View(vi.ID); v.Phase != play.RoyalReveal || !v.Question.Reveal.Mine || !v.Question.Reveal.Right {
		t.Fatalf("Vi's answer: %+v", v)
	}

	// Bo's screen is back while the second answer shows: he's in, both questions missed.
	w.h.Follow(bo.ID)
	w.h.Step(ctx)
	if v := w.h.View(bo.ID); !v.In || v.Phase != play.RoyalReveal || v.Entered != 3 || v.Question.Reveal.Mine {
		t.Fatalf("Bo, back: %+v", v)
	}
	w.wait(Pause)
	if v := w.h.View(bo.ID); v.Phase != play.RoyalQuestion || v.N != 2 || !v.In {
		t.Fatalf("Bo at the third: %+v", v)
	}
	for _, p := range []Player{ana, bo, vi} {
		w.give(p, true)
	}
	// The third's answer shows: the door is shut.
	if v := w.h.View(zed.ID); v.Phase != play.RoyalReveal || v.Late {
		t.Fatalf("the door after the third: %+v", v)
	}
	if err := w.h.Join(ctx, zed); !errors.Is(err, ErrClosed) {
		t.Fatalf("Zed came in after the third: %v", err)
	}
	if v := w.h.View(ana.ID); v.Players[0].Name != ana.Name || v.Players[0].Reached != 3 || v.Players[1].Reached != 2 ||
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
	sub := w.h.Follow(ana.ID)
	if err := w.h.Join(ctx, ana); err != nil {
		t.Fatal(err)
	}
	w.h.Unfollow(sub)
	w.at(21, 0, 0)
	if v := w.h.View(ana.ID); v.Phase != play.RoyalQuestion || v.In || !v.Late {
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
	sub := w.h.Follow(ana.ID)
	w.h.Follow(bo.ID)
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
	v = w.h.View(bo.ID)
	if v.Phase != play.RoyalReveal || v.Out || v.Left != 2 || v.Last {
		t.Fatalf("after the restart, Bo's answer: %+v", v)
	}
	if p := v.Players; p[0].Name != ana.Name || p[0].Reached != 2 || p[0].Ms != 1000 || p[1].Reached != 1 || p[1].Ms != 2000 {
		t.Fatalf("the standings after a restart: %+v", p)
	}
	// Another restart while the answer shows: the game goes on.
	w.h = NewHub(w.g, Evening)
	if err := w.h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	if v := w.h.View(ana.ID); v.Phase != play.RoyalReveal || v.Left != 2 || v.Players[1].Ms != 2000 {
		t.Fatalf("the answer showing, after a restart: %+v", v)
	}
	w.onward()
	if v := w.h.View(ana.ID); v.Phase != play.RoyalQuestion || v.N != 2 {
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
	v := w.h.View(vi.ID)
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
	v := w.h.View(vi.ID)
	if v.Phase != play.RoyalReveal || v.Out || v.WentOut != 1 || v.Players[0].Name != bo.Name || v.Players[1].Name != vi.Name {
		t.Fatalf("Ana a right answer behind, out: %+v", v)
	}
	if v := w.h.View(ana.ID); !v.Out {
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
		if v := w.h.View(ana.ID); v.Phase != play.RoyalReveal || v.Out || v.Cut != nil || v.Last != (n == 14) {
			t.Fatalf("question %d, alone: %+v", n+1, v)
		}
	}
	w.wait(Pause)
	if v := w.h.View(ana.ID); v.Phase != play.RoyalEnd || v.Place != 1 || v.Entered != 1 || v.Players[0].Reached != 8 {
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
		if v := w.h.View(ana.ID); v.Phase != play.RoyalQuestion || v.N != n || v.Cut != nil {
			t.Fatalf("question %d of two: %+v %+v", n+1, v, v.Cut)
		}
		w.give(ana, true)
		w.give(bo, false)
	}
	if v := w.h.View(bo.ID); v.Out || v.WentOut != 0 || w.h.pause(w.h.night.tables[0]) != Pause {
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
	for v := w.h.View(ana.ID); v.Phase != play.RoyalEnd; v = w.h.View(ana.ID) {
		w.wait(time.Minute)
	}
	if w.h.Near(lead) {
		t.Fatalf("near once over, at %s", w.now.In(play.Bulgaria).Format(time.TimeOnly))
	}
	// An evening nobody came to is over at its start.
	w.now = w.now.Add(23 * time.Hour)
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

	w.h = NewHub(w.g, Evening)
	if err := w.h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	w.h.Step(ctx)
	v := w.h.View(bo.ID)
	if v.Phase != play.RoyalQuestion || v.N != 5 || !v.In || !v.Out || v.Rights != 4 || !v.Players[2].Answered ||
		v.Players[0].Reached != 5 || v.Left != 2 {
		t.Fatalf("Bo after the restart: %+v", v)
	}
	w.give(vi, true)
	v = w.h.View(bo.ID)
	if v.Phase != play.RoyalReveal || !v.Question.Reveal.Mine || v.Rights != 5 || v.Cut != nil {
		t.Fatalf("question 6 after the restart: %+v", v)
	}
	if p := v.Players; p[2].Name != bo.Name || p[2].Reached != 4 || p[2].OutAt != 4 {
		t.Fatalf("Bo's standing after the restart: %+v", p)
	}
}
