package play

import (
	"math/rand/v2"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The day's picture place keeps a picture when its difficulty has none left: the nearest difficulty with one comes
// before a question without.
func TestPictureBeforeDifficulty(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	s := daySlots[1]
	if s.picture != withPicture || s.difficulty != bank.Easy {
		t.Fatalf("the day's second place is %+v", s)
	}
	used := map[string]bool{}
	for _, q := range b.Live("", "") {
		if matches(q, s, true, true) {
			used[q.Base().ID] = true // every easy picture spent
		}
	}
	if len(used) == 0 {
		t.Fatal("the sample has no easy picture")
	}
	allowed := func(bank.Question) bool { return true }
	fresh := func(q bank.Question) bool { return !used[q.Base().ID] }
	for seed := range uint64(20) {
		q := choose(b.Live("", ""), s, allowed, fresh, nil, rand.New(rand.NewPCG(seed, 1)))
		if q == nil || !bank.HasPictures(q) || q.Base().Difficulty == bank.Easy || q.Base().Type != "choice" {
			t.Fatalf("seed %d: %+v instead of a medium or hard picture", seed, q)
		}
	}
	// The runway counts that place's fresh questions: none left of it.
	for _, r := range DayRunway(b, used) {
		if r.Place == "easy choice with a picture" && r.Days != 0 {
			t.Fatalf("runway %+v with every easy picture spent", r)
		}
	}
	if r := DayRunway(b, nil); r[1].Place != "easy choice with a picture" || r[1].Days != len(used) {
		t.Fatalf("runway %+v, %d easy pictures", r, len(used))
	}
}
