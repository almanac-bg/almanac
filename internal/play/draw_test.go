package play

import (
	"math/rand/v2"
	"slices"
	"testing"
	"time"

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
	for _, r := range DayRunway(b, Used{IDs: used}, "2026-11-16") {
		if r.Place == "easy choice with a picture" && r.Days != 0 {
			t.Fatalf("runway %+v with every easy picture spent", r)
		}
	}
	if r := DayRunway(b, Used{}, "2026-11-16"); r[1].Place != "easy choice with a picture" || r[1].Days != len(used) {
		t.Fatalf("runway %+v, %d easy pictures", r, len(used))
	}
}

// A day takes the question that belongs to its date, at least BGFloor about Bulgaria where the bank has them, and an
// estimate to finish on; every place still fits just so, and the topics stay one each.
func TestDayOfItsDate(t *testing.T) {
	b := biggerSample(t, 20)
	day := "2026-03-03"
	var dated bank.Question
	for _, q := range b.Live("history", "choice") {
		if q.Base().Difficulty == bank.Medium && !bank.HasPictures(q) {
			dated = q
			break
		}
	}
	dated.Extra().On = []string{"03-03"}
	for i, q := range b.Live("", "") {
		if i%4 == 0 {
			q.Extra().BG = true
		}
	}
	for seed := range uint64(30) {
		picks, short := drawDay(b, day, map[string]bool{}, nil, rand.New(rand.NewPCG(seed, 7)))
		if len(short) > 0 || len(picks) != Length {
			t.Fatalf("seed %d: %d picks, short %v", seed, len(picks), short)
		}
		found, bg, topics := false, 0, map[string]bool{}
		for i, p := range picks {
			q, _ := b.Get(p.ID)
			found = found || p.ID == dated.Base().ID
			bg += b2i(q.Extra().BG)
			topics[q.Base().Category] = true
			if i == Length-1 && !estimate(q) {
				t.Fatalf("seed %d: the day ends on %s, not an estimate", seed, p.ID)
			}
		}
		if !found || bg < BGFloor || len(topics) != Length {
			t.Fatalf("seed %d: dated %v, %d about Bulgaria, %d topics", seed, found, bg, len(topics))
		}
	}
	// Any other day keeps it for its own: never drawn before (or after) its date.
	for seed := range uint64(30) {
		for _, day := range []string{"2026-03-02", "2026-03-04"} {
			picks, _ := drawDay(b, day, map[string]bool{}, nil, rand.New(rand.NewPCG(seed, 7)))
			if len(picks) != Length || slices.ContainsFunc(picks, func(p Pick) bool { return p.ID == dated.Base().ID }) {
				t.Fatalf("seed %d, %s: %d picks, or the 3 March question spent", seed, day, len(picks))
			}
		}
	}
}

// A day names each subject once: no two of its questions share an answer or a quoted title, though the bank has each
// answer many times over (every sample question copied twenty times), with the question of its date and the
// Bulgarian ones swapped in, day after day.
func TestOneSubjectADay(t *testing.T) {
	b := biggerSample(t, 20)
	for i, q := range b.Live("", "") {
		if i%4 == 0 {
			q.Extra().BG = true
		}
	}
	dated, _ := b.Get("his-015") // the treaty of San Stefano, 3 March 1878
	dated.Extra().On = []string{"03-03"}
	used := map[string]bool{}
	days := 0
	for d := range 40 {
		day := time.Date(2026, 3, 1+d, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)
		picks, short := drawDay(b, day, used, nil, rand.New(rand.NewPCG(uint64(d), 11)))
		if len(short) > 0 {
			break
		}
		days++
		named := map[string]string{}
		for _, p := range picks {
			used[p.ID] = true
			q, _ := b.Get(p.ID)
			for _, k := range bank.Subjects(q) {
				if other, ok := named[k]; ok {
					t.Fatalf("%s: %s and %s both name %q", day, other, p.ID, k)
				}
				named[k] = p.ID
			}
		}
		if day == "2026-03-03" && named["санстефанският"] != "his-015" {
			t.Fatalf("3 March without its question: %v", picks)
		}
	}
	if days < 15 { // the sample has one hard number, so 21 days at most
		t.Fatalf("only %d days drawn exactly", days)
	}
}
