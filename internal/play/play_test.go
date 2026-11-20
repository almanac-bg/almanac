package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
	"github.com/almanac-bg/almanac/internal/store/storetest"
)

type world struct {
	t   *testing.T
	g   *Game
	db  *store.DB
	b   *bank.Bank
	now time.Time
	// clock guards now where the game's background work reads it (a game's follow-up) while a test moves it on (wait).
	clock sync.Mutex
	next  int64
	// pace, if set, is how long a player takes over question n (three seconds otherwise).
	pace func(n int) time.Duration
	// inPlay is the bank the game plays, swapped as the server swaps it on a reload (one atomic pointer): a test puts
	// a bank in play with use or swap, never by setting Game.Bank while the game's background work may read it.
	inPlay atomic.Pointer[bank.Bank]
}

func setup(t *testing.T) *world {
	t.Helper()
	db := storetest.Open(t)
	// Its own bank, not banktest.Sample: these tests change questions (retire them, date them).
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	w := &world{t: t, db: db, now: time.Date(2026, 11, 12, 10, 0, 0, 0, Bulgaria)}
	w.use(b)
	w.g = w.newGame()
	return w
}

// newGame is a game on the world's database, bank in play and clock, as a server (or one started again) makes it. Its
// background work (the follow-ups of runs, the counts) is waited for as the test ends, before its database closes:
// none writes into a database, or a folder, that is going away.
func (w *world) newGame() *Game {
	g := &Game{DB: w.db, Bank: w.inPlay.Load, Now: func() time.Time {
		w.clock.Lock()
		defer w.clock.Unlock()
		return w.now
	}}
	w.t.Cleanup(func() { g.Settled(context.Background()) })
	return g
}

// use makes b the world's bank (w.b) and puts it in play.
func (w *world) use(b *bank.Bank) {
	w.b = b
	w.swap(b)
}

// swap puts b in play, w.b left as it was.
func (w *world) swap(b *bank.Bank) { w.inPlay.Store(b) }

