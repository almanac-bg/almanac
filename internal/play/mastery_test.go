package play

import (
	"encoding/json"
	"math/rand/v2"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A topic run's shape: a true-or-not second, an order and a match in the middle, a number last; easy to hard by
// ability, about two in three right.
func TestTopicShape(t *testing.T) {
	for ability, want := range map[float64]string{
		-2:  "c:e t:e c:e c:e c:e c:e c:m o:m m:m n:h",
		0:   "c:e t:e c:e c:m c:m o:m c:m m:m c:h n:h",
		0.5: "c:e t:e c:m c:m o:m m:m c:h c:h c:h n:h",
		1:   "c:e t:m o:m m:m c:h c:h c:h c:h c:h n:h",
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
// as they are; guessing alone is a Новак.
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
					a.learn(float64(r.IntN(4)/3), h, chance["choice"])
					continue
				}
				score := 0.0
				if r.Float64() < chance["choice"]+(1-chance["choice"])*sigmoid(truth-h) {
					score = 1
				}
				a.learn(score, h, chance["choice"])
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
	hard := []float64{}
	for _, d := range mix {
		hard = append(hard, hardnessOf(labelKnown[d]))
	}
	if m := masteryOf("x", ability{mean: estimate(-100, 100), answers: 100}, hard); m.Tier != 0 {
		t.Errorf("a guesser: %+v", m)
	}
	// An average player knows about 60% of a topic: a Познавач.
	if m := masteryOf("x", ability{mean: 0, answers: 100}, hard); m.Known < 55 || m.Known > 65 || MasteryTiers[m.Tier].ID != "connoisseur" {
		t.Errorf("an average player: %+v", m)
	}
}

// A hard question right moves an ability more than an easy one; an easy one wrong, more than a hard one; a guess
// at a true-or-not, less than one at a choice.
func TestLearnWeighsAnswers(t *testing.T) {
	moved := func(score float64, d bank.Difficulty, typ string) float64 {
		a := newAbility()
		a.learn(score, hardnessOf(labelKnown[d]), chance[typ])
		return a.mean
	}
	if moved(1, bank.Hard, "choice") <= moved(1, bank.Easy, "choice") {
		t.Error("a hard question right")
	}
	if moved(0, bank.Easy, "choice") >= moved(0, bank.Hard, "choice") {
		t.Error("an easy question wrong")
	}
	if moved(1, bank.Medium, "truefalse") >= moved(1, bank.Medium, "choice") {
		t.Error("a true-or-not right")
	}
	if moved(1, bank.Medium, "number") <= moved(1, bank.Medium, "choice") {
		t.Error("a number right (no luck in it)")
	}
}

func TestMastery(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	m, err := w.g.MasteryOf(ctx, ana)
	if err != nil || len(m) != len(w.b.Categories) || m[0].Answers != 0 || m[0].Sure {
		t.Fatalf("a newcomer's mastery: %+v %v", m, err)
	}
	// Ana knows history; Bo doesn't.
	for _, p := range []struct {
		user   int64
		answer func(int64, int) json.RawMessage
	}{{ana, w.right}, {bo, w.wrong}} {
		for range 2 {
			s, err := w.g.StartTopic(ctx, p.user, "history")
			if err != nil {
				t.Fatal(err)
			}
			w.play(p.user, s.ID, repeat(p.answer, Length)...)
		}
	}
	know := func(user int64) Mastery {
		m, _ := w.g.MasteryOf(ctx, user)
		for _, x := range m {
			if x.Category == "history" {
				return x
			}
		}
		return Mastery{}
	}
	a, b := know(ana), know(bo)
	if !a.Sure || a.Answers != 2*Length || a.Tier < 3 || b.Tier != 0 || a.Known <= b.Known {
		t.Fatalf("ana %+v, bo %+v", a, b)
	}
	// Ana's next history run is harder than Bo's.
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
	// A game tells how it moved the mastery of its topics.
	s, _ := w.g.StartTopic(ctx, bo, "music")
	if _, err := w.g.MasteryMoves(ctx, bo, s.ID); err != ErrOutOfStep {
		t.Fatalf("a game not over: %v", err)
	}
	w.play(bo, s.ID, repeat(w.right, Length)...)
	n, err := w.g.NewsOf(ctx, bo, s.ID)
	if err != nil || len(n.Mastery) != 1 || n.Mastery[0].To.Category != "music" || n.Mastery[0].From.Answers != 0 ||
		n.Mastery[0].To.Answers != Length || n.Mastery[0].To.Known <= n.Mastery[0].From.Known {
		t.Fatalf("the news of a music game: %+v %v", n.Mastery, err)
	}
	if n, err := w.g.NewsOf(ctx, ana, s.ID); err != nil || n.Mastery != nil {
		t.Fatalf("news of someone else's game: %+v %v", n, err)
	}
	// A game played later doesn't change what an earlier one did.
	w.wait(time.Minute)
	later, _ := w.g.StartTopic(ctx, bo, "music")
	w.play(bo, later.ID, repeat(w.wrong, Length)...)
	if again, _ := w.g.MasteryMoves(ctx, bo, s.ID); len(again) != 1 || again[0] != n.Mastery[0] {
		t.Fatalf("an earlier game's news, after another: %+v, was %+v", again, n.Mastery)
	}
	stats, _ := w.g.StatsOf(ctx, ana)
	if len(stats.Mastery) != len(w.b.Categories) || stats.Mastery[0].Name == "" {
		t.Fatalf("stats' mastery: %+v", stats.Mastery)
	}
}
