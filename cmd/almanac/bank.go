package main

import (
	"errors"
	"fmt"
	"os"
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
	return strings.TrimRight(s.String(), "\n")
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
