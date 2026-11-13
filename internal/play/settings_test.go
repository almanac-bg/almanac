package play

import (
	"errors"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

func TestSettingsNormal(t *testing.T) {
	for _, c := range []struct {
		in, want Settings
		bad      bool
	}{
		{in: Settings{}, want: Settings{}},
		{in: Settings{Length: 10}, want: Settings{}},
		{in: Settings{Length: 5, Difficulty: bank.Hard}, want: Settings{Length: 5, Difficulty: bank.Hard}},
		{in: Settings{Kinds: []string{"match", "choice"}}, want: Settings{Kinds: []string{"choice", "match"}}},
		{in: Settings{Kinds: slices.Clone(bank.TypeOrder)}, want: Settings{}},
		{in: Settings{Length: 7}, bad: true},
		{in: Settings{Difficulty: "brutal"}, bad: true},
		{in: Settings{Kinds: []string{"essay"}}, bad: true},
		{in: Settings{Kinds: []string{"choice", "choice"}}, bad: true},
	} {
		got, err := c.in.Normal()
		if c.bad != errors.Is(err, ErrBadSettings) || (!c.bad && !slices.Equal(got.Kinds, c.want.Kinds)) ||
			(!c.bad && (got.Length != c.want.Length || got.Difficulty != c.want.Difficulty)) {
			t.Errorf("%+v: %+v %v", c.in, got, err)
		}
	}
	if (Settings{Length: 1 << 40}).Count() != Length || (Settings{Length: -3}).Count() != Length {
		t.Error("a length a run can't have")
	}
	if !(Settings{}).Standard() || (Settings{Slow: true}).Standard() || (Settings{}).stored() != nil {
		t.Error("the standard run")
	}
}

// The standard run keeps its shape: a true-or-not second, an order and a match in the middle, a number last; easy to
// hard by skill.
func TestStandardShape(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	for skill, want := range map[float64]string{
		0.3:  "c:e t:e c:e c:e c:e c:m c:m o:m m:m n:h",
		0.6:  "c:e t:e c:e c:m c:m o:m c:m m:m c:h n:h",
		0.8:  "c:e t:e c:m c:m o:m m:m c:h c:h c:h n:h",
		0.95: "c:e t:m c:m o:m m:m c:h c:h c:h c:h n:h",
	} {
		if got := shape((Settings{}).slots(skill, r)); got != want {
			t.Errorf("skill %v: %s, want %s", skill, got, want)
		}
	}
}

func shape(slots []slot) string {
	var out []string
	for _, s := range slots {
		out = append(out, s.typ[:1]+":"+string(s.difficulty[:1]))
	}
	return strings.Join(out, " ")
}

func TestSettingsShapes(t *testing.T) {
	r := rand.New(rand.NewPCG(3, 4))
	count := func(slots []slot) map[string]int {
		n := map[string]int{}
		for _, s := range slots {
			n[s.typ]++
			n[string(s.difficulty)]++
		}
		return n
	}
	for _, c := range []struct {
		set  Settings
		want map[string]int
	}{
		// Five: a true-or-not and one of the order, the match and the number among choices.
		{Settings{Length: 5}, map[string]int{"choice": 3, "truefalse": 1}},
		// Fifteen: two true-or-not, an order, a match and a number.
		{Settings{Length: 15}, map[string]int{"choice": 10, "truefalse": 2, "order": 1, "match": 1, "number": 1}},
		// One difficulty throughout.
		{Settings{Difficulty: bank.Hard}, map[string]int{"hard": 10}},
		// Some kinds: in the shares the bank aims for, each at least once.
		{Settings{Kinds: []string{"choice", "truefalse"}}, map[string]int{"choice": 8, "truefalse": 2}},
		{Settings{Kinds: []string{"truefalse"}, Length: 5}, map[string]int{"truefalse": 5}},
		{Settings{Kinds: []string{"order", "match"}}, map[string]int{"order": 5, "match": 5}},
		{Settings{Kinds: []string{"truefalse", "number", "order", "match"}, Length: 5},
			map[string]int{"truefalse": 2, "number": 1, "order": 1, "match": 1}},
	} {
		slots := c.set.slots(0.6, r)
		got := count(slots)
		if len(slots) != c.set.Count() {
			t.Errorf("%+v: %d places", c.set, len(slots))
		}
		for k, n := range c.want {
			if got[k] != n {
				t.Errorf("%+v: %d %s, want %d (%s)", c.set, got[k], k, n, shape(slots))
			}
		}
	}
	// A short run's one special kind is one of the order, the match and the number.
	if s := (Settings{Length: 5}).slots(0.6, r); !slices.Contains([]string{"order", "match", "number"}, s[3].typ) {
		t.Errorf("a run of five: %s", shape(s))
	}
}

func TestWorth(t *testing.T) {
	q := func(d bank.Difficulty) bank.Question {
		return &bank.Choice{Head: bank.Head{Type: "choice", Difficulty: d}}
	}
	if worth(q(bank.Easy), 1) != 60 || worth(q(bank.Medium), 1) != 100 || worth(q(bank.Hard), 1) != 140 ||
		worth(q(bank.Hard), 0.5) != 70 || worth(q(bank.Medium), 0) != 0 {
		t.Error("what answers are worth")
	}
	// A day (three easy, four medium, three hard) earns what ten answers at 100 would.
	if 3*worth(q(bank.Easy), 1)+4*worth(q(bank.Medium), 1)+3*worth(q(bank.Hard), 1) != Length*MaxPoints {
		t.Error("a day's worth")
	}
}

func TestTopicWithSettings(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	if _, err := w.g.StartTopic(ctx, u, "history", Settings{Length: 8}); !errors.Is(err, ErrBadSettings) {
		t.Fatalf("a run of eight: %v", err)
	}
	s, err := w.g.StartTopic(ctx, u, "", Settings{Length: 5, Kinds: []string{"truefalse"}, Slow: true})
	if err != nil || s.Total != 5 {
		t.Fatalf("five true-or-not: %+v %v", s, err)
	}
	for _, p := range w.picks(s.ID) {
		if q, _ := w.b.Get(p.ID); q.Base().Type != "truefalse" {
			t.Fatalf("%s is a %s", p.ID, q.Base().Type)
		}
	}
	shown, err := w.g.Show(ctx, u, s.ID)
	if err != nil || shown.Question == nil || shown.Question.LimitMs != (20*time.Second).Milliseconds() {
		t.Fatalf("double time: %+v %v", shown.Question, err)
	}
	// Past the usual time, but within the double, the answer counts.
	w.wait(15 * time.Second)
	res, err := w.g.Answer(ctx, u, s.ID, 0, w.right(s.ID, 0))
	if err != nil || res.TimedOut || !res.Right {
		t.Fatalf("an answer in double time: %+v %v", res, err)
	}
	var stored string
	_ = w.db.Read.QueryRow(`SELECT settings FROM runs WHERE id = ?`, s.ID).Scan(&stored)
	if stored != `{"length":5,"kinds":["truefalse"],"slow":true}` {
		t.Fatalf("kept as %s", stored)
	}
	std, _ := w.g.StartTopic(ctx, u, "", Settings{Length: 10})
	var null any = "x"
	_ = w.db.Read.QueryRow(`SELECT settings FROM runs WHERE id = ?`, std.ID).Scan(&null)
	if null != nil {
		t.Fatalf("the standard run kept as %v", null)
	}
}
