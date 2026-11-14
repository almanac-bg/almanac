package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

type world struct {
	t    *testing.T
	g    *Game
	db   *store.DB
	b    *bank.Bank
	now  time.Time
	next int64
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
		if _, err := w.g.Show(w.t.Context(), user, runID); err != nil {
			w.t.Fatal(err)
		}
		if _, err := w.g.Start(w.t.Context(), user, runID, n); err != nil { // its pictures in, if it has any
			w.t.Fatal(err)
		}
		w.wait(3 * time.Second)
		res, err := w.g.Answer(w.t.Context(), user, runID, n, answer(runID, n))
		if err != nil {
			w.t.Fatalf("answer %d: %v", n, err)
		}
		s = res.State
	}
	return s
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
	for i, p := range picks {
		q, _ := w.b.Get(p.ID)
		topics[q.Base().Category] = true
		if want := daySlots[i].typ; q.Base().Type != want && (want == "order" || want == "number") {
			t.Errorf("place %d is a %s, not a %s", i, q.Base().Type, want)
		}
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

// The first level comes with the run that passes 300 XP, in the news once.
func TestLevelUpNews(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	bo := w.user()
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
	if err != nil || res.Points != WorthOf(w.question(s.ID, 0), 1, 0, 1).Points || !res.Right || res.State.At != 1 || res.Reveal == nil {
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

// A question with a picture waits for it: its time starts once the player's screen has it in, or PictureWait after
// it's shown at the latest. A live duel's starts at once (the match keeps the time).
func TestPictureTime(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	s, _ := w.g.StartDay(ctx, u)
	picks := w.picks(s.ID)
	picks[0].ID, picks[1].ID, picks[2].ID = "geo-901", "geo-902", "geo-903"
	raw, _ := json.Marshal(picks)
	if _, err := w.db.Write.Exec(`UPDATE runs SET questions = ? WHERE id = ?`, string(raw), s.ID); err != nil {
		t.Fatal(err)
	}
	if q, _ := w.b.Get("geo-901"); !bank.HasPictures(q) {
		t.Fatal("geo-901 has no picture")
	}

	// Shown, waiting: the full time, and when it starts by itself.
	shown, _ := w.g.Show(ctx, u, s.ID)
	if q := shown.Question; q == nil || q.LeftMs != q.LimitMs || q.StartsMs != PictureWait.Milliseconds() {
		t.Fatalf("shown, waiting for its picture: %+v", q)
	}
	w.wait(2 * time.Second) // the picture loading
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
	w.wait(time.Second)
	if again, _ := w.g.Start(ctx, u, s.ID, 0); again.Question.LeftMs != again.Question.LimitMs-1000 {
		t.Fatalf("started twice: %+v", again.Question)
	}
	w.wait(5 * time.Second)
	res, err := w.g.Answer(ctx, u, s.ID, 0, w.right(s.ID, 0))
	if err != nil || res.Points != WorthOf(w.question(s.ID, 0), 1, 6*time.Second, 1).Points {
		t.Fatalf("answered 6 s after it started: %+v %v", res, err)
	}

	// Never started by the screen: it starts by itself, PictureWait after it's shown.
	_, _ = w.g.Show(ctx, u, s.ID)
	w.wait(PictureWait + Limit(w.question(s.ID, 1)))
	if st, _ := w.g.State(ctx, u, s.ID); st.At != 1 || st.Question == nil || st.Question.LeftMs != 0 {
		t.Fatalf("its time, after it started by itself: %+v", st.Question)
	}
	w.wait(Grace + time.Second)
	if st, _ := w.g.State(ctx, u, s.ID); st.At != 2 {
		t.Fatalf("not out of time after PictureWait and its time: %+v", st)
	}

	// A live duel's starts at once.
	now, _ := w.g.ShowNow(ctx, u, s.ID)
	if now.Question.StartsMs != 0 {
		t.Fatalf("a live duel's question waits: %+v", now.Question)
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
	w.setGoals(ana, "day", "duel", "duelWin") // goals the day's questions alone don't finish: no reserve day
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	if n, _ := w.g.Streak(ctx, ana); n != 2 {
		t.Fatalf("streak %d after two days", n)
	}
	w.wait(48 * time.Hour)
	if n, _ := w.g.Streak(ctx, ana); n != 0 {
		t.Fatalf("streak %d after missing a day", n)
	}
	if week, _ := w.g.Week(ctx, ana); week != [7]bool{3: true, 4: true} {
		t.Fatalf("week %v on Sunday, after Thursday and Friday", week)
	}
	w.wait(24 * time.Hour)
	if week, _ := w.g.Week(ctx, ana); week != [7]bool{} {
		t.Fatalf("week %v on a new Monday", week)
	}
}

// The day's three goals done earn a reserve day; a missed day spends it, and the streak holds.
func TestReserveDays(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	full := func() {
		s, _ := w.g.StartDay(ctx, ana)
		w.play(ana, s.ID, repeat(w.right, Length)...)
		for i := range GoalsPerDay {
			_, _ = w.db.Write.Exec(`INSERT OR IGNORE INTO goals_done (user_id, day, goal, at, xp, seen) VALUES (?, ?, ?, 1, 0, 1)`,
				ana, w.g.Today(), fmt.Sprint("g", i))
		}
	}
	full()
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 1 || s.Reserve != 1 {
		t.Fatalf("after a full day: %+v", s)
	}
	w.wait(48 * time.Hour) // a day missed
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 1 || s.Reserve != 0 || len(s.Saved) != 1 || s.Saved[0] != "2026-11-13" {
		t.Fatalf("a day missed, with a reserve: %+v", s)
	}
	if saved := w.g.InWeek([]string{"2026-11-13"}); saved != [7]bool{4: true} {
		t.Fatalf("the saved day this week: %v", saved)
	}
	full()
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 2 || s.Reserve != 1 {
		t.Fatalf("played on after a reserve: %+v", s)
	}
	w.wait(72 * time.Hour) // two days missed, one reserve
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 0 || s.Reserve != 0 || len(s.Saved) != 0 {
		t.Fatalf("two days missed: %+v", s)
	}
}

// A division reached is told once with what it unlocks; an achievement's reward is only what's new to the player; a
// player from before unlocks were kept isn't told of what they have.
func TestUnlocks(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, old := w.user(), w.user()
	_, _ = w.g.NewsOf(ctx, ana, 0)
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1200, peak = 1200 WHERE id = ?`, ana)
	n, err := w.g.NewsOf(ctx, ana, 0)
	got := []string{}
	for _, u := range n.Unlocks {
		got = append(got, u.Kind+":"+u.ID+" "+u.From)
	}
	if err != nil || n.Division == nil || n.Division.ID != "gold" ||
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

	// The shield is duel1's: once it's earned, duel10 gives its XP and its title, not the shield.
	_, _ = w.db.Write.Exec(`INSERT INTO achievements (user_id, id, at, xp, seen) VALUES (?, 'duel1', 1, 50, 1)`, ana)
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
	_, _ = w.db.Write.Exec(`UPDATE users SET unlocks_known = 0, peak = 1500, peak_seen = 1500 WHERE id = ?`, old)
	if n, _ := w.g.NewsOf(ctx, old, 0); len(n.Unlocks) != 0 || n.Division != nil {
		t.Fatalf("a player from before: %+v", n)
	}
	_, _ = w.db.Write.Exec(`UPDATE users SET peak = 1700 WHERE id = ?`, old)
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
	if all, _ := w.g.StartTopic(ctx, u, ""); all.ID == first.ID {
		t.Fatal("all the topics went on with history's run")
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
	if !music.Sure || music.Answers < Length || s.Recent[0].Kind != "topic" || s.Recent[0].Total != Length {
		t.Fatalf("music %+v, recent %+v", music, s.Recent)
	}
}

func TestFriends(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi := w.user(), w.user(), w.user()
	code, err := w.g.InviteCode(ctx, ana)
	if again, _ := w.g.InviteCode(ctx, ana); err != nil || len(code) != 8 || again != code {
		t.Fatalf("Ana's invite: %q, again %q, %v", code, again, err)
	}
	if _, _, err := w.g.Befriend(ctx, ana, code); !errors.Is(err, ErrOwnInvite) {
		t.Fatalf("befriended oneself: %v", err)
	}
	if _, _, err := w.g.Befriend(ctx, bo, "nosuchcd"); !errors.Is(err, ErrNoInvite) {
		t.Fatalf("a made-up invite: %v", err)
	}
	if id, _, err := w.g.Befriend(ctx, bo, code); err != nil || id != ana {
		t.Fatalf("Bo befriends Ana: %d %v", id, err)
	}
	if _, _, err := w.g.Befriend(ctx, bo, code); err != nil {
		t.Fatalf("befriending again: %v", err)
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
	as, duel, err := w.g.ChallengeFriend(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, as.ID, repeat(w.right, Length)...)
	bs, err := w.g.PlayDuel(ctx, bo, duel)
	if err != nil {
		t.Fatal(err)
	}
	w.play(bo, bs.ID, repeat(w.wrong, Length)...)
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
	p, err := w.g.ProgressOf(ctx, ana)
	if err != nil || p.Level != 1 || p.Avatar != DefaultAvatar(ana) || len(p.Achievements) != len(Achievements) ||
		p.Achievements[0].At != 0 {
		t.Fatalf("a new player's progress: %+v %v", p, err)
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
	// (A perfect day earns 20 XP an answer and 100 for the day, 300, and the goals it finished more: the first level.)
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
		n.XP != 300+goals || lvl < 2 ||
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
	if a := byID["answers100"]; a.At != 0 || a.Progress != Length || a.Goal != 100 {
		t.Fatalf("answers100 after ten answers: %+v", a)
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

	// What's earned may be worn; what isn't, can't.
	for _, c := range []struct {
		avatar, title *string
		ok            bool
	}{
		{nil, ptr("master-history"), true}, // ten right in history: sure, and a master
		{ptr("star-gold"), ptr("flawless"), true},
		{ptr("crown-gold"), nil, false},
		{ptr("star-black"), nil, false},
		{ptr("bogus"), nil, false},
		{nil, ptr("perfect"), false}, // an achievement isn't a title
		{nil, ptr("duelInstinct"), false},
		{nil, ptr("erudition"), false}, // level 8
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
	if _, err := w.g.Request(ctx, ana, tag(ana), false); !errors.Is(err, ErrOwnInvite) {
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
	var told []DuelNews
	w.g.DuelNews = func(_ context.Context, n DuelNews) { told = append(told, n) }
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
	if len(da) != 1 || da[0].Kind != "live" || da[0].State != "won" || db[0].State != "lost" || da[0].Friendly ||
		da[0].Delta <= 0 || rating(ana) != StartRating+da[0].Delta || rating(bo) != StartRating+db[0].Delta {
		t.Fatalf("the result: %+v / %+v", da, db)
	}
	if len(told) != 2 || told[0].Kind != "result" || told[0].Friendly {
		t.Fatalf("told: %+v", told)
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

func TestFriendDuels(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, vi, stranger := w.user(), w.user(), w.user()
	var told []DuelNews
	w.g.DuelNews = func(_ context.Context, n DuelNews) { told = append(told, n) }
	if _, _, err := w.g.ChallengeFriend(ctx, ana, stranger); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("challenged a stranger: %v", err)
	}
	w.befriend(ana, vi)

	// Ana plays first; Vi can't before, and hears of it only once Ana has finished.
	s, id, err := w.g.ChallengeFriend(ctx, ana, vi)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.PlayDuel(ctx, vi, id); !errors.Is(err, ErrNoDuel) {
		t.Fatalf("Vi played before Ana: %v", err)
	}
	if c, _ := w.g.Challenges(ctx, vi); len(c) != 0 {
		t.Fatalf("Vi challenged before Ana played: %+v", c)
	}
	w.wait(time.Hour)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	if len(told) != 1 || told[0].To != vi || told[0].Kind != "asked" || told[0].DuelID != id {
		t.Fatalf("Vi wasn't told: %+v", told)
	}
	// Her 48 hours start now, not when Ana began.
	c, _ := w.g.Challenges(ctx, vi)
	if len(c) != 1 || c[0].ID != id || c[0].ExpiresAt != w.now.Add(FriendFor).UnixMilli() {
		t.Fatalf("Vi's challenge: %+v", c)
	}
	if d, _ := w.g.DuelsOf(ctx, vi); d[0].State != "play" || d[0].Opponent.Points != 0 {
		t.Fatalf("Vi sees Ana's score before playing: %+v", d[0])
	}
	vs, err := w.g.PlayDuel(ctx, vi, id)
	if err != nil {
		t.Fatal(err)
	}
	w.play(vi, vs.ID, repeat(w.wrong, Length)...)
	if d, _ := w.g.DuelsOf(ctx, vi); d[0].State != "lost" || d[0].Delta >= 0 {
		t.Fatalf("Vi's duel after both played: %+v", d[0])
	}

	// A friend may say no; and one not played in time ends without a result.
	_, no, _ := w.g.ChallengeFriend(ctx, ana, vi)
	if err := w.g.DeclineDuel(ctx, vi, no); err != nil {
		t.Fatal(err)
	}
	s, late, _ := w.g.ChallengeFriend(ctx, ana, vi)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	w.wait(FriendFor - time.Minute)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	if c, _ := w.g.Challenges(ctx, vi); len(c) != 1 || c[0].ID != late {
		t.Fatalf("expired early: %+v", c)
	}
	w.wait(2 * time.Minute)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	states := map[int64]string{}
	d, _ := w.g.DuelsOf(ctx, ana)
	for _, x := range d {
		states[x.ID] = x.State
	}
	if states[no] != "declined" || states[late] != "expired" {
		t.Fatalf("Ana's duels: %v", states)
	}

	// At most MaxWaiting challenges wait on friends at once.
	for range MaxWaiting {
		if _, _, err := w.g.ChallengeFriend(ctx, ana, vi); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := w.g.ChallengeFriend(ctx, ana, vi); !errors.Is(err, ErrManyWaiting) {
		t.Fatalf("one too many: %v", err)
	}
}

// befriend makes two players friends, as accepting an invite link would.
func (w *world) befriend(a, b int64) {
	w.t.Helper()
	code, err := w.g.InviteCode(w.t.Context(), a)
	if err == nil {
		_, _, err = w.g.Befriend(w.t.Context(), b, code)
	}
	if err != nil {
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
	}{{0, "bronze", 1050}, {1000, "bronze", 1050}, {1050, "silver", 1150}, {1599, "diamond", 1600}, {2400, "legend", 0}} {
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
	a, err := w.g.AlmanacOf(ctx, ana)
	if err != nil || len(a.Facts) != 0 || len(a.Of) == 0 {
		t.Fatalf("an empty almanac: %+v %v", a, err)
	}
	s, _ := w.g.StartTopic(ctx, ana, "general")
	w.play(ana, s.ID, repeat(w.right, Length)...)
	a, _ = w.g.AlmanacOf(ctx, ana)
	for _, f := range a.Facts {
		if f.Fact == "" || f.Answer == "" || f.Category == "" {
			t.Fatalf("a learned fact: %+v", f)
		}
	}
	if len(a.Facts) == 0 {
		t.Fatal("ten right answers, and nothing learned")
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
	}{{1, "Шампион на Рила"}, {3, "Трикратен шампион на Рила"}, {12, "12-кратен шампион на Рила"}} {
		if name, tier := ChampionTitle(c.n); name != c.want || tier != Legendary {
			t.Fatalf("champion %d times: %q", c.n, name)
		}
	}

	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	topic := func(user int64, games int) {
		for range games {
			s, err := w.g.StartTopic(ctx, user, "science")
			if err != nil {
				t.Fatal(err)
			}
			w.play(user, s.ID, repeat(w.right, Length)...)
		}
	}
	ana, bo, cy := w.user(), w.user(), w.user()
	if v, err := w.g.LeagueOf(ctx, ana); err != nil || v.In || v.League.Name != "Странджа" || v.DaysLeft != 4 ||
		v.Week != "2026-11-09" {
		t.Fatalf("before a game: %+v %v", v, err)
	}
	// Ana plays three games, Bo two, three more one each, Cy none: the five race in one group, Ana ahead; until
	// there are five, it isn't a race.
	topic(ana, 3)
	topic(bo, 2)
	if v, _ := w.g.LeagueOf(ctx, ana); !v.In || len(v.Group) != 2 || v.Up != 0 {
		t.Fatalf("a group of two going up: %+v", v)
	}
	for range RaceSize - 2 {
		topic(w.user(), 1)
	}
	v, err := w.g.LeagueOf(ctx, ana)
	if err != nil || !v.In || len(v.Group) != RaceSize || v.Place != 1 || !v.Group[0].Me ||
		v.Group[0].XP <= v.Group[1].XP || v.Up != 2 || v.Down != 0 || v.Group[1].Name == "" {
		t.Fatalf("Ana's week: %+v %v", v, err)
	}
	if v, _ := w.g.LeagueOf(ctx, cy); v.In {
		t.Fatal("a player in a league without a game")
	}

	// The week ends: Ana and Bo go up with first and second place's XP, the third stays with third's; told once.
	var told []LeagueNews
	w.g.LeagueNews = func(_ context.Context, n LeagueNews) { told = append(told, n) }
	w.now = time.Date(2026, 11, 16, 0, 5, 0, 0, Bulgaria)
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
	topic(ana, 2)
	topic(bo, 1)
	topic(cy, 1)
	if v, _ := w.g.LeagueOf(ctx, bo); !v.In || len(v.Group) != 2 || v.League.Tier != 1 || v.Up != 0 {
		t.Fatalf("Ana and Bo in Средна гора: %+v", v)
	}
	if v, _ := w.g.LeagueOf(ctx, cy); !v.In || len(v.Group) != 1 || v.League.Tier != 0 || v.Up != 0 {
		t.Fatalf("Cy alone in Странджа: %+v", v)
	}

	// A group of eight in Родопи, by goals' XP: the first two go up, the last two down, the rest stay.
	monday := "2026-11-16"
	res, _ := w.db.Write.Exec(`INSERT INTO league_groups (week, tier) VALUES (?, 2)`, monday)
	group, _ := res.LastInsertId()
	var eight []int64
	for i := range 8 {
		p := w.user()
		eight = append(eight, p)
		_, _ = w.db.Write.Exec(`UPDATE users SET league = 2 WHERE id = ?`, p)
		_, _ = w.db.Write.Exec(`INSERT INTO league_members (week, user_id, group_id, joined_at) VALUES (?, ?, ?, ?)`,
			monday, p, group, i)
		_, _ = w.db.Write.Exec(`INSERT INTO goals_done (user_id, day, goal, at, xp) VALUES (?, ?, 'day', 0, ?)`,
			p, "2026-11-17", 800-100*i)
	}
	// And five in Рила: the first is its champion, and can go no higher.
	top1, top2 := w.user(), w.user()
	rila := []int64{top1, top2, w.user(), w.user(), w.user()}
	for i, p := range rila {
		_, _ = w.db.Write.Exec(`UPDATE users SET league = 5 WHERE id = ?`, p)
		topic(p, map[bool]int{true: 2, false: 1}[i == 0]) // the first two games, the rest one
	}
	w.now = time.Date(2026, 11, 23, 0, 5, 0, 0, Bulgaria)
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
	if look, _ := w.g.LookOf(ctx, top1); look.Title != "Шампион на Рила" || !strings.Contains(look.Avatar, "/peak5/") {
		t.Fatalf("the champion's look: %+v", look)
	}
	n, _ = w.g.NewsOf(ctx, top1, 0)
	if !slices.ContainsFunc(n.Achievements, func(a Earned) bool { return a.ID == "rila" }) ||
		!slices.ContainsFunc(n.Unlocks, func(u Unlock) bool { return u.ID == championID && u.Name == "Шампион на Рила" }) {
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
	p, _ := w.g.ProgressOf(ctx, ana)
	topics := len(w.g.Bank().Categories) * len(topicTiers)
	if len(p.Titles) != 1+len(Titles)+topics || p.Titles[0].ID != championID || p.Titles[0].Name != "Шампион на Рила" ||
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
	if v := byID["nightOwl"]; v.How != "скрито постижение" {
		t.Fatalf("a hidden achievement's title tells how: %+v", v)
	}
	if v := byID["unquenched"]; v.How != "играй въпросите на деня тридесет дни поред." {
		t.Fatalf("an achievement's title: %+v", v)
	}
	if v := byID["master-history"]; v.Name != "Майстор · История" || v.How != "стигни до „Майстор“ в „История“" ||
		v.Group != TitleTopic {
		t.Fatalf("a topic's title: %+v", v)
	}
	if v := byID["diamondMind"]; v.How != "дивизия Диамант" {
		t.Fatalf("a division's title: %+v", v)
	}

	// A level's title, told when the level is.
	if _, err := w.db.Write.Exec(`INSERT INTO goals_done (user_id, day, goal, at, xp, seen) VALUES (?, '2026-11-01', 'x', 1, 2100, 1)`, ana); err != nil {
		t.Fatal(err)
	}
	// Everything the levels up to 5 unlock is told with it: the titles, a frame, a pattern.
	n, err := w.g.NewsOf(ctx, ana, 0)
	told := []string{}
	for _, u := range n.Unlocks {
		told = append(told, u.Kind+":"+u.ID+" "+u.From)
	}
	if err != nil || n.Level != 5 || !slices.Equal(told, []string{"title:spark ниво 1", "title:curious ниво 3",
		"title:passion ниво 5", "frame:ring ниво 2", "frame:double ниво 5", "backdrop:dots ниво 3"}) {
		t.Fatalf("level 5's news: %v %+v %v", told, n, err)
	}
	if p, _ := w.g.ProgressOf(ctx, ana); p.Next.Level != 6 || len(p.Next.LevelUnlocks) != 1 ||
		p.Next.LevelUnlocks[0].ID != "stripes" || p.Next.Division == nil || p.Next.Division.ID != "silver" {
		t.Fatalf("what's next at level 5: %+v", p.Next)
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
	if err != nil || len(k.Top) != 2 || k.Top[0].Value != 100 || k.Top[0].Answers != KnowAll || k.Place != 2 ||
		k.Mine.Value != 0 {
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
	if k, _ := w.g.KnowledgeBoard(ctx, cy, true, ""); len(k.Top) != 1 || k.Place != 0 || k.Top[0].Value != 0 {
		t.Fatalf("knowledge among friends: %+v", k)
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
	for _, c := range list {
		if c.ID == first && (c.Answers != CalibrateFrom || c.Known < 0.99 || c.Observed != bank.Easy) {
			t.Fatalf("a question all got right: %+v", c)
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
	c := w.g.Crowd(first)
	if c == nil || c.Answers != CrowdFrom || math.Abs(c.Right-0.75) > 1e-9 {
		t.Fatalf("the first question's crowd: %+v", c)
	}
	// The next player sees it with the answer; a question with fewer answers shows none.
	p := w.user()
	s, _ := w.g.StartDay(ctx, p)
	if _, err := w.g.Show(ctx, p, s.ID); err != nil {
		t.Fatal(err)
	}
	res, err := w.g.Answer(ctx, p, s.ID, 0, w.right(s.ID, 0))
	if err != nil {
		t.Fatal(err)
	}
	var rev struct{ Crowd *bank.CrowdView }
	_ = json.Unmarshal(mustJSON(t, res.Reveal), &rev)
	if rev.Crowd == nil || rev.Crowd.Answers != CrowdFrom {
		t.Fatalf("revealed %+v", rev.Crowd)
	}
	if second := w.picks(s.ID)[1].ID; w.g.Crowd(second) != nil {
		t.Fatal("a question with one answer showed a crowd")
	}
	// Answers from before a question last changed were to another question: they don't count.
	q, _ := w.b.Get(first)
	q.Extra().Updated = "2026-11-13"
	if err := w.g.CountCrowds(ctx); err != nil {
		t.Fatal(err)
	}
	if c := w.g.Crowd(first); c != nil {
		t.Fatalf("a changed question kept its crowd: %+v", c)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestRetention(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, guest, owner := w.user(), w.user(), w.user(), w.user()
	playOne := func(user int64) {
		s, err := w.g.StartTopic(ctx, user, "science")
		if err != nil {
			t.Fatal(err)
		}
		w.play(user, s.ID, w.right)
	}
	// 12 November: Ана and Бо are new. Ана comes back the next day; Бо doesn't.
	playOne(ana)
	playOne(bo)
	w.wait(24 * time.Hour)
	playOne(ana)
	// 13 November: a guest plays, then signs in to a new account that played the same day: one new player, not two.
	playOne(guest)
	playOne(owner)
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, guest, owner) }); err != nil {
		t.Fatal(err)
	}
	cohorts, active, err := w.g.Retention(ctx, 30)
	if err != nil {
		t.Fatal(err)
	}
	if active.Today != 2 || active.Week != 3 || active.Month != 3 {
		t.Errorf("active: %+v", active)
	}
	if len(cohorts) != 2 || cohorts[0].Day != "2026-11-13" || cohorts[0].New != 1 || cohorts[0].Back[0] != -1 {
		t.Fatalf("cohorts: %+v", cohorts)
	}
	// The 12th's day 1 is today: not over, so not counted yet.
	if c := cohorts[1]; c.Day != "2026-11-12" || c.New != 2 || c.Back[0] != -1 || c.Back[1] != -1 || c.Back[3] != -1 {
		t.Errorf("the 12th: %+v", c)
	}
	// A week on, Бо is back on day 7; Ана's day 3 was missed. Read the day after.
	w.wait(6 * 24 * time.Hour)
	playOne(bo)
	w.wait(24 * time.Hour)
	cohorts, _, _ = w.g.Retention(ctx, 30)
	if c := cohorts[len(cohorts)-1]; c.Back[0] != 1 {
		t.Errorf("day 1, once over: %+v", c)
	}
	if c := cohorts[len(cohorts)-1]; c.Back[1] != 0 || c.Back[2] != 1 || c.Back[3] != -1 {
		t.Errorf("a week on: %+v", c)
	}
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
	if _, err := w.g.Show(ctx, ana, m.ID); err != nil {
		t.Fatal(err)
	}
	res, err := w.g.Answer(ctx, ana, m.ID, 0, w.right(m.ID, 0))
	if err != nil {
		t.Fatal(err)
	}
	q, _ := w.b.Get(missed[0].ID)
	if res.Learned != (q.Extra().Fact != "") {
		t.Errorf("learned = %v for a question with fact %q", res.Learned, q.Extra().Fact)
	}
	for n := 1; n < Length; n++ {
		if _, err := w.g.Show(ctx, ana, m.ID); err != nil {
			t.Fatal(err)
		}
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
	w.g.Show(ctx, ana, s.ID)
	if res, _ := w.g.Answer(ctx, ana, s.ID, 0, w.right(s.ID, 0)); res.Learned {
		t.Error("learned in a topic run")
	}
}

func TestYear(t *testing.T) {
	w := setup(t) // Thursday, 12 November 2026
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	if _, err := w.g.YearOf(ctx, ana, 2027); !errors.Is(err, ErrNoYear) {
		t.Fatalf("a year not started: %v", err)
	}
	if y, err := w.g.YearOf(ctx, ana, 2026); err != nil || y.Days != 0 || y.League != nil || y.First != nil {
		t.Fatalf("a year without a game: %+v %v", y, err)
	}
	// Three days in a row of the day's questions, a gap, then one more; a topic game of right answers.
	for _, gap := range []int{0, 1, 1, 2} {
		w.wait(time.Duration(gap) * 24 * time.Hour)
		s, err := w.g.StartDay(ctx, ana)
		if err != nil {
			t.Fatal(err)
		}
		w.play(ana, s.ID, repeat(w.wrong, Length)...)
	}
	s, _ := w.g.StartTopic(ctx, ana, "history")
	w.play(ana, s.ID, repeat(w.right, Length)...)
	y, err := w.g.YearOf(ctx, ana, 2026)
	if err != nil || y.Days != 4 || y.Streak != 3 || y.Games != 5 || y.Answers != 5*Length || y.Right != Length ||
		y.XP <= 0 || y.League == nil || y.League.Name != "Странджа" {
		t.Fatalf("Ana's year: %+v %v", y, err)
	}
	if y.Facts == 0 || y.First == nil || y.First.Fact == "" {
		t.Fatalf("the facts of Ana's year: %+v", y)
	}
	if b, _ := w.g.YearOf(ctx, bo, 2026); b.Days != 0 || b.Games != 0 {
		t.Fatalf("Bo's year has Ana's games: %+v", b)
	}
}
