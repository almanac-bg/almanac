package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

// bankDays prints the issues to come: the days' tens as the game has drawn them (play.Game.DaysDrawn, from the
// database at DB_PATH, opened read-only), each question with its answer, options, fact and the rules it breaks, and
// the subjects that come back within a week, so that a session reads the next weeks' issues before players do (the
// questions skill's weekly pre-check). Production draws them play.Ahead days ahead. -json prints only the days and their
// question ids (nothing of a player's, and no answers: for a work list).
//
// On the server, as the game's user with its settings (BANK_DIR then names the bank it plays):
//
//	systemd-run --pipe --wait -p User=almanac -p EnvironmentFile=/etc/almanac/env /usr/local/bin/almanac bank days -n 30
func bankDays(args []string) error {
	fs := flag.NewFlagSet("bank days", flag.ContinueOnError)
	n := fs.Int("n", 30, "how many days")
	from := fs.String("from", "", "the first day (YYYY-MM-DD; today if empty)")
	asJSON := fs.Bool("json", false, "only the days and their question ids, as JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *from == "" {
		*from = today()
	}
	if _, err := time.Parse(time.DateOnly, *from); err != nil {
		return fmt.Errorf("-from %q isn't a day (YYYY-MM-DD)", *from)
	}
	db, err := store.OpenReadOnly(dbPath())
	if err != nil {
		return err
	}
	defer db.Close()
	before, days, err := play.New(db, func() *bank.Bank { return nil }).DaysDrawn(context.Background(), *from, *n)
	if err != nil {
		return err
	}
	if *asJSON {
		type day struct {
			Day string   `json:"day"`
			IDs []string `json:"ids"`
		}
		out := []day{}
		for _, d := range days {
			ids := []string{}
			for _, p := range d.Picks {
				ids = append(ids, p.ID)
			}
			out = append(out, day{d.Day, ids})
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", " ")
		return enc.Encode(out)
	}
	dir := defaultBankDir()
	if fs.NArg() > 0 {
		dir = fs.Arg(0)
	}
	b, problems := bank.Load(dir)
	if b == nil {
		return fmt.Errorf("%s: %d errors: fix the bank first (or -json for the ids alone)", dir, bank.CountOf(problems).Errors)
	}
	printDays(os.Stdout, b, problems, before, days)
	return nil
}

// printDays writes the days' tens for a reader: each day, then each question in its place, with what it asks, its
// answer and options, its fact (and its day's line on its date), the rules lint finds it breaking, and the subjects
// the play.Recent days before it named.
func printDays(w io.Writer, b *bank.Bank, problems []bank.Problem, before, days []play.Drawn) {
	broken := map[string][]string{}
	for _, p := range problems {
		if p.ID != "" && p.Rule != "" {
			broken[p.ID] = append(broken[p.ID], p.Rule+": "+p.Msg)
		}
	}
	all := append(slices.Clone(before), days...)
	if len(days) == 0 {
		fmt.Fprintln(w, "no days drawn from then on")
		return
	}
	fmt.Fprintf(w, "%d days, %s to %s\n", len(days), days[0].Day, days[len(days)-1].Day)
	for i, d := range days {
		at := len(before) + i
		// The subjects the week before named, and which day.
		named := map[string]string{}
		t, _ := time.Parse(time.DateOnly, d.Day)
		week := t.AddDate(0, 0, -play.Recent).Format(time.DateOnly)
		for _, o := range all[:at] {
			if o.Day < week {
				continue
			}
			for _, p := range o.Picks {
				if q, ok := b.Get(p.ID); ok {
					for _, k := range bank.Subjects(q) {
						named[k] = o.Day
					}
				}
			}
		}
		fmt.Fprintf(w, "\n%s (%s)\n", d.Day, t.Weekday())
		for n, p := range d.Picks {
			q, ok := b.Get(p.ID)
			if !ok {
				fmt.Fprintf(w, "%2d  %s: not in this bank\n", n+1, p.ID)
				continue
			}
			h, tail := q.Base(), q.Extra()
			var marks []string
			if tail.BG {
				marks = append(marks, "bg")
			}
			if tail.OnDay(d.Day) {
				marks = append(marks, "на този ден")
			}
			if tail.Retired {
				marks = append(marks, "RETIRED")
			}
			if tail.ReviewBy != "" && tail.ReviewBy <= d.Day {
				marks = append(marks, "due for review")
			}
			if len(tail.Sources) == 0 {
				marks = append(marks, "no sources")
			}
			fmt.Fprintf(w, "%2d  %-9s %-10s %-6s %-9s %s\n", n+1, h.ID, h.Category, h.Difficulty, h.Type, strings.Join(marks, ", "))
			fmt.Fprintf(w, "    %s\n", h.Text)
			for _, c := range cluesOf(q) {
				fmt.Fprintf(w, "    clue: %s\n", c)
			}
			fmt.Fprintf(w, "    = %s\n", answerOf(q))
			if tail.OnDay(d.Day) && tail.Day != "" {
				fmt.Fprintf(w, "    day: %s\n", tail.Day)
			}
			fmt.Fprintf(w, "    fact: %s\n", tail.Fact)
			for _, r := range broken[h.ID] {
				fmt.Fprintf(w, "    ! %s\n", r)
			}
			for _, k := range bank.Subjects(q) {
				if on, ok := named[k]; ok {
					fmt.Fprintf(w, "    ! again within a week: %q, on %s\n", k, on)
				}
			}
		}
	}
}

// answerOf is a question's answer as a keeper reads it (bank.KeeperText), with a choice's wrong options and a number's
// tolerance.
func answerOf(q bank.Question) string {
	s := bank.KeeperText(q)
	switch q := q.(type) {
	case *bank.Choice:
		s += "   (wrong: " + strings.Join(q.Wrong, ", ") + ")"
	case *bank.Clues:
		s += "   (wrong: " + strings.Join(q.Wrong, ", ") + ")"
	case *bank.Number:
		how := "±"
		if q.Scale == "log" {
			how = "×÷"
		}
		s += fmt.Sprintf("   (%s%g)", how, q.Tolerance)
	}
	return s
}

// cluesOf are a question's clues, if it has any.
func cluesOf(q bank.Question) []string {
	if c, ok := q.(*bank.Clues); ok {
		return c.Clues
	}
	return nil
}
