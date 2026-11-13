package main

import (
	"errors"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"

	"github.com/almanac-bg/almanac/internal/bank"
)

func bankCommand(args []string) error {
	if len(args) == 0 {
		return usage()
	}
	dir := func() string {
		if len(args) > 1 {
			return args[1]
		}
		return defaultBankDir()
	}
	switch args[0] {
	case "check":
		return bankCheck(dir())
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

func bankCheck(dir string) error {
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

// balance says how the bank stands against its aims (bank.Mix, equal categories, a fact and dates on every
// question), and what each category needs to get there by adding questions.
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
	fmt.Fprintf(&s, "to the aim   every category at %d, adding (easy/medium/hard):\n", bal.Size)
	for _, c := range b.Categories {
		a := bal.Add[c.ID]
		fmt.Fprintf(&s, "  %-10s %d/%d/%d\n", c.ID, a[bank.Easy], a[bank.Medium], a[bank.Hard])
	}
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
	fmt.Fprintf(&s, "\nto the kinds every category at %d, adding (%s):\n", bal.TypeSize, strings.Join(bank.TypeOrder, "/"))
	for _, c := range b.Categories {
		a := bal.AddTypes[c.ID]
		parts := make([]string, len(bank.TypeOrder))
		for i, t := range bank.TypeOrder {
			parts[i] = strconv.Itoa(a[t])
		}
		fmt.Fprintf(&s, "  %-10s %s\n", c.ID, strings.Join(parts, "/"))
	}
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
