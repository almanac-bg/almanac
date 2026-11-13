package main

import (
	"errors"
	"fmt"
	"math"
	"os"
	"strings"

	"github.com/almanac-bg/almanac/internal/bank"
)

func bankCommand(args []string) error {
	if len(args) == 0 {
		return usage()
	}
	// check takes -unbalanced: a bank that isn't fully balanced (the public sample) passes, with its gaps reported.
	unbalanced := false
	rest := args[1:]
	if args[0] == "check" && len(rest) > 0 && rest[0] == "-unbalanced" {
		unbalanced, rest = true, rest[1:]
	}
	dir := func() string {
		if len(rest) > 0 {
			return rest[0]
		}
		return defaultBankDir()
	}
	switch args[0] {
	case "check":
		return bankCheck(dir(), unbalanced)
	case "fmt":
		return bankFmt(dir())
	case "calibrate":
		return bankCalibrate(dir())
	}
	return usage()
}

// defaultBankDir is the private bank when there is one (a clone in private/), else the public sample.
func defaultBankDir() string {
	if dir := os.Getenv("BANK_DIR"); dir != "" {
		return dir
	}
	if _, err := os.Stat("private/" + bank.CategoriesFile); err == nil {
		return "private"
	}
	return "bank/sample"
}

// bankCheck checks everything the server checks before it plays a bank, and the owner's rule that the bank is fully
// balanced: every category the same size, with the same number of questions in every kind and difficulty. An
// unbalanced bank still plays, but fails the check unless unbalanced is set, so a batch can't be committed half done.
func bankCheck(dir string, unbalanced bool) error {
	b, problems := bank.Load(dir)
	errs := 0
	for _, p := range problems {
		fmt.Println(p)
		if !p.Warning {
			errs++
		}
	}
	if b == nil {
		return fmt.Errorf("%s: %d problems: the server would not play this bank", dir, errs)
	}
	fmt.Println(summary(b))
	if off := b.BalanceOf().Off; off > 0 && !unbalanced {
		return fmt.Errorf("%s: not fully balanced (%d questions out of place): write for the + cells, judge again or retire the − ones", dir, off)
	}
	return nil
}

// summary counts what a bank holds, by category, type and difficulty.
func summary(b *bank.Bank) string {
	var s strings.Builder
	types := bank.Types()
	fmt.Fprintf(&s, "%s: %d questions (%d live)\n", b.Dir, len(b.Questions), len(b.Live("", "")))
	fmt.Fprintf(&s, "%-12s", "")
	for _, t := range types {
		fmt.Fprintf(&s, "%22s", t+" (e/m/h)")
	}
	s.WriteString("   pictures\n")
	for _, c := range b.Categories {
		fmt.Fprintf(&s, "%-12s", c.ID)
		for _, t := range types {
			n := map[bank.Difficulty]int{}
			for _, q := range b.Live(c.ID, t) {
				n[q.Base().Difficulty]++
			}
			fmt.Fprintf(&s, "%22s", fmt.Sprintf("%d/%d/%d", n[bank.Easy], n[bank.Medium], n[bank.Hard]))
		}
		pictures := 0
		for _, q := range b.Live(c.ID, "") {
			if q.Extra().Image != nil {
				pictures++
			}
		}
		fmt.Fprintf(&s, "%11d\n", pictures)
	}
	s.WriteString(balance(b))
	return strings.TrimRight(s.String(), "\n")
}

// balance says how the bank stands against its aims (full balance, a fact and dates on every question), and per
// category, kind and difficulty what to write or judge again to get there.
func balance(b *bank.Bank) string {
	var s strings.Builder
	bal := b.BalanceOf()
	pct := func(n, of int) int {
		if of == 0 {
			return 0
		}
		return int(math.Round(100 * float64(n) / float64(of)))
	}
	all := map[bank.Difficulty]int{}
	for _, n := range bal.Live {
		for d, k := range n {
			all[d] += k
		}
	}
	fmt.Fprintf(&s, "\ndifficulty   %d/%d/%d%% easy/medium/hard (aim %.0f/%.0f/%.0f)\n",
		pct(all[bank.Easy], bal.Total), pct(all[bank.Medium], bal.Total), pct(all[bank.Hard], bal.Total),
		100*bank.Mix[bank.Easy], 100*bank.Mix[bank.Medium], 100*bank.Mix[bank.Hard])
	fmt.Fprintf(&s, "facts        %d of %d (%d without)\n", bal.Facts, bal.Total, bal.Total-bal.Facts)
	fmt.Fprintf(&s, "dates        added on %d, updated on %d (of %d)\n", bal.Added, bal.Updated, bal.Total)
	kinds := map[string]int{}
	for _, n := range bal.Types {
		for t, k := range n {
			kinds[t] += k
		}
	}
	s.WriteString("kinds       ")
	for _, t := range bank.TypeOrder {
		fmt.Fprintf(&s, " %s %d%% (aim %.1f)", t, pct(kinds[t], bal.Total), 100*bank.TypeMix[t])
	}
	s.WriteString("\n")
	// Full balance: per category, kind and difficulty, what to write (+) or judge again or retire (−).
	if bal.Off == 0 {
		s.WriteString("balance      full: every category, kind and difficulty on its aim\n")
		return s.String()
	}
	fmt.Fprintf(&s, "balance      %d questions out of place; every category at %d, each kind easy/medium/hard (+ write, − judge again or retire):\n",
		bal.Off, bal.Target)
	fmt.Fprintf(&s, "  %-10s", "")
	for _, t := range bank.TypeOrder {
		fmt.Fprintf(&s, "%16s", t)
	}
	s.WriteString("\n")
	for _, c := range b.Categories {
		fmt.Fprintf(&s, "  %-10s", c.ID)
		for _, t := range bank.TypeOrder {
			g := bal.Gaps[c.ID][t]
			fmt.Fprintf(&s, "%16s", fmt.Sprintf("%+d/%+d/%+d", g[bank.Easy], g[bank.Medium], g[bank.Hard]))
		}
		s.WriteString("\n")
	}
	return s.String()
}

// bankFmt rewrites the bank's files in their one format. It refuses a bank with errors: fix those first.
func bankFmt(dir string) error {
	b, problems := bank.Load(dir)
	if b == nil {
		for _, p := range problems {
			fmt.Println(p)
		}
		return errors.New("fix the errors first")
	}
	for _, c := range b.Categories {
		if err := bank.WriteCategory(dir, c.ID, b.InCategory(c.ID)); err != nil {
			return err
		}
	}
	return bank.WriteCategories(dir, b.Categories)
}
