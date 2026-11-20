package play

import (
	"context"
	"encoding/json"
	"maps"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

func (w *world) count(query string, args ...any) int {
	w.t.Helper()
	var n int
	if err := w.db.Read.QueryRow(query, args...).Scan(&n); err != nil {
		w.t.Fatal(err)
	}
	return n
}

// What follows a finished run is done by the request that finished it, and crossed off; what that request left (a
// restart in between) the sweep does, in turn, a few times at most.
func TestAfterARun(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	ana := w.user()
	s, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	answers := make([]func(int64, int) json.RawMessage, Length)
	for i := range answers {
		answers[i] = w.right
	}
	if st := w.play(ana, s.ID, answers...); !st.Done {
		t.Fatalf("the day not done: %+v", st)
	}
	if n := w.count(`SELECT count(*) FROM runs_after`); n != 0 {
		t.Fatalf("%d left to do after the run", n)
	}
	earned := w.count(`SELECT count(*) FROM achievements WHERE user_id = ?`, ana)
	if earned == 0 {
		t.Fatal("the day earned nothing")
	}

	// A restart cut it short: nothing kept but the run, its follow-up noted.
	if _, err := w.db.Write.Exec(`DELETE FROM achievements WHERE user_id = ?`, ana); err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(`INSERT INTO runs_after (run_id, due) VALUES (?, ?)`, s.ID,
		store.Ms(w.now.Add(afterOwn))); err != nil {
		t.Fatal(err)
	}
	if err := w.g.AfterDue(ctx); err != nil { // still the finishing request's
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM runs_after`); n != 1 {
		t.Fatal("the sweep took a follow-up before its time")
	}
	w.wait(afterOwn)
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM runs_after`); n != 0 {
		t.Fatalf("%d left after the sweep", n)
	}
	if n := w.count(`SELECT count(*) FROM achievements WHERE user_id = ?`, ana); n != earned {
		t.Fatalf("the sweep kept %d achievements, not %d", n, earned)
	}

	// One that has failed afterTries times is given up on.
	if _, err := w.db.Write.Exec(`INSERT INTO runs_after (run_id, due, tries) VALUES (?, ?, ?)`, s.ID,
		store.Ms(w.now), afterTries); err != nil {
		t.Fatal(err)
	}
	if err := w.g.AfterDue(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM runs_after`); n != 0 {
		t.Fatal("not given up")
	}
}

// The questions anyone has answered, step by step along the index, are those a pass over every answer finds.
func TestAnsweredQuestions(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	got, err := w.g.answeredQuestions(ctx)
	if err != nil || len(got) != 0 {
		t.Fatalf("none answered: %v %v", got, err)
	}
	for range 2 {
		ana := w.user()
		s, err := w.g.StartDay(ctx, ana)
		if err != nil {
			t.Fatal(err)
		}
		w.play(ana, s.ID, w.right, w.wrong, w.right)
		w.wait(time.Hour)
	}
	got, err = w.g.answeredQuestions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := w.db.Read.Query(`SELECT DISTINCT question_id FROM answers`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	want := map[string]bool{}
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		want[id] = true
	}
	if len(want) == 0 || !maps.Equal(got, want) {
		t.Fatalf("answered %v, want %v", got, want)
	}
}

// The last answer of a game doesn't wait for what follows it (the achievements measured again, the goals):
// that's done in the background, and the game's news waits for it instead, so it still tells all of it.
func TestTheLastAnswerDoesntWaitForWhatFollows(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	w.g.later.by, w.g.later.slots = map[int64]*later{}, make(chan struct{}, 1)
	w.g.later.slots <- struct{}{} // every worker busy: nothing that follows a run can start
	s, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	for n := range Length {
		st, err := w.g.Show(ctx, ana, s.ID)
		if err == nil && st.Question != nil && st.Question.StartsMs > 0 {
			_, err = w.g.Start(ctx, ana, s.ID, n)
		}
		if err != nil {
			t.Fatal(err)
		}
		res, err := w.g.Answer(ctx, ana, s.ID, n, w.right(s.ID, n))
		if err != nil {
			t.Fatal(err)
		}
		if n == Length-1 && !res.State.Done {
			t.Fatal("the day not done")
		}
	}
	if n := w.count(`SELECT count(*) FROM runs_after`); n != 1 {
		t.Fatalf("%d left to do after the run, not 1: it was done before the answer went back", n)
	}
	if n := w.count(`SELECT count(*) FROM achievements WHERE user_id = ?`, ana); n != 0 {
		t.Fatalf("%d achievements before what follows the run was done", n)
	}
	waiting, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	w.g.AfterWait(waiting, ana) // the news waits for it (here, for as long as it's let)
	if waiting.Err() == nil {
		t.Fatal("nothing to wait for")
	}

	<-w.g.later.slots // a worker free
	news, err := w.g.NewsOf(ctx, ana, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(news.Achievements) == 0 || w.count(`SELECT count(*) FROM goals_done WHERE user_id = ?`, ana) == 0 {
		t.Fatalf("the news before what the game earned was kept: %+v", news)
	}
	if n := w.count(`SELECT count(*) FROM runs_after`); n != 0 {
		t.Fatalf("%d left to do after the news", n)
	}
}