func (w *world) user() int64 {
	w.t.Helper()
	w.next++
	res, err := w.db.Write.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES (?, ?, 0, 0)`,
		"Играч", fmt.Sprintf("player%d", w.next))
	if err != nil {
		w.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

// pastLimit is a wait past any question's time, its grace for a late answer too: the longest limit is a minute (an
// order or a match), so a minute's wait is no time run out.
const pastLimit = LongestLimit + LateGrace + time.Second

func (w *world) wait(d time.Duration) {
	w.clock.Lock()
	defer w.clock.Unlock()
	w.now = w.now.Add(d)
}

// picks are a run's questions, as stored.
func (w *world) picks(runID int64) []Pick {
	var s string
	_ = w.db.Read.QueryRow(`SELECT questions FROM runs WHERE id = ?`, runID).Scan(&s)
	var p []Pick
	_ = json.Unmarshal([]byte(s), &p)
	return p
}

// right is the right answer to a run's question n, as the player would give it.
func (w *world) right(runID int64, n int) json.RawMessage {
	p := w.picks(runID)[n]
	q, _ := w.b.Get(p.ID)
	reveal, _ := json.Marshal(q.Deal(p.Seed).Reveal(nil))
	var r struct {
		Pick  *int     `json:"pick"`
		Value *float64 `json:"value"`
		Order []int    `json:"order"`
		Truth *bool    `json:"truth"`
		Pairs []int    `json:"pairs"`
		Sides []int    `json:"sides"`
	}
	_ = json.Unmarshal(reveal, &r)
	var a any
	switch {
	case r.Pick != nil:
		a = map[string]int{"pick": *r.Pick}
	case r.Value != nil:
		a = map[string]float64{"value": *r.Value}
	case r.Truth != nil:
		a = map[string]bool{"truth": *r.Truth}
	case r.Sides != nil:
		a = map[string][]int{"sides": r.Sides}
	case r.Pairs != nil:
		a = map[string][]int{"pairs": r.Pairs}
	default:
		a = map[string][]int{"order": r.Order}
	}
	out, _ := json.Marshal(a)
	return out
}

// wrong is a wrong answer to it (a choice's other option, a number far off, the other of true or not, every pair of
// a match joined one along, every item of a split sent the other way, an order backwards).
func (w *world) wrong(runID int64, n int) json.RawMessage {
	var r map[string]any
	_ = json.Unmarshal(w.right(runID, n), &r)
	switch {
	case r["pick"] != nil:
		r["pick"] = (int(r["pick"].(float64)) + 1) % bank.ChoiceOptions
	case r["value"] != nil:
		p := w.picks(runID)[n]
		q, _ := w.b.Get(p.ID)
		num := q.(*bank.Number)
		r["value"] = num.Answer + 10*num.Tolerance*num.Answer // far off on either scale
	case r["truth"] != nil:
		r["truth"] = !r["truth"].(bool)
	case r["sides"] != nil:
		sides := r["sides"].([]any)
		for i, v := range sides {
			sides[i] = 1 - int(v.(float64))
		}
	case r["pairs"] != nil:
		p := r["pairs"].([]any)
		r["pairs"] = append(p[1:], p[0])
	default:
		o := r["order"].([]any)
		for i, j := 0, len(o)-1; i < j; i, j = i+1, j-1 {
			o[i], o[j] = o[j], o[i]
		}
	}
	out, _ := json.Marshal(r)
	return out
}

func (w *world) play(user, runID int64, answers ...func(int64, int) json.RawMessage) State {
	w.t.Helper()
	var s State
	for n, answer := range answers {
		w.show(user, runID)
		if w.pace != nil {
			w.wait(w.pace(n))
		} else {
			w.wait(3 * time.Second)
		}
		res, err := w.answer(user, runID, n, answer(runID, n))
		if err != nil {
			w.t.Fatalf("answer %d: %v", n, err)
		}
		s = res.State
	}
	return s
}

// show shows a run's next question and starts its time, its pictures in at once if it has any, as a screen does.
func (w *world) show(user, runID int64) State {
	w.t.Helper()
	ctx := w.t.Context()
	defer w.g.AftersDone(ctx) // a run its clock ended
	s, err := w.g.Show(ctx, user, runID)
	if err == nil && s.Question != nil && s.Question.StartsMs > 0 {
		s, err = w.g.Start(ctx, user, runID, s.Question.N)
	}
	if err != nil {
		w.t.Fatal(err)
	}
	return s
}

// answer answers a run's question n now, as its player does. What follows a run it ends is done when it returns
// (after.go: in the background), as a test reads it next.
func (w *world) answer(user, runID int64, n int, a json.RawMessage) (Result, error) {
	defer w.g.AftersDone(w.t.Context())
	return w.g.Answer(w.t.Context(), user, runID, n, a)
}

// crowd is how players have answered a question as the bank has it, as last counted.
func (w *world) crowd(id string) *bank.Crowd {
	w.t.Helper()
	q, ok := w.b.Get(id)
	if !ok {
		w.t.Fatal("no question", id)
	}
	return w.g.Crowd(q)
}

func repeat(f func(int64, int) json.RawMessage, n int) []func(int64, int) json.RawMessage {
	out := make([]func(int64, int) json.RawMessage, n)
	for i := range out {
		out[i] = f
	}
	return out
}

func TestTheDay(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	s, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := w.g.StartDay(ctx, ana); again.ID != s.ID {
		t.Fatal("a second run of the same day")
	}
	if s.Total != Length || s.Day != "2026-11-12" {
		t.Fatalf("the day: %+v", s)
	}
	picks := w.picks(s.ID)
	topics := map[string]bool{}
	types := map[string]bank.Difficulty{}
	for i, p := range picks {
		q, _ := w.b.Get(p.ID)
		topics[q.Base().Category] = true
		types[q.Base().Type] = daySlots[i].difficulty // where in the day it is: its places are drawn within their band
	}
	if types["order"] != bank.Medium || types["number"] != bank.Hard {
		t.Errorf("the day's order and number are in the %q and %q places", types["order"], types["number"])
	}
	if len(topics) != Length {
		t.Errorf("the day's questions come from %d topics", len(topics))
	}
	other, _ := w.g.StartDay(ctx, bo)
	if p := w.picks(other.ID); p[0] != picks[0] || p[9] != picks[9] {
		t.Fatal("two players got different days")
	}

	// Tomorrow's questions are new ones.
	w.wait(24 * time.Hour)
	tomorrow, _ := w.g.StartDay(ctx, ana)
	for _, p := range w.picks(tomorrow.ID) {
		for _, old := range picks {
			if p.ID == old.ID {
				t.Fatalf("%s again the next day", p.ID)
			}
		}
	}
}

// A question that belongs to the day is „На този ден“ in the day's ten, its day's line in the answer (and the review),
// never before; the same question in a topic's game, or on another day, has neither.
func TestOnThisDay(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	const line = "На 12 ноември 1982 г. се случва нещо."
	dayOf := func(r any) string {
		var v struct{ Day string }
		raw, _ := json.Marshal(r)
		_ = json.Unmarshal(raw, &v)
		return v.Day
	}
	// answer shows run's question n, says whether it's „На този ден“, and answers it: what its answer shows.
	answer := func(runID int64, n int) (bool, Result) {
		shown, err := w.g.Show(ctx, u, runID)
		if err != nil || shown.Question == nil {
			t.Fatalf("showing %d: %v", n, err)
		}
		if v, _ := json.Marshal(shown.Question.View); strings.Contains(string(v), line) {
			t.Fatal("the day's line shows before the answer")
		}
		if _, err := w.g.Start(ctx, u, runID, n); err != nil {
			t.Fatal(err)
		}
		w.wait(3 * time.Second)
		res, err := w.g.Answer(ctx, u, runID, n, w.right(runID, n))
		if err != nil {
			t.Fatal(err)
		}
		return shown.Question.OnThisDay, res
	}
	date := func(q bank.Question, on string) { q.Extra().On, q.Extra().Day = []string{on}, line }

	s, _ := w.g.StartDay(ctx, u)
	picks := w.picks(s.ID)
	first, _ := w.b.Get(picks[0].ID)
	second, _ := w.b.Get(picks[1].ID)
	date(first, "11-12")  // today
	date(second, "11-13") // tomorrow
	if on, res := answer(s.ID, 0); !on || dayOf(res.Reveal) != line {
		t.Errorf("the day's own question: on this day %v, its line %q", on, dayOf(res.Reveal))
	}
	if on, res := answer(s.ID, 1); on || dayOf(res.Reveal) != "" {
		t.Errorf("another day's question: on this day %v, its line %q", on, dayOf(res.Reveal))
	}
	for n := 2; n < Length; n++ {
		answer(s.ID, n)
	}
	review, err := w.g.Review(ctx, u, s.ID)
	if err != nil || len(review) != Length {
		t.Fatal(err)
	}
	if dayOf(review[0].Reveal) != line || dayOf(review[1].Reveal) != "" {
		t.Errorf("the review: %q, %q", dayOf(review[0].Reveal), dayOf(review[1].Reveal))
	}

	// A topic's game, today: the question it deals is no day's.
	topic, _ := w.g.StartTopic(ctx, u, MixTopic)
	q, _ := w.b.Get(w.picks(topic.ID)[0].ID)
	date(q, "11-12")
	if on, res := answer(topic.ID, 0); on || dayOf(res.Reveal) != "" {
		t.Errorf("a topic's game: on this day %v, its line %q", on, dayOf(res.Reveal))
	}
}

// A game is gone over on the day it ended (one ended just before midnight, right after it too), never days later.
func TestReviewOnItsDay(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	w.at(15, 23, 50, 0)
	s, err := w.g.StartTopic(ctx, ana, "history")
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, repeat(w.right, len(w.picks(s.ID)))...)
	if r, err := w.g.Review(ctx, ana, s.ID); err != nil || len(r) == 0 {
		t.Fatalf("right after it: %d, %v", len(r), err)
	}
	w.at(16, 0, 1, 0)
	if _, err := w.g.Review(ctx, ana, s.ID); err != nil {
		t.Fatalf("just after midnight: %v", err)
	}
	w.at(16, 12, 0, 0)
	if _, err := w.g.Review(ctx, ana, s.ID); !errors.Is(err, ErrReviewOver) {
		t.Fatalf("the day after: %v", err)
	}
}

func TestQuestionTime(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	s, _ := w.g.StartDay(ctx, u)
	if _, err := w.g.Answer(ctx, u, s.ID, 0, w.right(s.ID, 0)); !errors.Is(err, ErrOutOfStep) {
		t.Fatalf("answered before the question was shown: %v", err)
	}
	shown, _ := w.g.Show(ctx, u, s.ID)
	if shown.Question == nil || shown.Question.LeftMs != shown.Question.LimitMs {
		t.Fatalf("shown: %+v", shown.Question)
	}
	if v, _ := json.Marshal(shown.Question.View); string(v) == "" || json.Valid(v) == false {
		t.Fatal("no view")
	}
	// Showing it again (a refresh) doesn't give more time.
	w.wait(5 * time.Second)
	again, _ := w.g.Show(ctx, u, s.ID)
	if again.Question.LeftMs != again.Question.LimitMs-5000 {
		t.Fatalf("after 5 s a refresh shows %d ms left of %d", again.Question.LeftMs, again.Question.LimitMs)
	}
	if _, err := w.g.Answer(ctx, u, s.ID, 1, w.right(s.ID, 0)); !errors.Is(err, ErrOutOfStep) {
		t.Fatalf("answered the wrong question: %v", err)
	}
	if _, err := w.g.Answer(ctx, u, s.ID, 0, json.RawMessage(`{"pick":9,"value":"x"}`)); !errors.Is(err, ErrBadAnswer) {
		t.Fatalf("a broken answer: %v", err)
	}
	res, err := w.g.Answer(ctx, u, s.ID, 0, w.right(s.ID, 0))
	if err != nil || res.Score != 1 || !res.Right || res.State.At != 1 || res.State.Rights != 1 || res.Reveal == nil {
		t.Fatalf("the right answer: %+v %v", res, err)
	}

	// Left showing past its time: unanswered, as soon as anyone looks.
	_, _ = w.g.Show(ctx, u, s.ID)
	w.wait(pastLimit)
	st, _ := w.g.State(ctx, u, s.ID)
	if st.At != 2 || st.Question != nil || len(st.Trail) != 2 || st.Trail[1].Right || st.Trail[1].Close {
		t.Fatalf("after its time ran out: %+v", st)
	}

	// An answer a little late (within the grace) counts; one later doesn't.
	_, _ = w.g.Show(ctx, u, s.ID)
	w.wait(Limit(w.question(s.ID, 2)) + Grace/2)
	if res, _ := w.g.Answer(ctx, u, s.ID, 2, w.right(s.ID, 2)); res.TimedOut || !res.Right {
		t.Fatalf("an answer within the grace: %+v", res)
	}

	// Another player's run is as good as missing.
	if _, err := w.g.State(ctx, w.user(), s.ID); !errors.Is(err, ErrNoRun) {
		t.Fatalf("someone else's run: %v", err)
	}
}

// An answer sent again, its reply lost on the way, gets what it got the first time and changes nothing: the screen
// shows its verdict, never skips it. A question whose time ran out meanwhile gives that; only the last answered does.
func TestAnswerAgain(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	s, _ := w.g.StartDay(ctx, u)
	answer := func(n int, a json.RawMessage) (Result, error) {
		if _, err := w.g.Show(ctx, u, s.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := w.g.Start(ctx, u, s.ID, n); err != nil {
			t.Fatal(err)
		}
		w.wait(3 * time.Second)
		return w.g.Answer(ctx, u, s.ID, n, a)
	}
	plain := func(r Result) string {
		r.Reveal = nil
		out, _ := json.Marshal(r)
		return string(out)
	}
	// Two right in a row: the second makes a row, and again too.
	if _, err := answer(0, w.right(s.ID, 0)); err != nil {
		t.Fatal(err)
	}
	first, err := answer(1, w.right(s.ID, 1))
	if err != nil || !first.Right || first.InRow != 2 {
		t.Fatalf("the first time: %+v %v", first, err)
	}
	w.wait(5 * time.Second)
	again, err := w.g.Answer(ctx, u, s.ID, 1, w.wrong(s.ID, 1)) // what's sent again changes nothing either
	if err != nil || again.Reveal == nil || plain(again) != plain(first) {
		t.Fatalf("sent again:\n%s\n%s\n%v", plain(again), plain(first), err)
	}
	st, _ := w.g.State(ctx, u, s.ID)
	if st.At != 2 || st.Rights != first.State.Rights || len(st.Trail) != 2 {
		t.Fatalf("the run after an answer sent again: %+v", st)
	}
	// Only the last answered: one before it is out of step, as is one not shown yet.
	if _, err := w.g.Answer(ctx, u, s.ID, 0, w.right(s.ID, 0)); !errors.Is(err, ErrOutOfStep) {
		t.Fatalf("an older answer sent again: %v", err)
	}
	// The next question shown meanwhile (another tab): the answer before it still gets its own, and the run's
	// question showing is in its state.
	if _, err := w.g.Show(ctx, u, s.ID); err != nil {
		t.Fatal(err)
	}
	if again, err := w.g.Answer(ctx, u, s.ID, 1, w.right(s.ID, 1)); err != nil || again.Right != first.Right ||
		again.State.Question == nil || again.State.Question.N != 2 {
		t.Fatalf("sent again with the next question showing: %+v %v", again, err)
	}
	// A question whose time ran out: sent after it did, the answer is that.
	w.wait(pastLimit)
	if _, err := w.g.State(ctx, u, s.ID); err != nil {
		t.Fatal(err)
	}
	if late, err := w.g.Answer(ctx, u, s.ID, 2, w.right(s.ID, 2)); err != nil || !late.TimedOut || late.Score != 0 ||
		late.Right {
		t.Fatalf("an answer after its time ran out: %+v %v", late, err)
	}
	// The last answer of the run, sent again: the run as it ended, ended once.
	var last Result
	for n := 3; n < Length; n++ {
		if last, err = answer(n, w.right(s.ID, n)); err != nil {
			t.Fatal(err)
		}
	}
	ended := func() (rights int, at int64) {
		_ = w.db.Read.QueryRow(`SELECT rights, finished_at FROM runs WHERE id = ?`, s.ID).Scan(&rights, &at)
		return rights, at
	}
	rights, at := ended()
	w.wait(time.Second)
	again, err = w.g.Answer(ctx, u, s.ID, Length-1, w.right(s.ID, Length-1))
	if p, a := ended(); err != nil || !again.State.Done || plain(again) != plain(last) || p != rights || a != at {
		t.Fatalf("the last answer sent again: %+v %v (rights %d at %d, were %d at %d)", again, err, p, a, rights, at)
	}
}

// A question with a picture waits for it: its time starts once the player's screen has it in, or PictureWait after
// it's shown at the latest. Until then the screen has its pictures only, and an answer is refused: nobody reads it, nor
// answers it, off the clock.
func TestPictureTime(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	s, _ := w.g.StartDay(ctx, u)
	picks := w.picks(s.ID)
	for i, id := range []string{"geo-901", "geo-902", "geo-903"} {
		picks[i] = Pick{ID: id, Seed: picks[i].Seed} // another question: none of the day's version
	}
	raw, _ := json.Marshal(picks)
	if _, err := w.db.Write.Exec(`UPDATE runs SET questions = ? WHERE id = ?`, string(raw), s.ID); err != nil {
		t.Fatal(err)
	}
	if q, _ := w.b.Get("geo-901"); !bank.HasPictures(q) {
		t.Fatal("geo-901 has no picture")
	}

	// Shown, waiting: the full time, and when it starts by itself; its picture to load, and not a word of it.
	shown, _ := w.g.Show(ctx, u, s.ID)
	if q := shown.Question; q == nil || q.LeftMs != q.LimitMs || q.StartsMs != PictureWait.Milliseconds() {
		t.Fatalf("shown, waiting for its picture: %+v", q)
	}
	waiting, _ := json.Marshal(shown.Question.View)
	var seen map[string]any
	_ = json.Unmarshal(waiting, &seen)
	if img, _ := seen["image"].(map[string]any); img == nil || img["src"] == "" || img["alt"] != "" ||
		seen["type"] != "choice" || seen["text"] != nil || seen["choices"] != nil {
		t.Fatalf("what a screen has of a question waiting for its picture: %s", waiting)
	}
	if st, _ := w.g.State(ctx, u, s.ID); !reflect.DeepEqual(st.Question.View, shown.Question.View) {
		t.Fatalf("a look at the run while it waits: %+v", st.Question.View)
	}
	w.wait(2 * time.Second) // the picture loading
	// Answered before its time runs (a screen that skipped Start): refused, never a 0 ms answer.
	if _, err := w.g.Answer(ctx, u, s.ID, 0, w.right(s.ID, 0)); !errors.Is(err, ErrOutOfStep) {
		t.Fatalf("answered while it waits for its picture: %v", err)
	}
	if again, _ := w.g.Show(ctx, u, s.ID); again.Question.LeftMs != again.Question.LimitMs || again.Question.StartsMs != 6000 {
		t.Fatalf("a refresh while it waits: %+v", again.Question)
	}
	if st, _ := w.g.Start(ctx, u, s.ID, 1); st.Question.StartsMs == 0 {
		t.Fatal("another question's start started this one")
	}
	started, _ := w.g.Start(ctx, u, s.ID, 0)
	if q := started.Question; q.StartsMs != 0 || q.LeftMs != q.LimitMs {
		t.Fatalf("started: %+v", q)
	}
	if v, _ := json.Marshal(started.Question.View); !strings.Contains(string(v), `"choices"`) || !strings.Contains(string(v), `"alt":"Знаме`) {
		t.Fatalf("started, without its words: %s", v)
	}
	w.wait(time.Second)
	if again, _ := w.g.Start(ctx, u, s.ID, 0); again.Question.LeftMs != again.Question.LimitMs-1000 {
		t.Fatalf("started twice: %+v", again.Question)
	}
	w.wait(5 * time.Second)
	res, err := w.g.Answer(ctx, u, s.ID, 0, w.right(s.ID, 0))
	if err != nil || !res.Right || w.count(`SELECT ms FROM answers WHERE run_id = ? AND n = 0`, s.ID) != 6000 {
		t.Fatalf("answered 6 s after it started: %+v %v", res, err)
	}

	// Never started by the screen: it starts by itself, PictureWait after it's shown.
	_, _ = w.g.Show(ctx, u, s.ID)
	w.wait(PictureWait + Limit(w.question(s.ID, 1)))
	if st, _ := w.g.State(ctx, u, s.ID); st.At != 1 || st.Question == nil || st.Question.LeftMs != 0 ||
		!strings.Contains(fmt.Sprint(st.Question.View), "Чие") {
		t.Fatalf("its time, after it started by itself: %+v", st.Question)
	}
	w.wait(LateGrace + time.Second) // an answer timed in time by the screen may still come until then
	if st, _ := w.g.State(ctx, u, s.ID); st.At != 2 {
		t.Fatalf("not out of time after PictureWait and its time: %+v", st)
	}
}

