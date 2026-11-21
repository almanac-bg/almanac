package play

import (
	"encoding/json"
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A topic run's shape: a true-or-not second, an order and a match in the middle, a split and a number last; easy to hard by
// ability, about two in three right.
func TestTopicShape(t *testing.T) {
	for ability, want := range map[float64]string{
		-2:  "c:e t:e c:e c:e c:e c:e s:m o:m m:m n:h",
		0:   "c:e t:e c:e c:m c:m o:m c:m m:m s:h n:h",
		0.5: "c:e t:e c:m c:m o:m m:m c:h c:h s:h n:h",
		1:   "c:e t:m o:m m:m c:h c:h c:h c:h s:h n:h",
	} {
		var got []string
		for _, s := range topicSlots(ability) {
			got = append(got, s.typ[:1]+":"+string(s.difficulty[:1]))
		}
		if strings.Join(got, " ") != want {
			t.Errorf("ability %v: %s, want %s", ability, strings.Join(got, " "), want)
		}
	}
}

// Players of a known ability, answering at random questions of the bank's mix, are told apart, and in time told
// as they are; guessing alone is below every one of them.
func TestAbility(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	mix := []bank.Difficulty{bank.Easy, bank.Easy, bank.Easy, bank.Easy, bank.Easy, bank.Medium, bank.Medium, bank.Medium, bank.Hard, bank.Hard}
	estimate := func(truth float64, answers int) float64 {
		sum := 0.0
		for range 200 {
			a := newAbility()
			for range answers {
				h := hardnessOf(labelKnown[mix[r.IntN(len(mix))]])
				if truth < -10 { // a guesser
					a.learn(r.IntN(4) == 3, h, rightChance["choice"])
					continue
				}
				luck := rightChance["choice"]
				a.learn(r.Float64() < luck+(1-luck)*sigmoid(truth-h), h, luck)
			}
			sum += a.mean
		}
		return sum / 200
	}
	prev := -100.0
	for _, truth := range []float64{-2, -1, 0, 1, 2} {
		got := estimate(truth, 300)
		if got < truth-0.25 || got > truth+0.25 || got <= prev {
			t.Errorf("a player of %v, after 300 answers: %.2f", truth, got)
		}
		prev = got
	}
	// Ten answers say less than three hundred: an estimate stays nearer the middle.
	if early := estimate(2, 10); early < 0.5 || early > 1.8 {
		t.Errorf("a strong player after ten answers: %.2f", early)
	}
	if g, weak := estimate(-100, 100), estimate(-2, 100); g >= weak {
		t.Errorf("a guesser %.2f, a weak player %.2f", g, weak)
	}
}

// The mastery a player's games shape themselves by: one who knows a topic draws harder games of it than one who
// doesn't; nothing of it is shown (DECISIONS.md, „The direction“).
func TestMasteryShapesGames(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	for _, p := range []struct {
		user   int64
		answer func(int64, int) json.RawMessage
	}{{ana, w.right}, {bo, w.wrong}} {
		for range 3 {
			s, err := w.g.StartTopic(ctx, p.user, "history")
			if err != nil {
				t.Fatal(err)
			}
			w.play(p.user, s.ID, repeat(p.answer, Length)...)
		}
	}
	a, _ := w.g.ability(ctx, w.db.Read, ana, "history")
	b, _ := w.g.ability(ctx, w.db.Read, bo, "history")
	if a <= b {
		t.Fatalf("ana %.2f, bo %.2f", a, b)
	}
	hardOnes := func(user int64) int {
		s, _ := w.g.StartTopic(ctx, user, "history")
		n := 0
		for _, p := range w.picks(s.ID) {
			if q, _ := w.b.Get(p.ID); q.Base().Difficulty == bank.Hard {
				n++
			}
		}
		return n
	}
	if hardOnes(ana) <= hardOnes(bo) {
		t.Fatal("a run's shape doesn't follow mastery")
	}
}

// A hard question right moves an ability more than an easy one; an easy one wrong, more than a hard one; a guess
// at a true-or-not, less than one at a choice.
func TestLearnWeighsAnswers(t *testing.T) {
	moved := func(right bool, d bank.Difficulty, typ string) float64 {
		a := newAbility()
		a.learn(right, hardnessOf(labelKnown[d]), rightChance[typ])
		return a.mean
	}
	if moved(true, bank.Hard, "choice") <= moved(true, bank.Easy, "choice") {
		t.Error("a hard question right")
	}
	if moved(false, bank.Easy, "choice") >= moved(false, bank.Hard, "choice") {
		t.Error("an easy question wrong")
	}
	if moved(true, bank.Medium, "truefalse") >= moved(true, bank.Medium, "choice") {
		t.Error("a true-or-not right")
	}
	if moved(true, bank.Medium, "number") <= moved(true, bank.Medium, "choice") {
		t.Error("a number right (next to no luck in it)")
	}
}
