package play

import (
	"math/rand/v2"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A batch goes the whole way: testdata/batch is five questions written by the new-questions skill (a writer, an
// independent checker and the blind answers, on 23 Nov 2026, from the themes `bank plan` found furthest short: a hard
// choice, a hard number, an easy true-or-not, a medium order and a medium match, all about Bulgaria), kept here and
// never put in the real bank (its answers are public here). `bank add` takes it into a copy of the sample with no
// error and no warning, marked checked; the bank loads; and the days drawn from it deal every one of the five in the
// place it was written for: its own chapter's, in its difficulty's band, the order and the match as the puzzle of a
// day whose turn it is, the number the day's last, and each once. TODAY in the fixture is the day the test runs.
func TestABatchGoesThroughToTheDays(t *testing.T) {
	dir, batch := t.TempDir(), t.TempDir()
	if err := os.CopyFS(dir, os.DirFS("../../bank/sample")); err != nil {
		t.Fatal(err)
	}
	today := time.Now().Format(time.DateOnly)
	files, _ := filepath.Glob("testdata/batch/*.json")
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		data = []byte(strings.ReplaceAll(string(data), "TODAY", today))
		if err := os.WriteFile(filepath.Join(batch, filepath.Base(f)), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	res, err := bank.Add(dir, batch, "new-questions fable-5.2", false)
	if err != nil || res.Added != 5 || res.Changed != 0 || res.Retired != 0 {
		t.Fatalf("the batch: %+v, %v", res, err)
	}
	if len(res.Warnings) > 0 {
		t.Fatalf("the batch goes in with warnings: %v", res.Warnings)
	}
	b, problems := bank.Load(dir)
	if b == nil {
		t.Fatal(problems)
	}
	sample, _ := bank.Load("../../bank/sample")
	var added []bank.Question
	kinds := map[string]int{}
	for _, q := range b.Questions {
		if _, old := sample.Get(q.Base().ID); old {
			continue
		}
		added = append(added, q)
		kinds[string(q.Base().Difficulty)+" "+q.Base().Type]++
		tail := q.Extra()
		if tail.Added != today || tail.Checked != today || tail.CheckedBy != "new-questions fable-5.2" || len(tail.Sources) == 0 ||
			tail.Theme == "" || tail.Fact == "" || !tail.BG {
			t.Errorf("%s isn't in as a new question is: %+v", q.Base().ID, tail)
		}
		if !unproven(q, today) {
			t.Errorf("%s isn't held for the days (unproven): a chapter's game could spend it first", q.Base().ID)
		}
	}
	for _, place := range []string{"hard choice", "hard number", "easy truefalse", "medium order", "medium match"} {
		if kinds[place] != 1 {
			t.Fatalf("the batch has %d of %q, not one: %v", kinds[place], place, kinds)
		}
	}

	// The days, one after the other, until each of the five has had its day.
	used := map[string]bool{}
	drawn := map[string][]Pick{}
	dealt := map[string]string{}
	r := rand.New(rand.NewPCG(5, 6))
	start, _ := time.Parse(time.DateOnly, today)
	for n := 1; n <= 60 && len(dealt) < len(added); n++ {
		day := start.AddDate(0, 0, n).Format(time.DateOnly)
		// The day's puzzle is the kind whose turn it is, of those the bank still has a medium one of (dayPuzzle).
		puzzleOf := dayPuzzle(day, func(kind string) bool {
			return slices.ContainsFunc(b.Live("", kind), func(q bank.Question) bool {
				return q.Base().Difficulty == bank.Medium && !used[q.Base().ID] && !overdue(q, day) && len(q.Extra().On) == 0
			})
		})
		picks, _ := drawDay(b, day, used, nil, recentSubjects(b, drawn, day), r)
		drawn[day] = picks
		for i, p := range picks {
			fresh := !used[p.ID]
			used[p.ID] = true
			if !slices.ContainsFunc(added, func(q bank.Question) bool { return q.Base().ID == p.ID }) {
				continue
			}
			q, _ := b.Get(p.ID)
			h := q.Base()
			if !fresh || dealt[p.ID] != "" {
				t.Fatalf("%s: %s dealt again (first on %s)", day, p.ID, dealt[p.ID])
			}
			dealt[p.ID] = day
			band := map[bank.Difficulty][2]int{bank.Easy: {0, 2}, bank.Medium: {3, 6}, bank.Hard: {7, 9}}[h.Difficulty]
			if i < band[0] || i > band[1] {
				t.Errorf("%s: %s, %s, is in place %d", day, p.ID, h.Difficulty, i+1)
			}
			if slices.ContainsFunc(picks, func(o Pick) bool {
				other, _ := b.Get(o.ID)
				return o.ID != p.ID && other.Base().Category == h.Category
			}) {
				t.Errorf("%s: %s shares the day with another question of %s", day, p.ID, h.Category)
			}
			switch {
			case h.Type == "number" && (i != Length-1 || !b.Estimate(q)):
				t.Errorf("%s: %s, the hard number, is in place %d (an estimate: %v), not the day's last", day, p.ID, i+1, b.Estimate(q))
			case slices.Contains(puzzleKinds, h.Type) && h.Type != puzzleOf:
				t.Errorf("%s: %s, a %s, is the puzzle of a day whose turn is a %s's", day, p.ID, h.Type, puzzleOf)
			}
		}
	}
	for _, q := range added {
		if dealt[q.Base().ID] == "" {
			t.Errorf("%s (%s %s) had no day in 60", q.Base().ID, q.Base().Difficulty, q.Base().Type)
		}
	}
}
