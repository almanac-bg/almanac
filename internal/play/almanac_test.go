package play

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// knows gives a player right answers to these questions, in a game of their own (as many games would), one after
// another from the start of time.
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
		if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, given, score, points, is_right, ms, at)
			VALUES (?, ?, ?, '{}', 1, 0, 1, 3000, ?)`, run, n, id, at+int64(n)); err != nil {
			w.t.Fatal(err)
		}
	}
}

// The almanac's achievements count facts collected: a question with a fact, answered right once, whatever came
// before or after; a wrong answer or a time-out counts nothing, and neither does a question without a fact.
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
	for n, p := range w.picks(run.ID) {
		if q, _ := w.b.Get(p.ID); n%2 == 0 && q.Extra().Fact != "" {
			want++
		}
	}
	// The same questions again, all right: the wrong ones are learned now; the right ones were already.
	var again []string
	for n, p := range w.picks(run.ID) {
		if q, _ := w.b.Get(p.ID); n%2 == 1 && q.Extra().Fact != "" {
			again = append(again, p.ID)
		}
	}
	alm, err := w.g.AlmanacOf(ctx, ana, AlmanacQuery{Limit: AlmanacPage})
	if err != nil || alm.All != want || len(alm.Facts) != want {
		t.Fatalf("%d facts in the almanac after a game half right, want %d (%v)", alm.All, want, err)
	}
	s, err := w.g.StatsOf(ctx, ana)
	if err != nil || s.Facts != want || s.Answers != Length {
		t.Fatalf("stats: %d facts of %d answers, want %d (%v)", s.Facts, s.Answers, want, err)
	}
	w.knows(ana, append(again, w.picks(run.ID)[0].ID)...)
	want += len(again)
	if s, _ := w.g.StatsOf(ctx, ana); s.Facts != want {
		t.Fatalf("stats: %d facts, want %d: one answered right again counts once", s.Facts, want)
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

// A chapter is complete with every fact a topic has now: its live questions' (a retired question's fact is kept, but
// no topic waits on it). It's noted in the book once, on the day of the game that completed it.
func TestWholeTopic(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	var facts []string
	for _, q := range w.b.Live("movies", "") {
		if q.Extra().Fact != "" {
			facts = append(facts, q.Base().ID)
		}
	}
	if len(facts) < 2 {
		t.Fatalf("the sample's movies have %d facts", len(facts))
	}
	w.knows(ana, facts[1:]...)
	if err := w.g.noteMilestones(ctx, ana, w.g.Today()); err != nil {
		t.Fatal(err)
	}
	if notes, _ := w.g.NotesOf(ctx, ana); len(notes) != 0 {
		t.Fatalf("a whole topic but one: %+v", notes)
	}
	w.knows(ana, facts[0])
	for range 2 {
		if err := w.g.noteMilestones(ctx, ana, w.g.Today()); err != nil {
			t.Fatal(err)
		}
	}
	want := []Note{{Day: w.g.Today(), Kind: NoteChapter, Topic: "movies"}}
	if notes, _ := w.g.NotesOf(ctx, ana); !slices.Equal(notes, want) {
		t.Fatalf("every fact of a topic: %+v", notes)
	}
	s, _ := w.g.StatsOf(ctx, ana)
	if s.Facts != len(facts) {
		t.Fatalf("Профил counts %d facts, want %d", s.Facts, len(facts))
	}
}