func (w *world) question(runID int64, n int) bank.Question {
	q, _ := w.b.Get(w.picks(runID)[n].ID)
	return q
}

func TestBoardAndStreak(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi := w.user(), w.user(), w.user()
	for _, p := range []struct {
		user  int64
		right int
	}{{ana, 7}, {bo, 10}, {vi, 3}} {
		s, _ := w.g.StartDay(ctx, p.user)
		answers := append(repeat(w.right, p.right), repeat(w.wrong, Length-p.right)...)
		if end := w.play(p.user, s.ID, answers...); !end.Done || end.Rights != p.right {
			t.Fatalf("finished %+v, want %d right", end, p.right)
		}
	}
	b, err := w.g.BoardOf(ctx, "2026-11-12", ana)
	if err != nil {
		t.Fatal(err)
	}
	if b.Players != 3 || b.Place != 2 || b.Top[0].Rights != 10 || !b.Top[1].Me || b.Mine.Rights != 7 {
		t.Fatalf("board %+v", b)
	}
	if n, _ := w.g.Streak(ctx, ana); n != 1 {
		t.Fatalf("streak %d after one day", n)
	}
	thursday := [7]bool{3: true} // 2026-11-12, Monday first
	if week, _ := w.g.Week(ctx, ana); week != thursday {
		t.Fatalf("week %v after Thursday", week)
	}
	w.wait(24 * time.Hour)
	if n, _ := w.g.Streak(ctx, ana); n != 1 {
		t.Fatalf("streak %d the next morning, before playing", n)
	}
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	if n, _ := w.g.Streak(ctx, ana); n != 2 {
		t.Fatalf("streak %d after two days", n)
	}
	w.wait(48 * time.Hour)
	if n, _ := w.g.Streak(ctx, ana); n != 2 {
		t.Fatalf("streak %d after missing a day, which the week forgives", n)
	}
	if week, _ := w.g.Week(ctx, ana); week != [7]bool{3: true, 4: true} {
		t.Fatalf("week %v on Sunday, after Thursday and Friday", week)
	}
	w.wait(24 * time.Hour)
	if week, _ := w.g.Week(ctx, ana); week != [7]bool{} {
		t.Fatalf("week %v on a new Monday", week)
	}
	if n, _ := w.g.Streak(ctx, ana); n != 2 {
		t.Fatalf("streak %d after missing two days in a week, both forgiven", n)
	}
}

