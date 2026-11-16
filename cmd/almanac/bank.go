package main

import (
	"errors"
	"flag"
	"fmt"
	"math"
	"os"
	"slices"
	"strings"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
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
	case "lint":
		fs := flag.NewFlagSet("bank lint", flag.ContinueOnError)
		rules := fs.String("rule", "", "only these rules (comma-separated: giveaway,stale)")
		short := fs.Bool("summary", false, "only the count of each rule")
		if err := fs.Parse(rest); err != nil {
			return usage()
		}
		into := defaultBankDir()
		if fs.NArg() > 0 {
			into = fs.Arg(0)
		}
		return bankLint(into, *rules, *short)
	case "subjects":
		return bankSubjects(dir())
	case "calibrate":
		return bankCalibrate(dir())
	case "plan":
		return bankPlan(rest)
	case "add":
		fs := flag.NewFlagSet("bank add", flag.ContinueOnError)
		dry := fs.Bool("check", false, "only check the batch: write nothing")
		checkedBy := fs.String("checked-by", "", `mark the new questions checked today by this ("new-questions fable-5.2")`)
		if err := fs.Parse(rest); err != nil || fs.NArg() == 0 {
			return usage()
		}
		into := defaultBankDir()
		if fs.NArg() > 1 {
			into = fs.Arg(1)
		}
		return bankAdd(fs.Arg(0), into, *checkedBy, *dry)
	}
	return usage()
}

// bankAdd adds a checked batch (bank.Add) to a bank: all of it, or nothing. dry (-check) only checks it and says what
// it would do: a writer checks one category's part this way, before the batch is whole.
func bankAdd(from, dir, checkedBy string, dry bool) error {
	res, err := bank.Add(dir, from, checkedBy, dry)
	if err != nil {
		return err
	}
	for _, p := range res.Warnings {
		fmt.Println(p)
	}
	var sizes []string
	for _, c := range res.Sizes {
		sizes = append(sizes, c.String())
	}
	verb := "added"
	if dry {
		verb = "would be added (nothing written)"
	}
	fmt.Printf("%s: %d questions %s, %d retired; live after: %s\n", dir, res.Added, verb, res.Retired, strings.Join(sizes, ", "))
	return nil
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

// bankCheck checks everything the server checks before it plays a bank, and the owner's rule that the categories are
// about the same size (bank.SizeSlack; unbalanced lets the small public sample pass). It prints every error, and
// counts the warnings by rule (bank lint lists them); it reports the mix; the day's runway: how long each place of a
// day has questions for, where the next batch writes first; and the subjects that come back. Its last line counts
// the problems.
func bankCheck(dir string, unbalanced bool) error {
	b, problems := bank.Load(dir)
	count := bank.CountOf(problems)
	tally := fmt.Sprintf("%s: %s", dir, count)
	if count.Warnings > 0 {
		tally += ": almanac bank lint lists them"
	}
	for _, p := range problems {
		if !p.Warning {
			fmt.Println(p)
		}
	}
	if b == nil {
		fmt.Println(tally)
		return fmt.Errorf("%s: %d errors: the server would not play this bank", dir, count.Errors)
	}
	fmt.Println(summary(b))
	fmt.Println(runway(b))
	fmt.Println(subjects(b, SubjectsShown))
	fmt.Println(tally)
	if off, mean := b.Uneven(); len(off) > 0 && !unbalanced {
		return fmt.Errorf("%s: categories more than %.0f%% off the mean of %.0f: %s (a batch adds to every category alike)",
			dir, 100*bank.SizeSlack, mean, countList(off))
	}
	return nil
}

func countList(cs []bank.CategoryCount) string {
	var parts []string
	for _, c := range cs {
		parts = append(parts, c.String())
	}
	return strings.Join(parts, ", ")
}

// bankLint lists every problem of a bank by rule (bank.Rules, the format's first), each with its question's id: what
// a content pass works through. rules ("giveaway,stale") keeps only those; short prints only each rule's count.
func bankLint(dir, rules string, short bool) error {
	_, problems := bank.Load(dir)
	want := map[string]bool{}
	for _, r := range strings.Split(rules, ",") {
		if r = strings.TrimSpace(r); r != "" {
			if _, ok := bank.RuleNamed(r); !ok && !slices.Contains(bank.RuleOrder(), r) {
				return fmt.Errorf("no rule %q: the rules are %s", r, strings.Join(bank.RuleOrder(), ", "))
			}
			want[r] = true
		}
	}
	byRule := map[string][]bank.Problem{}
	for _, p := range problems {
		r := p.Rule
		if r == "" {
			r = "format"
		}
		if len(want) == 0 || want[r] {
			byRule[r] = append(byRule[r], p)
		}
	}
	all := bank.CountOf(nil)
	for _, r := range bank.RuleOrder() {
		ps := byRule[r]
		if len(ps) == 0 {
			continue
		}
		c := bank.CountOf(ps)
		all.Errors, all.Warnings = all.Errors+c.Errors, all.Warnings+c.Warnings
		says := "the format: lengths, fields, dates"
		if rule, ok := bank.RuleNamed(r); ok {
			says = rule.Says
		}
		fmt.Printf("%-14s %5d errors %5d warnings   %s\n", r, c.Errors, c.Warnings, says)
		if short {
			continue
		}
		slices.SortStableFunc(ps, func(x, y bank.Problem) int { return strings.Compare(x.ID, y.ID) })
		for _, p := range ps {
			mark := "warning"
			if !p.Warning {
				mark = "ERROR"
			}
			where := p.ID
			if where == "" {
				where = p.File
			}
			fmt.Printf("  %-9s %-7s %s\n", where, mark, p.Msg)
		}
	}
	fmt.Printf("%s: %d errors, %d warnings\n", dir, all.Errors, all.Warnings)
	return nil
}

// RunwayMin is the fewest days of the day's questions a place should have left: below it, `bank check` warns, and the
// next batch writes for that place first.
const RunwayMin = 180

// runway says how many days of the day's questions the bank holds for each place of a day (play.DayRunway), counting
// the whole bank (the days already played have spent some: production has had a day since 12 Nov 2026), and warns of
// the places below RunwayMin. It warns rather than fails: a bank fix must still pass while a short place waits for
// its batch.
func runway(b *bank.Bank) string {
	var s strings.Builder
	s.WriteString("the day's runway (days of questions left for each place, the whole bank; shortest first):\n")
	places := play.DayRunway(b, nil)
	slices.SortStableFunc(places, func(x, y play.Runway) int { return x.Days - y.Days })
	for _, r := range places {
		warn := ""
		if r.Days < RunwayMin {
			warn = fmt.Sprintf("   warning: under %d days: write for it first", RunwayMin)
		}
		fmt.Fprintf(&s, "  %-34s %5d%s\n", r.Place, r.Days, warn)
	}
	return strings.TrimRight(s.String(), "\n")
}

// SubjectMost is how many live questions may name one subject before it's listed; SubjectShare is the share of a
// category one subject should stay under (the questions skill's soft cap); SubjectsShown is how many of each list
// `bank check` shows (`bank subjects` shows them all).
const (
	SubjectMost   = 15
	SubjectShare  = 0.01
	SubjectsShown = 20
)

// bankSubjects lists every subject that comes back (subjects), for a batch that writes away from them or a pass that
// retires the weaker of two identities.
func bankSubjects(dir string) error {
	b, problems := bank.Load(dir)
	if b == nil {
		for _, p := range problems {
			fmt.Println(p)
		}
		return errors.New("fix the errors first")
	}
	fmt.Println(subjects(b, 0))
	return nil
}

// subjects lists, without failing, the subjects that come back (bank.Repeats): the answers and names more than
// SubjectMost live questions name, with the categories they fall in (marked where over SubjectShare of one); and the
// "who or what is this" questions that share an answer (bank.SameIdentity), of which one is enough. Each list stops
// at shown lines (0: all of them).
func subjects(b *bank.Bank, shown int) string {
	var s strings.Builder
	size := map[string]int{}
	for _, c := range b.Categories {
		size[c.ID] = len(b.Live(c.ID, ""))
	}
	// cut says, at line i of n, whether the list stops there, and how many it leaves out.
	cut := func(i, n int) bool {
		if shown > 0 && i == shown {
			fmt.Fprintf(&s, "  … and %d more: almanac bank subjects\n", n-shown)
			return true
		}
		return false
	}
	repeats := b.Repeats(SubjectMost)
	fmt.Fprintf(&s, "subjects that come back: %d named in more than %d live questions (text, options, clues, items; * over %.0f%% of a category)\n",
		len(repeats), SubjectMost, 100*SubjectShare)
	for i, r := range repeats {
		if cut(i, len(repeats)) {
			break
		}
		var where []string
		for _, c := range b.Spread(r) {
			mark := ""
			if float64(c.N) > SubjectShare*float64(size[c.Category]) {
				mark = "*"
			}
			where = append(where, c.String()+mark)
		}
		fmt.Fprintf(&s, "  %5d  %-28s %s\n", len(r.IDs), r.Name, strings.Join(where, ", "))
	}
	same := b.SameIdentity()
	fmt.Fprintf(&s, "the same answer twice: %d \"who or what is this\" answers asked by more than one picture choice or clues (one is enough)\n", len(same))
	for i, g := range same {
		if cut(i, len(same)) {
			break
		}
		fmt.Fprintf(&s, "  %-30s %s\n", g.Name, strings.Join(g.IDs, ", "))
	}
	return strings.TrimRight(s.String(), "\n")
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
			if bank.HasPictures(q) {
				pictures++
			}
		}
		fmt.Fprintf(&s, "%11d\n", pictures)
	}
	s.WriteString(balance(b))
	return strings.TrimRight(s.String(), "\n")
}

