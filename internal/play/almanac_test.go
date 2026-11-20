package play

import (
	"database/sql"
	"encoding/json"
	"slices"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// knows gives a player right answers to these questions, in a game of their own (as many games would), one after
// another from the start of time: their book written as the rule writes it (pencil: ink.go).
func (w *world) knows(user int64, ids ...string) {
	w.t.Helper()
	w.knowsAt(user, 0, ids...)
}

// knowsAt is knows from a time on.
func (w *world) knowsAt(user, at int64, ids ...string) {
	w.t.Helper()
	res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at, finished_at) VALUES (?, 'topic', '[]', 0, 0)`, user)
	if err != nil {
		w.t.Fatal(err)
	}
	run, _ := res.LastInsertId()
	for n, id := range ids {
		if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, given, score, is_right, ms, at)
			VALUES (?, ?, ?, '{}', 1, 1, 3000, ?)`, run, n, id, at+int64(n)); err != nil {
			w.t.Fatal(err)
		}
	}
	w.rewrite(user)
}

// rewrite writes a player's book again from their answers (rewriteFacts), as after answers put in by hand.
func (w *world) rewrite(user int64) {
	w.t.Helper()
	if err := w.db.Tx(w.t.Context(), func(tx *sql.Tx) error { return rewriteFacts(tx, user) }); err != nil {
		w.t.Fatal(err)
	}
}

// The almanac has every fact met, once: a question with a fact, answered right or wrong, or let run out, in grey
// outside the day's issue; never one without a fact; and a question met again is the same entry.
func TestFactsCollected(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	run, err := w.g.StartTopic(ctx, ana, "history")
	if err != nil {
		t.Fatal(err)
	}
	answers := make([]func(int64, int) json.RawMessage, Length)
	for n := range answers {
		answers[n] = w.right
		if n%2 == 1 {
			answers[n] = w.wrong
		}
	}
	w.play(ana, run.ID, answers...)
	want := 0
	var ids []string
	for _, p := range w.picks(run.ID) {
		if q, _ := w.b.Get(p.ID); q.Extra().Fact != "" {
			want++
			ids = append(ids, p.ID)
		}
	}
	alm, err := w.g.AlmanacOf(ctx, ana, AlmanacQuery{Limit: AlmanacPage})
	if err != nil || len(alm.Facts) != want || alm.Found != want || len(alm.Ink) != 0 ||
		slices.ContainsFunc(alm.Facts, func(l Learned) bool { return l.Ink }) {
		t.Fatalf("%d facts in the almanac after a topic's game half right, want %d in grey (ink %v, %v)",
			len(alm.Facts), want, alm.Ink, err)
	}
	w.knows(ana, ids...)
	if alm, _ := w.g.AlmanacOf(ctx, ana, AlmanacQuery{Limit: AlmanacPage}); alm.Found != want {
		t.Fatalf("the almanac: %d facts, want %d: one met again is one entry", alm.Found, want)
	}
}

// The almanac reads in the order the facts were learned; a statement is its own headline (no question), marked if it
// isn't so.
func TestAlmanacEntries(t *testing.T) {
	w := setup(t)
	ana := w.user()
	var truth, untruth, choice string
	for _, q := range w.b.Live("", "") {
		if q.Extra().Fact == "" {
			continue
		}
		switch tf, ok := q.(*bank.TrueFalse); {
		case ok && tf.Answer && truth == "":
			truth = q.Base().ID
		case ok && !tf.Answer && untruth == "":
			untruth = q.Base().ID
		case !ok && choice == "" && q.Base().Type == "choice":
			choice = q.Base().ID
		}
	}
	if truth == "" || untruth == "" || choice == "" {
		t.Fatal("the sample lacks a true statement, an untrue one or a choice, each with a fact")
	}
	w.knowsAt(ana, 2000, truth, untruth)
	w.knowsAt(ana, 1000, choice)
	alm, err := w.g.AlmanacOf(t.Context(), ana, AlmanacQuery{Limit: AlmanacPage})
	if err != nil || len(alm.Facts) != 3 {
		t.Fatalf("%d facts (%v)", len(alm.Facts), err)
	}
	if got := []string{alm.Facts[0].ID, alm.Facts[1].ID, alm.Facts[2].ID}; !slices.Equal(got, []string{untruth, truth, choice}) {
		t.Fatalf("not the latest learned first: %v", got)
	}
	byID := map[string]Learned{}
	for _, f := range alm.Facts {
		byID[f.ID] = f
	}
	if f := byID[choice]; f.Question == "" {
		t.Fatalf("a choice: %+v", f)
	}
	if f := byID[truth]; f.Question != "" || f.Untrue {
		t.Fatalf("a true statement: %+v", f)
	}
	if f := byID[untruth]; f.Question != "" || !f.Untrue || f.Answer == "Невярно" {
		t.Fatalf("an untrue statement: %+v", f)
	}
}