// The streak forgives two days missed in a week, Monday to Sunday, by itself; a third that week ends it. Four days
// missed in a row are forgiven only across a week's turn.
func TestStreakForgives(t *testing.T) {
	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	ana := w.user()
	streak := func(what string, days int, forgiven []string, spare bool) StreakNow {
		t.Helper()
		s, err := w.g.StreakOf(ctx, ana)
		if err != nil || s.Days != days || !slices.Equal(s.Forgiven, forgiven) || s.Spare != spare {
			t.Fatalf("%s: %+v; want %d days, forgiven %v, spare %v (%v)", what, s, days, forgiven, spare, err)
		}
		return s
	}
	streak("before the first day", 0, []string{}, true)
	w.playDay(ana)
	w.wait(24 * time.Hour)
	w.playDay(ana)
	streak("Friday, the second day", 2, []string{}, true)
	w.wait(48 * time.Hour) // Saturday missed: one of this week's two forgiven
	s := streak("Sunday, before playing", 2, []string{"2026-11-14"}, true)
	if s.PerWeek != Forgives || s.Left != 1 {
		t.Fatalf("Sunday, the week's forgiving: %+v", s)
	}
	if week := w.g.InWeek([]string{"2026-11-14"}); week != [7]bool{5: true} {
		t.Fatalf("the day forgiven on the week's strip: %v", week)
	}
	w.playDay(ana)
	streak("Sunday, the third day", 3, []string{"2026-11-14"}, true)
	w.wait(24 * time.Hour) // Monday: a new week, with its own two to forgive
	streak("Monday, before playing", 3, []string{"2026-11-14"}, true)
	w.wait(48 * time.Hour) // Monday and Tuesday missed, both forgiven
	s = streak("Wednesday, before playing", 3, []string{"2026-11-14", "2026-11-16", "2026-11-17"}, false)
	if s.Ended != nil || s.Best != 3 || s.Left != 0 {
		t.Fatalf("still going: %+v", s)
	}
	w.wait(24 * time.Hour) // Wednesday missed too: the week's third, which ends it
	s = streak("Thursday", 0, []string{}, false)
	if s.Ended == nil || *s.Ended != (Ended{Days: 3, On: "2026-11-18"}) || s.Best != 3 {
		t.Fatalf("ended: %+v", s)
	}
	// A Saturday and Sunday, then the Monday and Tuesday after: each two their own week's.
	bo := w.user()
	w.daysPlayed(bo, 8, 7, 6, 1) // Wednesday to Friday, then yesterday (Wednesday): four days forgiven
	if s, _ := w.g.StreakOf(ctx, bo); s.Days != 4 ||
		!slices.Equal(s.Forgiven, []string{"2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"}) {
		t.Fatalf("across a week's turn: %+v", s)
	}
	// The ended streak's days are never said: its day only.
	if out, _ := json.Marshal(StreakNow{Ended: &Ended{Days: 3, On: "2026-11-18"}}); !strings.Contains(string(out),
		`"ended":{"on":"2026-11-18"}`) {
		t.Fatalf("an ended streak's number said: %s", out)
	}
}

