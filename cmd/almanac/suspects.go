package main

import (
	"context"
	"fmt"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

// bankSuspects prints the questions whose players' answers speak against the key (play.Suspects), one a line: the
// id, how many answers, and what they say. Run it where the game's database is (DB_PATH), on the bank the game plays.
func bankSuspects(dir string) error {
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
	if err := g.CountCrowds(context.Background()); err != nil { // of now, not the count the server kept
		return err
	}
	list, err := g.Suspects(context.Background())
	if err != nil {
		return err
	}
	for _, s := range list {
		fmt.Printf("%s\t%d\t%s\n", s.ID, s.Answers, s.Why)
	}
	return nil
}
