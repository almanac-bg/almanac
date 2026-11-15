package play

import (
	"errors"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// „България“ is a topic of Bulgaria's questions from every topic: never a day's, open while the bank has a game's
// worth of them besides the days', shaped by how well the player knows all the topics, and no topic of its own for
// „Обиколка“ (a game in every topic).
func TestBulgariaTopic(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	if !w.g.BulgariaOpen() {
		t.Fatal("the sample's Bulgarian questions don't open the topic")
	}
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	if !w.g.BulgariaOpen() {
		t.Fatal("closed once the days are drawn")
	}
	s, err := w.g.StartTopic(ctx, u, BulgariaTopic)
	if err != nil || s.Total != Length || s.Category != BulgariaTopic {
		t.Fatalf("a game of Bulgaria's: %+v %v", s, err)
	}
	barred, _ := w.g.DayQuestions(ctx)
	topics := map[string]bool{}
	for _, p := range w.picks(s.ID) {
		q, _ := w.b.Get(p.ID)
		if !q.Extra().BG || barred[p.ID] {
			t.Fatalf("%s in Bulgaria's game: about Bulgaria %v, a day's %v", p.ID, q.Extra().BG, barred[p.ID])
		}
		topics[q.Base().Category] = true
	}
	if len(topics) < 3 {
		t.Fatalf("Bulgaria's game from %d topics only", len(topics))
	}
	w.play(u, s.ID, repeat(w.right, Length)...)
	// Its answers count in their own topics; the game itself is no topic toward „Обиколка“.
	p, _ := w.g.ProgressOf(ctx, u)
	for _, a := range p.Achievements {
		if a.ID == "allTopics" && a.Progress != 0 {
			t.Fatalf("„Обиколка“ counted Bulgaria's game: %+v", a)
		}
	}
	m, _ := w.g.MasteryOf(ctx, u)
	answered := 0
	for _, t := range m {
		answered += t.Answers
		if t.Category == BulgariaTopic {
			answered = -100
		}
	}
	if answered != Length {
		t.Fatalf("mastery took %d answers: %+v", answered, m)
	}

	// With too few of them left beside the days', it closes, and a game of it is refused.
	b2, _ := bank.Load(w.b.Dir)
	left := 0
	for _, q := range b2.Live("", "") {
		if q.Extra().BG && !barred[q.Base().ID] {
			if left++; left >= Length {
				q.Extra().BG = false
			}
		}
	}
	w.g.Bank = func() *bank.Bank { return b2 }
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	if w.g.BulgariaOpen() {
		t.Fatal("open with too few questions")
	}
	if _, err := w.g.StartTopic(ctx, u, BulgariaTopic); !errors.Is(err, ErrNoTopic) {
		t.Fatalf("a game of a closed topic: %v", err)
	}
}