// A tenth of the players who come in during the hold-out's window (StreakHoldout) get one forgiven day a week while
// it lasts, by a bucket of their own; from its end, two, as everyone.
func TestStreakHoldout(t *testing.T) {
	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	for _, q := range []string{
		`INSERT OR REPLACE INTO kv (key, value) VALUES ('streak_forgives_from', '2026-11-01')`,
		`INSERT OR REPLACE INTO kv (key, value) VALUES ('streak_forgives_until', '2026-11-20')`,
	} {
		if _, err := w.db.Write.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	var held, free int64
	for held == 0 || free == 0 {
		id := w.user()
		if _, err := w.db.Write.Exec(`UPDATE users SET created_at = ? WHERE id = ?`,
			time.Date(2026, 11, 10, 12, 0, 0, 0, Bulgaria).UnixMilli(), id); err != nil {
			t.Fatal(err)
		}
		switch {
		case HeldOut(StreakHoldout, id) && held == 0:
			held = id
		case !HeldOut(StreakHoldout, id) && free == 0:
			free = id
		}
	}
	if Bucket(StreakHoldout, held) == Bucket(HeldReminders, held) && Bucket(StreakHoldout, free) == Bucket(HeldReminders, free) {
		t.Fatal("the streak's buckets are the reminders'")
	}
	// Tuesday and Wednesday played; Thursday's today. Saturday and Sunday missed by both.
	w.daysPlayed(held, 2, 1)
	w.daysPlayed(free, 2, 1)
	w.playDay(held)
	w.playDay(free)
	w.wait(72 * time.Hour) // Sunday: Friday and Saturday missed
	if s, _ := w.g.StreakOf(ctx, held); s.Days != 0 || s.PerWeek != HeldForgives || s.Ended == nil {
		t.Fatalf("held out, two missed: %+v", s)
	}
	if s, _ := w.g.StreakOf(ctx, free); s.Days != 3 || s.PerWeek != Forgives || len(s.Forgiven) != 2 {
		t.Fatalf("not held out, two missed: %+v", s)
	}
	// Past the window: two for everyone.
	w.wait(7 * 24 * time.Hour)
	if s, _ := w.g.StreakOf(ctx, held); s.PerWeek != Forgives {
		t.Fatalf("held out, after the window: %+v", s)
	}
	// One who came in before the window is never held.
	old := w.user()
	for HeldOut(StreakHoldout, old) == false {
		old = w.user()
	}
	if until, _ := w.g.heldUntil(ctx, old); until != "" {
		t.Fatalf("a player from before the window held: %q", until)
	}
}

// The days missed before the rule came in stay as the reserve days of then judged them (streak_missed): one kept is
// its week's day forgiven, two kept in a week both hold, and one that ended a streak isn't won back.
func TestStreakAsJudgedBefore(t *testing.T) {
	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	judged := func(user int64, day string, kept bool) {
		t.Helper()
		if _, err := w.db.Write.Exec(`INSERT INTO streak_missed (user_id, day, kept) VALUES (?, ?, ?)`, user, day, kept); err != nil {
			t.Fatal(err)
		}
	}
	w.daysPlayed(ana, 3, 1)          // Monday and Wednesday, 9 and 11 November
	judged(ana, "2026-11-10", false) // Tuesday ended her streak, though the week had a day to forgive
	w.daysPlayed(bo, 4, 1)           // Sunday and Wednesday
	judged(bo, "2026-11-09", true)   // Monday and Tuesday were kept by reserve days
	judged(bo, "2026-11-10", true)
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 1 || s.Ended == nil || s.Ended.On != "2026-11-10" || s.Best != 1 {
		t.Fatalf("a streak ended before: %+v", s)
	}
	s, _ := w.g.StreakOf(ctx, bo)
	if s.Days != 2 || !slices.Equal(s.Forgiven, []string{"2026-11-09", "2026-11-10"}) || s.Spare {
		t.Fatalf("two kept in a week: %+v", s)
	}
	w.wait(48 * time.Hour) // Thursday missed: the week has had its day forgiven
	if s, _ := w.g.StreakOf(ctx, bo); s.Days != 0 || s.Ended == nil || s.Ended.On != "2026-11-12" {
		t.Fatalf("a day missed after the kept ones: %+v", s)
	}
}

func TestTopics(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	if _, err := w.g.StartTopic(ctx, u, "astrology"); !errors.Is(err, ErrNoTopic) {
		t.Fatalf("an unknown topic: %v", err)
	}
	first, err := w.g.StartTopic(ctx, u, "history")
	if err != nil {
		t.Fatal(err)
	}
	w.play(u, first.ID, repeat(w.right, Length)...)
	firstPicks := map[string]bool{}
	for _, p := range w.picks(first.ID) {
		if q, _ := w.b.Get(p.ID); q.Base().Category != "history" {
			t.Fatalf("%s in a history run", p.ID)
		}
		firstPicks[p.ID] = true
	}
	// The next run starts with what the player hasn't seen (and isn't today's).
	second, _ := w.g.StartTopic(ctx, u, "history")
	today, _ := w.g.DayQuestions(ctx)
	unseen := 0
	for _, q := range w.b.Live("history", "") {
		if !firstPicks[q.Base().ID] && !today[q.Base().ID] {
			unseen++
		}
	}
	fresh := 0
	for _, p := range w.picks(second.ID) {
		if !firstPicks[p.ID] {
			fresh++
		}
	}
	if fresh < min(unseen, Length) {
		t.Fatalf("%d fresh questions of %d unseen", fresh, unseen)
	}
	mix, err := w.g.StartTopic(ctx, u, MixTopic)
	if err != nil || mix.Total != Length {
		t.Fatalf("„Микс“: %+v %v", mix, err)
	}
}

func TestTopicLeftHalfWay(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	first, _ := w.g.StartTopic(ctx, u, "history")
	w.play(u, first.ID, w.right, w.wrong, w.right)
	// Left with the fourth showing, and back once its time is up: the same run, the fourth counted unanswered, the
	// fifth next.
	if _, err := w.g.Show(ctx, u, first.ID); err != nil {
		t.Fatal(err)
	}
	w.wait(pastLimit)
	back, err := w.g.StartTopic(ctx, u, "history")
	if err != nil || back.ID != first.ID || back.At != 4 || len(back.Trail) != 4 || back.Question != nil {
		t.Fatalf("back to the topic: %+v %v", back, err)
	}
	if m := back.Trail[3]; m.Right || m.Close {
		t.Fatalf("the question left showing: %+v", m)
	}
	// Another topic is a run of its own, and so is „Микс“.
	if other, _ := w.g.StartTopic(ctx, u, "science"); other.ID == first.ID {
		t.Fatal("another topic went on with history's run")
	}
	mix, _ := w.g.StartTopic(ctx, u, MixTopic)
	if mix.ID == first.ID {
		t.Fatal("„Микс“ went on with history's run")
	}
	// The games left, to come back to: each topic's latest, the latest first; one with its question showing is open.
	if _, err := w.g.Show(ctx, u, mix.ID); err != nil {
		t.Fatal(err)
	}
	left, err := w.g.Left(ctx, u)
	if err != nil || len(left) != 3 {
		t.Fatalf("left: %+v %v", left, err)
	}
	if l := left[0]; l.ID != mix.ID || l.Category != MixTopic || l.At != 0 || l.Total != Length || !l.Open {
		t.Errorf("„Микс“, left: %+v", l)
	}
	if l := left[2]; l.ID != first.ID || l.Category != "history" || l.At != 4 || l.Open {
		t.Errorf("history, left: %+v", l)
	}
	// Finished, the next is new.
	for n := 4; n < Length; n++ {
		if _, err := w.g.Show(ctx, u, first.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := w.g.Start(ctx, u, first.ID, n); err != nil {
			t.Fatal(err)
		}
		if _, err := w.g.Answer(ctx, u, first.ID, n, w.right(first.ID, n)); err != nil {
			t.Fatalf("answer %d: %v", n, err)
		}
	}
	if again, _ := w.g.StartTopic(ctx, u, "history"); again.ID == first.ID || again.At != 0 {
		t.Fatalf("after the end: %+v", again)
	}
	// Left on an earlier day, it isn't taken up again.
	w.wait(24 * time.Hour)
	if next, _ := w.g.StartTopic(ctx, u, "history"); next.At != 0 {
		t.Fatalf("a run of yesterday went on: %+v", next)
	}
}

func TestMergeKeepsTheAccountsDay(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	guest, owner := w.user(), w.user()
	gs, _ := w.g.StartDay(ctx, guest)
	topic, _ := w.g.StartTopic(ctx, guest, "science")
	os, _ := w.g.StartDay(ctx, owner)
	// The guest chose no word from friends.
	_, _ = w.db.Write.Exec(`INSERT INTO push_prefs (user_id, kind, wanted) VALUES (?, 'friends', 0)`, guest)
	err := w.db.Tx(ctx, func(tx *sql.Tx) error { return w.g.Merge(tx, guest, owner) })
	if err != nil {
		t.Fatal(err)
	}
	var wanted int
	if err := w.db.Read.QueryRow(`SELECT wanted FROM push_prefs WHERE user_id = ? AND kind = 'friends'`, owner).Scan(&wanted); err != nil || wanted != 0 {
		t.Fatalf("the guest's choice of notifications: %d %v", wanted, err)
	}
	if _, err := w.g.State(ctx, owner, topic.ID); err != nil {
		t.Fatal("the guest's topic run didn't move")
	}
	if _, err := w.g.State(ctx, owner, gs.ID); !errors.Is(err, ErrNoRun) {
		t.Fatal("the guest's day replaced the account's")
	}
	if _, err := w.g.State(ctx, owner, os.ID); err != nil {
		t.Fatal(err)
	}
}

func TestStats(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	empty, err := w.g.StatsOf(ctx, u)
	if err != nil || empty.Seal != nil {
		t.Fatalf("a newcomer's stats: %+v %v", empty, err)
	}
	day, _ := w.g.StartDay(ctx, u)
	w.play(u, day.ID, append(repeat(w.right, 6), repeat(w.wrong, 4)...)...)
	topic, _ := w.g.StartTopic(ctx, u, "music")
	w.play(u, topic.ID, repeat(w.right, Length)...)
	s, err := w.g.StatsOf(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	if s.Streak != 1 || s.Best != 1 ||
		s.Seal == nil || s.Seal.Level == 0 {
		t.Fatalf("stats %+v", s)
	}
	// No lifetime totals (DECISIONS.md, „The direction“): nothing that counts them is said.
	out, _ := json.Marshal(s)
	for _, total := range []string{`"days"`, `"games"`, `"answers"`, `"right"`, `"facts"`, `"duels"`, `"won"`, `"mastery"`, `"recent"`} {
		if strings.Contains(string(out), total) {
			t.Errorf("the stats say %s: %s", total, out)
		}
	}
}

func TestFriends(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi := w.user(), w.user(), w.user()
	var anaTag string
	if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, ana).Scan(&anaTag); err != nil {
		t.Fatal(err)
	}
	// Bo asks Ana by her tag: a request, Ana's to accept; asked again, the same one, nothing new to tell her.
	if sent, err := w.g.Request(ctx, bo, anaTag, false); err != nil || sent.Friends || !sent.New || sent.To != ana {
		t.Fatalf("Bo asks Ana: %+v %v", sent, err)
	}
	if sent, err := w.g.Request(ctx, bo, anaTag, false); err != nil || sent.New || sent.Friends {
		t.Fatalf("asking again: %+v %v", sent, err)
	}
	if _, err := w.g.Friend(ctx, ana, bo); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("friends by a request alone: %v", err)
	}
	in, _, _ := w.g.Requests(ctx, ana)
	if len(in) != 1 {
		t.Fatalf("Ana's requests: %+v", in)
	}
	if _, err := w.g.Accept(ctx, ana, in[0].ID); err != nil {
		t.Fatal(err)
	}
	for _, p := range [][2]int64{{ana, bo}, {bo, ana}} {
		if _, err := w.g.Friend(ctx, p[0], p[1]); err != nil {
			t.Fatalf("%d and %d aren't friends both ways: %v", p[0], p[1], err)
		}
	}
	if _, err := w.g.Friend(ctx, ana, vi); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("Ana and Vi: %v", err)
	}

	// The day: nobody's board until a friend has played; then both, best first.
	day := w.g.Today()
	if b, _ := w.g.FriendsBoard(ctx, day, ana); b != nil {
		t.Fatalf("a friends' board before anyone played: %+v", b)
	}
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, append(repeat(w.right, 4), repeat(w.wrong, Length-4)...)...)
	if b, _ := w.g.FriendsBoard(ctx, day, ana); b != nil {
		t.Fatalf("a friends' board with only oneself on it: %+v", b)
	}
	s, _ = w.g.StartDay(ctx, bo)
	w.play(bo, s.ID, repeat(w.right, Length)...)
	b, err := w.g.FriendsBoard(ctx, day, ana)
	if err != nil || len(b) != 2 || b[0].Me || !b[1].Me || b[0].Rights != Length {
		t.Fatalf("the friends' board: %+v %v", b, err)
	}

	// A duel between them counts in the record, from each side.
	w.duel(ana, bo, repeat(w.right, Length), repeat(w.wrong, Length))
	list, err := w.g.FriendsOf(ctx, ana)
	if err != nil || len(list) != 1 || list[0].ID != bo || list[0].Won != 1 || list[0].Lost != 0 ||
		list[0].Today == nil || list[0].Today.Rights != Length {
		t.Fatalf("Ana's friends: %+v %v", list, err)
	}
	if list, _ := w.g.FriendsOf(ctx, bo); len(list) != 1 || list[0].Lost != 1 {
		t.Fatalf("Bo's friends: %+v", list)
	}

	// A guest who signs in to an account brings their friends and their record along.
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return w.g.Merge(tx, bo, vi) }); err != nil {
		t.Fatal(err)
	}
	if list, _ := w.g.FriendsOf(ctx, ana); len(list) != 1 || list[0].ID != vi || list[0].Won != 1 {
		t.Fatalf("Ana's friends after Bo signed in as Vi: %+v", list)
	}
	if err := w.g.Unfriend(ctx, vi, ana); err != nil {
		t.Fatal(err)
	}
	if list, _ := w.g.FriendsOf(ctx, ana); len(list) != 0 {
		t.Fatalf("still friends: %+v", list)
	}
}

