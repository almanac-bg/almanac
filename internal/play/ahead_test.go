package play

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The days ahead are drawn as far as each place has a question that fits it just so, never a question twice; none of
// their questions reaches another game; and a day ahead whose question leaves the bank is drawn again.
func TestDaysAhead(t *testing.T) {
	w := setup(t)
	w.b = biggerSample(t, 30)
	w.g.Bank = func() *bank.Bank { return w.b }
	ctx := t.Context()
	barred, err := w.g.DayQuestions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	days := map[string][]Pick{}
	rows, _ := w.db.Read.Query(`SELECT day, questions FROM days ORDER BY day`)
	for rows.Next() {
		var day, s string
		_ = rows.Scan(&day, &s)
		days[day] = mustPicks(t, s)
	}
	rows.Close()
	today := w.g.Today()
	if len(days[today]) != Length || len(days) < 2 {
		t.Fatalf("%d days drawn, today's %d questions", len(days), len(days[today]))
	}
	t.Logf("the sample bank holds %d days ahead", len(days)-1)
	seen := map[string]bool{}
	for day, picks := range days {
		for _, p := range picks {
			if seen[p.ID] || !barred[p.ID] {
				t.Fatalf("%s: %s twice, or not kept out of the other games", day, p.ID)
			}
			seen[p.ID] = true
		}
	}
	// A topic game deals none of them.
	ana := w.user()
	for _, c := range w.b.Categories {
		s, err := w.g.StartTopic(ctx, ana, c.ID)
		if err != nil {
			continue // a topic with too few questions left
		}
		for _, p := range w.picks(s.ID) {
			if barred[p.ID] {
				t.Fatalf("a %s game dealt %s, a day's", c.ID, p.ID)
			}
		}
	}
	// A question of a day ahead leaves the bank: that day is drawn again with the next bank, the others stay.
	var ahead string
	for day := range days {
		if day > today && (ahead == "" || day < ahead) {
			ahead = day
		}
	}
	gone := days[ahead][0].ID
	b2, _ := bank.Load(w.b.Dir)
	q, _ := b2.Get(gone)
	q.Extra().Retired = true
	w.g.Bank = func() *bank.Bank { return b2 }
	if _, err := w.g.DayQuestions(ctx); err != nil {
		t.Fatal(err)
	}
	var s string
	if err := w.db.Read.QueryRow(`SELECT questions FROM days WHERE day = ?`, ahead).Scan(&s); err == nil {
		for _, p := range mustPicks(t, s) {
			if p.ID == gone {
				t.Fatalf("%s kept %s, which left the bank", ahead, gone)
			}
		}
	}
	_ = w.db.Read.QueryRow(`SELECT questions FROM days WHERE day = ?`, today).Scan(&s)
	if picks := mustPicks(t, s); picks[0] != days[today][0] {
		t.Fatalf("today's questions changed")
	}
	// The next day, the next day ahead is drawn; yesterday's questions may come back to the other games.
	w.wait(24 * time.Hour)
	next, err := w.g.DayQuestions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range days[today] {
		if next[p.ID] {
			t.Fatalf("yesterday's %s is still kept out", p.ID)
		}
	}
}

// biggerSample is the sample bank with each question copied n times more (new ids, the text marked), its splits made
// medium too: enough of every place of a day for days ahead.
func biggerSample(t *testing.T, n int) *bank.Bank {
	t.Helper()
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS("../../bank/sample")); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(dir, bank.QuestionsDir, "*.json"))
	for _, f := range files {
		data, _ := os.ReadFile(f)
		var qs []map[string]any
		if err := json.Unmarshal(data, &qs); err != nil {
			t.Fatal(err)
		}
		out := slices.Clone(qs)
		for i := range n {
			for _, q := range qs {
				c := maps.Clone(q)
				prefix, num, _ := strings.Cut(q["id"].(string), "-")
				c["id"] = fmt.Sprintf("%s-%d%s", prefix, i+1, num)
				c["text"] = fmt.Sprintf("%d. %s", i+1, q["text"])
				if c["type"] == "split" {
					c["difficulty"] = "medium"
				}
				out = append(out, c)
			}
		}
		data, _ = json.Marshal(out)
		if err := os.WriteFile(f, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	b, problems := bank.Load(dir)
	if b == nil {
		t.Fatal(problems)
	}
	return b
}

func mustPicks(t *testing.T, s string) []Pick {
	t.Helper()
	var p []Pick
	if err := json.Unmarshal([]byte(s), &p); err != nil {
		t.Fatal(err)
	}
	return p
}
