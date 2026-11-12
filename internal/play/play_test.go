package play

import (
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
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
	res, err := w.db.Write.Exec(`INSERT INTO users (name, name_key, created_at, seen_at) VALUES (?, ?, 0, 0)`,
		"Играч", "играч"+string(rune('0'+w.next)))
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
	reveal, _ := json.Marshal(q.Deal(p.Seed).Reveal())
	var r struct {
		Pick  *int     `json:"pick"`
		Value *float64 `json:"value"`
		Order []int    `json:"order"`
	}
	_ = json.Unmarshal(reveal, &r)
	var a any
	switch {
	case r.Pick != nil:
		a = map[string]int{"pick": *r.Pick}
	case r.Value != nil:
		a = map[string]float64{"value": *r.Value}
	default:
		a = map[string][]int{"order": r.Order}
	}
	out, _ := json.Marshal(a)
	return out
}

// wrong is a wrong answer to it (a choice's other option, a number far off, an order backwards).
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
		if num.Answer-num.Min > num.Max-num.Answer {
			r["value"] = num.Min
		} else {
			r["value"] = num.Max
		}
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
	if err != nil || res.Points != MaxPoints || !res.Right || res.State.At != 1 || res.Reveal == nil {
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
	if n, _ := w.g.Streak(ctx, ana); n != 0 {
		t.Fatalf("streak %d after missing a day", n)
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
	// The next run starts with what the player hasn't seen.
	second, _ := w.g.StartTopic(ctx, u, "history")
	unseen := len(w.b.Live("history", "")) - len(firstPicks)
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

func TestChallenge(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	s, _ := w.g.StartTopic(ctx, ana, "music")
	if _, err := w.g.Challenge(ctx, ana, s.ID); !errors.Is(err, ErrOutOfStep) {
		t.Fatalf("a challenge from an unfinished run: %v", err)
	}
	w.play(ana, s.ID, repeat(w.right, Length)...)
	code, err := w.g.Challenge(ctx, ana, s.ID)
	if err != nil || len(code) != 6 {
		t.Fatalf("code %q %v", code, err)
	}
	if again, _ := w.g.Challenge(ctx, ana, s.ID); again != code {
		t.Fatal("a second code for the same run")
	}
	theirs, err := w.g.StartChallenge(ctx, bo, code)
	if err != nil || theirs.Kind != "challenge" {
		t.Fatalf("%+v %v", theirs, err)
	}
	if a, b := w.picks(s.ID), w.picks(theirs.ID); a[3] != b[3] {
		t.Fatal("not the same questions, dealt the same way")
	}
	// The maker opening their own link gets their own run back.
	if own, _ := w.g.StartChallenge(ctx, ana, code); own.ID != s.ID {
		t.Fatal("the maker got a new run")
	}
	w.play(bo, theirs.ID, append(repeat(w.right, 4), repeat(w.wrong, 6)...)...)
	c, err := w.g.ChallengeOf(ctx, code, bo)
	if err != nil || len(c.Players) != 2 || c.Players[0].Rights != 10 || !c.Players[1].Me || c.Mine != theirs.ID {
		t.Fatalf("%+v %v", c, err)
	}
}

func TestMergeKeepsTheAccountsDay(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	guest, owner := w.user(), w.user()
	gs, _ := w.g.StartDay(ctx, guest)
	topic, _ := w.g.StartTopic(ctx, guest, "science")
	os, _ := w.g.StartDay(ctx, owner)
	err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, guest, owner) })
	if err != nil {
		t.Fatal(err)
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
	if err != nil || empty.Games != 0 || len(empty.Topics) != 0 || empty.Recent == nil {
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
	if s.Topics[0].Category != "music" || s.Topics[0].Answers < 10 || s.Recent[0].Kind != "topic" || s.Recent[0].Total != Length {
		t.Fatalf("topics %+v, recent %+v", s.Topics, s.Recent)
	}
}

func TestRecordingsAndDuels(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	if rec, err := w.g.RecordingFor(ctx, bo); err != nil || rec != nil {
		t.Fatalf("a recording with nothing played: %v %v", rec, err)
	}
	run, _ := w.g.StartTopic(ctx, ana, "")
	w.play(ana, run.ID, repeat(w.right, Length)...)
	if rec, _ := w.g.RecordingFor(ctx, ana); rec != nil {
		t.Fatal("a player got their own game as a recording")
	}
	rec, err := w.g.RecordingFor(ctx, bo)
	if err != nil || rec == nil || len(rec.Picks) != Length || len(rec.Answers) != Length || rec.Answers[0].Ms != 3000 {
		t.Fatalf("Bo's recording: %+v %v", rec, err)
	}
	// What the recording gave grades right again, dealt the same way.
	q, _ := w.b.Get(rec.Picks[0].ID)
	if g, err := q.Deal(rec.Picks[0].Seed).Grade(rec.Answers[0].Shown); err != nil || !g.Right {
		t.Fatalf("the recorded answer: %+v %v", g, err)
	}

	d := Duel{UserID: bo, Picks: rec.Picks, Opponent: "Ана", Recorded: true, Outcome: "lost"}
	for _, p := range rec.Picks {
		d.Answers = append(d.Answers, DuelAnswer{QuestionID: p.ID, Ms: 15000})
	}
	if err := w.g.SaveDuel(ctx, d); err != nil {
		t.Fatal(err)
	}
	s, _ := w.g.StatsOf(ctx, bo)
	if s.Games != 1 || s.Answers != Length || s.Recent[0].Kind != "duel" || s.Duels != 1 || s.Won != 0 {
		t.Fatalf("Bo's stats after a duel: %+v", s)
	}
	if err := w.g.SaveDuel(ctx, Duel{UserID: bo, Picks: rec.Picks}); err == nil {
		t.Fatal("kept a duel without its answers")
	}
}