func TestFriendRequests(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi, gal := w.user(), w.user(), w.user(), w.user()
	tag := func(id int64) string { return fmt.Sprintf("player%d", id-ana+1) }
	_, _ = w.db.Write.Exec(`UPDATE users SET email = 'vi@example.com' WHERE id = ?`, vi)
	_, _ = w.db.Write.Exec(`UPDATE users SET email = 'ana@example.com' WHERE id = ?`, ana)

	// By tag: Bo is asked by name, and answers yes.
	if _, err := w.g.Request(ctx, ana, "nosuchplayer", false); !errors.Is(err, ErrNoPlayer) {
		t.Fatalf("an unknown tag: %v", err)
	}
	if _, err := w.g.Request(ctx, ana, tag(ana), false); !errors.Is(err, ErrSelf) {
		t.Fatalf("asked oneself: %v", err)
	}
	if sent, err := w.g.Request(ctx, ana, tag(bo), false); err != nil || sent.Friends || sent.Name != "Играч" {
		t.Fatalf("to Bo: %+v %v", sent, err)
	}
	in, _, _ := w.g.Requests(ctx, bo)
	_, out, _ := w.g.Requests(ctx, ana)
	if len(in) != 1 || in[0].Tag != tag(ana) || len(out) != 1 || out[0].Tag != tag(bo) {
		t.Fatalf("Bo's in %+v, Ana's out %+v", in, out)
	}
	if _, err := w.g.Accept(ctx, ana, in[0].ID); !errors.Is(err, ErrNoRequest) {
		t.Fatalf("the sender accepted her own request: %v", err)
	}
	if _, err := w.g.Accept(ctx, bo, in[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.Friend(ctx, ana, bo); err != nil {
		t.Fatalf("not friends after yes: %v", err)
	}
	if n, _ := w.g.RequestsWaiting(ctx, bo); n != 0 {
		t.Fatalf("%d still waiting", n)
	}

	// By email: the sender isn't told whether anyone has the address — the same answer either way.
	known, err := w.g.Request(ctx, ana, "vi@example.com", true)
	unknown, err2 := w.g.Request(ctx, ana, "nobody@example.com", true)
	if err != nil || err2 != nil || known != unknown || known.Name != "" {
		t.Fatalf("by email: %+v %v, %+v %v", known, err, unknown, err2)
	}
	if n, _ := w.g.RequestsWaiting(ctx, vi); n != 1 {
		t.Fatalf("Vi has %d waiting", n)
	}
	// Vi asks Ana back by her email: Ana asked first, so they're friends at once.
	if sent, err := w.g.Request(ctx, vi, "ana@example.com", true); err != nil || !sent.Friends {
		t.Fatalf("asking back: %+v %v", sent, err)
	}
	if _, out, _ := w.g.Requests(ctx, ana); len(out) != 1 || out[0].Email != "nobody@example.com" {
		t.Fatalf("Ana's requests left: %+v", out)
	}

	// Gal asks Bo; Bo says no, and Gal's request is simply gone.
	_, _ = w.g.Request(ctx, gal, tag(bo), false)
	in, _, _ = w.g.Requests(ctx, bo)
	if err := w.g.Withdraw(ctx, bo, in[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, out, _ := w.g.Requests(ctx, gal); len(out) != 0 {
		t.Fatalf("Gal's requests: %+v", out)
	}
	if err := w.g.Withdraw(ctx, vi, in[0].ID); !errors.Is(err, ErrNoRequest) {
		t.Fatalf("withdrew someone else's request: %v", err)
	}
}

func TestDecided(t *testing.T) {
	marks := func(rights string) []DuelMark {
		out := make([]DuelMark, len(rights))
		for i, r := range rights {
			out[i] = DuelMark{Right: r == '1'}
		}
		return out
	}
	sum := func(m []DuelMark) (n int) {
		for _, x := range m {
			n += b2i(x.Right)
		}
		return n
	}
	for _, c := range []struct {
		name string
		a, b []DuelMark
		want int
	}{
		{"ahead from the first", marks("101"), marks("000"), 1},
		{"a lead lost and taken back on the last", marks("1001"), marks("0100"), 4},
		{"even after the second, ahead from the third", marks("101"), marks("010"), 3},
		{"the other won it on the second", marks("100"), marks("110"), 2},
		{"even right answers: the tie broken", marks("10"), marks("01"), 0},
		{"nothing played", nil, nil, 0},
	} {
		if got := decided(c.a, c.b, sum(c.a), sum(c.b)); got != c.want {
			t.Errorf("%s: decided on %d, want %d", c.name, got, c.want)
		}
	}
	// A question that counts for nobody is in the marks but not in the score: the last question's lead is the score's.
	if got := decided(marks("11"), marks("10"), 1, 1); got != 0 {
		t.Errorf("decided by a void question: %d", got)
	}
}

// A duel goes by right answers, then as the board breaks a tie (how close the number came), then by time, by TieBand
// or more.
func TestDuelScore(t *testing.T) {
	base := duelScore{rights: 7, tie: tiebreak{closeness: 500}, ms: 60_000}
	for _, c := range []struct {
		name string
		o    duelScore
		want int
	}{
		{"more right answers", duelScore{rights: 8}, 1},
		{"fewer right answers, closer and quicker", duelScore{rights: 6, tie: tiebreak{closeness: 1000}, ms: 1}, -1},
		{"a closer number", duelScore{rights: 7, tie: tiebreak{closeness: 600}, ms: 90_000}, 1},
		{"quicker by a second", duelScore{rights: 7, tie: base.tie, ms: 59_000}, 1},
		{"quicker by less", duelScore{rights: 7, tie: base.tie, ms: 59_500}, 0},
		{"slower by a second", duelScore{rights: 7, tie: base.tie, ms: 61_000}, -1},
	} {
		if got := base.against(c.o); got != c.want {
			t.Errorf("%s: %d, want %d", c.name, got, c.want)
		}
		if got := c.o.against(base); got != -c.want {
			t.Errorf("%s, the other way: %d, want %d", c.name, got, -c.want)
		}
	}
}

// befriend makes two players friends: a asked, b said yes.
func (w *world) befriend(a, b int64) {
	w.t.Helper()
	if err := w.g.befriend(w.t.Context(), a, b); err != nil {
		w.t.Fatal(err)
	}
}

func TestAlmanac(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	a, err := w.g.AlmanacOf(ctx, ana, AlmanacQuery{Limit: AlmanacPage})
	if err != nil || len(a.Facts) != 0 || a.Found != 0 || len(a.Ink) != 0 || a.Next != "" {
		t.Fatalf("an empty almanac: %+v %v", a, err)
	}
	s, _ := w.g.StartTopic(ctx, ana, "general")
	w.play(ana, s.ID, repeat(w.right, Length)...)
	a, _ = w.g.AlmanacOf(ctx, ana, AlmanacQuery{Limit: AlmanacPage})
	for _, f := range a.Facts {
		if f.Fact == "" || f.Answer == "" || f.Category == "" {
			t.Fatalf("a learned fact: %+v", f)
		}
	}
	if len(a.Facts) == 0 || a.Found != len(a.Facts) || len(a.Ink) != 0 {
		t.Fatalf("ten right answers in „general“, in pencil: %d facts of %d, ink %v", len(a.Facts), a.Found, a.Ink)
	}
	// What was learned stays when its question leaves play, unless it wasn't so.
	n := len(a.Facts)
	q := mustQuestion(t, w, a.Facts[0].ID)
	q.Extra().Retired, q.Extra().RetiredWhy = true, "weak"
	if a, _ = w.g.AlmanacOf(ctx, ana, AlmanacQuery{Limit: AlmanacPage}); a.Found != n {
		t.Fatalf("a question retired as weak left the almanac: %d of %d", a.Found, n)
	}
	q.Extra().RetiredWhy = "wrong"
	if a, _ = w.g.AlmanacOf(ctx, ana, AlmanacQuery{Limit: AlmanacPage}); a.Found != n-1 || len(a.Facts) != n-1 {
		t.Fatalf("a question retired as wrong stayed learned: %d of %d", a.Found, n)
	}
}

// The almanac comes a page at a time, by chapter or of all: every fact once, the latest learned first, whatever is
// learned between one page and the next (it comes at the top, on the next look); the counts are of the whole.
func TestAlmanacPages(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	var ids []string
	for _, topic := range []string{"movies", "history"} {
		n := 0
		for _, q := range w.b.Live(topic, "") {
			if q.Extra().Fact != "" && n < 8 {
				ids, n = append(ids, q.Base().ID), n+1
			}
		}
	}
	w.knows(ana, ids...) // one after another, the last the newest; two topics
	all := func(topic string, size int, between func()) []string {
		var got []string
		from := ""
		for range len(ids) + 1 {
			a, err := w.g.AlmanacOf(ctx, ana, AlmanacQuery{Topic: topic, From: from, Limit: size})
			if err != nil || len(a.Facts) > size {
				t.Fatalf("a page of %d: %d facts of %d (%v)", size, len(a.Facts), a.Found, err)
			}
			for _, f := range a.Facts {
				got = append(got, f.ID)
			}
			if from = a.Next; from == "" {
				return got
			}
			between()
		}
		t.Fatal("the pages never end")
		return nil
	}
	want := slices.Clone(ids)
	slices.Reverse(want)
	if got := all("", 4, func() {}); !slices.Equal(got, want) {
		t.Fatalf("all, by fours:\n%v\nwant\n%v", got, want)
	}
	if got := all("", len(ids), func() {}); !slices.Equal(got, want) {
		t.Fatalf("all on one page: %v", got)
	}
	// By its number: the second page of fours, the count of them all, and the day the book began.
	a, err := w.g.AlmanacOf(ctx, ana, AlmanacQuery{Page: 1, Limit: 4})
	got := []string{}
	for _, f := range a.Facts {
		got = append(got, f.ID)
	}
	if err != nil || !slices.Equal(got, want[4:8]) || a.Found != len(ids) || a.Since != "" {
		t.Fatalf("the second page of fours: %v (%d found, since %q) %v", got, a.Found, a.Since, err)
	}
	var history []string
	for _, id := range want {
		if q, _ := w.b.Get(id); q.Base().Category == "history" {
			history = append(history, id)
		}
	}
	if got := all("history", 3, func() {}); len(history) == 0 || !slices.Equal(got, history) {
		t.Fatalf("history, by threes: %v, want %v", got, history)
	}
	// A fact learned while the player scrolls comes at the top: the pages under way go on as they were.
	var fresh string
	for _, q := range w.b.Live("general", "") {
		if q.Extra().Fact != "" {
			fresh = q.Base().ID
			break
		}
	}
	learned := false
	if got := all("", 5, func() {
		if !learned {
			learned = true
			w.knowsAt(ana, 1000, fresh)
		}
	}); !slices.Equal(got, want) {
		t.Fatalf("pages with a fact learned between them: %v", got)
	}
	if a, _ := w.g.AlmanacOf(ctx, ana, AlmanacQuery{Limit: 1}); len(a.Facts) != 1 || a.Facts[0].ID != fresh ||
		a.Found != len(ids)+1 || a.Facts[0].Ink || a.Facts[0].Kind != "topic" {
		t.Fatalf("the latest fact first: %+v", a)
	}
	// Found by its words, as they're written or not: a word of its answer finds it, in its chapter and in all.
	f := mustQuestion(t, w, ids[0])
	word := strings.ToUpper(strings.Fields(bank.AnswerText(f))[0])
	for _, topic := range []string{"", f.Base().Category, MixTopic} {
		a, err := w.g.AlmanacOf(ctx, ana, AlmanacQuery{Topic: topic, Search: word, Limit: AlmanacPage})
		if err != nil || !slices.ContainsFunc(a.Facts, func(l Learned) bool { return l.ID == ids[0] }) {
			t.Fatalf("searched %q in %q: %+v %v", word, topic, a.Facts, err)
		}
		for _, l := range a.Facts {
			if !strings.Contains(strings.ToLower(l.Question+" "+l.Answer+" "+l.Fact), strings.ToLower(word)) {
				t.Fatalf("searched %q, found %+v", word, l)
			}
		}
	}
	if a, _ := w.g.AlmanacOf(ctx, ana, AlmanacQuery{Search: "щщщщщ", Limit: AlmanacPage}); len(a.Facts) != 0 || a.Found != 0 {
		t.Fatalf("a search that finds nothing: %+v", a)
	}
}

func TestCalibrate(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	if KnownToDifficulty(0.9) != bank.Easy || KnownToDifficulty(0.5) != bank.Medium || KnownToDifficulty(0.1) != bank.Hard {
		t.Fatal("the knowledge bands")
	}
	// Thirty players get the first question of a day right: it shows as easy, whatever it's labelled.
	var first string
	for range CalibrateFrom {
		p := w.user()
		s, _ := w.g.StartDay(ctx, p)
		first = w.picks(s.ID)[0].ID
		w.play(p, s.ID, w.right)
	}
	list, err := w.g.Calibrate(ctx)
	if err != nil || len(list) == 0 {
		t.Fatalf("calibrated: %+v %v", list, err)
	}
	found := false
	for _, c := range list {
		if c.ID == first {
			found = true
			if c.Answers != CalibrateFrom || c.Known < 0.99 || c.Observed != bank.Easy {
				t.Fatalf("a question all got right: %+v", c)
			}
		}
	}
	if !found {
		t.Fatal("the question all got right isn't calibrated")
	}
	// Answers from before what it asks changed don't count: it has none left.
	q := mustQuestion(t, w, first)
	q.Extra().Changed = time.Now().AddDate(0, 0, 1).Format(time.DateOnly)
	list, _ = w.g.Calibrate(ctx)
	for _, c := range list {
		if c.ID == first {
			t.Fatalf("calibrated on answers to what it asked before: %+v", c)
		}
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

func TestCrowds(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	// Fifteen players get the day's first question right and five wrong.
	var first string
	for i := range CrowdFrom {
		p := w.user()
		s, _ := w.g.StartDay(ctx, p)
		first = w.picks(s.ID)[0].ID
		if i < 15 {
			w.play(p, s.ID, w.right)
		} else {
			w.play(p, s.ID, w.wrong)
		}
	}
	if err := w.g.CountCrowds(ctx); err != nil {
		t.Fatal(err)
	}
	c := w.crowd(first)
	if c == nil || c.Answers != CrowdFrom || math.Abs(c.Right-0.75) > 1e-9 {
		t.Fatalf("the first question's crowd: %+v", c)
	}
	// The next player sees it with the answer; a question with fewer answers shows none.
	p := w.user()
	s, _ := w.g.StartDay(ctx, p)
	w.show(p, s.ID)
	res, err := w.g.Answer(ctx, p, s.ID, 0, w.right(s.ID, 0))
	if err != nil {
		t.Fatal(err)
	}
	var rev struct{ Crowd *bank.CrowdView }
	_ = json.Unmarshal(mustJSON(t, res.Reveal), &rev)
	if rev.Crowd == nil || rev.Crowd.Answers != CrowdFrom {
		t.Fatalf("revealed %+v", rev.Crowd)
	}
	if second := w.picks(s.ID)[1].ID; w.crowd(second) != nil {
		t.Fatal("a question with one answer showed a crowd")
	}
	// A fix to the fact alone (updated) keeps the crowd: the question asked the same.
	q, _ := w.b.Get(first)
	q.Extra().Updated = "2026-11-13"
	if err := w.g.CountCrowds(ctx); err != nil {
		t.Fatal(err)
	}
	if c := w.crowd(first); c == nil {
		t.Fatal("a fix to the fact cost a question its crowd")
	}
	// Answers from before what a question asks last changed were to another question: they don't count.
	q.Extra().Changed = "2026-11-13"
	if err := w.g.CountCrowds(ctx); err != nil {
		t.Fatal(err)
	}
	if c := w.crowd(first); c != nil {
		t.Fatalf("a changed question kept its crowd: %+v", c)
	}
}

// A question of the day shows how that day's other players answered it, once ten have: not the player's own answer,
// not other days' players, not other kinds of game.
func TestDayCrowd(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	crowdOf := func(reveal any) *bank.CrowdView {
		var rev struct{ Crowd *bank.CrowdView }
		_ = json.Unmarshal(mustJSON(t, reveal), &rev)
		return rev.Crowd
	}
	// Every question asked as it is since before the day, whichever the day's second is (the sample's newer ones were
	// added after it).
	for _, q := range w.b.Live("", "") {
		q.Extra().Added, q.Extra().Changed = "2026-11-01", ""
	}
	// Nine players answer the day's first two questions: seven get the first right, two the second.
	var picks []Pick
	for i := range 9 {
		p := w.user()
		s, _ := w.g.StartDay(ctx, p)
		picks = w.picks(s.ID)
		first, second := w.wrong, w.wrong
		if i < 7 {
			first = w.right
		}
		if i < 2 {
			second = w.right
		}
		w.play(p, s.ID, first, second)
	}
	// Other days and other games don't count: a topic's answer to the same question today, and a day's yesterday.
	noise := w.user()
	for _, run := range []struct{ kind, day string }{{"topic", ""}, {"day", "2026-11-11"}} {
		res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, started_at) VALUES (?, ?, nullif(?, ''), '[]', 0)`,
			noise, run.kind, run.day)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		for n := range 3 {
			if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, score, is_right, ms, at)
				VALUES (?, ?, ?, 1, 1, 900, ?)`, id, n, picks[0].ID, w.now.UnixMilli()); err != nil {
				t.Fatal(err)
			}
		}
	}

	// Nine others say too little: nothing shows (the crowd of everyone isn't counted yet either).
	ana := w.user()
	s, _ := w.g.StartDay(ctx, ana)
	w.show(ana, s.ID)
	res, err := w.g.Answer(ctx, ana, s.ID, 0, w.right(s.ID, 0))
	if err != nil {
		t.Fatal(err)
	}
	if c := crowdOf(res.Reveal); c != nil {
		t.Fatalf("nine others showed a crowd: %+v", c)
	}
	w.show(ana, s.ID)
	if _, err := w.g.Answer(ctx, ana, s.ID, 1, w.wrong(s.ID, 1)); err != nil {
		t.Fatal(err)
	}

	// The next player has ten others, ana the tenth, and not their own answer (with it, 9 right of 11).
	bo := w.user()
	s, _ = w.g.StartDay(ctx, bo)
	w.show(bo, s.ID)
	if res, err = w.g.Answer(ctx, bo, s.ID, 0, w.right(s.ID, 0)); err != nil {
		t.Fatal(err)
	}
	if c := crowdOf(res.Reveal); c == nil || !c.Today || c.Answers != 10 || math.Abs(c.Right-0.8) > 1e-9 {
		t.Fatalf("the day's crowd: %+v", c)
	}

	// bo plays on, the second right too, the rest wrong; the review shows the same, and the third has no crowd.
	for n := 1; n < Length; n++ {
		w.show(bo, s.ID)
		w.wait(3 * time.Second) // at a person's pace, or bo's answers count for bo alone (fair.go)
		answer := w.wrong
		if n == 1 {
			answer = w.right
		}
		if _, err := w.g.Answer(ctx, bo, s.ID, n, answer(s.ID, n)); err != nil {
			t.Fatal(err)
		}
	}
	items, err := w.g.Review(ctx, bo, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if c := crowdOf(items[0].Reveal); c == nil || !c.Today || c.Answers != 10 {
		t.Fatalf("the review's first: %+v", c)
	}
	if c := crowdOf(items[2].Reveal); c != nil {
		t.Fatalf("the review's third, which no one else answered: %+v", c)
	}
	// The rarest right answer for the result shared: the second, which two in ten others got, and Bo: 3 in 11.
	rare, err := w.g.EntryOfDay(ctx, bo, "2026-11-12")
	if err != nil {
		t.Fatal(err)
	}
	if rare == nil || rare.N != 1 || !rare.Crowd || math.Abs(rare.Right-3.0/11) > 1e-9 || rare.Alone {
		t.Fatalf("the rarest right answer: %+v", rare)
	}
	// None for a day not finished (ana left it after one question).
	if rare, _ := w.g.EntryOfDay(ctx, ana, "2026-11-12"); rare != nil {
		t.Fatalf("a rarest right answer in an unfinished day: %+v", rare)
	}

	// The browser tests show a crowd from the first answer (CrowdMin); answers from before a question last changed were
	// to another question.
	w.g.CrowdMin = 1
	w.g.Settled(ctx) // the counts made in the background read the questions this changes
	third := mustQuestion(t, w, picks[2].ID)
	third.Extra().Added, third.Extra().Changed, third.Extra().Updated = "2026-11-01", "2026-11-13", "2026-11-13"
	if c, _ := w.g.dayCrowd(ctx, w.db.Read, "2026-11-12", third, 0); c != nil {
		t.Fatalf("the third, changed since: %+v", c)
	}
	third.Extra().Changed = ""
	if c, _ := w.g.dayCrowd(ctx, w.db.Read, "2026-11-12", third, 0); c == nil || c.Answers != 1 {
		t.Fatalf("the third with CrowdMin 1: %+v", c)
	}
}

func mustQuestion(t *testing.T, w *world, id string) bank.Question {
	t.Helper()
	q, ok := w.b.Get(id)
	if !ok {
		t.Fatal("no question", id)
	}
	return q
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
