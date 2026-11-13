package main

import (
	"context"
	"fmt"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

// bankCalibrate prints each question whose difficulty disagrees with what players have done with it (with enough
// answers), and how well the labels separate on the whole. Run it where the game's database is (DB_PATH), on the bank
// the game plays.
func bankCalibrate(dir string) error {
	b, problems := bank.Load(dir)
	if b == nil {
		return fmt.Errorf("%s: %d problems: fix the bank first", dir, len(problems))
	}
	db, err := store.Open(dbPath())
	if err != nil {
		return err
	}
	defer db.Close()
	g := play.New(db, func() *bank.Bank { return b })
	list, err := g.Calibrate(context.Background())
	if err != nil {
		return err
	}
	type tally struct{ n, agree int }
	by := map[bank.Difficulty]*tally{bank.Easy: {}, bank.Medium: {}, bank.Hard: {}}
	for _, c := range list {
		t := by[c.Labelled]
		if t == nil {
			continue
		}
		t.n++
		if c.Observed == c.Labelled {
			t.agree++
		}
	}
	fmt.Printf("%d questions with at least %d answers; labels the answers agree with:\n", len(list), play.CalibrateFrom)
	for _, d := range bank.Difficulties {
		fmt.Printf("  %-6s %d of %d\n", d, by[d].agree, by[d].n)
	}
	fmt.Printf("known above chance: easy from %.0f%%, medium from %.0f%%, hard below\n\n", 100*play.EasyFrom, 100*play.MediumFrom)
	for _, c := range list {
		if c.Observed == c.Labelled {
			continue
		}
		q, _ := b.Get(c.ID)
		fmt.Printf("%-8s %-9s %-6s → %-6s %3.0f%% known (%d answers)  %s\n", c.ID, c.Type, c.Labelled, c.Observed,
			100*c.Known, c.Answers, q.Base().Text)
	}
	return nil
}