// balance says how the bank stands against its aims: a fact and dates on every question, every kind at its share of
// every category.
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
	fmt.Fprintf(&s, "\ndifficulty   %d/%d/%d%% easy/medium/hard (no aim: batches follow the day's runway)\n",
		pct(all[bank.Easy], bal.Total), pct(all[bank.Medium], bal.Total), pct(all[bank.Hard], bal.Total))
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
		share := 0.0
		if bal.Total > 0 {
			share = 100 * float64(kinds[t]) / float64(bal.Total)
		}
		fmt.Fprintf(&s, " %s %.1f%% (aim %.1f)", t, share, 100*bank.TypeMix[t])
	}
	s.WriteString("\n")
	// Each category's kinds against its TypeMix share: what the topic games draw from.
	if bal.Off == 0 {
		s.WriteString("kinds mix    every category at its share of every kind\n")
		return s.String()
	}
	fmt.Fprintf(&s, "kinds mix    %d questions to write for every category to have its share of each kind (+ to write, − over):\n", bal.Off)
	fmt.Fprintf(&s, "  %-10s", "")
	for _, t := range bank.TypeOrder {
		fmt.Fprintf(&s, "%10s", t)
	}
	s.WriteString("\n")
	for _, c := range b.Categories {
		fmt.Fprintf(&s, "  %-10s", c.ID)
		for _, t := range bank.TypeOrder {
			fmt.Fprintf(&s, "%10s", fmt.Sprintf("%+d", bal.Gaps[c.ID][t]))
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
