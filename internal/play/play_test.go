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
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
	"github.com/almanac-bg/almanac/internal/store/storetest"
)

type world struct {
	t    *testing.T
	g    *Game
	db   *store.DB
	b    *bank.Bank
	now  time.Time
	next int64
	// pace, if set, is how long a player takes over question n (three seconds otherwise).
	pace func(n int) time.Duration
}

func setup(t *testing.T) *world {
	t.Helper()
	db := storetest.Open(t)
	// Its own bank, not banktest.Sample: these tests change questions (retire them, date them).
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	w := &world{t: t, db: db, b: b, now: time.Date(2026, 11, 12, 10, 0, 0, 0, Bulgaria)}
	w.g = &Game{DB: db, Bank: func() *bank.Bank { return b }, Now: func() time.Time { return w.now }}
	return w
}

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

func (w *world) wait(d time.Duration) { w.now = w.now.Add(d) }

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

// live says whether a run is a live duel's, which its duel moves on (internal/live), not its player.
func (w *world) live(runID int64) bool {
	var live bool
	_ = w.db.Read.QueryRow(`SELECT EXISTS (SELECT 1 FROM duels WHERE a_run = ?1 OR b_run = ?1)`,
		runID).Scan(&live)
	return live
}

// show shows a run's next question and starts its time, its pictures in at once if it has any, as a screen does; a
// live duel's, as its duel does.
func (w *world) show(user, runID int64) State {
	w.t.Helper()
	ctx := w.t.Context()
	defer w.g.AftersDone(ctx) // a run its clock ended
	if w.live(runID) {
		s, err := w.g.State(ctx, user, runID)
		if err == nil {
			err = w.g.ShowLive(ctx, user, runID, s.At, w.now, w.dealt(runID, s.At))
		}
		if err != nil {
			w.t.Fatal(err)
		}
		s, _ = w.g.State(ctx, user, runID)
		return s
	}
	s, err := w.g.Show(ctx, user, runID)
	if err == nil && s.Question != nil && s.Question.StartsMs > 0 {
		s, err = w.g.Start(ctx, user, runID, s.Question.N)
	}
	if err != nil {
		w.t.Fatal(err)
	}
	return s
}

