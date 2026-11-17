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

// dayNumber is a day's number question, which is among its hard ones.
func dayNumber(t *testing.T, b *bank.Bank, picks []Pick) bank.Question {
	t.Helper()
	for i, p := range picks {
		if q, _ := b.Get(p.ID); q != nil && q.Base().Type == "number" {
			if daySlots[i].difficulty != bank.Hard {
				t.Fatalf("the day's number is in place %d, not among the hard ones", i)
			}
			return q
		}
	}
	t.Fatal("the day has no number")
	return nil
}

// A run goes easy to hard, a plain choice first, but where its special questions sit changes from run to run, within
// their difficulty; and a day's shape, drawn once, is the same for everyone.
func TestShapesDiffer(t *testing.T) {
	where := func(slots []slot, typ string) int {
		return slices.IndexFunc(slots, func(s slot) bool { return s.typ == typ })
	}
	for _, shape := range [][]slot{daySlots, topicSlots(0), topicSlots(2)} {
		seen := map[string]map[int]bool{}
		for seed := range uint64(40) {
			slots := inBands(slices.Clone(shape), rand.New(rand.NewPCG(seed, 5)))
			if slots[0] != shape[0] || slots[0].typ != "choice" || slots[0].picture == withPicture {
				t.Fatalf("seed %d: the first question is %+v", seed, slots[0])
			}
			for i := range slots {
				if slots[i].difficulty != shape[i].difficulty {
					t.Fatalf("seed %d: place %d is %s, not %s", seed, i, slots[i].difficulty, shape[i].difficulty)
				}
			}
			for _, typ := range []string{"truefalse", "order", "match", "number"} {
				if seen[typ] == nil {
					seen[typ] = map[int]bool{}
				}
				seen[typ][where(slots, typ)] = true
			}
		}
		for typ, at := range seen {
			if len(at) < 2 {
				t.Errorf("the %s is always in place %v", typ, at)
			}
		}
	}
}

// A day takes the question that belongs to its date, at least BGFloor about Bulgaria where the bank has them, and an
// estimate for its number; every place still fits just so, and the topics stay one each.
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
		for _, p := range picks {
			q, _ := b.Get(p.ID)
			found = found || p.ID == dated.Base().ID
			bg += b2i(q.Extra().BG)
			topics[q.Base().Category] = true
		}
		if n := dayNumber(t, b, picks); !estimate(n) {
			t.Fatalf("seed %d: the day's number is %s, not an estimate", seed, n.Base().ID)
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
