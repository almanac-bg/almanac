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