// answer answers a run's question n now, as its player does; a live duel's, through its duel. What follows a run it
// ends is done when it returns (after.go: in the background), as a test reads it next.
func (w *world) answer(user, runID int64, n int, a json.RawMessage) (Result, error) {
	defer w.g.AftersDone(w.t.Context())
	if w.live(runID) {
		return w.g.AnswerLive(w.t.Context(), user, runID, n, a, w.now, time.Time{}, w.dealt(runID, n))
	}
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

// dealt is a run's question n as a live game deals it: the version the run shows, if it shows one yet, else the bank's.
func (w *world) dealt(runID int64, n int) bank.Dealt {
	w.t.Helper()
	d, ok := w.g.Deal(w.picks(runID)[n])
	if !ok {
		w.t.Fatalf("no question %d of run %d", n, runID)
	}
	return d
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
	topic, _ := w.g.StartTopic(ctx, u, "")
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

// The first level comes with the run that passes 300 XP, in the news once.
func TestLevelUpNews(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	bo := w.user()
	w.played(bo, XPFromDay-1) // the level's told from the second day played (TestUnfolding)
	var n News
	for range 5 {
		s, _ := w.g.StartTopic(ctx, bo, "")
		w.play(bo, s.ID, repeat(w.right, Length)...)
		var err error
		if n, err = w.g.NewsOf(ctx, bo, 0); err != nil {
			t.Fatal(err)
		}
		if n.XP >= 300 {
			break
		}
		if n.LevelUp {
			t.Fatalf("a level at %d XP", n.XP)
		}
	}
	if lvl, from, _ := LevelOf(n.XP); !n.LevelUp || n.Level != lvl || lvl < 2 || n.From != from {
		t.Fatalf("news at %d XP: %+v", n.XP, n)
	}
	if again, _ := w.g.NewsOf(ctx, bo, 0); again.LevelUp {
		t.Fatalf("the level twice: %+v", again)
	}
}

// A level reached by a week of the league, paid as it ended, was the player's before their next game: that game's
// news tells its own XP (the week's is in the week's card), and doesn't call the level new.
func TestLevelNewOnlyByTheGame(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	bo := w.user()
	w.played(bo, 3) // XP and the league open
	n, err := w.g.NewsOf(ctx, bo, 0)
	if err != nil || !n.Open.League {
		t.Fatalf("before: %+v %v", n, err)
	}
	pay := n.To - n.XP // enough for the next level
	if _, err := w.db.Write.Exec(`INSERT INTO league_results (user_id, week, tier, place, of, points, moved, xp, seen)
		VALUES (?, '2026-11-02', 0, 1, 5, 900, 1, ?, 0)`, bo, pay); err != nil {
		t.Fatal(err)
	}
	s, _ := w.g.StartTopic(ctx, bo, "")
	w.play(bo, s.ID, repeat(w.wrong, Length)...)
	n, err = w.g.NewsOf(ctx, bo, s.ID)
	var game int
	_ = w.db.Read.QueryRow(`SELECT xp FROM runs WHERE id = ?`, s.ID).Scan(&game)
	for _, a := range n.Achievements {
		game += a.XP
	}
	for _, d := range n.Goals {
		game += d.XP
	}
	if lvl, _, _ := LevelOf(n.XP); err != nil || n.League == nil || n.League.XP != pay || n.Earned != game || n.LevelUp ||
		lvl < 2 {
		t.Fatalf("a game's news after a week paid a level: earned %d of %d, %+v %v", n.Earned, game, n, err)
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
	if err != nil || res.Points != WorthOf(w.question(s.ID, 0), 1, 0).Points || !res.Right || res.State.At != 1 || res.Reveal == nil {
		t.Fatalf("the right answer: %+v %v", res, err)
	}

	// Left showing past its time: unanswered, as soon as anyone looks.
	_, _ = w.g.Show(ctx, u, s.ID)
	w.wait(time.Minute)
	st, _ := w.g.State(ctx, u, s.ID)
	if st.At != 2 || st.Question != nil || len(st.Trail) != 2 || st.Trail[1].Points != 0 {
		t.Fatalf("after its time ran out: %+v", st)
	}

	// An answer a little late (within the grace) counts; one later doesn't.
	_, _ = w.g.Show(ctx, u, s.ID)
	w.wait(Limit(w.question(s.ID, 2)) + Grace/2)
	if res, _ := w.g.Answer(ctx, u, s.ID, 2, w.right(s.ID, 2)); res.TimedOut || res.Points == 0 {
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
	// Two right in a row: the second's points are made up of its speed, and so are they again, with the row it makes.
	if _, err := answer(0, w.right(s.ID, 0)); err != nil {
		t.Fatal(err)
	}
	first, err := answer(1, w.right(s.ID, 1))
	if err != nil || !first.Right || first.InRow != 2 || first.Speed == 0 {
		t.Fatalf("the first time: %+v %v", first, err)
	}
	w.wait(5 * time.Second)
	again, err := w.g.Answer(ctx, u, s.ID, 1, w.wrong(s.ID, 1)) // what's sent again changes nothing either
	if err != nil || again.Reveal == nil || plain(again) != plain(first) {
		t.Fatalf("sent again:\n%s\n%s\n%v", plain(again), plain(first), err)
	}
	st, _ := w.g.State(ctx, u, s.ID)
	if st.At != 2 || st.Points != first.State.Points || len(st.Trail) != 2 {
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
	if again, err := w.g.Answer(ctx, u, s.ID, 1, w.right(s.ID, 1)); err != nil || again.Points != first.Points ||
		again.State.Question == nil || again.State.Question.N != 2 {
		t.Fatalf("sent again with the next question showing: %+v %v", again, err)
	}
	// A question whose time ran out: sent after it did, the answer is that.
	w.wait(time.Minute)
	if _, err := w.g.State(ctx, u, s.ID); err != nil {
		t.Fatal(err)
	}
	if late, err := w.g.Answer(ctx, u, s.ID, 2, w.right(s.ID, 2)); err != nil || !late.TimedOut || late.Points != 0 ||
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
	xp := func() (xp int) {
		_ = w.db.Read.QueryRow(`SELECT xp FROM runs WHERE id = ?`, s.ID).Scan(&xp)
		return xp
	}
	before := xp()
	again, err = w.g.Answer(ctx, u, s.ID, Length-1, w.right(s.ID, Length-1))
	if err != nil || !again.State.Done || plain(again) != plain(last) || xp() != before {
		t.Fatalf("the last answer sent again: %+v %v (XP %d, was %d)", again, err, xp(), before)
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
	if err != nil || res.Points != WorthOf(w.question(s.ID, 0), 1, 6*time.Second).Points {
		t.Fatalf("answered 6 s after it started: %+v %v", res, err)
	}

	// Never started by the screen: it starts by itself, PictureWait after it's shown.
	_, _ = w.g.Show(ctx, u, s.ID)
	w.wait(PictureWait + Limit(w.question(s.ID, 1)))
	if st, _ := w.g.State(ctx, u, s.ID); st.At != 1 || st.Question == nil || st.Question.LeftMs != 0 ||
		!strings.Contains(fmt.Sprint(st.Question.View), "Чие") {
		t.Fatalf("its time, after it started by itself: %+v", st.Question)
	}
	w.wait(Grace + time.Second)
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
	w.setGoals(ana, "day", "duel", "duelWin") // goals the day's questions alone don't finish: no reserve day from the goals
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	if n, _ := w.g.Streak(ctx, ana); n != 2 {
		t.Fatalf("streak %d after two days", n)
	}
	w.wait(48 * time.Hour)
	if n, _ := w.g.Streak(ctx, ana); n != 2 {
		t.Fatalf("streak %d after missing a day, with the first day's reserve day", n)
	}
	if week, _ := w.g.Week(ctx, ana); week != [7]bool{3: true, 4: true} {
		t.Fatalf("week %v on Sunday, after Thursday and Friday", week)
	}
	w.wait(24 * time.Hour)
	if week, _ := w.g.Week(ctx, ana); week != [7]bool{} {
		t.Fatalf("week %v on a new Monday", week)
	}
	if n, _ := w.g.Streak(ctx, ana); n != 0 {
		t.Fatalf("streak %d after missing two days, with one reserve day", n)
	}
}

// The days before the rules of 2026-11-19 earned reserve days as the rules were then: the first day played, every
// seventh in a row and a day with all three goals done, two at most and no cap a week; a missed day spends one and the
// streak holds; with none left it ends, and says so.
func TestReserveDaysBefore(t *testing.T) {
	rules := ReserveRulesFrom
	ReserveRulesFrom = "9999-12-31"
	t.Cleanup(func() { ReserveRulesFrom = rules })
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	day := func() {
		s, _ := w.g.StartDay(ctx, ana)
		w.play(ana, s.ID, repeat(w.right, Length)...)
	}
	full := func() {
		day()
		for i := range GoalsPerDay {
			_, _ = w.db.Write.Exec(`INSERT OR IGNORE INTO goals_done (user_id, day, goal, at, xp, seen) VALUES (?, ?, ?, 1, 0, 1)`,
				ana, w.g.Today(), fmt.Sprint("g", i))
		}
	}
	day() // the first day ever: a reserve day, goals or not
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 1 || s.Reserve != 1 || s.Next != 6 || s.Ended != nil {
		t.Fatalf("after a first day: %+v", s)
	}
	w.wait(48 * time.Hour) // a day missed
	missed := w.g.Now().In(Bulgaria).AddDate(0, 0, -1).Format(time.DateOnly)
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 1 || s.Reserve != 0 || len(s.Saved) != 1 || s.Saved[0] != missed {
		t.Fatalf("a day missed, with a reserve: %+v", s)
	}
	full() // all three goals: a reserve day
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 2 || s.Reserve != 1 || s.Next != 5 {
		t.Fatalf("a full day: %+v", s)
	}
	for range 5 { // to seven days in a row: the second reserve day, and no more to earn
		w.wait(24 * time.Hour)
		day()
	}
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 7 || s.Reserve != ReserveMax || s.Next != 0 {
		t.Fatalf("seven days in a row: %+v", s)
	}
	w.wait(24 * time.Hour)
	full() // a full day with the reserve days full earns nothing more
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 8 || s.Reserve != ReserveMax {
		t.Fatalf("a full day with reserve days full: %+v", s)
	}
	w.wait(4 * 24 * time.Hour) // three days missed, two reserve days: the third ends it
	ended := w.g.Now().In(Bulgaria).AddDate(0, 0, -1).Format(time.DateOnly)
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 0 || s.Reserve != 0 || len(s.Saved) != 0 || s.Ended == nil ||
		*s.Ended != (Ended{Days: 8, On: ended}) || s.Next != ReserveEvery {
		t.Fatalf("three days missed: %+v (ended %+v)", s, s.Ended)
	}
}

// Reserve days come from the day itself (a streak's third day, then every seventh in a row) and from a day with all
// three goals done: one a week at most, none before the streak's third day, two in hand at most. A missed day spends
// one and the streak holds; with none left it ends.
func TestReserveDays(t *testing.T) {
	rules := ReserveRulesFrom
	ReserveRulesFrom = ""
	t.Cleanup(func() { ReserveRulesFrom = rules })
	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	ana := w.user()
	day := func() {
		s, _ := w.g.StartDay(ctx, ana)
		w.play(ana, s.ID, repeat(w.right, Length)...)
	}
	full := func() {
		day()
		for i := range GoalsPerDay {
			_, _ = w.db.Write.Exec(`INSERT OR IGNORE INTO goals_done (user_id, day, goal, at, xp, seen) VALUES (?, ?, ?, 1, 0, 1)`,
				ana, w.g.Today(), fmt.Sprint("g", i))
		}
	}
	streak := func(what string, days, reserve, next int, week bool, goals string) StreakNow {
		t.Helper()
		s, err := w.g.StreakOf(ctx, ana)
		if err != nil || s.Days != days || s.Reserve != reserve || s.Next != next || s.Week != week ||
			s.GoalsReserve() != goals {
			t.Fatalf("%s: %+v, goals %q; want %d days, %d reserve, next in %d, week %v, goals %q (%v)", what, s,
				s.GoalsReserve(), days, reserve, next, week, goals, err)
		}
		return s
	}
	full() // the first day, all three goals done: no reserve day yet, and day two keeps its stake
	streak("Thursday, the first day", 1, 0, 2, false, ReserveSoon)
	w.wait(24 * time.Hour)
	streak("Friday, before playing", 1, 0, 2, false, ReserveSoon)
	full()
	streak("Friday, the second day", 2, 0, 1, false, ReserveSoon)
	w.wait(24 * time.Hour)
	day() // Saturday, the third day in a row: the first reserve day, this week's
	streak("Saturday, the third day", 3, 1, 4, true, ReserveWeek)
	w.wait(24 * time.Hour)
	full() // Sunday, all three goals: this week's reserve day is earned already
	streak("Sunday, a full day", 4, 1, 3, true, ReserveWeek)
	w.wait(24 * time.Hour)
	full() // Monday, a new week: all three goals earn its reserve day
	streak("Monday, a full day", 5, ReserveMax, 0, true, ReserveFull)
	w.wait(48 * time.Hour) // Tuesday missed: a reserve day spent
	day()
	s := streak("Wednesday, after a day missed", 6, 1, 8, true, ReserveWeek)
	if len(s.Saved) != 1 || s.Saved[0] != "2026-11-17" || s.Unbroken != 1 {
		t.Fatalf("the day a reserve day kept: %+v", s)
	}
	w.wait(24 * time.Hour)
	day() // Thursday, the seventh day in a row: this week's reserve day is earned already
	streak("Thursday, the seventh day", 7, 1, 7, true, ReserveWeek)
	w.wait(3 * 24 * time.Hour) // Friday spends the last, Saturday ends it
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 0 || s.Reserve != 0 || s.Ended == nil ||
		*s.Ended != (Ended{Days: 7, On: "2026-11-21"}) || s.Next != ReserveFrom {
		t.Fatalf("two days missed with one reserve day: %+v (ended %+v)", s, s.Ended)
	}
}

// A player keeps the reserve days the rules before 2026-11-19 gave, and earns by today's rules from then.
func TestReserveDaysKeptOverTheRules(t *testing.T) {
	rules := ReserveRulesFrom
	ReserveRulesFrom = "2026-11-14"
	t.Cleanup(func() { ReserveRulesFrom = rules })
	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	ana := w.user()
	w.daysPlayed(ana, 0) // the first day ever, by the old rules: a reserve day
	if s, _ := w.g.StreakOf(ctx, ana); s.Reserve != 1 || !s.Week {
		t.Fatalf("a first day, by the old rules: %+v", s)
	}
	w.wait(2 * 24 * time.Hour)
	w.daysPlayed(ana, 1, 0) // Saturday, the third day, by today's rules: this week's reserve day came on Thursday
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 3 || s.Reserve != 1 || s.Next != 4 {
		t.Fatalf("the third day, by today's rules: %+v", s)
	}
}

// A division reached is told once with what it unlocks; an achievement's reward is only what's new to the player; a
// player from before unlocks were kept isn't told of what they have.
func TestUnlocks(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, old := w.user(), w.user()
	_, _ = w.g.NewsOf(ctx, ana, 0)
	// While the rating is being set, no division is told, nor what one unlocks, nor what comes next.
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1180, peak = 1180, rated = ? WHERE id = ?`, MinRatedGames-1, ana)
	if n, _ := w.g.NewsOf(ctx, ana, 0); n.Division != nil || len(n.Unlocks) != 0 {
		t.Fatalf("news while placing: %+v", n)
	}
	if p, _ := w.g.ProgressOf(ctx, ana); p.Next.Division != nil || p.Standing.Of != MinRatedGames ||
		p.Standing.Rated != MinRatedGames-1 {
		t.Fatalf("progress while placing: %+v %+v", p.Next, p.Standing)
	}
	// Set: the division it's in now is told (not the peak's), with what it unlocks.
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1100, rated = ? WHERE id = ?`, MinRatedGames, ana)
	n, err := w.g.NewsOf(ctx, ana, 0)
	got := []string{}
	for _, u := range n.Unlocks {
		got = append(got, u.Kind+":"+u.ID+" "+u.From)
	}
	if err != nil || n.Division == nil || n.Division.ID != "gold" || !n.Placed ||
		!slices.Equal(got, []string{"title:goldStandard дивизия Злато", "backdrop:stars дивизия Злато"}) {
		t.Fatalf("gold reached: %v %+v %v", got, n.Division, err)
	}
	if again, _ := w.g.NewsOf(ctx, ana, 0); again.Division != nil || len(again.Unlocks) != 0 {
		t.Fatalf("gold told twice: %+v", again)
	}
	p, _ := w.g.ProgressOf(ctx, ana)
	if p.Next.Division == nil || p.Next.Division.ID != "platinum" || len(p.Next.DivisionUnlocks) != 0 {
		t.Fatalf("next after gold: %+v", p.Next)
	}

	// The shield is duel1's: once it's earned, duel10 gives its XP (said once XP is open) and its title, not the shield.
	_, _ = w.db.Write.Exec(`INSERT INTO achievements (user_id, id, at, xp, seen) VALUES (?, 'duel1', 1, 50, 1)`, ana)
	w.played(ana, XPFromDay)
	p, _ = w.g.ProgressOf(ctx, ana)
	for _, a := range p.Achievements {
		switch a.ID {
		case "duel1":
			if len(a.Rewards) != 1 || a.Rewards[0].ID != "shield" {
				t.Fatalf("duel1's rewards: %+v", a.Rewards)
			}
		case "duel10":
			if a.XP != AchievementXP[Epic] || len(a.Rewards) != 1 || a.Rewards[0].ID != "duelInstinct" {
				t.Fatalf("duel10's rewards: %+v", a.Rewards)
			}
		case "friend1", "friendWin":
			// The heart is the first's in the list, not friendWin's.
			if heart := len(a.Rewards) == 1 && a.Rewards[0].ID == "heart"; heart != (a.ID == "friend1") {
				t.Fatalf("%s's rewards: %+v", a.ID, a.Rewards)
			}
		}
	}
	// The first epic one unlocks a pattern: the tier's reward, told once.
	if u := p.TierUnlocks[Epic]; len(u) != 1 || u[0].ID != "rays" || len(p.TierUnlocks[Common]) != 0 {
		t.Fatalf("the tiers' rewards: %+v", p.TierUnlocks)
	}

	// A player from before: what they have is taken in untold.
	_, _ = w.db.Write.Exec(`UPDATE users SET unlocks_known = 0, peak = 1400, peak_seen = 1400, rated = ? WHERE id = ?`,
		MinRatedGames, old)
	if n, _ := w.g.NewsOf(ctx, old, 0); len(n.Unlocks) != 0 || n.Division != nil {
		t.Fatalf("a player from before: %+v", n)
	}
	_, _ = w.db.Write.Exec(`UPDATE users SET peak = 1600 WHERE id = ?`, old)
	if n, _ := w.g.NewsOf(ctx, old, 0); n.Division == nil || n.Division.ID != "legend" || len(n.Unlocks) != 2 {
		t.Fatalf("a player from before, reaching Легенда: %+v", n)
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
	all, err := w.g.StartTopic(ctx, u, "")
	if err != nil || all.Total != Length {
		t.Fatalf("all topics: %+v %v", all, err)
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
	w.wait(time.Minute)
	back, err := w.g.StartTopic(ctx, u, "history")
	if err != nil || back.ID != first.ID || back.At != 4 || len(back.Trail) != 4 || back.Question != nil {
		t.Fatalf("back to the topic: %+v %v", back, err)
	}
	if m := back.Trail[3]; m.Right || m.Points != 0 {
		t.Fatalf("the question left showing: %+v", m)
	}
	// Another topic is a run of its own, and so is all of them.
	if other, _ := w.g.StartTopic(ctx, u, "science"); other.ID == first.ID {
		t.Fatal("another topic went on with history's run")
	}
	all, _ := w.g.StartTopic(ctx, u, "")
	if all.ID == first.ID {
		t.Fatal("all the topics went on with history's run")
	}
	// The games left, to come back to: each topic's latest, the latest first; one with its question showing is open.
	if _, err := w.g.Show(ctx, u, all.ID); err != nil {
		t.Fatal(err)
	}
	left, err := w.g.Left(ctx, u)
	if err != nil || len(left) != 3 {
		t.Fatalf("left: %+v %v", left, err)
	}
	if l := left[0]; l.ID != all.ID || l.Category != "" || l.At != 0 || l.Total != Length || !l.Open {
		t.Errorf("all the topics, left: %+v", l)
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
	// The guest said they'd come to tonight's Роял, and chose no word from friends.
	_ = w.g.PlanRoyal(ctx, "2026-11-14", guest, true)
	_, _ = w.db.Write.Exec(`INSERT INTO push_prefs (user_id, kind, wanted) VALUES (?, 'friends', 0)`, guest)
	err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, guest, owner) })
	if err != nil {
		t.Fatal(err)
	}
	if n, mine, _ := w.g.RoyalPlans(ctx, "2026-11-14", owner); n != 1 || !mine {
		t.Fatalf("the guest's plan: %d, %v", n, mine)
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
	if err != nil || empty.Games != 0 || len(empty.Mastery) != len(w.b.Categories) || empty.Mastery[0].Answers != 0 || empty.Recent == nil {
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
	if s.Streak != 1 || s.Days != 1 || s.Games != 2 || s.Answers != 20 || s.Right != 16 || len(s.Recent) != 2 {
		t.Fatalf("stats %+v", s)
	}
	music := s.Mastery[slices.IndexFunc(s.Mastery, func(m Mastery) bool { return m.Category == "music" })]
	if music.Sure || !music.First || music.Answers < Length || s.Recent[0].Kind != "topic" || s.Recent[0].Total != Length {
		t.Fatalf("music %+v, recent %+v", music, s.Recent)
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

	// A duel between them counts in the record, from each side, and in their stats.
	l, err := w.g.StartLive(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, l.Runs[0], repeat(w.right, Length)...)
	w.play(bo, l.Runs[1], repeat(w.wrong, Length)...)
	if st, _ := w.g.StatsOf(ctx, bo); st.Duels != 1 || st.Won != 0 || st.Recent[0].Kind != "duel" {
		t.Fatalf("Bo's stats after a duel: %+v", st)
	}
	list, err := w.g.FriendsOf(ctx, ana)
	if err != nil || len(list) != 1 || list[0].ID != bo || list[0].Won != 1 || list[0].Lost != 0 ||
		list[0].Today == nil || list[0].Today.Rights != Length {
		t.Fatalf("Ana's friends: %+v %v", list, err)
	}
	if list, _ := w.g.FriendsOf(ctx, bo); len(list) != 1 || list[0].Lost != 1 {
		t.Fatalf("Bo's friends: %+v", list)
	}

	// A guest who signs in to an account brings their friends and their record along.
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, bo, vi) }); err != nil {
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

func TestProgress(t *testing.T) {
	for _, c := range []struct{ points, level, from, to int }{
		{0, 1, 0, 300}, {299, 1, 0, 300}, {300, 2, 300, 750}, {749, 2, 300, 750}, {750, 3, 750, 1350},
	} {
		if l, f, to := LevelOf(c.points); l != c.level || f != c.from || to != c.to {
			t.Fatalf("LevelOf(%d) = %d %d %d", c.points, l, f, to)
		}
	}
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	w.played(ana, XPFromDay-1)
	p, err := w.g.ProgressOf(ctx, ana)
	if err != nil || p.Level != 1 || p.Avatar != DefaultAvatar(ana) || p.Achievements[0].At != 0 {
		t.Fatalf("a new player's progress: %+v %v", p, err)
	}
	// Before the second day, Награди follows the unfolding: no XP said, and no achievement of the day's goals or the
	// league; from it, the goals' and XP; from the third, the league's too.
	hiddenNow := func(p Progress) int {
		n := 0
		for _, a := range Achievements {
			if !slices.ContainsFunc(p.Achievements, func(e Earned) bool { return e.ID == a.ID }) {
				n++
			}
		}
		return n
	}
	if hiddenNow(p) != 5 || slices.ContainsFunc(p.Achievements, func(e Earned) bool { return e.XP != 0 }) {
		t.Fatalf("a first day's achievements: %d hidden, %+v", hiddenNow(p), p.Achievements)
	}
	for _, c := range []struct{ days, hidden int }{{XPFromDay, 3}, {LeagueFromDay, 0}} {
		w.played(ana, c.days)
		p, _ := w.g.ProgressOf(ctx, ana)
		if hiddenNow(p) != c.hidden || p.Achievements[0].XP != AchievementXP[p.Achievements[0].Tier] {
			t.Fatalf("day %d's achievements: %d hidden, %+v", c.days, hiddenNow(p), p.Achievements[0])
		}
	}
	for _, s := range p.Shapes {
		if locked := slices.Contains(Unlockable, s.Shape); s.Locked != locked || (locked && s.How == "") {
			t.Fatalf("a new player's shape %+v", s)
		}
	}
	if err := w.g.SetLook(ctx, ana, ptr("star-gold"), nil); !errors.Is(err, ErrNotYours) {
		t.Fatalf("a locked shape: %v", err)
	}

	// A perfect day: the achievements come with the last answer, and a level with the points.
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	n, err := w.g.NewsOf(ctx, ana, 0)
	ids := []string{}
	for _, a := range n.Achievements {
		ids = append(ids, a.ID)
	}
	// (A perfect day earns 20 XP an answer and 200 for the day, 400, and the goals it finished more: the first level.)
	// (and each achievement its tier's XP).
	goals := 0
	for _, d := range n.Goals {
		goals += d.XP
	}
	for _, a := range n.Achievements {
		goals += a.XP
		if a.XP != AchievementXP[a.Tier] {
			t.Fatalf("news of %s, and its XP: %+v", a.ID, a)
		}
	}
	if lvl, from, _ := LevelOf(n.XP); err != nil || !slices.Contains(ids, "perfect") || goals < GoalXP[0] ||
		n.XP != 400+goals || lvl < 2 ||
		n.Level != lvl || n.From != from || !n.LevelUp {
		t.Fatalf("news after a perfect day: %+v %v", n, err)
	}
	// „Десет от десет“ gives its avatar and its title, and both are told as unlocked.
	for _, a := range n.Achievements {
		if a.ID == "perfect" && (len(a.Rewards) != 2 || a.Rewards[0] != (Unlock{Kind: "avatar", ID: "star",
			From: "постижението „Десет от десет“"}) || a.Rewards[1].ID != "flawless") {
			t.Fatalf("perfect's rewards: %+v", a.Rewards)
		}
	}
	if !slices.ContainsFunc(n.Unlocks, func(u Unlock) bool { return u.Kind == "avatar" && u.ID == "star" }) ||
		!slices.ContainsFunc(n.Unlocks, func(u Unlock) bool { return u.Kind == "title" && u.ID == "flawless" }) {
		t.Fatalf("unlocks after a perfect day: %+v", n.Unlocks)
	}
	if again, _ := w.g.NewsOf(ctx, ana, 0); len(again.Achievements) != 0 || again.LevelUp || len(again.Unlocks) != 0 {
		t.Fatalf("the same news twice: %+v", again)
	}

	// Progress towards each goal; a hidden achievement stays a secret until it's found.
	p, _ = w.g.ProgressOf(ctx, ana)
	byID := map[string]Earned{}
	for _, a := range p.Achievements {
		byID[a.ID] = a
	}
	alm, _ := w.g.AlmanacOf(ctx, ana, "", "", AlmanacPage)
	if a := byID["facts100"]; a.At != 0 || a.Progress != alm.All || a.Progress == 0 || a.Goal != 100 {
		t.Fatalf("facts100 after ten right answers (%d facts): %+v", alm.All, a)
	}
	if a := byID["perfect"]; a.At == 0 || a.Progress != a.Goal {
		t.Fatalf("perfect, earned: %+v", a)
	}
	if a := byID["topicPerfect"]; a.Name != "Скрито постижение" || !a.Hidden || a.Icon != "secret" || a.Progress != 0 {
		t.Fatalf("a hidden achievement before it's found: %+v", a)
	}
	for _, s := range p.Shapes {
		if s.Shape == "spark" && s.How != "скрито постижение" {
			t.Fatalf("a hidden achievement's shape tells how: %+v", s)
		}
	}
	run, _ := w.g.StartTopic(ctx, ana, "history")
	w.play(ana, run.ID, repeat(w.right, Length)...)
	p, _ = w.g.ProgressOf(ctx, ana)
	for _, a := range p.Achievements {
		if a.ID == "topicPerfect" && (a.At == 0 || a.Name != "Тема без грешка") {
			t.Fatalf("a hidden achievement once found: %+v", a)
		}
	}

	// Two more games of history, all right: a sure mark there, and a master's.
	for range MasteryFrom/Length - 1 {
		run, _ := w.g.StartTopic(ctx, ana, "history")
		w.play(ana, run.ID, repeat(w.right, Length)...)
	}

	// What's earned may be worn; what isn't, can't.
	for _, c := range []struct {
		avatar, title *string
		ok            bool
	}{
		{nil, ptr("master-history"), true}, // thirty right in history: sure, and a master
		{ptr("star-gold"), ptr("flawless"), true},
		{ptr("crown-gold"), nil, false},
		{ptr("star-black"), nil, false},
		{ptr("bogus"), nil, false},
		{nil, ptr("perfect"), false}, // an achievement isn't a title
		{nil, ptr("duelInstinct"), false},
		{nil, ptr("persistence"), false}, // level 8
		{nil, ptr("royalCrown"), false},
		{nil, ptr("master-science"), false},
		{nil, ptr("champion"), false},
		{nil, ptr("nosuch"), false},
	} {
		if err := w.g.SetLook(ctx, ana, c.avatar, c.title); (err == nil) != c.ok {
			t.Fatalf("SetLook(%v, %v): %v", deref(c.avatar), deref(c.title), err)
		}
	}
	b, _ := w.g.BoardOf(ctx, w.g.Today(), ana)
	if top := b.Top[0]; top.Avatar != "star-gold" || top.Title != "Безупречност" || top.TitleTier != Rare || top.Level < 2 {
		t.Fatalf("the board shows %+v", top)
	}
	if err := w.g.SetLook(ctx, ana, nil, ptr("")); err != nil {
		t.Fatal(err)
	}
	if look, _ := w.g.LookOf(ctx, ana); look.Title != "" || look.Avatar != "star-gold" {
		t.Fatalf("after taking the title off: %+v", look)
	}

	// A guest who signs in brings what they earned.
	vi := w.user()
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, ana, vi) }); err != nil {
		t.Fatal(err)
	}
	if p, _ := w.g.ProgressOf(ctx, vi); p.Avatar != "star-gold" || !slices.ContainsFunc(p.Achievements, func(e Earned) bool { return e.ID == "perfect" && e.At > 0 }) {
		t.Fatalf("after the merge: %+v", p)
	}
}

func ptr(s string) *string { return &s }

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

func TestLiveDuels(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, gal := w.user(), w.user(), w.user()
	rating := func(id int64) int {
		s, _ := w.g.StandingOf(ctx, id)
		return s.Rating
	}

	// Nothing recorded yet: nobody to play against.
	if _, err := w.g.StartRecorded(ctx, gal); !errors.Is(err, ErrNobody) {
		t.Fatalf("a recording out of nothing: %v", err)
	}

	// Ana and Bo, live: the same questions, a run each; a duel under way isn't in their lists yet.
	l, err := w.g.StartLive(ctx, ana, bo)
	if err != nil || len(l.Picks) != Length || l.Users != [2]int64{ana, bo} {
		t.Fatalf("a live duel: %+v %v", l, err)
	}
	if !slices.Equal(w.picks(l.Runs[0]), w.picks(l.Runs[1])) {
		t.Fatal("different questions for the two")
	}
	if d, _ := w.g.DuelsOf(ctx, ana); len(d) != 0 {
		t.Fatalf("a live duel listed while it's played: %+v", d)
	}
	w.play(ana, l.Runs[0], repeat(w.right, Length)...)
	w.play(bo, l.Runs[1], repeat(w.wrong, Length)...)
	da, _ := w.g.DuelsOf(ctx, ana)
	db, _ := w.g.DuelsOf(ctx, bo)
	if len(da) != 1 || da[0].State != "won" || db[0].State != "lost" || da[0].Friendly ||
		da[0].Delta <= 0 || rating(ana) != StartRating+da[0].Delta || rating(bo) != StartRating+db[0].Delta {
		t.Fatalf("the result: %+v / %+v", da, db)
	}

	// Again the same day: a friendly, the result kept but no rating moved.
	before := [2]int{rating(ana), rating(bo)}
	l, _ = w.g.StartLive(ctx, bo, ana)
	w.play(bo, l.Runs[0], repeat(w.right, Length)...)
	w.play(ana, l.Runs[1], repeat(w.wrong, Length)...)
	if da, _ = w.g.DuelsOf(ctx, ana); da[0].State != "lost" || !da[0].Friendly || da[0].Delta != 0 ||
		[2]int{rating(ana), rating(bo)} != before {
		t.Fatalf("a second duel the same day: %+v, ratings %d %d", da[0], rating(ana), rating(bo))
	}
	// The next day it counts again.
	w.wait(24 * time.Hour)
	l, _ = w.g.StartLive(ctx, ana, bo)
	w.play(ana, l.Runs[0], repeat(w.right, Length)...)
	w.play(bo, l.Runs[1], repeat(w.wrong, Length)...)
	if da, _ = w.g.DuelsOf(ctx, ana); da[0].Friendly || da[0].Delta <= 0 {
		t.Fatalf("the next day's duel: %+v", da[0])
	}

	// Gal, against a recording: its answers come with it, and only her rating moves.
	before = [2]int{rating(ana), rating(bo)}
	l, err = w.g.StartRecorded(ctx, gal)
	if err != nil || l.Users[0] != gal || l.Users[1] == gal || len(l.Recording) != Length {
		t.Fatalf("against a recording: %+v %v", l, err)
	}
	if l.Recording[0].Ms == 0 || (l.Recording[0].Right && l.Recording[0].Points == 0) {
		t.Fatalf("a recorded answer: %+v", l.Recording[0])
	}
	w.play(gal, l.Runs[0], repeat(w.wrong, Length)...)
	d, _ := w.g.DuelsOf(ctx, gal)
	if len(d) != 1 || !d[0].Recorded || d[0].Opponent == nil || d[0].State == "won" || rating(gal) > StartRating {
		t.Fatalf("Gal's duel against a recording: %+v, rating %d", d, rating(gal))
	}
	if [2]int{rating(ana), rating(bo)} != before {
		t.Fatal("a recorded player's rating moved")
	}

	// Called off (a player never came), and cut off (the server restarted): over, without a result.
	l, _ = w.g.StartLive(ctx, ana, gal)
	if err := w.g.CancelLive(ctx, l.DuelID); err != nil {
		t.Fatal(err)
	}
	l2, _ := w.g.StartLive(ctx, bo, gal)
	if err := w.g.EndLive(ctx); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int64{l.DuelID, l2.DuelID} {
		var outcome string
		_ = w.db.Read.QueryRow(`SELECT outcome FROM duels WHERE id = ?`, id).Scan(&outcome)
		if outcome != "expired" {
			t.Fatalf("duel %d: %q", id, outcome)
		}
	}
}

// The same points: the quicker wins only by a second or more over the game (TieBand); closer, it's a draw.
func TestTieBand(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	duel := func(slower time.Duration) DuelView {
		t.Helper()
		l, _ := w.g.StartLive(ctx, ana, bo)
		// Both as quick, answer for answer (the same points); Ana slower overall by `slower` (her line's).
		w.play(ana, l.Runs[0], repeat(w.right, Length)...)
		if _, err := w.db.Write.Exec(`UPDATE runs SET ms = ms + ? WHERE id = ?`, slower.Milliseconds(), l.Runs[0]); err != nil {
			t.Fatal(err)
		}
		w.play(bo, l.Runs[1], repeat(w.right, Length)...)
		d, err := w.g.DuelOf(ctx, bo, l.DuelID)
		if err != nil || d.You.Points != d.Opponent.Points {
			t.Fatalf("not the same points: %+v (%v)", d, err)
		}
		w.wait(24 * time.Hour) // each duel rated
		return d
	}
	if d := duel(900 * time.Millisecond); d.State != "draw" {
		t.Fatalf("0,9 s apart: %+v", d)
	}
	if d := duel(1500 * time.Millisecond); d.State != "won" {
		t.Fatalf("1,5 s apart: %+v", d)
	}
}

// One duel's result: how each question went for each side, the question that decided it, where the rating went, and
// the record between the two.
func TestDuelOf(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, gal, vi := w.user(), w.user(), w.user(), w.user()

	// Ana wins from the first question; the result says so on both sides.
	l, _ := w.g.StartLive(ctx, ana, bo)
	w.play(ana, l.Runs[0], repeat(w.right, Length)...)
	w.play(bo, l.Runs[1], repeat(w.wrong, Length)...)
	d, err := w.g.DuelOf(ctx, ana, l.DuelID)
	if err != nil || d.State != "won" || len(d.You.Marks) != Length || len(d.Opponent.Marks) != Length ||
		!d.You.Marks[0].Right || d.You.Marks[0].Ms == 0 || d.Opponent.Marks[0].Right || d.Decided != 1 {
		t.Fatalf("Ana's duel: %+v %v", d, err)
	}
	if r := d.Rating; r == nil || r.Before != StartRating || r.After != StartRating+d.Delta || r.Division.ID != "silver" ||
		r.Next == nil || r.Next.ID != "gold" || r.Rated != 1 || r.Of != MinRatedGames {
		t.Fatalf("Ana's rating: %+v", d.Rating)
	}
	if d.Record == nil || *d.Record != (Record{Won: 1}) {
		t.Fatalf("Ana's record against Bo: %+v", d.Record)
	}
	db, _ := w.g.DuelOf(ctx, bo, l.DuelID)
	if db.State != "lost" || db.Decided != 1 || db.Rating.After != StartRating+db.Delta || *db.Record != (Record{Lost: 1}) {
		t.Fatalf("Bo's side: %+v", db)
	}
	// Someone else's duel isn't theirs to see.
	if _, err := w.g.DuelOf(ctx, gal, l.DuelID); !errors.Is(err, ErrNoDuel) {
		t.Fatalf("Gal saw Ana's duel: %v", err)
	}

	// A friendly the same day: the record grows, the rating doesn't move (and isn't shown).
	l, _ = w.g.StartLive(ctx, bo, ana)
	w.play(bo, l.Runs[0], repeat(w.right, Length)...)
	w.play(ana, l.Runs[1], repeat(w.wrong, Length)...)
	if d, _ = w.g.DuelOf(ctx, ana, l.DuelID); !d.Friendly || d.Rating != nil || *d.Record != (Record{Won: 1, Lost: 1}) {
		t.Fatalf("a friendly: %+v", d)
	}

	// Against a recording: its marks, and no record against a recording's player.
	l, err = w.g.StartRecorded(ctx, vi)
	if err != nil {
		t.Fatal(err)
	}
	w.play(vi, l.Runs[0], repeat(w.wrong, Length)...)
	if d, _ = w.g.DuelOf(ctx, vi, l.DuelID); !d.Recorded || d.State != "lost" || len(d.Opponent.Marks) != Length ||
		d.Record != nil || d.Rating == nil || d.Rating.After != StartRating+d.Delta {
		t.Fatalf("against a recording: %+v", d)
	}
}

func TestDecided(t *testing.T) {
	marks := func(points ...int) []DuelMark {
		out := make([]DuelMark, len(points))
		for i, p := range points {
			out[i] = DuelMark{Points: p}
		}
		return out
	}
	sum := func(m []DuelMark) (n int) {
		for _, x := range m {
			n += x.Points
		}
		return n
	}
	for _, c := range []struct {
		name string
		a, b []DuelMark
		want int
	}{
		{"ahead from the first", marks(100, 0, 100), marks(0, 50, 0), 1},
		{"a lead lost and taken back on the last", marks(100, 0, 0, 200), marks(0, 150, 50, 0), 4},
		{"even after the second, ahead from the third", marks(100, 0, 100), marks(0, 100, 0), 3},
		{"the other won it on the second", marks(100, 0, 0), marks(0, 200, 0), 2},
		{"even points: the time decides", marks(100, 0), marks(0, 100), 0},
		{"nothing played", nil, nil, 0},
	} {
		if got := decided(c.a, c.b, sum(c.a), sum(c.b)); got != c.want {
			t.Errorf("%s: decided on %d, want %d", c.name, got, c.want)
		}
	}
	// The bonus for all right comes with the last question: it can turn the duel there.
	if got := decided(marks(100, 100), marks(300, 0), 200+AllRight, 300); got != 2 {
		t.Errorf("turned by the bonus: decided on %d", got)
	}
}

// befriend makes two players friends: a asked, b said yes.
func (w *world) befriend(a, b int64) {
	w.t.Helper()
	if err := w.g.befriend(w.t.Context(), a, b); err != nil {
		w.t.Fatal(err)
	}
}

func TestRatingAndDivisions(t *testing.T) {
	if d := eloDelta(1000, 1000, 0, 1); d != 20 {
		t.Fatalf("an even win moved %d", d)
	}
	if up, down := eloDelta(1000, 1400, 30, 1), eloDelta(1400, 1000, 30, 0); up <= 12 || up != -down {
		t.Fatalf("an upset: %d / %d", up, down)
	}
	for _, c := range []struct {
		rating int
		id     string
		next   int
	}{{0, "bronze", 900}, {899, "bronze", 900}, {StartRating, "silver", 1050}, {1050, "gold", 1200}, {1499, "diamond", 1500},
		{2400, "legend", 0}} {
		if d, next := DivisionOf(c.rating); d.ID != c.id || next != c.next {
			t.Errorf("DivisionOf(%d) = %s, next %d", c.rating, d.ID, next)
		}
	}
}

// placeDeltas: each place against each other counts as a duel won, lost or drawn (Роял's places move ratings so).
func TestPlaceDeltas(t *testing.T) {
	// The first wins, the two second share it, the last loses; all from the start.
	d := placeDeltas([]int{1, 2, 2, 4}, []int{StartRating, StartRating, StartRating, StartRating}, []int{0, 0, 0, 0})
	if d[0] <= 0 || d[3] >= 0 || d[1] != d[2] || d[0] <= d[1] {
		t.Fatalf("what the places did: %v", d)
	}
}

func TestAlmanac(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	a, err := w.g.AlmanacOf(ctx, ana, "", "", AlmanacPage)
	if err != nil || len(a.Facts) != 0 || a.All != 0 || len(a.Of) == 0 || a.Next != "" {
		t.Fatalf("an empty almanac: %+v %v", a, err)
	}
	s, _ := w.g.StartTopic(ctx, ana, "general")
	w.play(ana, s.ID, repeat(w.right, Length)...)
	a, _ = w.g.AlmanacOf(ctx, ana, "", "", AlmanacPage)
	for _, f := range a.Facts {
		if f.Fact == "" || f.Answer == "" || f.Category == "" {
			t.Fatalf("a learned fact: %+v", f)
		}
	}
	if len(a.Facts) == 0 || a.All != len(a.Facts) || a.Have["general"] != a.All {
		t.Fatalf("ten right answers in „general“: %d facts of %d, %v", len(a.Facts), a.All, a.Have)
	}
	// What was learned stays when its question leaves play, unless it wasn't so.
	n := len(a.Facts)
	q := mustQuestion(t, w, a.Facts[0].ID)
	q.Extra().Retired, q.Extra().RetiredWhy = true, "weak"
	if a, _ = w.g.AlmanacOf(ctx, ana, "", "", AlmanacPage); a.All != n {
		t.Fatalf("a question retired as weak left the almanac: %d of %d", a.All, n)
	}
	q.Extra().RetiredWhy = "wrong"
	if a, _ = w.g.AlmanacOf(ctx, ana, "", "", AlmanacPage); a.All != n-1 || len(a.Facts) != n-1 {
		t.Fatalf("a question retired as wrong stayed learned: %d of %d", a.All, n)
	}
}

// The almanac comes a page at a time, by topic or of all: every fact once, newest first, whatever is learned between
// one page and the next; the counts are of the whole.
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
			a, err := w.g.AlmanacOf(ctx, ana, topic, from, size)
			if err != nil || len(a.Facts) > size || a.All < len(ids) {
				t.Fatalf("a page of %d: %d facts of %d (%v)", size, len(a.Facts), a.All, err)
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
	var history []string
	for _, id := range want {
		if q, _ := w.b.Get(id); q.Base().Category == "history" {
			history = append(history, id)
		}
	}
	if got := all("history", 3, func() {}); len(history) == 0 || !slices.Equal(got, history) {
		t.Fatalf("history, by threes: %v, want %v", got, history)
	}
	// A fact learned while the player scrolls is at the top of the next look, not in the pages under way.
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
	if a, _ := w.g.AlmanacOf(ctx, ana, "", "", 1); len(a.Facts) != 1 || a.Facts[0].ID != fresh || a.All != len(ids)+1 ||
		a.Have["general"] != 1 {
		t.Fatalf("the newest fact first: %+v", a)
	}
}

func TestWardrobe(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	p, _ := w.g.ProgressOf(ctx, ana)
	if len(p.Frames) != len(Frames) || !p.Frames[0].Locked || p.Frames[0].How != "ниво 2" {
		t.Fatalf("a new player's frames: %+v", p.Frames)
	}
	if err := w.g.SetLook(ctx, ana, nil, nil, ptr("ring"), nil); !errors.Is(err, ErrNotYours) {
		t.Fatalf("a locked frame: %v", err)
	}
	// Two perfect runs make level 2: the ring is hers, and it shows wherever she does.
	for range 2 {
		s, _ := w.g.StartTopic(ctx, ana, "")
		w.play(ana, s.ID, repeat(w.right, Length)...)
	}
	if err := w.g.SetLook(ctx, ana, nil, nil, ptr("ring"), ptr("")); err != nil {
		t.Fatalf("an unlocked frame: %v", err)
	}
	if look, _ := w.g.LookOf(ctx, ana); !strings.HasSuffix(look.Avatar, "/ring/") {
		t.Fatalf("the look worn: %q", look.Avatar)
	}
	if err := w.g.SetLook(ctx, ana, nil, nil, ptr("halo"), nil); !errors.Is(err, ErrNotYours) {
		t.Fatalf("Легенда's frame at the start: %v", err)
	}
}

func TestLeagues(t *testing.T) {
	for _, c := range []struct{ n, up, down int }{{1, 0, 0}, {2, 0, 0}, {4, 0, 0}, {5, 2, 0}, {8, 2, 2}, {9, 3, 2}, {10, 5, 2},
		{14, 5, 3}, {15, 5, 5}, {20, 5, 5}} {
		if up, down := moves(c.n); up != c.up || down != c.down {
			t.Fatalf("a group of %d: %d up, %d down", c.n, up, down)
		}
	}
	if weekOf(time.Date(2026, 11, 12, 10, 0, 0, 0, Bulgaria)) != "2026-11-09" ||
		weekOf(time.Date(2026, 11, 15, 23, 59, 0, 0, Bulgaria)) != "2026-11-09" ||
		weekOf(time.Date(2026, 11, 16, 0, 0, 0, 0, Bulgaria)) != "2026-11-16" {
		t.Fatal("a week runs Monday to Sunday, in Bulgaria")
	}
	for _, c := range []struct {
		n    int
		want string
	}{{1, "Купата на Рила"}, {3, "Три купи на Рила"}, {12, "12 купи на Рила"}} {
		if name, tier := ChampionTitle(c.n); name != c.want || tier != Legendary {
			t.Fatalf("champion %d times: %q", c.n, name)
		}
	}

	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	// day plays the day's ten with so many right, the rest wrong.
	day := func(user int64, rights int) {
		w.dayGame(user, nil, append(repeat(w.right, rights), repeat(w.wrong, Length-rights)...)...)
	}
	ana, bo, cy := w.user(), w.user(), w.user()
	w.played(ana, LeagueFromDay-1) // the league's open to Ana: her week's end is told
	if v, err := w.g.LeagueOf(ctx, ana); err != nil || v.In || v.League.Name != "Странджа" || v.DaysLeft != 4 ||
		v.Week != "2026-11-09" {
		t.Fatalf("before a game: %+v %v", v, err)
	}
	// A topic's game, however good, puts nobody in the league: the day's questions do.
	s, err := w.g.StartTopic(ctx, cy, "science")
	if err != nil {
		t.Fatal(err)
	}
	w.play(cy, s.ID, repeat(w.right, Length)...)
	if v, _ := w.g.LeagueOf(ctx, cy); v.In {
		t.Fatal("a topic's game put a player in the league")
	}
	// Bo plays the day all right, Ana with seven: a group of two is still gathering, and shows nobody.
	day(bo, Length)
	day(ana, 7)
	if v, _ := w.g.LeagueOf(ctx, ana); !v.In || v.Size != 2 || len(v.Group) != 0 || v.Place != 0 || v.Up != 0 {
		t.Fatalf("a group of two: %+v", v)
	}
	// Three more with one right each: five race, Bo ahead.
	for range RaceSize - 2 {
		day(w.user(), 1)
	}
	v, err := w.g.LeagueOf(ctx, ana)
	if err != nil || !v.In || v.Size != RaceSize || len(v.Group) != RaceSize || v.Place != 2 || !v.Group[1].Me ||
		v.Group[0].Points <= v.Group[1].Points || v.Group[1].Points <= v.Group[2].Points || v.Up != 2 || v.Down != 0 ||
		v.Group[0].Name == "" {
		t.Fatalf("Ana's Thursday: %+v %v", v, err)
	}
	// Friday: Ana plays the day all right, and Bo misses it: a day missed adds nothing, and Ana goes ahead.
	w.now = time.Date(2026, 11, 13, 10, 0, 0, 0, Bulgaria)
	day(ana, Length)
	if v, _ := w.g.LeagueOf(ctx, ana); v.Place != 1 || !v.Group[0].Me || v.Group[1].Tag != "player2" {
		t.Fatalf("Ana's Friday: %+v", v)
	}

	// The week ends: Ana and Bo go up with first and second place's XP, the third stays with third's; told once.
	// The news is kept with the places, or neither is: a failure to keep it ends nothing, and it's done again. The week
	// closes once Sunday's last runs are in (weekLate), minutes into Monday.
	w.now = time.Date(2026, 11, 16, 0, 30, 0, 0, Bulgaria)
	w.g.LeagueNews = func(context.Context, *sql.Tx, []LeagueNews) error { return errors.New("no room") }
	if err := w.g.SettleDue(ctx); err == nil {
		t.Fatal("the week ended without its news")
	}
	var results int
	if _ = w.db.Read.QueryRow(`SELECT count(*) FROM league_results`).Scan(&results); results != 0 {
		t.Fatalf("the week ended without its news: %d places kept", results)
	}
	var told []LeagueNews
	w.g.LeagueNews = func(_ context.Context, _ *sql.Tx, n []LeagueNews) error { told = append(told, n...); return nil }
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	if len(told) != RaceSize || told[0].To != ana || told[0].Place != 1 || told[0].Of != RaceSize ||
		told[0].XP != LeaguePay[0] || told[0].Now.Tier != 1 || told[1].To != bo || told[1].XP != LeaguePay[1] ||
		told[1].Now.Tier != 1 || told[2].XP != LeaguePay[2] || told[2].Now.Tier != 0 || told[3].XP != 0 {
		t.Fatalf("the week's news: %+v", told)
	}
	if err := w.g.SettleDue(ctx); err != nil || len(told) != RaceSize {
		t.Fatalf("a week ended twice: %v", err)
	}
	n, err := w.g.NewsOf(ctx, ana, 0)
	if err != nil || n.League == nil || n.League.Place != 1 || n.League.Moved != 1 || n.League.Now.Name != "Средна гора" ||
		n.Earned < LeaguePay[0] || !slices.ContainsFunc(n.Achievements, func(a Earned) bool { return a.ID == "leagueUp" }) ||
		!slices.ContainsFunc(n.Achievements, func(a Earned) bool { return a.ID == "leagueFirst" }) {
		t.Fatalf("Ana's news: %+v %v", n, err)
	}
	if again, _ := w.g.NewsOf(ctx, ana, 0); again.League != nil {
		t.Fatalf("a week told twice: %+v", again.League)
	}
	if v, _ := w.g.LeagueOf(ctx, ana); v.In || v.League.Tier != 1 || v.Last == nil || v.Last.Place != 1 {
		t.Fatalf("Ana's new week: %+v", v)
	}
	// Ana and Bo race in Средна гора now, and Cy in Странджа: two and one, no race.
	day(ana, 2)
	day(bo, 1)
	day(cy, 1)
	if v, _ := w.g.LeagueOf(ctx, bo); !v.In || v.Size != 2 || v.League.Tier != 1 || v.Up != 0 {
		t.Fatalf("Ana and Bo in Средна гора: %+v", v)
	}
	if v, _ := w.g.LeagueOf(ctx, cy); !v.In || v.Size != 1 || v.League.Tier != 0 || v.Up != 0 {
		t.Fatalf("Cy alone in Странджа: %+v", v)
	}

	// A group of eight in Родопи: the first two go up, the last two down, the rest stay. The second has fewer points
	// than the third, and more right answers: they're ahead, though they came later.
	monday := "2026-11-16"
	res, _ := w.db.Write.Exec(`INSERT INTO league_groups (week, tier) VALUES (?, 2)`, monday)
	group, _ := res.LastInsertId()
	var eight []int64
	for i, points := range []int{8000, 6500, 7000, 5000, 4000, 3000, 2000, 1000} {
		p := w.user()
		eight = append(eight, p)
		rights, joined := 5, i
		if i == 1 {
			rights, joined = 6, 10
		}
		_, _ = w.db.Write.Exec(`UPDATE users SET league = 2 WHERE id = ?`, p)
		_, _ = w.db.Write.Exec(`INSERT INTO league_members (week, user_id, group_id, joined_at) VALUES (?, ?, ?, ?)`,
			monday, p, group, joined)
		if _, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, started_at, finished_at, points, rights)
			VALUES (?, 'day', '2026-11-17', '[]', 0, 1, ?, ?)`, p, points, rights); err != nil {
			t.Fatal(err)
		}
	}
	// And five in Рила: the first is its champion, and can go no higher.
	top1, top2 := w.user(), w.user()
	w.played(top1, LeagueFromDay-1)
	rila := []int64{top1, top2, w.user(), w.user(), w.user()}
	for i, p := range rila {
		_, _ = w.db.Write.Exec(`UPDATE users SET league = 5 WHERE id = ?`, p)
		day(p, map[bool]int{true: Length, false: 5 - i}[i == 0])
	}
	w.now = time.Date(2026, 11, 23, 0, 30, 0, 0, Bulgaria)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	// Ana, first of two in Средна гора, goes nowhere, is paid nothing, and is no group's first for it.
	var moved, paid int
	_ = w.db.Read.QueryRow(`SELECT moved, xp FROM league_results WHERE user_id = ? AND week = ?`, ana, monday).Scan(&moved, &paid)
	if firsts, _ := w.g.leagueFirsts(ctx, ana); moved != 0 || paid != 0 || firsts[1] != 0 || firsts[0] != 1 {
		t.Fatalf("a group of two: moved %d, paid %d, firsts %v", moved, paid, firsts)
	}
	for i, p := range eight {
		var tier int
		_ = w.db.Read.QueryRow(`SELECT league FROM users WHERE id = ?`, p).Scan(&tier)
		want := map[bool]int{true: 3}[i < 2] + map[bool]int{true: 2}[i >= 2 && i < 6] + map[bool]int{true: 1}[i >= 6]
		if tier != want {
			t.Fatalf("place %d of eight is in league %d, not %d", i+1, tier, want)
		}
	}
	var tier int
	_ = w.db.Read.QueryRow(`SELECT league FROM users WHERE id = ?`, top1).Scan(&tier)
	if tier != TopLeague {
		t.Fatalf("Рила's first went to league %d", tier)
	}
	// Рила's first may wear the champion's title and the top frame; the second may not.
	if err := w.g.SetLook(ctx, top1, nil, ptr("champion"), ptr("peak5"), nil); err != nil {
		t.Fatalf("the champion's look: %v", err)
	}
	if err := w.g.SetLook(ctx, top2, nil, ptr("champion"), nil, nil); !errors.Is(err, ErrNotYours) {
		t.Fatalf("the champion's title, second: %v", err)
	}
	if err := w.g.SetLook(ctx, top2, nil, nil, ptr("peak3"), nil); !errors.Is(err, ErrNotYours) {
		t.Fatalf("a peak's frame without a first place: %v", err)
	}
	if look, _ := w.g.LookOf(ctx, top1); look.Title != "Купата на Рила" || !strings.Contains(look.Avatar, "/peak5/") {
		t.Fatalf("the champion's look: %+v", look)
	}
	n, _ = w.g.NewsOf(ctx, top1, 0)
	if !slices.ContainsFunc(n.Achievements, func(a Earned) bool { return a.ID == "rila" }) ||
		!slices.ContainsFunc(n.Unlocks, func(u Unlock) bool { return u.ID == championID && u.Name == "Купата на Рила" }) {
		t.Fatalf("the champion's news: %+v", n)
	}

	// The rating's board: everyone with enough rated games, by rating.
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1300, rated = ? WHERE id = ?`, MinRatedGames, ana)
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1500, rated = 3 WHERE id = ?`, bo)
	if b, err := w.g.RatingBoard(ctx, bo, false); err != nil || len(b.Top) != 1 || b.Top[0].Value != 1300 ||
		b.Top[0].Division == nil || b.Place != 0 {
		t.Fatalf("the rating's board: %+v %v", b, err)
	}
}

func TestTitles(t *testing.T) {
	// Titles are their own: each unlocked by something there is, none an achievement's name.
	ids := map[string]bool{}
	for _, tt := range Titles {
		if ids[tt.ID] || tt.Name == "" || tt.Tier == "" {
			t.Fatalf("title %+v", tt)
		}
		ids[tt.ID] = true
		if _, ok := achievementByID(tt.by.achieved); tt.by.achieved != "" && !ok {
			t.Fatalf("%s is unlocked by no achievement", tt.ID)
		}
		if slices.ContainsFunc(Achievements, func(a Achievement) bool { return a.Name == tt.Name }) {
			t.Fatalf("%s is an achievement's name", tt.Name)
		}
	}

	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	w.played(ana, XPFromDay)
	p, _ := w.g.ProgressOf(ctx, ana)
	topics := len(w.g.Bank().Categories)*len(topicTiers) + len(acrossTopics)
	if len(p.Titles) != 1+len(Titles)+topics || p.Titles[0].ID != championID || p.Titles[0].Name != "Купата на Рила" ||
		p.Titles[0].How != championHow {
		t.Fatalf("a new player's titles: %+v", p.Titles)
	}
	byID := map[string]TitleView{}
	for _, v := range p.Titles {
		byID[v.ID] = v
		if v.Locked == (v.ID == "spark") || (v.Locked && v.How == "") || v.Group == "" {
			t.Fatalf("a new player's title %+v", v)
		}
	}
	if v := byID["polymath"]; v.How != "скрито постижение" {
		t.Fatalf("a hidden achievement's title tells how: %+v", v)
	}
	if v := byID["unquenched"]; v.How != "постижението „Цял месец“" {
		t.Fatalf("an achievement's title: %+v", v)
	}
	if v := byID["master-history"]; v.Name != "Майстор · История" || v.How != "„Майстор“ в „История“" ||
		v.Group != TitleTopic {
		t.Fatalf("a topic's title: %+v", v)
	}
	if v := byID["diamondMind"]; v.How != "дивизия Диамант" {
		t.Fatalf("a division's title: %+v", v)
	}

	// Until they choose, a player wears their level's title, the newest as the level grows: none at the start (the
	// first, everyone's, would only mark them new on every board), though it's theirs to choose.
	if look, _ := w.g.LookOf(ctx, ana); look.Title != "" || p.Title != "" || !p.TitleByLevel {
		t.Fatalf("a new player's title: %+v %q, by level %v", look, p.Title, p.TitleByLevel)
	}
	if err := w.g.SetLook(ctx, ana, nil, ptr("spark")); err != nil {
		t.Fatalf("the first title, chosen: %v", err)
	}
	if look, _ := w.g.LookOf(ctx, ana); look.Title != "Нова искра" {
		t.Fatalf("the first title, chosen: %+v", look)
	}
	if _, err := w.db.Write.Exec(`UPDATE users SET title = NULL WHERE id = ?`, ana); err != nil {
		t.Fatal(err)
	}

	// A level's title, told when the level is.
	if _, err := w.db.Write.Exec(`INSERT INTO goals_done (user_id, day, goal, at, xp, seen) VALUES (?, '2026-11-01', 'x', 1, 2100, 1)`, ana); err != nil {
		t.Fatal(err)
	}
	// Everything the levels up to 5 unlock is told with it (but the first level's title, worn from the start): the
	// titles, a frame, a pattern.
	n, err := w.g.NewsOf(ctx, ana, 0)
	told := []string{}
	for _, u := range n.Unlocks {
		told = append(told, u.Kind+":"+u.ID+" "+u.From)
	}
	if err != nil || n.Level != 5 || !slices.Equal(told, []string{"title:curious ниво 3",
		"title:passion ниво 5", "frame:ring ниво 2", "frame:double ниво 5", "backdrop:dots ниво 3"}) {
		t.Fatalf("level 5's news: %v %+v %v", told, n, err)
	}
	if p, _ := w.g.ProgressOf(ctx, ana); p.Next.Level != 6 || len(p.Next.LevelUnlocks) != 1 ||
		p.Next.LevelUnlocks[0].ID != "stripes" || p.Next.Division != nil || p.Next.Days == nil ||
		p.Next.Days.Title.ID != "persistence" || p.Next.Days.Days != 14 {
		t.Fatalf("what's next at level 5: %+v", p.Next)
	}
	if look, _ := w.g.LookOf(ctx, ana); look.Title != "Страст към викторините" {
		t.Fatalf("level 5's title, not chosen: %+v", look)
	}
	// „Без титла“ is a choice, and stays one.
	if err := w.g.SetLook(ctx, ana, nil, ptr("")); err != nil {
		t.Fatal(err)
	}
	if look, _ := w.g.LookOf(ctx, ana); look.Title != "" {
		t.Fatalf("no title, chosen: %+v", look)
	}
	if p, _ := w.g.ProgressOf(ctx, ana); p.Title != "" || p.TitleByLevel {
		t.Fatalf("no title, chosen, in the wardrobe: %q, by level %v", p.Title, p.TitleByLevel)
	}
	if err := w.g.SetLook(ctx, ana, nil, ptr("passion")); err != nil {
		t.Fatalf("level 5's title: %v", err)
	}
	if look, _ := w.g.LookOf(ctx, ana); look.Title != "Страст към викторините" || look.TitleTier != Common {
		t.Fatalf("the look: %+v", look)
	}

	// A Роял won, with someone else in it; alone, it doesn't count.
	royal := func(players ...int64) {
		res, err := w.db.Write.Exec(`INSERT INTO royals (questions, created_at, closes_at, ended_at) VALUES ('[]', 1, 1, 1)`)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		for i, u := range players {
			if _, err := w.db.Write.Exec(`INSERT INTO royal_players (royal_id, user_id, joined_at, place) VALUES (?, ?, 1, ?)`,
				id, u, i+1); err != nil {
				t.Fatal(err)
			}
		}
	}
	royal(bo)
	if err := w.g.SetLook(ctx, bo, nil, ptr("royalCrown")); !errors.Is(err, ErrNotYours) {
		t.Fatalf("a Роял alone: %v", err)
	}
	royal(bo, ana)
	if err := w.g.SetLook(ctx, bo, nil, ptr("royalCrown")); err != nil {
		t.Fatalf("a Роял won: %v", err)
	}
	if err := w.g.SetLook(ctx, ana, nil, ptr("royalCrown")); !errors.Is(err, ErrNotYours) {
		t.Fatalf("second in a Роял: %v", err)
	}
}

func TestBoards(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy := w.user(), w.user(), w.user()
	// Ana knows the day's ten; Bo misses them all; Cy plays nothing.
	for _, p := range []struct {
		id    int64
		right bool
	}{{ana, true}, {bo, false}} {
		for range KnowAll / Length {
			s, err := w.g.StartTopic(ctx, p.id, "")
			if err != nil {
				t.Fatal(err)
			}
			if p.right {
				w.play(p.id, s.ID, repeat(w.right, Length)...)
			} else {
				w.play(p.id, s.ID, repeat(w.wrong, Length)...)
			}
		}
	}
	k, err := w.g.KnowledgeBoard(ctx, bo, false, "")
	if err != nil || len(k.Top) != 2 || k.Top[0].Value < 90 || k.Top[0].Tier != "Светило" || k.Top[0].Answers != KnowAll || k.Place != 2 ||
		k.Mine.Value > 10 || k.Mine.Tier != "Новак" {
		t.Fatalf("the board of knowledge: %+v %v", k, err)
	}
	if _, err := w.g.KnowledgeBoard(ctx, bo, false, "nope"); !errors.Is(err, ErrNoTopic) {
		t.Fatalf("a topic there isn't: %v", err)
	}
	topic := w.b.Categories[0].ID
	if k, _ := w.g.KnowledgeBoard(ctx, bo, false, topic); len(k.Top) != 0 {
		t.Fatalf("a topic nobody has %d answers in: %+v", KnowTopic, k)
	}
	_ = w.g.befriend(ctx, cy, bo)
	if k, _ := w.g.KnowledgeBoard(ctx, cy, true, ""); len(k.Top) != 1 || k.Place != 0 || k.Top[0].Value > 10 {
		t.Fatalf("knowledge among friends: %+v", k)
	}
}

// The boards of knowledge count everyone's answers once in a while, and the viewer's own whenever they look.
func TestKnowledgeCounted(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	w.pace = func(int) time.Duration { return 2 * time.Second } // a person's, and Bo's games well inside knowFresh
	games := func(id int64, answer func(int64, int) json.RawMessage) {
		for range KnowAll / Length {
			s, err := w.g.StartTopic(ctx, id, "")
			if err != nil {
				t.Fatal(err)
			}
			w.play(id, s.ID, repeat(answer, Length)...)
		}
	}
	games(ana, w.right)
	if k, err := w.g.KnowledgeBoard(ctx, bo, false, ""); err != nil || len(k.Top) != 1 || k.Mine != nil {
		t.Fatalf("before Bo plays: %+v %v", k, err)
	}
	games(bo, w.wrong)
	// Bo sees their own at once, in their place; Ana sees the count, which hasn't got Bo yet.
	if k, _ := w.g.KnowledgeBoard(ctx, bo, false, ""); len(k.Top) != 2 || k.Place != 2 || k.Mine.Value > 10 ||
		k.Mine.Answers != KnowAll || !k.Top[1].Me {
		t.Fatalf("Bo, just played: %+v", k)
	}
	if k, _ := w.g.KnowledgeBoard(ctx, ana, false, ""); len(k.Top) != 1 || k.Place != 1 {
		t.Fatalf("Ana, before the next count: %+v", k)
	}
	// Once the count is old, the next look counts again (in the background), and the one after has Bo.
	w.wait(knowFresh)
	_, _ = w.g.KnowledgeBoard(ctx, ana, false, "")
	w.g.known.settle() // the count under way, done
	if k, _ := w.g.KnowledgeBoard(ctx, ana, false, ""); len(k.Top) != 2 || k.Place != 1 || k.Top[1].Value > 10 {
		t.Fatalf("Ana, after the next count: %+v", k)
	}
}

// The boards of knowledge rank by mastery, not by the share right: a player who gets fewer right of hard questions
// knows more than one who gets more right of easy ones. A topic's board waits for a sure mark there.
func TestKnowledgeByMastery(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	of := func(d bank.Difficulty) []string {
		var ids []string
		for _, q := range w.b.Questions {
			if h := q.Base(); h.Difficulty == d && !q.Extra().Retired {
				ids = append(ids, h.ID)
			}
		}
		return ids
	}
	// answer gives a player n answers to these questions in turn, the first `right` of every ten right.
	answer := func(user int64, ids []string, n, right int) {
		res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at, finished_at) VALUES (?, 'topic', '[]', 0, 1)`, user)
		if err != nil {
			t.Fatal(err)
		}
		run, _ := res.LastInsertId()
		for i := range n {
			ok := i%Length < right
			if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, score, points, is_right, ms, at)
				VALUES (?, ?, ?, ?, 0, ?, 3000, ?)`, run, i, ids[i%len(ids)], map[bool]float64{true: 1}[ok], ok, i); err != nil {
				t.Fatal(err)
			}
		}
	}
	ana, bo := w.user(), w.user()
	answer(ana, of(bank.Hard), KnowAll, 6) // 60% right, of hard questions
	answer(bo, of(bank.Easy), KnowAll, 8)  // 80% right, of easy ones
	k, err := w.g.KnowledgeBoard(ctx, 0, false, "")
	if err != nil || len(k.Top) != 2 || k.Top[0].Tag != "player1" || k.Top[0].Value <= k.Top[1].Value ||
		k.Top[0].Tier == "" || k.Top[0].Answers != KnowAll {
		t.Fatalf("by mastery: %+v %v", k, err)
	}
	// As each sees it (their own gone over exactly): the same.
	if k, _ := w.g.KnowledgeBoard(ctx, bo, false, ""); k.Place != 2 || k.Mine.Value != k.Top[1].Value {
		t.Fatalf("as Bo sees it: %+v", k)
	}
	// In a topic, only a sure mark there counts: KnowTopic answers of it.
	topic := w.b.Categories[0].ID
	var ids []string
	for _, q := range w.b.Live(topic, "") {
		ids = append(ids, q.Base().ID)
	}
	cy := w.user()
	answer(cy, ids, KnowTopic-1, 10)
	if k, _ := w.g.KnowledgeBoard(ctx, cy, false, topic); len(k.Top) != 0 || k.Mine != nil {
		t.Fatalf("a topic's board before a sure mark: %+v", k)
	}
	answer(cy, ids, 1, 10)
	if k, _ := w.g.KnowledgeBoard(ctx, cy, false, topic); len(k.Top) != 1 || k.Place != 1 || k.Top[0].Answers != KnowTopic {
		t.Fatalf("a topic's board with a sure mark: %+v", k)
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
			if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, score, points, is_right, ms, at)
				VALUES (?, ?, ?, 1, 100, 1, 900, ?)`, id, n, picks[0].ID, w.now.UnixMilli()); err != nil {
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
	// The rarest right answer for the result shared: the second, which two in ten got.
	rare, err := w.g.RarestRight(ctx, bo, "2026-11-12")
	if err != nil {
		t.Fatal(err)
	}
	if rare == nil || rare.N != 1 || math.Abs(rare.Right-0.2) > 1e-9 {
		t.Fatalf("the rarest right answer: %+v", rare)
	}
	// None for a day not finished (ana left it after one question).
	if rare, _ := w.g.RarestRight(ctx, ana, "2026-11-12"); rare != nil {
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

func TestMistakes(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	// Ten wrong in a topic, then nothing waits until three days have passed.
	s, _ := w.g.StartTopic(ctx, ana, "general")
	missed := w.picks(s.ID)
	w.play(ana, s.ID, repeat(w.wrong, Length)...)
	if n, _ := w.g.Mistakes(ctx, ana); n != 0 {
		t.Fatalf("%d waiting at once", n)
	}
	if _, err := w.g.StartMistakes(ctx, ana); !errors.Is(err, ErrNoMistakes) {
		t.Fatalf("a second chance at once: %v", err)
	}
	w.wait(MistakesAfter)
	if n, _ := w.g.Mistakes(ctx, ana); n != Length {
		t.Fatalf("%d waiting after three days", n)
	}
	m, err := w.g.StartMistakes(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if m.Kind != "mistakes" || m.Total != Length {
		t.Fatalf("the run: %+v", m)
	}
	for i, p := range w.picks(m.ID) {
		if p.ID != missed[i].ID {
			t.Fatalf("question %d is %s, not the one missed first (%s)", i, p.ID, missed[i].ID)
		}
	}
	// Right on the first, and its fact is learned; wrong on the rest, which wait three days again.
	w.show(ana, m.ID)
	res, err := w.g.Answer(ctx, ana, m.ID, 0, w.right(m.ID, 0))
	if err != nil {
		t.Fatal(err)
	}
	q, _ := w.b.Get(missed[0].ID)
	if res.Learned != (q.Extra().Fact != "") {
		t.Errorf("learned = %v for a question with fact %q", res.Learned, q.Extra().Fact)
	}
	// Left after it and come back to: the same second chance, from the second question.
	if again, err := w.g.StartMistakes(ctx, ana); err != nil || again.ID != m.ID || again.At != 1 {
		t.Fatalf("back to the second chance: %+v %v", again, err)
	}
	if left, _ := w.g.Left(ctx, ana); len(left) != 1 || left[0].ID != m.ID || left[0].Kind != "mistakes" || left[0].At != 1 {
		t.Fatalf("left: %+v", left)
	}
	for n := 1; n < Length; n++ {
		w.show(ana, m.ID)
		if _, err := w.g.Answer(ctx, ana, m.ID, n, w.wrong(m.ID, n)); err != nil {
			t.Fatal(err)
		}
	}
	if n, _ := w.g.Mistakes(ctx, ana); n != 0 {
		t.Fatalf("%d waiting right after a second chance", n)
	}
	w.wait(MistakesAfter)
	if n, _ := w.g.Mistakes(ctx, ana); n != Length-1 {
		t.Fatalf("%d waiting again, want the %d still wrong", n, Length-1)
	}
	// A right answer in a topic run is never a second chance's „learned“.
	s, _ = w.g.StartTopic(ctx, ana, "general")
	w.show(ana, s.ID)
	if res, _ := w.g.Answer(ctx, ana, s.ID, 0, w.right(s.ID, 0)); res.Learned {
		t.Error("learned in a topic run")
	}
}
