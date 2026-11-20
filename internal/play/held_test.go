package play

import (
	"math/rand/v2"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A question new to the bank (from NewHeldFrom on) is held out of chapter games and duels until a day has dealt it or
// it is NewHeld days old; the day itself deals it, and a question without a date of joining, or from before the rule,
// is old.
func TestNewQuestionsHeldForTheDays(t *testing.T) {
	q := func(added string) bank.Question {
		c := &bank.Choice{}
		c.Extra().Added = added
		return c
	}
	for _, c := range []struct {
		added, today string
		held         bool
	}{
		{"", "2026-12-01", false},
		{"2026-11-20", "2026-12-01", false}, // the bank as it was before the rule
		{"2026-11-25", "2026-12-01", true},
		{"2026-11-25", "2027-03-24", true},  // 119 days on
		{"2026-11-25", "2027-03-25", false}, // 120
	} {
		if got := unproven(q(c.added), c.today); got != c.held {
			t.Errorf("added %q, on %s: held %v, want %v", c.added, c.today, got, c.held)
		}
	}

	b := biggerSample(t, 20)
	today := "2026-12-01"
	live := b.Live("", "")
	fresh, dealt, old := live[0].Base().ID, live[1].Base().ID, live[2].Base().ID
	for _, id := range []string{fresh, dealt} {
		x, _ := b.Get(id)
		x.Extra().Added = "2026-11-28"
	}
	bars := barsOf(map[string][]Pick{"2026-11-30": {{ID: dealt}}}, today, b)
	if !bars.all[fresh] || bars.now[fresh] || bars.all[dealt] || bars.all[old] {
		t.Fatalf("held: new %v (now %v), new but dealt %v, old %v", bars.all[fresh], bars.now[fresh], bars.all[dealt],
			bars.all[old])
	}
	// No game but the day deals it: a topic's draw passes it by.
	for seed := range uint64(20) {
		for _, p := range Draw(b, live[0].Base().Category, 0, nil, bars.all, rand.New(rand.NewPCG(seed, 3))) {
			if p.ID == fresh {
				t.Fatalf("seed %d: a topic's game dealt a held question", seed)
			}
		}
	}
	// The day deals them: a bank all new still makes its days.
	for _, x := range live {
		x.Extra().Added = "2026-11-28"
	}
	if picks, short := drawDay(b, today, map[string]bool{}, nil, nil, rand.New(rand.NewPCG(1, 7))); len(picks) != Length ||
		len(short) != 0 {
		t.Fatalf("a day of a new bank: %d picks, short %v", len(picks), short)
	}
}

// Within each of its places, the day takes a question nobody has opened before one somebody has (drawDay: answered),
// so that the issue's first meeting is everyone's: one opened only where its place has none unopened left.
func TestDayPrefersNeverOpened(t *testing.T) {
	b := biggerSample(t, 20)
	answered := map[string]bool{}
	for i, q := range b.Live("", "") {
		if i%2 == 0 {
			answered[q.Base().ID] = true
		}
	}
	used := map[string]bool{}
	seen, all := 0, 0
	for d := range 20 {
		picks, _ := drawDay(b, DayShift("2026-12-01", d), used, answered, nil, rand.New(rand.NewPCG(uint64(d)+1, 5)))
		for _, p := range picks {
			used[p.ID] = true
			all++
			if answered[p.ID] {
				seen++
				q, _ := b.Get(p.ID)
				for _, o := range b.Live(q.Base().Category, q.Base().Type) {
					if !answered[o.Base().ID] && !used[o.Base().ID] && o.Base().Difficulty == q.Base().Difficulty &&
						bank.HasPictures(o) == bank.HasPictures(q) && len(o.Extra().On) == 0 {
						t.Errorf("day %d: %s (%s %s %s bg %v) over %s (bg %v)", d, p.ID, q.Base().Category, q.Base().Type,
							q.Base().Difficulty, q.Extra().BG, o.Base().ID, o.Extra().BG)
						break
					}
				}
			}
		}
	}
	if all == 0 || 2*seen >= all {
		t.Fatalf("%d of %d of the days' questions opened before, with half the bank unopened", seen, all)
	}
}
