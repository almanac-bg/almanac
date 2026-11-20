package play

import (
	"database/sql"
	"encoding/json"
	"errors"
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
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
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
	w.swap(b2)
	if err := w.g.EnsureDays(ctx); err != nil {
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
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
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

// biggerSample is the sample bank with each question copied n times more (new ids, the text marked), each copy in
// the next topic round, so that every topic has every kind; its splits made medium too: enough of every place of a
// day for days ahead, whichever topics a day gives them.
func biggerSample(t *testing.T, n int) *bank.Bank {
	t.Helper()
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS("../../bank/sample")); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(dir, bank.QuestionsDir, "*.json"))
	slices.Sort(files)
	all := make([][]map[string]any, len(files))
	prefixes := make([]string, len(files))
	for i, f := range files {
		data, _ := os.ReadFile(f)
		if err := json.Unmarshal(data, &all[i]); err != nil {
			t.Fatal(err)
		}
		prefixes[i], _, _ = strings.Cut(all[i][0]["id"].(string), "-")
	}
	out := make([][]map[string]any, len(files))
	for i := range files {
		out[i] = slices.Clone(all[i])
	}
	for i, qs := range all {
		for k := range n {
			to := (i + k + 1) % len(files)
			for j, q := range qs {
				c := maps.Clone(q)
				c["id"] = fmt.Sprintf("%s-%d%03d%02d", prefixes[to], k+1, j, i)
				c["text"] = fmt.Sprintf("%d. %s", k+1, q["text"])
				if c["type"] == "split" {
					c["difficulty"] = "medium"
				}
				out[to] = append(out[to], c)
			}
		}
	}
	for i, f := range files {
		data, _ := json.Marshal(out[i])
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

// A game that rolls back takes no days with it: the days ahead are drawn in a transaction of their own, and a
// player's game only reads them (today's drawn there if it must be); the next game finds what was kept.
func TestDaysAheadRollBack(t *testing.T) {
	w := setup(t)
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	var seen map[string]bool
	failed := w.db.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		seen, err = w.g.dayQuestions(tx)
		if err != nil {
			return err
		}
		return errors.New("the game fails")
	})
	if failed == nil || len(seen) != Length {
		t.Fatalf("today's %d, %v", len(seen), failed)
	}
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	s, err := w.g.StartDay(ctx, w.user())
	if err != nil {
		t.Fatal(err)
	}
	barred, _ := w.g.DayQuestions(ctx)
	for _, p := range w.picks(s.ID) {
		if !barred[p.ID] {
			t.Fatalf("today's %s isn't kept out of the other games", p.ID)
		}
	}
	// New rules: the days after tomorrow are drawn again; today and tomorrow stay.
	var before string
	tomorrow := w.now.AddDate(0, 0, 1).In(Bulgaria).Format(time.DateOnly)
	_ = w.db.Read.QueryRow(`SELECT questions FROM days WHERE day = ?`, tomorrow).Scan(&before)
	_, _ = w.db.Write.Exec(`UPDATE kv SET value = 'older rules' WHERE key = 'days_drawn_by'`)
	w.g.daysAhead.mu.Lock()
	w.g.daysAhead.day = ""
	w.g.daysAhead.mu.Unlock()
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	var after, rules string
	_ = w.db.Read.QueryRow(`SELECT questions FROM days WHERE day = ?`, tomorrow).Scan(&after)
	_ = w.db.Read.QueryRow(`SELECT value FROM kv WHERE key = 'days_drawn_by'`).Scan(&rules)
	if before == "" || after != before || rules != drawnBy(w.b) {
		t.Fatalf("tomorrow %q → %q, rules %q", before, after, rules)
	}
}

func mustPicks(t *testing.T, s string) []Pick {
	t.Helper()
	var p []Pick
	if err := json.Unmarshal([]byte(s), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

// A question due for review is dealt by no game from its date on: the days ahead drawn before it was due are drawn
// again without it, and it is barred from every other game (DayQuestions: topics, duels). DaysUsed gives
// the days' questions, and the last day drawn.
func TestNoGameDealsAQuestionDueForReview(t *testing.T) {
	w := setup(t)
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	today := w.g.Today()
	days, err := storedDays(mustTx(t, w), "")
	if err != nil {
		t.Fatal(err)
	}
	used, err := w.g.DaysUsed(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var last string
	n := 0
	for day, picks := range days {
		last = max(last, day)
		n += len(picks)
		for _, p := range picks {
			if !used.IDs[p.ID] {
				t.Fatalf("DaysUsed misses %s of %s", p.ID, day)
			}
		}
	}
	if used.Through != last || len(used.IDs) != n {
		t.Fatalf("DaysUsed: %d through %s, want %d through %s", len(used.IDs), used.Through, n, last)
	}
	// A question of the third day ahead is due for review on its day, and one no day has today. The third day is drawn
	// again without it (or, the sample being short of estimates by then, left to its morning).
	d, _ := time.Parse(time.DateOnly, today)
	third := d.AddDate(0, 0, 3).Format(time.DateOnly)
	b2, _ := bank.Load(w.b.Dir)
	later, _ := b2.Get(days[third][4].ID)
	later.Extra().ReviewBy = third
	var now bank.Question
	for _, q := range b2.Live("history", "") {
		if !used.IDs[q.Base().ID] {
			now = q
			break
		}
	}
	now.Extra().ReviewBy = today
	w.swap(b2)
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	again, _ := storedDays(mustTx(t, w), third)
	if slices.ContainsFunc(again[third], func(p Pick) bool { return p.ID == later.Base().ID }) {
		t.Fatalf("%s kept %s, due for review that day", third, later.Base().ID)
	}
	barred, err := w.g.DayQuestions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !barred[now.Base().ID] {
		t.Fatalf("%s, due for review today, isn't barred", now.Base().ID)
	}
	ana := w.user()
	for range 5 {
		s, err := w.g.StartTopic(ctx, ana, "history")
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range w.picks(s.ID) {
			if p.ID == now.Base().ID {
				t.Fatalf("a history game dealt %s, due for review", p.ID)
			}
		}
		w.play(ana, s.ID)
	}
}

// A question for a date („На този ден“) waits for it out of every other game, however far off the date is, until a
// day has dealt it; one whose only date has passed waits no more.
func TestDatedQuestionsWaitForTheirDate(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	live := b.Live("history", "")
	yearly, dealt, past, plain, next := live[0], live[1], live[2], live[3], live[4]
	for _, q := range live[:5] {
		q.Extra().On = nil
	}
	yearly.Extra().On = []string{"12-31"}
	dealt.Extra().On = []string{"01-01"}
	past.Extra().On = []string{"2020-04-12"}
	next.Extra().On = []string{"2027-03-28"}
	today := "2026-11-18"
	days := map[string][]Pick{"2026-01-01": {{ID: dealt.Base().ID}}}
	bars := barsOf(days, today, b)
	for q, want := range map[bank.Question]bool{yearly: true, dealt: false, past: false, plain: false, next: true} {
		if id := q.Base().ID; bars.all[id] != want || bars.now[id] {
			t.Errorf("%s (on %v): kept out %v, want %v, and never as today's", id, q.Extra().On, bars.all[id], want)
		}
	}
}

func mustTx(t *testing.T, w *world) *sql.Tx {
	t.Helper()
	tx, err := w.db.Read.Begin()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })
	return tx
}
