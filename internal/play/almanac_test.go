package play

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
	"time"

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
	alm, err := w.g.AlmanacOf(ctx, ana, "", "", AlmanacPage)
	if err != nil || alm.All != want || len(alm.Facts) != want {
		t.Fatalf("%d facts in the almanac after a game half right, want %d (%v)", alm.All, want, err)
	}
	s, err := w.g.StatsOf(ctx, ana)
	if err != nil || s.Facts != want || s.Answers != Length {
		t.Fatalf("stats: %d facts of %d answers, want %d (%v)", s.Facts, s.Answers, want, err)
	}
	w.knows(ana, append(again, w.picks(run.ID)[0].ID)...)
	want += len(again)
	p, err := w.g.ProgressOf(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range p.Achievements {
		switch a.ID {
		case "facts100", "facts1000", "facts5000":
			if a.At != 0 || a.Progress != want {
				t.Fatalf("%s at %d facts: %+v", a.ID, want, a)
			}
		case "wholeTopic":
			if a.At != 0 || a.Progress != 0 || a.Goal != 1 {
				t.Fatalf("a whole topic before one is: %+v", a)
			}
		case "answers100", "answers1000":
			t.Fatalf("an achievement for answers given: %s", a.ID)
		}
	}
}

// The almanac reads by day: each fact says the day it was learned, in Bulgaria, and that day's issue; a statement is
// its own headline (no question), marked if it isn't so.
func TestAlmanacByDay(t *testing.T) {
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
	// 23:30 in Sofia on the 16th is the 16th there, though it's the 16th's 21:30 in UTC; 00:30 is the 17th.
	late := time.Date(2026, 11, 16, 23, 30, 0, 0, Bulgaria).UnixMilli()
	early := time.Date(2026, 11, 17, 0, 30, 0, 0, Bulgaria).UnixMilli()
	w.knowsAt(ana, late, choice)
	w.knowsAt(ana, early, truth, untruth)
	alm, err := w.g.AlmanacOf(t.Context(), ana, "", "", AlmanacPage)
	if err != nil || len(alm.Facts) != 3 {
		t.Fatalf("%d facts (%v)", len(alm.Facts), err)
	}
	byID := map[string]Learned{}
	for _, f := range alm.Facts {
		byID[f.ID] = f
	}
	if f := byID[choice]; f.Day != "2026-11-16" || f.Issue != 5 || f.Question == "" {
		t.Fatalf("a choice learned late on the 16th: %+v", f)
	}
	if f := byID[truth]; f.Day != "2026-11-17" || f.Issue != 6 || f.Question != "" || f.Untrue {
		t.Fatalf("a true statement: %+v", f)
	}
	if f := byID[untruth]; f.Question != "" || !f.Untrue || f.Answer == "Невярно" {
		t.Fatalf("an untrue statement: %+v", f)
	}
}

// „Цяла тема“ is every fact a topic has now: its live questions' (a retired question's fact is kept, but no topic
// waits on it).
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
	if news, err := w.g.Award(ctx, ana); err != nil || slices.Contains(news, "wholeTopic") {
		t.Fatalf("a whole topic but one: %v %v", news, err)
	}
	w.knows(ana, facts[0])
	if news, err := w.g.Award(ctx, ana); err != nil || !slices.Contains(news, "wholeTopic") {
		t.Fatalf("every fact of a topic: %v %v", news, err)
	}
	s, _ := w.g.StatsOf(ctx, ana)
	if s.Facts != len(facts) {
		t.Fatalf("Профил counts %d facts, want %d", s.Facts, len(facts))
	}
}

// The achievements for answers given become the ones for facts collected, with the XP they paid and what they
// unlocked: the book avatar, and the first epic's pattern.
func TestFactsMigration(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	for _, a := range []struct {
		id string
		xp int
	}{{"answers100", 50}, {"answers1000", 400}, {"streak3", 50}} {
		if _, err := w.db.Write.Exec(`INSERT INTO achievements (user_id, id, at, xp, seen) VALUES (?, ?, 1, ?, 1)`,
			ana, a.id, a.xp); err != nil {
			t.Fatal(err)
		}
	}
	body, err := os.ReadFile("../store/migrations/0042_facts_achievements.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(string(body)); err != nil {
		t.Fatal(err)
	}
	earned, _ := w.g.earned(ctx, ana)
	if len(earned) != 3 || earned["facts100"] == 0 || earned["facts1000"] == 0 || earned["streak3"] == 0 {
		t.Fatalf("after the migration: %v", earned)
	}
	if xp, _ := w.g.totalXP(ctx, ana); xp != 500 {
		t.Fatalf("XP after the migration: %d", xp)
	}
	if err := w.g.SetLook(ctx, ana, ptr("book-gold"), nil); err != nil {
		t.Fatalf("the book, unlocked by „Сто отговора“: %v", err)
	}
	p, _ := w.g.ProgressOf(ctx, ana)
	for _, b := range p.Backdrops {
		if b.ID == "rays" && b.Locked {
			t.Fatal("the first epic's pattern, locked")
		}
	}
	for _, a := range p.Achievements {
		if a.ID == "facts1000" && (a.At == 0 || a.Progress != a.Goal) {
			t.Fatalf("„Хиляда факта“, kept: %+v", a)
		}
	}
	// Nothing is told again: what was seen stays seen.
	n, _ := w.g.NewsOf(ctx, ana, 0)
	if len(n.Achievements) != 0 {
		t.Fatalf("told again: %+v", n.Achievements)
	}
}
