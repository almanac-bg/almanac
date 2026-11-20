package main

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

// bank days reads the days drawn from a database it only opens to read, from a day on, with the week before, and
// prints each question of each day with its answer, its fact, what lint finds, and a subject the week before had.
func TestBankDays(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	live := b.Live("", "choice")
	path := filepath.Join(t.TempDir(), "game.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	put := func(day string, ids ...string) {
		var picks []play.Pick
		for _, id := range ids {
			picks = append(picks, play.Pick{ID: id, Seed: 1})
		}
		data, _ := json.Marshal(picks)
		if _, err := db.Write.Exec(`INSERT INTO days (day, questions) VALUES (?, ?)`, day, string(data)); err != nil {
			t.Fatal(err)
		}
	}
	first, second := live[0].Base().ID, live[1].Base().ID
	put("2026-11-01", first)                     // more than a week before: neither shown nor held against
	put("2026-11-18", second)                    // the week before
	put("2026-11-20", live[2].Base().ID)         // the first day shown
	put("2026-11-22", second, live[3].Base().ID) // its subject again, four days on
	put("2026-11-23", live[4].Base().ID)         // past -n 2
	db.Close()

	ro, err := store.OpenReadOnly(path)
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	before, days, err := play.New(ro, func() *bank.Bank { return nil }).DaysDrawn(context.Background(), "2026-11-20", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(before) != 1 || before[0].Day != "2026-11-18" || len(days) != 2 || days[1].Day != "2026-11-22" {
		t.Fatalf("before %v, days %v", before, days)
	}
	var out strings.Builder
	printDays(&out, b, problems, before, days)
	s := out.String()
	for _, want := range []string{"2 days, 2026-11-20 to 2026-11-22", live[2].Base().Text, bank.AnswerText(live[2]),
		"fact: " + live[2].Extra().Fact, "again within a week", "on 2026-11-18"} {
		if !strings.Contains(s, want) {
			t.Errorf("no %q in\n%s", want, s)
		}
	}
	if strings.Contains(s, live[4].Base().ID) {
		t.Errorf("a day past -n shown:\n%s", s)
	}
}
